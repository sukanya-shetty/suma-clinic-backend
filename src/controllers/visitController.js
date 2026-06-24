const pool = require('../config/db');

// ===== FUNCTION 1: createVisit() =====
const createVisit = async (req, res) => {
    try {
        const { patient_id, visit_date, diagnosis, blood_pressure, temperature, notes } = req.body;
        const doctor_id = req.user.id;
        const isDoctor = req.user && req.user.role === 'Doctor';

        if (!patient_id || !visit_date) {
            return res.status(400).json({ 
                error: 'Required fields: patient_id, visit_date' 
            });
        }

        const finalDiagnosis = diagnosis ? diagnosis.trim() : 'General Visit';
        const finalBloodPressure = blood_pressure || 'N/A';
        const finalTemperature = temperature ? parseFloat(temperature) : 98.6;

        if (finalBloodPressure !== 'N/A' && !finalBloodPressure.match(/^\d+\/\d+$/)) {
            return res.status(400).json({ 
                error: 'Blood pressure must be in format: SYS/DIA (e.g., 120/80)' 
            });
        }

        if (isNaN(finalTemperature) || finalTemperature < 90 || finalTemperature > 110) {
            return res.status(400).json({ 
                error: 'Temperature must be a number between 90 and 110' 
            });
        }

        const connection = await pool.getConnection();

        // Check if patient exists and is assigned to this doctor
        const [patientCheck] = await connection.query(
            'SELECT patient_id, assigned_doctor_id FROM patients WHERE patient_id = ?',
            [patient_id]
        );

        if (patientCheck.length === 0) {
            connection.release();
            return res.status(404).json({ error: 'Patient not found' });
        }

        if (isDoctor && patientCheck[0].assigned_doctor_id !== doctor_id) {
            connection.release();
            return res.status(403).json({ error: 'Access denied. You can only create visits for patients assigned to you.' });
        }

        const [result] = await connection.query(
            'INSERT INTO visits (doctor_id, patient_id, visit_date, diagnosis, blood_pressure, temperature, notes) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [doctor_id, patient_id, visit_date, finalDiagnosis, finalBloodPressure, finalTemperature, notes || null]
        );

        connection.release();

        return res.status(201).json({
            message: 'Visit created successfully',
            visit: {
                visit_id: result.insertId,
                doctor_id: doctor_id,
                patient_id: patient_id,
                visit_date: visit_date,
                diagnosis: finalDiagnosis,
                blood_pressure: finalBloodPressure,
                temperature: finalTemperature,
                notes: notes || null
            }
        });

    } catch (error) {
        console.error('Error in createVisit:', error);
        return res.status(500).json({ error: 'Database error while creating visit' });
    }
};

// ===== FUNCTION 2: getPatientVisits() =====
const getPatientVisits = async (req, res) => {
    try {
        const { patient_id } = req.params;
        const isDoctor = req.user && req.user.role === 'Doctor';

        const connection = await pool.getConnection();

        // Doctor check
        if (isDoctor) {
            const [patientCheck] = await connection.query(
                'SELECT assigned_doctor_id FROM patients WHERE patient_id = ?',
                [patient_id]
            );
            if (patientCheck.length === 0 || patientCheck[0].assigned_doctor_id !== req.user.id) {
                connection.release();
                return res.status(403).json({ error: 'Access denied. Patient is assigned to another doctor.' });
            }
        }

        const [visits] = await connection.query(
            'SELECT visit_id, doctor_id, patient_id, visit_date, diagnosis, blood_pressure, temperature, notes, created_at FROM visits WHERE patient_id = ? ORDER BY visit_date DESC',
            [patient_id]
        );

        connection.release();

        return res.status(200).json({
            message: 'Patient visits retrieved successfully',
            total: visits.length,
            visits: visits
        });

    } catch (error) {
        console.error('Error in getPatientVisits:', error);
        return res.status(500).json({ error: 'Database error while retrieving visits' });
    }
};

// ===== FUNCTION 3: updateVisit() =====
const updateVisit = async (req, res) => {
    try {
        const { id } = req.params;
        const { diagnosis, blood_pressure, temperature, notes } = req.body;
        const isDoctor = req.user && req.user.role === 'Doctor';

        if (!diagnosis && !blood_pressure && !temperature && !notes) {
            return res.status(400).json({ 
                error: 'Provide at least one field to update.' 
            });
        }

        const connection = await pool.getConnection();

        const [visitCheck] = await connection.query(
            'SELECT visit_id, doctor_id FROM visits WHERE visit_id = ?',
            [id]
        );

        if (visitCheck.length === 0) {
            connection.release();
            return res.status(404).json({ error: 'Visit not found' });
        }

        if (isDoctor && visitCheck[0].doctor_id !== req.user.id) {
            connection.release();
            return res.status(403).json({ error: 'Access denied. You can only update your own visits.' });
        }

        const updateFields = [];
        const updateValues = [];

        if (diagnosis !== undefined) {
            updateFields.push('diagnosis = ?');
            updateValues.push(diagnosis ? diagnosis.trim() : 'General Visit');
        }

        if (blood_pressure !== undefined) {
            if (blood_pressure && blood_pressure !== 'N/A' && !blood_pressure.match(/^\d+\/\d+$/)) {
                connection.release();
                return res.status(400).json({ 
                    error: 'Blood pressure must be in format: SYS/DIA (e.g., 120/80)' 
                });
            }
            updateFields.push('blood_pressure = ?');
            updateValues.push(blood_pressure || 'N/A');
        }

        if (temperature !== undefined) {
            const tempVal = temperature ? parseFloat(temperature) : 98.6;
            if (isNaN(tempVal) || tempVal < 90 || tempVal > 110) {
                connection.release();
                return res.status(400).json({ 
                    error: 'Temperature must be a number between 90 and 110' 
                });
            }
            updateFields.push('temperature = ?');
            updateValues.push(tempVal);
        }

        if (notes !== undefined) {
            updateFields.push('notes = ?');
            updateValues.push(notes || null);
        }

        updateValues.push(id);

        const updateQuery = `UPDATE visits SET ${updateFields.join(', ')} WHERE visit_id = ?`;
        await connection.query(updateQuery, updateValues);

        const [updatedVisit] = await connection.query(
            'SELECT visit_id, doctor_id, patient_id, visit_date, diagnosis, blood_pressure, temperature, notes FROM visits WHERE visit_id = ?',
            [id]
        );

        connection.release();

        return res.status(200).json({
            message: 'Visit updated successfully',
            visit: updatedVisit[0]
        });

    } catch (error) {
        console.error('Error in updateVisit:', error);
        return res.status(500).json({ error: 'Database error while updating visit' });
    }
};

// ===== FUNCTION 4: deleteVisit() =====
const deleteVisit = async (req, res) => {
    try {
        const { id } = req.params;
        const isDoctor = req.user && req.user.role === 'Doctor';

        const connection = await pool.getConnection();

        const [visitCheck] = await connection.query(
            'SELECT visit_id, doctor_id FROM visits WHERE visit_id = ?',
            [id]
        );

        if (visitCheck.length === 0) {
            connection.release();
            return res.status(404).json({ error: 'Visit not found' });
        }

        if (isDoctor && visitCheck[0].doctor_id !== req.user.id) {
            connection.release();
            return res.status(403).json({ error: 'Access denied. You can only delete your own visits.' });
        }

        await connection.query(
            'DELETE FROM visits WHERE visit_id = ?',
            [id]
        );

        connection.release();

        return res.status(200).json({
            message: 'Visit deleted successfully',
            visit_id: id
        });

    } catch (error) {
        console.error('Error in deleteVisit:', error);
        return res.status(500).json({ error: 'Database error while deleting visit' });
    }
};

// ===== FUNCTION 5: getRecentVisits() =====
const getRecentVisits = async (req, res) => {
    try {
        const isDoctor = req.user && req.user.role === 'Doctor';
        let queryStr = `
             SELECT v.visit_id, v.patient_id, p.patient_name, v.visit_date, v.diagnosis, v.blood_pressure, v.temperature, v.notes 
             FROM visits v 
             JOIN patients p ON v.patient_id = p.patient_id
        `;
        const params = [];

        if (isDoctor) {
            queryStr += ' WHERE p.assigned_doctor_id = ?';
            params.push(req.user.id);
        }

        queryStr += ' ORDER BY v.visit_date DESC LIMIT 10';

        const [visits] = await pool.query(queryStr, params);
        
        return res.status(200).json({
            success: true,
            visits
        });
    } catch (error) {
        console.error('Error in getRecentVisits:', error);
        return res.status(500).json({ error: 'Database error while fetching recent visits' });
    }
};

module.exports = {
    createVisit,
    getPatientVisits,
    updateVisit,
    deleteVisit,
    getRecentVisits
};

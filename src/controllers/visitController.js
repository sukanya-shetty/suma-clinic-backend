const pool = require('../config/db');

// ===== FUNCTION 1: createVisit() =====
// Purpose: Create a new visit record for a patient
// Input: { patient_id, visit_date, diagnosis, blood_pressure, temperature, notes }
// Doctor_id is automatically set from JWT token (req.user.id)
// Returns: 201 Created / 400 Bad Request / 404 Not Found / 500 Error
const createVisit = async (req, res) => {
    try {
        // STEP 1: Extract fields from request body
        const { patient_id, visit_date, diagnosis, blood_pressure, temperature, notes } = req.body;
        const doctor_id = req.user.id; // Get doctor_id from JWT token (authMiddleware decoded it)

        // STEP 2: Validate all required fields exist
        if (!patient_id || !visit_date || !diagnosis || !blood_pressure || !temperature) {
            return res.status(400).json({ 
                error: 'Required fields: patient_id, visit_date, diagnosis, blood_pressure, temperature' 
            });
        }

        // STEP 3: Validate blood_pressure format (should be like "120/80")
        if (!blood_pressure.match(/^\d+\/\d+$/)) {
            return res.status(400).json({ 
                error: 'Blood pressure must be in format: SYS/DIA (e.g., 120/80)' 
            });
        }

        // STEP 4: Validate temperature is a number between 90 and 110 (realistic range)
        const temp = parseFloat(temperature);
        if (isNaN(temp) || temp < 90 || temp > 110) {
            return res.status(400).json({ 
                error: 'Temperature must be a number between 90 and 110' 
            });
        }

        // STEP 5: Check if patient exists in database
        const [patientExists] = await pool.query(
            'SELECT patient_id FROM patients WHERE patient_id = ?',
            [patient_id]
        );

        if (patientExists.length === 0) {
            return res.status(404).json({ error: 'Patient not found' });
        }

        // STEP 6: Insert new visit into visits table
        // doctor_id is taken from JWT token (req.user.id) - cannot be spoofed
        const [result] = await pool.query(
            'INSERT INTO visits (doctor_id, patient_id, visit_date, diagnosis, blood_pressure, temperature, notes) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [doctor_id, patient_id, visit_date, diagnosis, blood_pressure, temperature, notes || null]
        );

        // STEP 7: Return success with new visit_id
        return res.status(201).json({
            message: 'Visit created successfully',
            visit: {
                visit_id: result.insertId,
                doctor_id: doctor_id,
                patient_id: patient_id,
                visit_date: visit_date,
                diagnosis: diagnosis,
                blood_pressure: blood_pressure,
                temperature: temperature,
                notes: notes || null
            }
        });

    } catch (error) {
        console.error('Error in createVisit:', error);
        return res.status(500).json({ error: 'Database error while creating visit' });
    }
};


// ===== FUNCTION 2: getPatientVisits() =====
// Purpose: Get all visits for a specific patient
// Input: patient_id (from URL param)
// Returns: 200 OK with array / 500 Error
const getPatientVisits = async (req, res) => {
    try {
        // STEP 1: Extract patient_id from URL params
        const { patient_id } = req.params;

        // STEP 2: Query all visits for this patient, ordered by most recent first
        const [visits] = await pool.query(
            'SELECT visit_id, doctor_id, patient_id, visit_date, diagnosis, blood_pressure, temperature, notes, created_at FROM visits WHERE patient_id = ? ORDER BY visit_date DESC',
            [patient_id]
        );

        // STEP 3: Return all visits
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
// Purpose: Update an existing visit record (partial update)
// Input: visit_id (from URL), { fields to update }
// Cannot update: visit_id, doctor_id, patient_id (foreign keys)
// Returns: 200 OK / 400 Bad Request / 404 Not Found / 500 Error
const updateVisit = async (req, res) => {
    try {
        // STEP 1: Extract visit_id from URL params (route uses :id)
        const { id } = req.params;
        const visit_id = id;

        // STEP 2: Extract updateable fields from request body
        const { diagnosis, blood_pressure, temperature, notes } = req.body;

        // STEP 3: Validate at least one field is provided for update
        if (!diagnosis && !blood_pressure && !temperature && !notes) {
            return res.status(400).json({ 
                error: 'Provide at least one field to update: diagnosis, blood_pressure, temperature, or notes' 
            });
        }

        // STEP 4: Check if visit exists
        const [visitExists] = await pool.query(
            'SELECT visit_id FROM visits WHERE visit_id = ?',
            [visit_id]
        );

        if (visitExists.length === 0) {
            return res.status(404).json({ error: 'Visit not found' });
        }

        // STEP 5: Build dynamic UPDATE query with only provided fields
        const updateFields = [];
        const updateValues = [];

        if (diagnosis) {
            updateFields.push('diagnosis = ?');
            updateValues.push(diagnosis);
        }

        if (blood_pressure) {
            // Validate blood_pressure format
            if (!blood_pressure.match(/^\d+\/\d+$/)) {
                return res.status(400).json({ 
                    error: 'Blood pressure must be in format: SYS/DIA (e.g., 120/80)' 
                });
            }
            updateFields.push('blood_pressure = ?');
            updateValues.push(blood_pressure);
        }

        if (temperature) {
            // Validate temperature is a number
            const temp = parseFloat(temperature);
            if (isNaN(temp) || temp < 90 || temp > 110) {
                return res.status(400).json({ 
                    error: 'Temperature must be a number between 90 and 110' 
                });
            }
            updateFields.push('temperature = ?');
            updateValues.push(temperature);
        }

        if (notes !== undefined) {
            updateFields.push('notes = ?');
            updateValues.push(notes || null);
        }

        // STEP 6: Add visit_id to query parameters (for WHERE clause)
        updateValues.push(visit_id);

        // STEP 7: Execute dynamic UPDATE query
        const updateQuery = `UPDATE visits SET ${updateFields.join(', ')} WHERE visit_id = ?`;
        await pool.query(updateQuery, updateValues);

        // STEP 8: Fetch updated visit to return
        const [updatedVisit] = await pool.query(
            'SELECT visit_id, doctor_id, patient_id, visit_date, diagnosis, blood_pressure, temperature, notes FROM visits WHERE visit_id = ?',
            [visit_id]
        );

        // STEP 9: Return updated visit
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
// Purpose: Delete a visit record (CASCADE deletes all related prescriptions)
// Input: visit_id (from URL)
// Returns: 200 OK / 404 Not Found / 500 Error
const deleteVisit = async (req, res) => {
    try {
        // STEP 1: Extract visit_id from URL params (route uses :id)
        const { id } = req.params;
        const visit_id = id;

        // STEP 2: Check if visit exists
        const [visitExists] = await pool.query(
            'SELECT visit_id FROM visits WHERE visit_id = ?',
            [visit_id]
        );

        if (visitExists.length === 0) {
            return res.status(404).json({ error: 'Visit not found' });
        }

        // STEP 3: Delete the visit
        // CASCADE will automatically delete all related prescriptions in prescriptions table
        await pool.query(
            'DELETE FROM visits WHERE visit_id = ?',
            [visit_id]
        );

        // STEP 4: Return success
        return res.status(200).json({
            message: 'Visit deleted successfully',
            visit_id: visit_id
        });

    } catch (error) {
        console.error('Error in deleteVisit:', error);
        return res.status(500).json({ error: 'Database error while deleting visit' });
    }
};


// Export all functions
module.exports = {
    createVisit,
    getPatientVisits,
    updateVisit,
    deleteVisit
};

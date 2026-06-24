const pool = require('../config/db');

// ===== FUNCTION 1: registerPatient() =====
const registerPatient = async (req, res) => {
    try {
        const { patient_name, phone_number, age, gender, address, weight, assigned_doctor_id } = req.body;

        // STEP 1: Validate all required fields exist
        if (!patient_name || !age || !gender || weight === undefined || !assigned_doctor_id) {
            return res.status(400).json({ 
                error: 'Required fields: patient_name, age, gender, weight, assigned_doctor_id. Phone_number and address are optional.' 
            });
        }

        // STEP 2: Validate age is positive number
        if (age <= 0 || !Number.isInteger(age)) {
            return res.status(400).json({ error: 'Age must be a positive whole number' });
        }

        // STEP 3: Validate weight
        const parsedWeight = parseFloat(weight);
        if (isNaN(parsedWeight) || parsedWeight <= 0) {
            return res.status(400).json({ error: 'Weight must be a positive number' });
        }

        // STEP 4: Validate gender is valid enum
        const validGenders = ['Male', 'Female', 'Other'];
        if (!validGenders.includes(gender)) {
            return res.status(400).json({ error: 'Gender must be: Male, Female, or Other' });
        }

        const connection = await pool.getConnection();

        // STEP 5: Validate assigned doctor exists and is indeed a Doctor
        const [doctorCheck] = await connection.query(
            "SELECT user_id FROM users WHERE user_id = ? AND role = 'doctor' AND is_active = ?",
            [assigned_doctor_id, true]
        );

        if (doctorCheck.length === 0) {
            connection.release();
            return res.status(400).json({ error: 'Invalid or inactive assigned doctor selected.' });
        }

        // STEP 6: If phone_number provided, check it's unique
        if (phone_number) {
            const [existingPhone] = await connection.query(
                'SELECT patient_id FROM patients WHERE phone_number = ?',
                [phone_number]
            );

            if (existingPhone.length > 0) {
                connection.release();
                return res.status(409).json({ error: 'Phone number already registered' });
            }
        }

        // STEP 7: Insert new patient
        const [result] = await connection.query(
            'INSERT INTO patients (patient_name, phone_number, age, gender, address, weight, assigned_doctor_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [patient_name, phone_number || null, age, gender, address || null, parsedWeight, assigned_doctor_id]
        );

        connection.release();

        return res.status(201).json({
            message: 'Patient registered successfully',
            patient: {
                id: result.insertId,
                patient_name: patient_name,
                phone_number: phone_number || null,
                age: age,
                gender: gender,
                address: address || null,
                weight: parsedWeight,
                assigned_doctor_id: assigned_doctor_id
            }
        });

    } catch (error) {
        console.error('Error in registerPatient:', error);
        return res.status(500).json({ error: 'Database error while registering patient' });
    }
};

// ===== FUNCTION 2: getAllPatients() =====
const getAllPatients = async (req, res) => {
    try {
        const isDoctor = req.user && req.user.role === 'Doctor';
        let queryStr = `
            SELECT p.patient_id, p.patient_name, p.phone_number, p.age, p.gender, 
                   p.address, p.weight, p.assigned_doctor_id, p.registration_date,
                   u.name as doctor_name, u.department as doctor_department
            FROM patients p
            LEFT JOIN users u ON p.assigned_doctor_id = u.user_id
        `;
        let queryParams = [];

        // Doctor can only view patients assigned to them
        if (isDoctor) {
            queryStr += ' WHERE p.assigned_doctor_id = ?';
            queryParams.push(req.user.id);
        }

        queryStr += ' ORDER BY registration_date DESC';

        const [patients] = await pool.query(queryStr, queryParams);

        return res.status(200).json({
            message: 'Patients retrieved successfully',
            total: patients.length,
            patients: patients
        });

    } catch (error) {
        console.error('Error in getAllPatients:', error);
        return res.status(500).json({ error: 'Database error while fetching patients' });
    }
};

// ===== FUNCTION 3: searchPatients() =====
const searchPatients = async (req, res) => {
    try {
        const { name, phone } = req.query;
        const isDoctor = req.user && req.user.role === 'Doctor';

        if (!name && !phone) {
            return res.status(400).json({ error: 'Provide either name or phone for search' });
        }

        let queryStr = 'SELECT patient_id, patient_name, phone_number, age, gender, address, weight, assigned_doctor_id FROM patients WHERE 1=1';
        const params = [];

        if (name) {
            queryStr += ' AND patient_name LIKE ?';
            params.push(`%${name}%`);
        }

        if (phone) {
            queryStr += ' AND phone_number = ?';
            params.push(phone);
        }

        // Doctor can only search among their assigned patients
        if (isDoctor) {
            queryStr += ' AND assigned_doctor_id = ?';
            params.push(req.user.id);
        }

        const [patients] = await pool.query(queryStr, params);

        return res.status(200).json({
            message: 'Search completed',
            total: patients.length,
            patients: patients
        });

    } catch (error) {
        console.error('Error in searchPatients:', error);
        return res.status(500).json({ error: 'Database error while searching patients' });
    }
};

// ===== FUNCTION 4: updatePatient() =====
const updatePatient = async (req, res) => {
    try {
        const patientId = req.params.id;
        const { name, phone_number, age, gender, address, weight, assigned_doctor_id } = req.body;

        if (!patientId) {
            return res.status(400).json({ error: 'Patient ID required' });
        }

        // Doctor guard: Can only update if assigned to this doctor
        const isDoctor = req.user && req.user.role === 'Doctor';
        
        const connection = await pool.getConnection();

        // Check if patient exists
        const [existingPatient] = await connection.query(
            'SELECT patient_id, assigned_doctor_id FROM patients WHERE patient_id = ?',
            [patientId]
        );

        if (existingPatient.length === 0) {
            connection.release();
            return res.status(404).json({ error: 'Patient not found' });
        }

        if (isDoctor && existingPatient[0].assigned_doctor_id !== req.user.id) {
            connection.release();
            return res.status(403).json({ error: 'Access denied. You can only manage patients assigned to you.' });
        }

        let updateFields = [];
        let updateValues = [];

        if (name) {
            updateFields.push('patient_name = ?');
            updateValues.push(name);
        }
        if (phone_number !== undefined) {
            if (phone_number) {
                if (!phone_number.match(/^\d{10}$/)) {
                    connection.release();
                    return res.status(400).json({ error: 'Phone number must be exactly 10 digits' });
                }
                // Check uniqueness
                const [phoneDuplicate] = await connection.query(
                    'SELECT patient_id FROM patients WHERE phone_number = ? AND patient_id != ?',
                    [phone_number, patientId]
                );
                if (phoneDuplicate.length > 0) {
                    connection.release();
                    return res.status(400).json({ error: 'Another patient is already registered with this phone number' });
                }
                updateFields.push('phone_number = ?');
                updateValues.push(phone_number);
            } else {
                updateFields.push('phone_number = NULL');
            }
        }
        if (age) {
            if (age <= 0 || !Number.isInteger(age)) {
                connection.release();
                return res.status(400).json({ error: 'Age must be a positive whole number' });
            }
            updateFields.push('age = ?');
            updateValues.push(age);
        }
        if (gender) {
            const validGenders = ['Male', 'Female', 'Other'];
            if (!validGenders.includes(gender)) {
                connection.release();
                return res.status(400).json({ error: 'Gender must be: Male, Female, or Other' });
            }
            updateFields.push('gender = ?');
            updateValues.push(gender);
        }
        if (address !== undefined) {
            updateFields.push('address = ?');
            updateValues.push(address || null);
        }
        if (weight !== undefined) {
            const parsedWeight = parseFloat(weight);
            if (isNaN(parsedWeight) || parsedWeight <= 0) {
                connection.release();
                return res.status(400).json({ error: 'Weight must be a positive number' });
            }
            updateFields.push('weight = ?');
            updateValues.push(parsedWeight);
        }
        if (assigned_doctor_id) {
            // Validate assigned doctor
            const [doctorCheck] = await connection.query(
                "SELECT user_id FROM users WHERE user_id = ? AND role = 'doctor' AND is_active = ?",
                [assigned_doctor_id, true]
            );
            if (doctorCheck.length === 0) {
                connection.release();
                return res.status(400).json({ error: 'Invalid or inactive assigned doctor selected.' });
            }
            updateFields.push('assigned_doctor_id = ?');
            updateValues.push(assigned_doctor_id);
        }

        if (updateFields.length === 0) {
            connection.release();
            return res.status(400).json({ error: 'No fields to update.' });
        }

        updateValues.push(patientId);

        const query = `UPDATE patients SET ${updateFields.join(', ')} WHERE patient_id = ?`;
        await connection.query(query, updateValues);

        const [updatedPatient] = await connection.query(
            'SELECT patient_id, patient_name, phone_number, age, gender, address, weight, assigned_doctor_id FROM patients WHERE patient_id = ?',
            [patientId]
        );

        connection.release();

        return res.status(200).json({
            message: 'Patient updated successfully',
            patient: updatedPatient[0]
        });

    } catch (error) {
        console.error('Error in updatePatient:', error);
        return res.status(500).json({ error: 'Database error while updating patient' });
    }
};

// ===== FUNCTION 5: deletePatient() =====
const deletePatient = async (req, res) => {
    try {
        const patientId = req.params.id;

        if (!patientId) {
            return res.status(400).json({ error: 'Patient ID required' });
        }

        const isDoctor = req.user && req.user.role === 'Doctor';

        const connection = await pool.getConnection();

        const [existingPatient] = await connection.query(
            'SELECT patient_id, patient_name, assigned_doctor_id FROM patients WHERE patient_id = ?',
            [patientId]
        );

        if (existingPatient.length === 0) {
            connection.release();
            return res.status(404).json({ error: 'Patient not found' });
        }

        if (isDoctor && existingPatient[0].assigned_doctor_id !== req.user.id) {
            connection.release();
            return res.status(403).json({ error: 'Access denied. You can only delete patients assigned to you.' });
        }

        const patientName = existingPatient[0].patient_name;

        await connection.query(
            'DELETE FROM patients WHERE patient_id = ?',
            [patientId]
        );

        connection.release();

        return res.status(200).json({
            message: 'Patient deleted successfully',
            patient: {
                id: patientId,
                name: patientName
            }
        });

    } catch (error) {
        console.error('Error in deletePatient:', error);
        return res.status(500).json({ error: 'Database error while deleting patient' });
    }
};

// ===== FUNCTION 6: getPatientHistory() =====
const getPatientHistory = async (req, res) => {
    try {
        const patientId = req.params.id;

        if (!patientId) {
            return res.status(400).json({ error: 'Patient ID required' });
        }

        const isDoctor = req.user && req.user.role === 'Doctor';

        const connection = await pool.getConnection();

        const [patientData] = await connection.query(
            'SELECT p.patient_id, p.patient_name, p.phone_number, p.age, p.gender, p.address, p.weight, p.assigned_doctor_id, u.name as doctor_name, p.registration_date FROM patients p LEFT JOIN users u ON p.assigned_doctor_id = u.user_id WHERE p.patient_id = ?',
            [patientId]
        );

        if (patientData.length === 0) {
            connection.release();
            return res.status(404).json({ error: 'Patient not found' });
        }

        const patient = patientData[0];

        // Doctor guard
        if (isDoctor && patient.assigned_doctor_id !== req.user.id) {
            connection.release();
            return res.status(403).json({ error: 'Access denied. This patient is assigned to another doctor.' });
        }

        const [visits] = await connection.query(
            'SELECT visit_id, visit_date, diagnosis, blood_pressure, temperature, notes FROM visits WHERE patient_id = ? ORDER BY visit_date DESC',
            [patientId]
        );

        const visitsWithPrescriptions = [];
        for (const visit of visits) {
            const [prescriptions] = await connection.query(
                `SELECT 
                    p.prescription_id, 
                    p.medicine_id, 
                    m.medicine_name, 
                    p.dosage, 
                    p.dosage_pattern,
                    p.days,
                    p.calculated_quantity,
                    p.dispensed_quantity,
                    p.dispensed_by,
                    p.dispensed_at,
                    p.quantity, 
                    p.duration_days, 
                    p.created_at 
                FROM prescriptions p 
                LEFT JOIN medicines m ON p.medicine_id = m.medicine_id 
                WHERE p.visit_id = ?`,
                [visit.visit_id]
            );

            visitsWithPrescriptions.push({
                ...visit,
                prescriptions: prescriptions
            });
        }

        connection.release();

        return res.status(200).json({
            message: 'Patient history retrieved successfully',
            patient: patient,
            totalVisits: visitsWithPrescriptions.length,
            visits: visitsWithPrescriptions
        });

    } catch (error) {
        console.error('Error in getPatientHistory:', error);
        return res.status(500).json({ error: 'Database error while fetching patient history' });
    }
};

module.exports = {
    registerPatient,
    getAllPatients,
    searchPatients,
    updatePatient,
    deletePatient,
    getPatientHistory
};

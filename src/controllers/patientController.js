const pool = require('../config/db');

// ===== FUNCTION 1: registerPatient() =====
// Purpose: Add new patient to clinic
// Input: { name, phone, age, gender, address }
// Phone can be NULL (optional) but if provided, must be UNIQUE
// Returns: 201 Created / 400 Bad Request / 409 Conflict (duplicate phone)
const registerPatient = async (req, res) => {
    try {
        const { patient_name, phone_number, age, gender, address } = req.body;

        // STEP 1: Validate all required fields exist
        if (!patient_name || !age || !gender) {
            return res.status(400).json({ error: 'Required fields: patient_name, age, gender. Phone_number and address are optional.' });
        }

        // STEP 2: Validate age is positive number
        if (age <= 0 || !Number.isInteger(age)) {
            return res.status(400).json({ error: 'Age must be a positive whole number' });
        }

        // STEP 3: Validate gender is valid enum
        const validGenders = ['Male', 'Female', 'Other'];
        if (!validGenders.includes(gender)) {
            return res.status(400).json({ error: 'Gender must be: Male, Female, or Other' });
        }

        // STEP 4: If phone_number provided, check it's unique
        if (phone_number) {
            const [existingPhone] = await pool.query(
                'SELECT patient_id FROM patients WHERE phone_number = ?',
                [phone_number]
            );

            if (existingPhone.length > 0) {
                return res.status(409).json({ error: 'Phone number already registered' });
            }
        }

        // STEP 5: Insert new patient (phone_number can be NULL)
        const [result] = await pool.query(
            'INSERT INTO patients (patient_name, phone_number, age, gender, address) VALUES (?, ?, ?, ?, ?)',
            [patient_name, phone_number || null, age, gender, address || null]
        );

        // STEP 6: Return success
        return res.status(201).json({
            message: 'Patient registered successfully',
            patient: {
                id: result.insertId,
                patient_name: patient_name,
                phone_number: phone_number || null,
                age: age,
                gender: gender,
                address: address || null
            }
        });

    } catch (error) {
        console.error('Error in registerPatient:', error);
        return res.status(500).json({ error: 'Database error while registering patient' });
    }
};


// ===== FUNCTION 2: getAllPatients() =====
// Purpose: Get all patients in clinic
// Returns: 200 OK with array / 500 Error
const getAllPatients = async (req, res) => {
    try {
        // STEP 1: Query all patients
        const [patients] = await pool.query(
            'SELECT patient_id, patient_name, phone_number, age, gender, address, registration_date FROM patients ORDER BY registration_date DESC'
        );

        // STEP 2: Return all patients
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
// Purpose: Search patients by name or phone number
// Query params: ?name=Rajesh OR ?phone=9876543210
// Returns: 200 OK with matching patients / 400 Bad Request / 500 Error
const searchPatients = async (req, res) => {
    try {
        const { name, phone } = req.query;

        // STEP 1: Validate at least one search parameter provided
        if (!name && !phone) {
            return res.status(400).json({ error: 'Provide either name or phone for search' });
        }

        let query = 'SELECT patient_id, patient_name, phone_number, age, gender, address FROM patients WHERE 1=1';
        const params = [];

        // STEP 2: Search by name if provided
        if (name) {
            query += ' AND patient_name LIKE ?';
            params.push(`%${name}%`); // % allows partial match
        }

        // STEP 3: Search by phone if provided
        if (phone) {
            query += ' AND phone_number = ?';
            params.push(phone);
        }

        // STEP 4: Execute search query
        const [patients] = await pool.query(query, params);

        // STEP 5: Return results
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
// Purpose: Update patient information by patient_id
// Input: { name, age, gender, address }
// NOTE: Phone number CANNOT be changed (unique key)
// Returns: 200 OK / 400 Bad Request / 404 Not Found / 500 Error
const updatePatient = async (req, res) => {
    try {
        const patientId = req.params.id;
        const { name, age, gender, address } = req.body;

        // STEP 1: Validate patient_id
        if (!patientId) {
            return res.status(400).json({ error: 'Patient ID required' });
        }

        // STEP 2: Check if patient exists
        const [existingPatient] = await pool.query(
            'SELECT patient_id, patient_name FROM patients WHERE patient_id = ?',
            [patientId]
        );

        if (existingPatient.length === 0) {
            return res.status(404).json({ error: 'Patient not found' });
        }

        // STEP 3: Build update query dynamically (only update provided fields)
        let updateFields = [];
        let updateValues = [];

        if (name) {
            updateFields.push('patient_name = ?');
            updateValues.push(name);
        }
        if (age) {
            // Validate age
            if (age <= 0 || !Number.isInteger(age)) {
                return res.status(400).json({ error: 'Age must be a positive whole number' });
            }
            updateFields.push('age = ?');
            updateValues.push(age);
        }
        if (gender) {
            // Validate gender
            const validGenders = ['Male', 'Female', 'Other'];
            if (!validGenders.includes(gender)) {
                return res.status(400).json({ error: 'Gender must be: Male, Female, or Other' });
            }
            updateFields.push('gender = ?');
            updateValues.push(gender);
        }
        if (address) {
            updateFields.push('address = ?');
            updateValues.push(address);
        }

        // STEP 4: If no fields to update, return error
        if (updateFields.length === 0) {
            return res.status(400).json({ error: 'No fields to update. Provide name, age, gender, or address.' });
        }

        // STEP 5: Add patient_id to query parameters
        updateValues.push(patientId);

        // STEP 6: Execute update
        const query = `UPDATE patients SET ${updateFields.join(', ')} WHERE patient_id = ?`;
        await pool.query(query, updateValues);

        // STEP 7: Fetch updated patient and return
        const [updatedPatient] = await pool.query(
            'SELECT patient_id, patient_name, phone_number, age, gender, address FROM patients WHERE patient_id = ?',
            [patientId]
        );

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
// Purpose: Delete patient from system
// Input: patient_id
// Note: Cascading delete will remove visits and prescriptions
// Returns: 200 OK / 404 Not Found / 500 Error
const deletePatient = async (req, res) => {
    try {
        const patientId = req.params.id;

        // STEP 1: Validate patient_id
        if (!patientId) {
            return res.status(400).json({ error: 'Patient ID required' });
        }

        // STEP 2: Check if patient exists
        const [existingPatient] = await pool.query(
            'SELECT patient_id, patient_name FROM patients WHERE patient_id = ?',
            [patientId]
        );

        if (existingPatient.length === 0) {
            return res.status(404).json({ error: 'Patient not found' });
        }

        const patientName = existingPatient[0].patient_name;

        // STEP 3: Delete patient (CASCADE will delete visits and prescriptions)
        await pool.query(
            'DELETE FROM patients WHERE patient_id = ?',
            [patientId]
        );

        // STEP 4: Return success
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
// Purpose: Get complete medical history for one patient (visits + prescriptions)
// Input: patient_id
// Returns: 200 OK with patient info + all visits + prescriptions / 404 Not Found / 500 Error
const getPatientHistory = async (req, res) => {
    try {
        const patientId = req.params.id;

        // STEP 1: Validate patient_id
        if (!patientId) {
            return res.status(400).json({ error: 'Patient ID required' });
        }

        // STEP 2: Get patient basic info
        const [patientData] = await pool.query(
            'SELECT patient_id, patient_name, phone_number, age, gender, address, registration_date FROM patients WHERE patient_id = ?',
            [patientId]
        );

        if (patientData.length === 0) {
            return res.status(404).json({ error: 'Patient not found' });
        }

        const patient = patientData[0];

        // STEP 3: Get all visits for this patient (ordered by date, newest first)
        const [visits] = await pool.query(
            'SELECT visit_id, visit_date, diagnosis, bp_level, sugar_level, temperature, notes FROM visits WHERE patient_id = ? ORDER BY visit_date DESC',
            [patientId]
        );

        // STEP 4: For each visit, get all prescriptions
        const visitsWithPrescriptions = [];
        for (const visit of visits) {
            const [prescriptions] = await pool.query(
                'SELECT prescription_id, medicine_name, dosage, duration, instructions, quantity_dispensed, price FROM prescriptions WHERE visit_id = ?',
                [visit.visit_id]
            );

            visitsWithPrescriptions.push({
                ...visit,
                prescriptions: prescriptions
            });
        }

        // STEP 5: Return complete history
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


// ===== EXPORT ALL FUNCTIONS =====
module.exports = {
    registerPatient,
    getAllPatients,
    searchPatients,
    updatePatient,
    deletePatient,
    getPatientHistory
};

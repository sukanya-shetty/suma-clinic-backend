const pool = require('../config/db');

// Helper to calculate total dosage quantity
const calculatePrescriptionQuantity = (medicineName, dosagePattern, days) => {
    if (!dosagePattern || !days) return 0;
    
    // Parse "1-0-1" format or similar
    const parts = dosagePattern.split('-').map(p => parseFloat(p) || 0);
    const sum = parts.reduce((a, b) => a + b, 0);
    const rawQty = sum * parseInt(days);
    
    const nameLower = medicineName.toLowerCase();
    const isLiquid = nameLower.includes('syrup') || 
                      nameLower.includes('susp') || 
                      nameLower.includes('liquid') || 
                      nameLower.includes('ml') || 
                      nameLower.includes('soln') || 
                      nameLower.includes('solution') || 
                      nameLower.includes('drops') ||
                      nameLower.includes('suspension');

    if (isLiquid) {
        return Math.round(rawQty * 100) / 100; // allow decimal places
    } else {
        return Math.ceil(rawQty); // round to whole tablets/capsules
    }
};

// ===== FUNCTION 1: createPrescription() =====
const createPrescription = async (req, res) => {
    try {
        const { visit_id, medicine_id, dosage, dosage_pattern, days, instructions } = req.body;

        if (!visit_id || !medicine_id || !dosage_pattern || !days) {
            return res.status(400).json({ 
                error: 'Required fields: visit_id, medicine_id, dosage_pattern, days.' 
            });
        }

        const isDoctor = req.user && req.user.role === 'Doctor';

        const connection = await pool.getConnection();

        // 1. Check if visit exists and belongs to the doctor
        const [visitCheck] = await connection.query(
            'SELECT visit_id, doctor_id FROM visits WHERE visit_id = ?',
            [visit_id]
        );

        if (visitCheck.length === 0) {
            connection.release();
            return res.status(404).json({ error: 'Visit not found' });
        }

        if (isDoctor && visitCheck[0].doctor_id !== req.user.id) {
            connection.release();
            return res.status(403).json({ error: 'Access denied. You can only prescribe for your own visits.' });
        }

        // 2. Check if medicine exists
        const [medicineCheck] = await connection.query(
            'SELECT medicine_id, medicine_name, price, quantity FROM medicines WHERE medicine_id = ?',
            [medicine_id]
        );

        if (medicineCheck.length === 0) {
            connection.release();
            return res.status(404).json({ error: 'Medicine not found' });
        }

        const medicine = medicineCheck[0];

        // 3. Calculate quantity
        const calculatedQty = calculatePrescriptionQuantity(medicine.medicine_name, dosage_pattern, days);

        // 4. Insert new prescription (Note: stock is NOT reduced here; Pharmacist does it during dispensing)
        const [insertResult] = await connection.query(
            `INSERT INTO prescriptions (
                visit_id, medicine_id, dosage, dosage_pattern, days, 
                calculated_quantity, quantity, duration_days
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                visit_id, medicine_id, dosage || '', dosage_pattern, days, 
                calculatedQty, calculatedQty, days
            ]
        );

        // Audit log
        try {
            await connection.query(
                'INSERT INTO audit_log (doctor_id, action, table_name, record_id, new_value) VALUES (?, ?, ?, ?, ?)',
                [
                    req.user ? req.user.id : null,
                    'PRESCRIPTION_CREATED',
                    'prescriptions',
                    insertResult.insertId,
                    JSON.stringify({ prescription_id: insertResult.insertId, calculated_quantity: calculatedQty })
                ]
            );
        } catch (auditErr) {
            console.error('Audit insert failed:', auditErr);
        }

        connection.release();

        return res.status(201).json({
            success: true,
            message: 'Prescription created successfully',
            prescription: {
                prescription_id: insertResult.insertId,
                visit_id: visit_id,
                medicine_id: medicine_id,
                medicine_name: medicine.medicine_name,
                dosage_pattern: dosage_pattern,
                days: days,
                calculated_quantity: calculatedQty,
                instructions: instructions,
                price: medicine.price
            }
        });

    } catch (error) {
        console.error('Error in createPrescription:', error);
        return res.status(500).json({ error: 'Database error while creating prescription' });
    }
};

// ===== FUNCTION 2: getPrescriptionsByVisit() =====
const getPrescriptionsByVisit = async (req, res) => {
    try {
        const { visit_id } = req.params;

        const [prescriptions] = await pool.query(
            `SELECT 
                p.prescription_id, 
                p.visit_id, 
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
                m.price,
                p.created_at 
            FROM prescriptions p
            LEFT JOIN medicines m ON p.medicine_id = m.medicine_id
            WHERE p.visit_id = ?
            ORDER BY p.created_at DESC`,
            [visit_id]
        );

        return res.status(200).json({
            message: 'Prescriptions retrieved successfully',
            total: prescriptions.length,
            prescriptions: prescriptions
        });

    } catch (error) {
        console.error('Error in getPrescriptionsByVisit:', error);
        return res.status(500).json({ error: 'Database error while retrieving prescriptions' });
    }
};

// ===== FUNCTION 3: updatePrescription() =====
const updatePrescription = async (req, res) => {
    try {
        const { id } = req.params;
        const { dosage, dosage_pattern, days, instructions } = req.body;

        const isDoctor = req.user && req.user.role === 'Doctor';

        const connection = await pool.getConnection();

        // Check if prescription exists and if it is already dispensed
        const [presCheck] = await connection.query(
            `SELECT p.*, m.medicine_name 
             FROM prescriptions p 
             LEFT JOIN medicines m ON p.medicine_id = m.medicine_id 
             WHERE p.prescription_id = ?`,
            [id]
        );

        if (presCheck.length === 0) {
            connection.release();
            return res.status(404).json({ error: 'Prescription not found' });
        }

        const prescription = presCheck[0];

        if (prescription.dispensed_at) {
            connection.release();
            return res.status(400).json({ error: 'Cannot update a prescription that has already been dispensed.' });
        }

        // Doctor guard: Can only update if they are the owner of the visit
        if (isDoctor) {
            const [visitCheck] = await connection.query(
                'SELECT doctor_id FROM visits WHERE visit_id = ?',
                [prescription.visit_id]
            );
            if (visitCheck.length === 0 || visitCheck[0].doctor_id !== req.user.id) {
                connection.release();
                return res.status(403).json({ error: 'Access denied. You can only update your own prescriptions.' });
            }
        }

        // Re-calculate quantity if pattern or days changed
        const newPattern = dosage_pattern !== undefined ? dosage_pattern : prescription.dosage_pattern;
        const newDays = days !== undefined ? days : prescription.days;
        const calculatedQty = calculatePrescriptionQuantity(prescription.medicine_name, newPattern, newDays);

        const updateFields = [];
        const updateValues = [];

        if (dosage !== undefined) {
            updateFields.push('dosage = ?');
            updateValues.push(dosage);
        }
        if (dosage_pattern !== undefined) {
            updateFields.push('dosage_pattern = ?');
            updateValues.push(dosage_pattern);
        }
        if (days !== undefined) {
            updateFields.push('days = ?');
            updateValues.push(days);
        }
        if (instructions !== undefined) {
            updateFields.push('instructions = ?');
            updateValues.push(instructions);
        }

        updateFields.push('calculated_quantity = ?');
        updateValues.push(calculatedQty);
        updateFields.push('quantity = ?');
        updateValues.push(calculatedQty);

        updateValues.push(id);

        const query = `UPDATE prescriptions SET ${updateFields.join(', ')} WHERE prescription_id = ?`;
        await connection.query(query, updateValues);

        connection.release();

        return res.status(200).json({
            success: true,
            message: 'Prescription updated successfully',
            calculated_quantity: calculatedQty
        });

    } catch (error) {
        console.error('Error in updatePrescription:', error);
        return res.status(500).json({ error: 'Database error while updating prescription' });
    }
};

// ===== FUNCTION 4: deletePrescription() =====
const deletePrescription = async (req, res) => {
    try {
        const { id } = req.params;
        const isDoctor = req.user && req.user.role === 'Doctor';

        const connection = await pool.getConnection();

        const [presCheck] = await connection.query(
            'SELECT * FROM prescriptions WHERE prescription_id = ?',
            [id]
        );

        if (presCheck.length === 0) {
            connection.release();
            return res.status(404).json({ error: 'Prescription not found' });
        }

        const prescription = presCheck[0];

        // Doctor guard
        if (isDoctor) {
            const [visitCheck] = await connection.query(
                'SELECT doctor_id FROM visits WHERE visit_id = ?',
                [prescription.visit_id]
            );
            if (visitCheck.length === 0 || visitCheck[0].doctor_id !== req.user.id) {
                connection.release();
                return res.status(403).json({ error: 'Access denied. You can only delete your own prescriptions.' });
            }
        }

        // If it was already dispensed, we should restore stock
        if (prescription.dispensed_at && prescription.medicine_id && prescription.dispensed_quantity) {
            await connection.query(
                'UPDATE medicines SET quantity = quantity + ? WHERE medicine_id = ?',
                [prescription.dispensed_quantity, prescription.medicine_id]
            );
        }

        await connection.query(
            'DELETE FROM prescriptions WHERE prescription_id = ?',
            [id]
        );

        connection.release();

        return res.status(200).json({
            success: true,
            message: 'Prescription deleted successfully'
        });

    } catch (error) {
        console.error('Error in deletePrescription:', error);
        return res.status(500).json({ error: 'Database error while deleting prescription' });
    }
};

const getPendingPrescriptions = async (req, res) => {
    try {
        const [prescriptions] = await pool.query(
            `SELECT 
                p.prescription_id, 
                p.visit_id, 
                p.medicine_id, 
                m.medicine_name,
                p.dosage, 
                p.dosage_pattern,
                p.days,
                p.calculated_quantity,
                p.quantity, 
                p.created_at,
                v.patient_id,
                pt.patient_name
            FROM prescriptions p
            JOIN visits v ON p.visit_id = v.visit_id
            JOIN patients pt ON v.patient_id = pt.patient_id
            LEFT JOIN medicines m ON p.medicine_id = m.medicine_id
            WHERE p.dispensed_at IS NULL
            ORDER BY p.created_at DESC`
        );

        return res.status(200).json({
            success: true,
            message: 'Pending prescriptions retrieved successfully',
            total: prescriptions.length,
            prescriptions: prescriptions
        });
    } catch (error) {
        console.error('Error in getPendingPrescriptions:', error);
        return res.status(500).json({ error: 'Database error while retrieving pending prescriptions' });
    }
};

module.exports = {
    createPrescription,
    getPrescriptionsByVisit,
    updatePrescription,
    deletePrescription,
    getPendingPrescriptions
};

const pool = require('../config/db');

const runPrescriptionTransaction = async (handler) => {
    const connection = await pool.getConnection();

    try {
        await connection.beginTransaction();
        const result = await handler(connection);
        await connection.commit();
        return result;
    } catch (error) {
        try {
            await connection.rollback();
        } catch (rollbackError) {
            console.error('Rollback error:', rollbackError);
        }
        throw error;
    } finally {
        connection.release();
    }
};

// ===== FUNCTION 1: createPrescription() =====
// Purpose: Create a new prescription for a visit
// Input: { visit_id, medicine_id, dosage, quantity, duration_days }
// CRITICAL: Reduces medicine inventory quantity when prescription is created
// Returns: 201 Created / 400 Bad Request / 404 Not Found / 409 Conflict / 500 Error
const createPrescription = async (req, res) => {
    try {
        // STEP 1: Extract fields from request body
        const { visit_id, medicine_id, dosage, quantity, duration_days } = req.body;

        // STEP 2: Validate all required fields exist
        if (!visit_id || !medicine_id || !dosage || !quantity) {
            return res.status(400).json({ 
                error: 'Required fields: visit_id, medicine_id, dosage, quantity. duration_days is optional.' 
            });
        }

        // STEP 3: Validate quantity is positive integer
        if (!Number.isInteger(quantity) || quantity <= 0) {
            return res.status(400).json({ 
                error: 'Quantity must be a positive whole number' 
            });
        }

        const result = await runPrescriptionTransaction(async (connection) => {
            // STEP 4: Check if visit exists
            const [visitExists] = await connection.query(
                'SELECT visit_id FROM visits WHERE visit_id = ?',
                [visit_id]
            );

            if (visitExists.length === 0) {
                return { status: 404, body: { error: 'Visit not found' } };
            }

            // STEP 5: Check if medicine exists in inventory
            const [medicineExists] = await connection.query(
                'SELECT medicine_id, quantity FROM medicines WHERE medicine_id = ?',
                [medicine_id]
            );

            if (medicineExists.length === 0) {
                return { status: 404, body: { error: 'Medicine not found in inventory' } };
            }

            // STEP 6: Check if enough stock available
            const availableStock = medicineExists[0].quantity;
            if (availableStock < quantity) {
                return { status: 409, body: { 
                    error: `Not enough stock. Available: ${availableStock}, Requested: ${quantity}` 
                } };
            }

            // STEP 7: Insert new prescription
            const [insertResult] = await connection.query(
                'INSERT INTO prescriptions (visit_id, medicine_id, dosage, quantity, duration_days) VALUES (?, ?, ?, ?, ?)',
                [visit_id, medicine_id, dosage, quantity, duration_days ?? null]
            );

            // STEP 8: REDUCE medicine quantity in inventory (prescription consumes stock!)
            const newQuantity = availableStock - quantity;
            await connection.query(
                'UPDATE medicines SET quantity = ? WHERE medicine_id = ?',
                [newQuantity, medicine_id]
            );

            // STEP 9: Check if new quantity triggers low stock alert
            if (newQuantity < 10 && availableStock >= 10) {
                await connection.query(
                    'INSERT INTO alerts (medicine_id, alert_type, message, is_read) VALUES (?, ?, ?, ?)',
                    [medicine_id, 'LOW_STOCK', `Stock for medicine_id ${medicine_id} is now ${newQuantity} (below 10)`, false]
                );
            }

            // AUDIT: record create action (inside same transaction)
            try {
                const after = {
                    prescription_id: insertResult.insertId,
                    visit_id: visit_id,
                    medicine_id: medicine_id,
                    dosage: dosage,
                    quantity: quantity,
                    duration_days: duration_days ?? null
                };

                await connection.query(
                    'INSERT INTO audit_log (entity_type, entity_id, action, user_id, user_name, role, before_data, after_data, meta) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
                    [
                        'prescription',
                        insertResult.insertId,
                        'CREATE',
                        req.user ? req.user.id : null,
                        req.user ? req.user.name : null,
                        req.user ? req.user.role : null,
                        null,
                        JSON.stringify(after),
                        JSON.stringify({ ip: req.ip || null })
                    ]
                );
            } catch (auditErr) {
                console.error('Audit insert failed (create):', auditErr);
                // don't abort business operation; audit failure should not prevent response
            }

            return {
                status: 201,
                body: {
                    message: 'Prescription created successfully',
                    prescription: {
                        prescription_id: insertResult.insertId,
                        visit_id: visit_id,
                        medicine_id: medicine_id,
                        dosage: dosage,
                        quantity: quantity,
                        duration_days: duration_days ?? null
                    },
                    inventory_update: {
                        previous_stock: availableStock,
                        prescribed_quantity: quantity,
                        new_stock: newQuantity
                    }
                }
            };
        });

        return res.status(result.status).json(result.body);

    } catch (error) {
        console.error('Error in createPrescription:', error);
        return res.status(500).json({ error: 'Database error while creating prescription' });
    }
};


// ===== FUNCTION 2: getPrescriptionsByVisit() =====
// Purpose: Get all prescriptions for a specific visit (with medicine details)
// Input: visit_id (from URL param)
// Returns: 200 OK with array / 500 Error
const getPrescriptionsByVisit = async (req, res) => {
    try {
        // STEP 1: Extract visit_id from URL params
        const { visit_id } = req.params;

        // STEP 2: Query all prescriptions for this visit with medicine details via JOIN
        const [prescriptions] = await pool.query(
            `SELECT 
                p.prescription_id, 
                p.visit_id, 
                p.medicine_id, 
                m.medicine_name,
                p.dosage, 
                p.quantity, 
                p.duration_days, 
                p.created_at 
            FROM prescriptions p
            JOIN medicines m ON p.medicine_id = m.medicine_id
            WHERE p.visit_id = ?
            ORDER BY p.created_at DESC`,
            [visit_id]
        );

        // STEP 3: Return all prescriptions with medicine names
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
// Purpose: Update an existing prescription (partial update)
// Input: prescription_id (from URL), { fields to update }
// Cannot update: prescription_id, visit_id, medicine_id (foreign keys)
// WARNING: If quantity changes, must adjust medicine stock accordingly!
// Returns: 200 OK / 400 Bad Request / 404 Not Found / 500 Error
const updatePrescription = async (req, res) => {
    try {
        // STEP 1: Extract prescription_id from URL params (route uses :id)
        const { id } = req.params;
        const prescription_id = id;

        // STEP 2: Extract updateable fields from request body
        const { dosage, quantity, duration_days } = req.body;

        // STEP 3: Validate at least one field is provided for update
        if (dosage === undefined && quantity === undefined && duration_days === undefined) {
            return res.status(400).json({ 
                error: 'Provide at least one field to update: dosage, quantity, or duration_days' 
            });
        }

        const result = await runPrescriptionTransaction(async (connection) => {
            // STEP 4: Check if prescription exists and get current details
            const [prescriptionExists] = await connection.query(
                'SELECT prescription_id, medicine_id, quantity FROM prescriptions WHERE prescription_id = ?',
                [prescription_id]
            );

            if (prescriptionExists.length === 0) {
                return { status: 404, body: { error: 'Prescription not found' } };
            }

            const currentQuantity = prescriptionExists[0].quantity;
            const medicine_id = prescriptionExists[0].medicine_id;

            if (quantity !== undefined && quantity !== currentQuantity) {
                if (!Number.isInteger(quantity) || quantity <= 0) {
                    return { status: 400, body: { error: 'Quantity must be a positive whole number' } };
                }

                // Get current medicine stock
                const [medicineData] = await connection.query(
                    'SELECT quantity FROM medicines WHERE medicine_id = ?',
                    [medicine_id]
                );

                if (medicineData.length === 0) {
                    return { status: 404, body: { error: 'Medicine not found' } };
                }

                const currentStock = medicineData[0].quantity;
                const quantityDifference = quantity - currentQuantity;

                // Check if we have enough stock for the increase
                if (quantityDifference > 0 && currentStock < quantityDifference) {
                    return { status: 409, body: { 
                        error: `Not enough stock to increase prescription. Available: ${currentStock}, Needed: ${quantityDifference}` 
                    } };
                }

                // Update medicine quantity
                const newStock = currentStock - quantityDifference;
                await connection.query(
                    'UPDATE medicines SET quantity = ? WHERE medicine_id = ?',
                    [newStock, medicine_id]
                );
            }

            // STEP 6: Build dynamic UPDATE query with only provided fields
            const updateFields = [];
            const updateValues = [];

            if (dosage !== undefined) {
                updateFields.push('dosage = ?');
                updateValues.push(dosage);
            }

            if (quantity !== undefined) {
                updateFields.push('quantity = ?');
                updateValues.push(quantity);
            }

            if (duration_days !== undefined) {
                updateFields.push('duration_days = ?');
                updateValues.push(duration_days === '' ? null : duration_days);
            }

            updateValues.push(prescription_id);

            const updateQuery = `UPDATE prescriptions SET ${updateFields.join(', ')} WHERE prescription_id = ?`;
            await connection.query(updateQuery, updateValues);

            const [updatedPrescription] = await connection.query(
                'SELECT prescription_id, visit_id, medicine_id, dosage, quantity, duration_days FROM prescriptions WHERE prescription_id = ?',
                [prescription_id]
            );

            // AUDIT: record update action (inside same transaction)
            try {
                const before = prescriptionExists[0];
                const after = updatedPrescription[0];

                await connection.query(
                    'INSERT INTO audit_log (entity_type, entity_id, action, user_id, user_name, role, before_data, after_data, meta) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
                    [
                        'prescription',
                        prescription_id,
                        'UPDATE',
                        req.user ? req.user.id : null,
                        req.user ? req.user.name : null,
                        req.user ? req.user.role : null,
                        JSON.stringify(before),
                        JSON.stringify(after),
                        JSON.stringify({ ip: req.ip || null })
                    ]
                );
            } catch (auditErr) {
                console.error('Audit insert failed (update):', auditErr);
            }

            return {
                status: 200,
                body: {
                    message: 'Prescription updated successfully',
                    prescription: updatedPrescription[0]
                }
            };
        });

        return res.status(result.status).json(result.body);

    } catch (error) {
        console.error('Error in updatePrescription:', error);
        return res.status(500).json({ error: 'Database error while updating prescription' });
    }
};


// ===== FUNCTION 4: deletePrescription() =====
// Purpose: Delete a prescription (MUST restore medicine quantity!)
// Input: prescription_id (from URL)
// CRITICAL: Restore medicine stock when prescription is deleted
// Returns: 200 OK / 404 Not Found / 500 Error
const deletePrescription = async (req, res) => {
    try {
        // STEP 1: Extract prescription_id from URL params (route uses :id)
        const { id } = req.params;
        const prescription_id = id;

        const result = await runPrescriptionTransaction(async (connection) => {
            // STEP 2: Check if prescription exists and get its details
            const [prescriptionExists] = await connection.query(
                'SELECT prescription_id, medicine_id, quantity FROM prescriptions WHERE prescription_id = ?',
                [prescription_id]
            );

            if (prescriptionExists.length === 0) {
                return { status: 404, body: { error: 'Prescription not found' } };
            }

            const medicine_id = prescriptionExists[0].medicine_id;
            const prescribed_quantity = prescriptionExists[0].quantity;

            // STEP 3: RESTORE medicine quantity (prescription was deleted, stock returns!)
            const [medicineData] = await connection.query(
                'SELECT quantity FROM medicines WHERE medicine_id = ?',
                [medicine_id]
            );

            if (medicineData.length === 0) {
                return { status: 404, body: { error: 'Medicine not found' } };
            }

            const currentStock = medicineData[0].quantity;
            const restoredStock = currentStock + prescribed_quantity;

            // Update medicine quantity back
            await connection.query(
                'UPDATE medicines SET quantity = ? WHERE medicine_id = ?',
                [restoredStock, medicine_id]
            );

            // STEP 4: Delete the prescription
            await connection.query(
                'DELETE FROM prescriptions WHERE prescription_id = ?',
                [prescription_id]
            );

            // AUDIT: record delete action (inside same transaction)
            try {
                const before = prescriptionExists[0];

                await connection.query(
                    'INSERT INTO audit_log (entity_type, entity_id, action, user_id, user_name, role, before_data, after_data, meta) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
                    [
                        'prescription',
                        prescription_id,
                        'DELETE',
                        req.user ? req.user.id : null,
                        req.user ? req.user.name : null,
                        req.user ? req.user.role : null,
                        JSON.stringify(before),
                        null,
                        JSON.stringify({ ip: req.ip || null })
                    ]
                );
            } catch (auditErr) {
                console.error('Audit insert failed (delete):', auditErr);
            }

            return {
                status: 200,
                body: {
                    message: 'Prescription deleted successfully',
                    prescription_id: prescription_id,
                    inventory_restored: {
                        previous_stock: currentStock,
                        restored_quantity: prescribed_quantity,
                        new_stock: restoredStock
                    }
                }
            };
        });

        return res.status(result.status).json(result.body);

    } catch (error) {
        console.error('Error in deletePrescription:', error);
        return res.status(500).json({ error: 'Database error while deleting prescription' });
    }
};


// Export all functions
module.exports = {
    createPrescription,
    getPrescriptionsByVisit,
    updatePrescription,
    deletePrescription
};

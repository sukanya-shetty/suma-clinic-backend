const pool = require('../config/db');

// ===== FUNCTION 1: addMedicine() =====
// Only Admin can add medicine/stock-in
const addMedicine = async (req, res) => {
    try {
        // Enforce Admin only on logic level
        if (!req.user || req.user.role !== 'Admin') {
            return res.status(403).json({ error: 'Access denied. Only Admin can add medicines or stock-in.' });
        }

        const { name, price, quantity, expiryDate, batch_number, supplier_name, purchase_price } = req.body;

        // STEP 1: Validate all fields exist
        if (!name || !price || !quantity || !expiryDate) {
            return res.status(400).json({ error: 'All fields required: name, price, quantity, expiryDate' });
        }

        // STEP 2: Validate price and quantity are positive numbers
        const parsedPrice = parseFloat(price);
        const parsedQuantity = parseFloat(quantity);
        if (isNaN(parsedPrice) || parsedPrice <= 0 || isNaN(parsedQuantity) || parsedQuantity <= 0) {
            return res.status(400).json({ error: 'Price and quantity must be positive numbers' });
        }

        const connection = await pool.getConnection();
        await connection.beginTransaction();

        try {
            // STEP 3: Check if medicine already exists (CASE-INSENSITIVE)
            const [existingMedicine] = await connection.query(
                'SELECT medicine_id, quantity FROM medicines WHERE LOWER(medicine_name) = LOWER(?)',
                [name.trim()]
            );

            let medicineId = null;
            let finalQuantity = parsedQuantity;
            let actionType = 'CREATED';

            // STEP 4: If exists → UPDATE quantity and attributes
            if (existingMedicine.length > 0) {
                medicineId = existingMedicine[0].medicine_id;
                const oldQuantity = existingMedicine[0].quantity;
                finalQuantity = oldQuantity + parsedQuantity;
                actionType = 'UPDATED';

                await connection.query(
                    `UPDATE medicines 
                     SET quantity = ?, price = ?, expiry_date = ?, batch_number = COALESCE(?, batch_number), 
                         supplier_name = COALESCE(?, supplier_name), purchase_price = COALESCE(?, purchase_price) 
                     WHERE medicine_id = ?`,
                    [finalQuantity, parsedPrice, expiryDate, batch_number || null, supplier_name || null, purchase_price || null, medicineId]
                );
            } else {
                // STEP 5: If NOT exists → INSERT new medicine
                const [result] = await connection.query(
                    `INSERT INTO medicines (medicine_name, price, quantity, expiry_date, batch_number, supplier_name, purchase_price) 
                     VALUES (?, ?, ?, ?, ?, ?, ?)`,
                    [name.trim(), parsedPrice, parsedQuantity, expiryDate, batch_number || null, supplier_name || null, purchase_price || null]
                );
                medicineId = result.insertId;
            }

            // STEP 6: Write to inventory_transactions (audit log for stock-in)
            await connection.query(
                'INSERT INTO inventory_transactions (medicine_id, type, quantity, performed_by) VALUES (?, ?, ?, ?)',
                [medicineId, 'stock_in', parsedQuantity, req.user.id]
            );

            await connection.commit();
            connection.release();

            return res.status(actionType === 'CREATED' ? 201 : 200).json({
                message: actionType === 'CREATED' ? 'Medicine added successfully' : 'Medicine stock updated successfully',
                medicine: {
                    id: medicineId,
                    name: name,
                    price: parsedPrice,
                    quantity: finalQuantity,
                    expiryDate: expiryDate,
                    action: actionType
                }
            });

        } catch (txErr) {
            await connection.rollback();
            connection.release();
            throw txErr;
        }

    } catch (error) {
        console.error('Error in addMedicine:', error);
        return res.status(500).json({ error: 'Database error while adding medicine' });
    }
};

// ===== FUNCTION 2: getAllMedicines() =====
const getAllMedicines = async (req, res) => {
    try {
        const [medicines] = await pool.query(
            'SELECT medicine_id, medicine_name, price, quantity, expiry_date, batch_number, supplier_name, purchase_price FROM medicines'
        );

        return res.status(200).json({
            message: 'Medicines retrieved successfully',
            total: medicines.length,
            medicines: medicines
        });

    } catch (error) {
        console.error('Error in getAllMedicines:', error);
        return res.status(500).json({ error: 'Database error while fetching medicines' });
    }
};

// ===== FUNCTION 3: updateMedicineStock() (Deprecated / Restricted to internal calls) =====
const updateMedicineStock = async (req, res) => {
    return res.status(403).json({ error: 'Direct manual stock update is not allowed. Stock changes must go through Admin Stock-In or Pharmacist Dispensing.' });
};

// ===== FUNCTION 4: getExpiringMedicines() =====
const getExpiringMedicines = async (req, res) => {
    try {
        const targetDate = new Date();
        targetDate.setDate(targetDate.getDate() + 30);
        const targetDateString = targetDate.toISOString().slice(0, 10);
        
        const [expiringMedicines] = await pool.query(
            "SELECT medicine_id, medicine_name, quantity, expiry_date FROM medicines WHERE expiry_date < ? ORDER BY expiry_date ASC",
            [targetDateString]
        );

        return res.status(200).json({
            message: 'Expiring medicines retrieved',
            total: expiringMedicines.length,
            medicines: expiringMedicines
        });

    } catch (error) {
        console.error('Error in getExpiringMedicines:', error);
        return res.status(500).json({ error: 'Database error while fetching expiring medicines' });
    }
};

// ===== FUNCTION 5: deleteMedicine() =====
const deleteMedicine = async (req, res) => {
    try {
        // Enforce Admin only
        if (!req.user || req.user.role !== 'Admin') {
            return res.status(403).json({ error: 'Access denied. Only Admin can delete medicines.' });
        }

        const medicineId = req.params.id;

        if (!medicineId) {
            return res.status(400).json({ error: 'medicineId required' });
        }

        const [medicineData] = await pool.query(
            'SELECT medicine_name FROM medicines WHERE medicine_id = ?',
            [medicineId]
        );

        if (medicineData.length === 0) {
            return res.status(404).json({ error: 'Medicine not found' });
        }

        const medicineName = medicineData[0].medicine_name;

        await pool.query(
            'DELETE FROM medicines WHERE medicine_id = ?',
            [medicineId]
        );

        return res.status(200).json({
            message: 'Medicine deleted successfully',
            medicine: {
                id: medicineId,
                name: medicineName
            }
        });

    } catch (error) {
        console.error('Error in deleteMedicine:', error);
        return res.status(500).json({ error: 'Database error while deleting medicine' });
    }
};

// ===== FUNCTION 6: getAlerts() =====
const getAlerts = async (req, res) => {
    try {
        const [alerts] = await pool.query(
            'SELECT a.alert_id, a.medicine_id, a.alert_type, a.message, a.is_read, a.created_at, m.medicine_name FROM alerts a JOIN medicines m ON a.medicine_id = m.medicine_id WHERE a.is_read = FALSE ORDER BY a.created_at DESC'
        );

        return res.status(200).json({
            message: 'Alerts retrieved',
            total: alerts.length,
            alerts: alerts
        });

    } catch (error) {
        console.error('Error in getAlerts:', error);
        return res.status(500).json({ error: 'Database error while fetching alerts' });
    }
};

module.exports = {
    addMedicine,
    getAllMedicines,
    updateMedicineStock,
    getExpiringMedicines,
    deleteMedicine,
    getAlerts
};

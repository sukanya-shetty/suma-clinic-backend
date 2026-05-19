const pool = require('../config/db');

// ===== FUNCTION 1: addMedicine() =====
// Purpose: Add new medicine or UPDATE existing (case-insensitive)
// Input: { name, price, quantity, expiryDate }
// Returns: 201 Created / 200 Updated / 400 Bad Request / 500 Error
const addMedicine = async (req, res) => {
    try {
        const { name, price, quantity, expiryDate } = req.body;

        // STEP 1: Validate all fields exist
        if (!name || !price || !quantity || !expiryDate) {
            return res.status(400).json({ error: 'All fields required: name, price, quantity, expiryDate' });
        }

        // STEP 2: Validate price and quantity are positive numbers
        if (price <= 0 || quantity <= 0) {
            return res.status(400).json({ error: 'Price and quantity must be positive numbers' });
        }

        // STEP 3: Check if medicine already exists (CASE-INSENSITIVE using LOWER)
        const [existingMedicine] = await pool.query(
            'SELECT medicine_id, quantity FROM medicines WHERE LOWER(medicine_name) = LOWER(?)',
            [name]
        );

        // STEP 4: If exists → UPDATE quantity
        if (existingMedicine.length > 0) {
            const existingId = existingMedicine[0].medicine_id;
            const oldQuantity = existingMedicine[0].quantity;
            const newQuantity = oldQuantity + parseInt(quantity);

            await pool.query(
                'UPDATE medicines SET quantity = ?, price = ? WHERE medicine_id = ?',
                [newQuantity, price, existingId]
            );

            return res.status(200).json({
                message: 'Medicine updated',
                medicine: {
                    id: existingId,
                    name: name,
                    price: price,
                    quantity: newQuantity,
                    expiryDate: expiryDate,
                    action: 'UPDATED'
                }
            });
        }

        // STEP 5: If NOT exists → INSERT new medicine (store name as LOWERCASE)
        const [result] = await pool.query(
            'INSERT INTO medicines (medicine_name, price, quantity, expiry_date) VALUES (LOWER(?), ?, ?, ?)',
            [name, price, quantity, expiryDate]
        );

        return res.status(201).json({
            message: 'Medicine added successfully',
            medicine: {
                id: result.insertId,
                name: name,
                price: price,
                quantity: quantity,
                expiryDate: expiryDate,
                action: 'CREATED'
            }
        });

    } catch (error) {
        console.error('Error in addMedicine:', error);
        return res.status(500).json({ error: 'Database error while adding medicine' });
    }
};


// ===== FUNCTION 2: getAllMedicines() =====
// Purpose: Get all medicines from inventory
// Returns: 200 OK with array / 500 Error
const getAllMedicines = async (req, res) => {
    try {
        // STEP 1: Query all medicines
        const [medicines] = await pool.query(
            'SELECT medicine_id, medicine_name, price, quantity, expiry_date FROM medicines'
        );

        // STEP 2: Return all medicines
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


// ===== FUNCTION 3: updateMedicineStock() =====
// Purpose: Reduce stock when medicine is sold
// Input: { medicineId, quantitySold }
// Returns: 200 OK with alert info / 400 Bad Request / 404 Not Found / 500 Error
const updateMedicineStock = async (req, res) => {
    try {
        const { medicineId, quantitySold } = req.body;

        // STEP 1: Validate fields
        if (!medicineId || !quantitySold) {
            return res.status(400).json({ error: 'medicineId and quantitySold required' });
        }

        if (quantitySold <= 0) {
            return res.status(400).json({ error: 'Quantity sold must be positive' });
        }

        // STEP 2: Get current medicine details
        const [medicineData] = await pool.query(
            'SELECT medicine_id, medicine_name, quantity FROM medicines WHERE medicine_id = ?',
            [medicineId]
        );

        // STEP 3: Check if medicine exists
        if (medicineData.length === 0) {
            return res.status(404).json({ error: 'Medicine not found' });
        }

        const currentQuantity = medicineData[0].quantity;
        const medicineName = medicineData[0].medicine_name;

        // STEP 4: Check if sufficient stock
        if (currentQuantity < quantitySold) {
            return res.status(400).json({
                error: `Insufficient stock. Available: ${currentQuantity}, Requested: ${quantitySold}`
            });
        }

        // STEP 5: Calculate new quantity
        const newQuantity = currentQuantity - quantitySold;

        // STEP 6: Update quantity in database
        await pool.query(
            'UPDATE medicines SET quantity = ? WHERE medicine_id = ?',
            [newQuantity, medicineId]
        );

        // STEP 7: Check if stock is below threshold (10) → Create alert
        let alertCreated = null;
        if (newQuantity < 10) {
            const alertMessage = `${medicineName} stock low: ${newQuantity} tablets remaining`;
            
            await pool.query(
                'INSERT INTO alerts (medicine_id, alert_type, message) VALUES (?, ?, ?)',
                [medicineId, 'LOW_STOCK', alertMessage]
            );

            alertCreated = {
                type: 'LOW_STOCK',
                message: alertMessage,
                currentStock: newQuantity
            };
        }

        // STEP 8: Return response with alert info
        return res.status(200).json({
            message: 'Stock updated successfully',
            stock: {
                medicineId: medicineId,
                medicineName: medicineName,
                quantitySold: quantitySold,
                oldQuantity: currentQuantity,
                newQuantity: newQuantity
            },
            alert: alertCreated
        });

    } catch (error) {
        console.error('Error in updateMedicineStock:', error);
        return res.status(500).json({ error: 'Database error while updating stock' });
    }
};


// ===== FUNCTION 4: getExpiringMedicines() =====
// Purpose: Get medicines expiring within 30 days
// Returns: 200 OK with array / 500 Error
const getExpiringMedicines = async (req, res) => {
    try {
        // STEP 1: Query medicines where expiry date < NOW() + 30 days
        const [expiringMedicines] = await pool.query(
            'SELECT medicine_id, medicine_name, quantity, expiry_date FROM medicines WHERE expiry_date < DATE_ADD(NOW(), INTERVAL 30 DAY) ORDER BY expiry_date ASC'
        );

        // STEP 2: Return results
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
// Purpose: Remove medicine from inventory
// Input: { medicineId }
// Returns: 200 OK / 404 Not Found / 500 Error
const deleteMedicine = async (req, res) => {
    try {
        const { medicineId } = req.body;

        // STEP 1: Validate field
        if (!medicineId) {
            return res.status(400).json({ error: 'medicineId required' });
        }

        // STEP 2: Check if medicine exists
        const [medicineData] = await pool.query(
            'SELECT medicine_name FROM medicines WHERE medicine_id = ?',
            [medicineId]
        );

        if (medicineData.length === 0) {
            return res.status(404).json({ error: 'Medicine not found' });
        }

        const medicineName = medicineData[0].medicine_name;

        // STEP 3: Delete medicine (CASCADE will also delete related alerts)
        await pool.query(
            'DELETE FROM medicines WHERE medicine_id = ?',
            [medicineId]
        );

        // STEP 4: Return success response
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
// Purpose: Get all unread alerts for dashboard
// Returns: 200 OK with array / 500 Error
const getAlerts = async (req, res) => {
    try {
        // STEP 1: Query all unread alerts with medicine details
        const [alerts] = await pool.query(
            'SELECT a.alert_id, a.medicine_id, a.alert_type, a.message, a.is_read, a.created_at, m.medicine_name FROM alerts a JOIN medicines m ON a.medicine_id = m.medicine_id WHERE a.is_read = FALSE ORDER BY a.created_at DESC'
        );

        // STEP 2: Return alerts
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


// ===== EXPORT ALL FUNCTIONS =====
module.exports = {
    addMedicine,
    getAllMedicines,
    updateMedicineStock,
    getExpiringMedicines,
    deleteMedicine,
    getAlerts
};

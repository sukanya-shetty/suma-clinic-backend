const express = require('express');
const router = express.Router();
const inventoryController = require('../controllers/inventoryController');
const { authMiddleware, authorizeRole } = require('../middleware/auth');

// POST /api/inventory/medicines
// Add new medicine or UPDATE existing (stock-in)
router.post('/medicines', authMiddleware, authorizeRole('Admin'), inventoryController.addMedicine);

// GET /api/inventory/medicines
// Get all medicines in inventory (Read-only for Doctor/Pharmacist/Admin)
router.get('/medicines', authMiddleware, inventoryController.getAllMedicines);

// PUT /api/inventory/medicines/:id/stock (Deprecated/Disabled)
router.put('/medicines/:id/stock', authMiddleware, inventoryController.updateMedicineStock);

// GET /api/inventory/expiring
// Get medicines expiring within 30 days
router.get('/expiring', authMiddleware, inventoryController.getExpiringMedicines);

// DELETE /api/inventory/medicines/:id
// Delete medicine from inventory
router.delete('/medicines/:id', authMiddleware, authorizeRole('Admin'), inventoryController.deleteMedicine);

// GET /api/inventory/alerts
// Get all unread alerts (low stock, expiry warnings)
router.get('/alerts', authMiddleware, inventoryController.getAlerts);

module.exports = router;

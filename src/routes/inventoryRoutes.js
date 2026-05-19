const express = require('express');
const router = express.Router();
const inventoryController = require('../controllers/inventoryController');
const { authMiddleware, authorizeRole } = require('../middleware/auth');

// ============================================================
// INVENTORY ROUTES
// ============================================================
// All routes require authentication (token must be valid)
// Some routes also require specific roles (Doctor-only, Staff-only)
// ============================================================

// POST /api/inventory/medicines
// Add new medicine or UPDATE existing (case-insensitive)
// Auth: Required (Both Doctor and Staff can add medicines)
// In real scenario: Doctor decides, Staff executes
// Request body: { name, price, quantity, expiryDate }
// Response: 201 Created / 200 Updated / 400 Bad Request
router.post('/medicines', authMiddleware, inventoryController.addMedicine);

// GET /api/inventory/medicines
// Get all medicines in inventory
// Auth: Required (Both Doctor and Staff can view)
// Request body: None
// Response: 200 OK with array of medicines
router.get('/medicines', authMiddleware, inventoryController.getAllMedicines);

// PUT /api/inventory/medicines/:id/stock
// Reduce stock when medicine is sold
// Auth: Required (Both Doctor and Staff can update stock)
// Request body: { quantitySold: 10 }
// Response: 200 OK with alert info / 400 Bad Request / 404 Not Found
router.put('/medicines/:id/stock', authMiddleware, inventoryController.updateMedicineStock);

// GET /api/inventory/expiring
// Get medicines expiring within 30 days
// Auth: Required (Both Doctor and Staff can view)
// Request body: None
// Response: 200 OK with array of expiring medicines
router.get('/expiring', authMiddleware, inventoryController.getExpiringMedicines);

// DELETE /api/inventory/medicines/:id
// Delete medicine from inventory
// Auth: Required + Doctor role only (Only doctor can delete)
// Request body: { medicineId: 5 }
// Response: 200 OK / 404 Not Found
router.delete('/medicines/:id', authMiddleware, authorizeRole('Doctor'), inventoryController.deleteMedicine);

// GET /api/inventory/alerts
// Get all unread alerts (low stock, expiry warnings)
// Auth: Required (Both Doctor and Staff can view alerts)
// Request body: None
// Response: 200 OK with array of alerts
router.get('/alerts', authMiddleware, inventoryController.getAlerts);

module.exports = router;

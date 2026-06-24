const express = require('express');
const router = express.Router();
const salesController = require('../controllers/salesController');
const { authMiddleware, authorizeRole } = require('../middleware/auth');

// POST /api/sales
// Create direct walk-in sale
router.post('/', authMiddleware, authorizeRole('Pharmacist'), salesController.createSale);

// POST /api/sales/dispense
// Dispense prescription medicines and generate invoice
router.post('/dispense', authMiddleware, authorizeRole('Pharmacist'), salesController.dispensePrescription);

// GET /api/sales/bills
// Retrieve list of all generated bills/invoices
router.get('/bills', authMiddleware, authorizeRole(['Admin', 'Pharmacist']), salesController.getAllBills);

// GET /api/sales/bills/:id
// Get detailed invoice details for printable bills
router.get('/bills/:id', authMiddleware, authorizeRole(['Admin', 'Pharmacist']), salesController.getBillDetails);

// GET /api/sales
// Retrieve list of all sales logs (Admin read-only, Pharmacist manages)
router.get('/', authMiddleware, authorizeRole(['Admin', 'Pharmacist']), salesController.getAllSales);

// GET /api/sales/daily
// Get daily summary
router.get('/daily', authMiddleware, authorizeRole(['Admin', 'Pharmacist']), salesController.getDailySalesSummary);

module.exports = router;

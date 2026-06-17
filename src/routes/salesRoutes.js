const express = require('express');
const router = express.Router();
const salesController = require('../controllers/salesController');
const { authMiddleware } = require('../middleware/auth');

// POST /api/sales
// Create a new sales transaction (walk-in or consultation)
router.post('/', authMiddleware, salesController.createSale);

// GET /api/sales
// Retrieve list of all transactions with optional date range filters
router.get('/', authMiddleware, salesController.getAllSales);

// GET /api/sales/daily
// Get total revenue and count for today's sales
router.get('/daily', authMiddleware, salesController.getDailySalesSummary);

module.exports = router;

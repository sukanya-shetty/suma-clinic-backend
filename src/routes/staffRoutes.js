const express = require('express');
const router = express.Router();
const staffController = require('../controllers/staffController');
const { authMiddleware, authorizeRole } = require('../middleware/auth');

// ============================================================
// STAFF ROUTES (ADMIN ONLY)
// ============================================================

// GET /api/staff/doctors
// Get active doctors roster (Accessible by any logged-in user)
router.get('/doctors', authMiddleware, staffController.getActiveDoctors);

// POST /api/staff/add-staff
router.post('/add-staff', authMiddleware, authorizeRole('Admin'), staffController.addStaff);

// GET /api/staff/all
router.get('/all', authMiddleware, authorizeRole('Admin'), staffController.getAllStaff);

// DELETE /api/staff/:id
router.delete('/:id', authMiddleware, authorizeRole('Admin'), staffController.deleteStaff);

module.exports = router;

const express = require('express');
const router = express.Router();
const staffController = require('../controllers/staffController');

// ============================================================
// STAFF ROUTES
// ============================================================
// These routes are used by the doctor to manage staff accounts
// In future, we'll add authentication middleware to protect these
// ============================================================

// POST /api/staff/add-staff
// Add new staff member (Pharmacist, Receptionist, Nurse)
// Request body: { name, email, phoneNumber, password, confirmPassword, role }
// Response: 201 Created or 400 Bad Request or 500 Error
router.post('/add-staff', staffController.addStaff);

// GET /api/staff/all
// Get all staff members
// Response: 200 OK with array of staff or 500 Error
router.get('/all', staffController.getAllStaff);

module.exports = router;

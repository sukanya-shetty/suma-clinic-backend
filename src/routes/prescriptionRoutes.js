const express = require('express');
const router = express.Router();
const prescriptionController = require('../controllers/prescriptionController');
const { authMiddleware, authorizeRole } = require('../middleware/auth');

// ============================================================================
// ROUTE 1: Create New Prescription
// POST /api/prescriptions
// ============================================================================
// PURPOSE: Doctor creates a new prescription for a visit
// AUTH: ✅ Requires JWT token (authMiddleware) + Doctor role (authorizeRole)
// WHO CAN: Only Doctor
// BODY: { visit_id, medicine_id, dosage, quantity, duration_days }
// RESPONSE: 201 Created with prescription_id + inventory update, or 400/404/409/500 Error
// CRITICAL: Automatically reduces medicine inventory by prescribed quantity!
// EXAMPLE BODY:
//   {
//     "visit_id": 1,
//     "medicine_id": 5,
//     "dosage": "500mg twice daily",
//     "quantity": 20,
//     "duration_days": 5
//   }
// EXAMPLE RESPONSE (201):
//   {
//     "message": "Prescription created successfully",
//     "prescription": { "prescription_id": 10, ... },
//     "inventory_update": {
//       "previous_stock": 100,
//       "prescribed_quantity": 20,
//       "new_stock": 80
//     }
//   }
// ============================================================================
router.post('/', authMiddleware, authorizeRole('Doctor'), prescriptionController.createPrescription);


// ============================================================================
// ROUTE 2: Get All Prescriptions for a Specific Visit
// GET /api/prescriptions/:visit_id
// ============================================================================
// PURPOSE: Retrieve all prescriptions (medicines prescribed) for a specific visit
// AUTH: ✅ Requires JWT token (authMiddleware)
// WHO CAN: Any logged-in user (Doctor or Staff can view visit's prescriptions)
// PARAMS: :visit_id (from URL)
// RESPONSE: 200 with array of all prescriptions for this visit, or 500 Error
// NOTE: Includes medicine_name via JOIN, ordered by created_at DESC (newest first)
// EXAMPLE REQUEST:
//   GET /api/prescriptions/1
// ============================================================================
router.get('/:visit_id', authMiddleware, prescriptionController.getPrescriptionsByVisit);


// ============================================================================
// ROUTE 3: Update Existing Prescription
// PUT /api/prescriptions/:id
// ============================================================================
// PURPOSE: Update prescription details (dosage, quantity, duration)
// AUTH: ✅ Requires JWT token (authMiddleware) + Doctor role (authorizeRole)
// WHO CAN: Only Doctor
// PARAMS: :id (prescription_id from URL)
// BODY: { dosage, quantity, duration_days } - PARTIAL UPDATE
// RESPONSE: 200 with updated prescription, or 400/404/409/500 Error
// IMPORTANT: Cannot update visit_id or medicine_id (foreign keys are immutable)
// WARNING: If quantity changes, inventory is automatically adjusted!
//   - Increase quantity? Stock decreases by difference
//   - Decrease quantity? Stock increases by difference
// EXAMPLE REQUEST:
//   PUT /api/prescriptions/10
//   BODY: { "dosage": "500mg once daily", "quantity": 15 }
// ============================================================================
router.put('/:id', authMiddleware, authorizeRole('Doctor'), prescriptionController.updatePrescription);


// ============================================================================
// ROUTE 4: Delete Existing Prescription
// DELETE /api/prescriptions/:id
// ============================================================================
// PURPOSE: Delete a prescription (MUST restore medicine quantity!)
// AUTH: ✅ Requires JWT token (authMiddleware) + Doctor role (authorizeRole)
// WHO CAN: Only Doctor
// PARAMS: :id (prescription_id from URL)
// RESPONSE: 200 with success + inventory restoration details, or 404/500 Error
// CRITICAL: When deleted, medicine quantity is RESTORED to inventory!
//   Example: Had 80 tablets → delete prescription of 20 → back to 100
// EXAMPLE REQUEST:
//   DELETE /api/prescriptions/10
// EXAMPLE RESPONSE (200):
//   {
//     "message": "Prescription deleted successfully",
//     "prescription_id": 10,
//     "inventory_restored": {
//       "previous_stock": 80,
//       "restored_quantity": 20,
//       "new_stock": 100
//     }
//   }
// ============================================================================
router.delete('/:id', authMiddleware, authorizeRole('Doctor'), prescriptionController.deletePrescription);


// Export router so app.js can use it
module.exports = router;

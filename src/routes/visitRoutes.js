const express = require('express');
const router = express.Router();
const visitController = require('../controllers/visitController');
const { authMiddleware, authorizeRole } = require('../middleware/auth');

// ============================================================================
// ROUTE 1: Create New Visit
// POST /api/visits
// ============================================================================
// PURPOSE: Doctor creates a new visit record for a patient
// AUTH: ✅ Requires JWT token (authMiddleware) + Doctor role (authorizeRole)
// WHO CAN: Only Doctor (superuser)
// BODY: { patient_id, visit_date, diagnosis, blood_pressure, temperature, notes }
// RESPONSE: 201 Created with visit_id, or 400/404/500 Error
// EXAMPLE BODY:
//   {
//     "patient_id": 1,
//     "visit_date": "2026-05-28T10:30:00",
//     "diagnosis": "Common cold with mild fever",
//     "blood_pressure": "120/80",
//     "temperature": 98.6,
//     "notes": "Prescribed rest and fluids"
//   }
// ============================================================================
router.post('/', authMiddleware, authorizeRole('Doctor'), visitController.createVisit);


// ============================================================================
// ROUTE 2: Get All Visits for a Specific Patient
// GET /api/visits/:patient_id
// ============================================================================
// PURPOSE: Retrieve all visits (medical history) for a specific patient
// AUTH: ✅ Requires JWT token (authMiddleware)
// WHO CAN: Any logged-in user (Doctor or Staff can view patient history)
// PARAMS: :patient_id (from URL)
// RESPONSE: 200 with array of all visits, or 500 Error
// NOTE: Ordered by visit_date DESC (newest visits first)
// EXAMPLE REQUEST:
//   GET /api/visits/1
// EXAMPLE RESPONSE:
//   {
//     "message": "Patient visits retrieved successfully",
//     "total": 3,
//     "visits": [
//       {
//         "visit_id": 101,
//         "doctor_id": 1,
//         "patient_id": 1,
//         "visit_date": "2026-05-28T10:30:00",
//         "diagnosis": "Common cold",
//         "blood_pressure": "120/80",
//         "temperature": 98.6,
//         "notes": "Prescribed rest"
//       }
//     ]
//   }
// ============================================================================
// GET /api/visits/recent/all
router.get('/recent/all', authMiddleware, visitController.getRecentVisits);

router.get('/:patient_id', authMiddleware, visitController.getPatientVisits);


// ============================================================================
// ROUTE 3: Update Existing Visit
// PUT /api/visits/:id
// ============================================================================
// PURPOSE: Update visit details (diagnosis, vital signs, notes)
// AUTH: ✅ Requires JWT token (authMiddleware) + Doctor role (authorizeRole)
// WHO CAN: Only Doctor
// PARAMS: :id (visit_id from URL)
// BODY: { diagnosis, blood_pressure, temperature, notes } - PARTIAL UPDATE
// RESPONSE: 200 with updated visit, or 400/404/500 Error
// IMPORTANT: Cannot update patient_id or doctor_id (foreign keys are immutable)
// EXAMPLE REQUEST:
//   PUT /api/visits/101
//   BODY: { "blood_pressure": "122/82", "temperature": 98.4 }
// ============================================================================
router.put('/:id', authMiddleware, authorizeRole('Doctor'), visitController.updateVisit);


// ============================================================================
// ROUTE 4: Delete Existing Visit
// DELETE /api/visits/:id
// ============================================================================
// PURPOSE: Delete a visit record (and all related prescriptions via CASCADE)
// AUTH: ✅ Requires JWT token (authMiddleware) + Doctor role (authorizeRole)
// WHO CAN: Only Doctor
// PARAMS: :id (visit_id from URL)
// RESPONSE: 200 with success message, or 404/500 Error
// CASCADE: Deletes all prescriptions linked to this visit
// EXAMPLE REQUEST:
//   DELETE /api/visits/101
// ============================================================================
router.delete('/:id', authMiddleware, authorizeRole('Doctor'), visitController.deleteVisit);


// Export router so app.js can use it
module.exports = router;

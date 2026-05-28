const express = require('express');
const router = express.Router();
const patientController = require('../controllers/patientController');
const { authMiddleware, authorizeRole } = require('../middleware/auth');

// ============================================================================
// ROUTE 1: Register New Patient
// POST /api/patients/register
// ============================================================================
// PURPOSE: Add a new patient to the clinic
// AUTH: ✅ Requires JWT token (authMiddleware)
// WHO CAN: Any logged-in user (Doctor or Staff)
// BODY: { patient_name, phone_number (optional), age, gender, address }
// RESPONSE: 201 Created with patient_id, or 400/409 Conflict
// ============================================================================
router.post('/register', authMiddleware, patientController.registerPatient);


// ============================================================================
// ROUTE 2: Get All Patients
// GET /api/patients
// ============================================================================
// PURPOSE: Retrieve all registered patients (sorted by registration date)
// AUTH: ✅ Requires JWT token (authMiddleware)
// WHO CAN: Any logged-in user (Doctor or Staff)
// QUERY: None
// RESPONSE: 200 with array of all patients
// ============================================================================
router.get('/', authMiddleware, patientController.getAllPatients);


// ============================================================================
// ROUTE 3: Search Patients by Name or Phone
// GET /api/patients/search?name=Rajesh&phone=9876543210
// ============================================================================
// PURPOSE: Find patient by name (partial match) or phone (exact match)
// AUTH: ✅ Requires JWT token (authMiddleware)
// WHO CAN: Any logged-in user (Doctor uses this to find patient_id)
// QUERY PARAMS:
//   - name (optional): Partial match using LIKE (e.g., "Raj" finds "Rajesh", "Raj Kumar")
//   - phone (optional): Exact match
// RESPONSE: 200 with matching patients
// ============================================================================
router.get('/search', authMiddleware, patientController.searchPatients);


// ============================================================================
// ROUTE 4: Update Patient Details
// PUT /api/patients/:id
// ============================================================================
// PURPOSE: Update patient information (name, age, gender, address)
// AUTH: ✅ Requires JWT token (authMiddleware)
// WHO CAN: Any logged-in user
// PARAMS: patient_id (from URL)
// BODY: { patient_name, age, gender, address } (only fields to update)
// RESTRICTION: ⚠️ Phone number CANNOT be changed (unique constraint!)
// RESPONSE: 200 Updated, or 400 Bad request, or 404 Not found
// ============================================================================
router.put('/:id', authMiddleware, patientController.updatePatient);


// ============================================================================
// ROUTE 5: Delete Patient
// DELETE /api/patients/:id
// ============================================================================
// PURPOSE: Remove patient from system (CASCADE deletes all visits + prescriptions)
// AUTH: ✅ JWT token + DOCTOR ONLY (Superuser permission required)
// WHO CAN: Only Doctor (authorizeRole checks this)
// PARAMS: patient_id (from URL)
// RESTRICTION: ⚠️ Dangerous operation - only Doctor can delete!
// RESPONSE: 200 Deleted, or 403 Unauthorized, or 404 Not found
// MIDDLEWARE ORDER: authMiddleware FIRST (decode JWT), then authorizeRole (check role)
// ============================================================================
router.delete('/:id', authMiddleware, authorizeRole('Doctor'), patientController.deletePatient);


// ============================================================================
// ROUTE 6: Get Complete Patient Medical History
// GET /api/patients/:id/history
// ============================================================================
// PURPOSE: Retrieve all visits and prescriptions for one patient
// AUTH: ✅ Requires JWT token (authMiddleware)
// WHO CAN: Any logged-in user (Doctor reviews complete history)
// PARAMS: patient_id (from URL)
// RESPONSE: 200 with patient info + all visits + all prescriptions for each visit
// EXAMPLE RESPONSE:
// {
//   patient_id: 1,
//   patient_name: "Rajesh Kumar",
//   visits: [
//     {
//       visit_id: 1,
//       visit_date: "2026-05-20",
//       diagnosis: "Common cold",
//       bp_level: "120/80",
//       prescriptions: [
//         { medicine_name: "Aspirin", dosage: "500mg", duration: "3 days" },
//         { medicine_name: "Cough syrup", dosage: "5ml", duration: "5 days" }
//       ]
//     }
//   ]
// }
// ============================================================================
router.get('/:id/history', authMiddleware, patientController.getPatientHistory);


module.exports = router;

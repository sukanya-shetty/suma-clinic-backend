//express gives us the API server framework.
const express=require('express');
//cors allows frontend and backend to communicate across ports.
const cors=require('cors');
//app is the main Express application instance.
const app=express();

//middleware to parse JSON bodies and enable CORS. cors responsible for front end aand backend
app.use(cors());
//lets server read json data sent in request bodies. necessary for POST and PUT requests.
app.use(express.json());

// Auth routes: /api/auth/login, /api/auth/register
app.use('/api/auth', require('./routes/authRoutes'));

// Staff routes: /api/staff/add-staff, /api/staff/all
app.use('/api/staff', require('./routes/staffRoutes'));

// Inventory routes: /api/inventory/medicines, /api/inventory/expiring, /api/inventory/alerts, etc.
app.use('/api/inventory', require('./routes/inventoryRoutes'));

// Patient routes: /api/patients/register, /api/patients, /api/patients/search, /api/patients/:id, /api/patients/:id/history
app.use('/api/patients', require('./routes/patientRoutes'));

// Debug routes (temporary): removed after verification
// app.use('/api/debug', require('./routes/debugRoutes'));

// Visit routes: /api/visits, /api/visits/:patient_id, /api/visits/:id (PUT/DELETE)
app.use('/api/visits', require('./routes/visitRoutes'));

// Prescription routes: /api/prescriptions, /api/prescriptions/:visit_id, /api/prescriptions/:id (PUT/DELETE)
app.use('/api/prescriptions', require('./routes/prescriptionRoutes'));

// Sales routes: /api/sales
app.use('/api/sales', require('./routes/salesRoutes'));

//This exports the Express app so server.js can use it.
module.exports=app;
const { Hono } = require('hono');
const { cors } = require('hono/cors');
const jwt = require('jsonwebtoken');
const { setDB } = require('./config/db');

const app = new Hono();

// Enable CORS
app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
  exposeHeaders: ['Content-Length'],
  maxAge: 600,
}));

// Global DB Binding Middleware
app.use('*', async (c, next) => {
  // Bind D1 to database config
  setDB(c.env.DB);
  // Set JWT_SECRET in process.env for compatibility with controllers/middleware
  process.env.JWT_SECRET = c.env.JWT_SECRET || 'sumaclinic-secret-key-12345';
  process.env.JWT_EXPIRES_IN = c.env.JWT_EXPIRES_IN || '24h';
  await next();
});

// Auth Middleware for Hono
const honoAuthMiddleware = async (c, next) => {
  const authHeader = c.req.header('authorization');
  if (!authHeader) {
    return c.json({ error: 'No authorization header provided' }, 401);
  }

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return c.json({ error: 'Invalid authorization format. Use "Bearer {token}"' }, 401);
  }

  const token = parts[1];
  try {
    const secret = process.env.JWT_SECRET;
    const decoded = jwt.verify(token, secret);
    c.set('user', decoded);
    await next();
  } catch (error) {
    return c.json({ error: 'Invalid or expired token' }, 401);
  }
};

// Role Authorization Middleware for Hono
const honoAuthorizeRole = (requiredRole) => {
  return async (c, next) => {
    const user = c.get('user');
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401);
    }
    if (user.role === requiredRole || user.role === 'Doctor') {
      await next();
    } else {
      return c.json({ error: `Access denied. This action requires ${requiredRole} role` }, 403);
    }
  };
};

// Express-to-Hono Handler Adapter Bridge
const makeHandler = (expressHandler) => {
  return async (c) => {
    // Re-verify DB and env are set for this context run
    setDB(c.env.DB);
    process.env.JWT_SECRET = c.env.JWT_SECRET || 'sumaclinic-secret-key-12345';
    process.env.JWT_EXPIRES_IN = c.env.JWT_EXPIRES_IN || '24h';

    // Parse JSON body safely
    let body = {};
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
      try {
        body = await c.req.json();
      } catch (e) {
        body = {};
      }
    }

    // Build mock req and res
    const req = {
      body,
      query: c.req.query(),
      params: c.req.param(),
      headers: {
        authorization: c.req.header('authorization'),
      },
      user: c.get('user') || null,
      env: c.env || {},
    };

    let responseStatus = 200;
    let responseJson = null;

    const res = {
      status: (code) => {
        responseStatus = code;
        return res;
      },
      json: (data) => {
        responseJson = data;
        return res;
      },
    };

    try {
      await expressHandler(req, res);
      return c.json(responseJson, responseStatus);
    } catch (err) {
      console.error('Handler execution error:', err);
      return c.json({ error: 'Internal Server Error', message: err.message }, 500);
    }
  };
};

// Import Controllers
const authController = require('./controllers/authController');
const staffController = require('./controllers/staffController');
const inventoryController = require('./controllers/inventoryController');
const patientController = require('./controllers/patientController');
const visitController = require('./controllers/visitController');
const prescriptionController = require('./controllers/prescriptionController');
const salesController = require('./controllers/salesController');

// Define API Routes
app.get('/api', (c) => c.json({ success: true, message: 'Clinic API is running!' }));
app.get('/api/', (c) => c.json({ success: true, message: 'Clinic API is running!' }));

// 1. Auth routes
app.post('/api/auth/login', makeHandler(authController.loginUser));
app.post('/api/auth/register', makeHandler(authController.registerUser));
app.post('/api/auth/forgot-password', makeHandler(authController.forgotPassword));
app.post('/api/auth/reset-password', makeHandler(authController.resetPassword));

// 2. Staff routes
app.post('/api/staff/add-staff', honoAuthMiddleware, honoAuthorizeRole('Doctor'), makeHandler(staffController.addStaff));
app.get('/api/staff/all', honoAuthMiddleware, honoAuthorizeRole('Doctor'), makeHandler(staffController.getAllStaff));

// 3. Inventory routes
app.post('/api/inventory/medicines', honoAuthMiddleware, honoAuthorizeRole('Doctor'), makeHandler(inventoryController.addMedicine));
app.get('/api/inventory/medicines', honoAuthMiddleware, makeHandler(inventoryController.getAllMedicines));
app.put('/api/inventory/medicines/:id', honoAuthMiddleware, makeHandler(inventoryController.updateMedicineStock));
app.get('/api/inventory/expiring', honoAuthMiddleware, makeHandler(inventoryController.getExpiringMedicines));
app.delete('/api/inventory/medicines/:id', honoAuthMiddleware, honoAuthorizeRole('Doctor'), makeHandler(inventoryController.deleteMedicine));
app.get('/api/inventory/alerts', honoAuthMiddleware, makeHandler(inventoryController.getAlerts));

// 4. Patient routes
app.post('/api/patients/register', honoAuthMiddleware, makeHandler(patientController.registerPatient));
app.get('/api/patients', honoAuthMiddleware, makeHandler(patientController.getAllPatients));
app.get('/api/patients/search', honoAuthMiddleware, makeHandler(patientController.searchPatients));
app.put('/api/patients/:id', honoAuthMiddleware, makeHandler(patientController.updatePatient));
app.delete('/api/patients/:id', honoAuthMiddleware, honoAuthorizeRole('Doctor'), makeHandler(patientController.deletePatient));
app.get('/api/patients/:id/history', honoAuthMiddleware, makeHandler(patientController.getPatientHistory));

// 5. Visit routes
app.post('/api/visits', honoAuthMiddleware, makeHandler(visitController.createVisit));
app.get('/api/visits/recent/all', honoAuthMiddleware, makeHandler(visitController.getRecentVisits));
app.get('/api/visits/:patient_id', honoAuthMiddleware, makeHandler(visitController.getPatientVisits));
app.put('/api/visits/:id', honoAuthMiddleware, makeHandler(visitController.updateVisit));
app.delete('/api/visits/:id', honoAuthMiddleware, honoAuthorizeRole('Doctor'), makeHandler(visitController.deleteVisit));


// 6. Prescription routes
app.post('/api/prescriptions', honoAuthMiddleware, makeHandler(prescriptionController.createPrescription));
app.get('/api/prescriptions/:visit_id', honoAuthMiddleware, makeHandler(prescriptionController.getPrescriptionsByVisit));
app.put('/api/prescriptions/:id', honoAuthMiddleware, makeHandler(prescriptionController.updatePrescription));
app.delete('/api/prescriptions/:id', honoAuthMiddleware, makeHandler(prescriptionController.deletePrescription));

// 7. Sales routes
app.post('/api/sales', honoAuthMiddleware, makeHandler(salesController.createSale));
app.get('/api/sales', honoAuthMiddleware, makeHandler(salesController.getAllSales));
app.get('/api/sales/summary/daily', honoAuthMiddleware, makeHandler(salesController.getDailySalesSummary));

// Base route
app.get('/', (c) => c.text('Clinic API Cloudflare Worker running!'));

export default app;

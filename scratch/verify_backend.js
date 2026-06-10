const http = require('http');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'suma_clinic_secret_key_jwt_token';

// Generate a valid token for Doctor ID 1
const doctorToken = jwt.sign(
    { id: 1, name: 'Dr. Rama Sharma', role: 'Doctor' },
    JWT_SECRET,
    { expiresIn: '1h' }
);

const request = (method, path, body = null) => {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'localhost',
            port: PORT,
            path: path,
            method: method,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${doctorToken}`
            }
        };

        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                try {
                    const parsed = data ? JSON.parse(data) : {};
                    resolve({ status: res.statusCode, body: parsed });
                } catch (e) {
                    resolve({ status: res.statusCode, raw: data });
                }
            });
        });

        req.on('error', (err) => { reject(err); });

        if (body) {
            req.write(JSON.stringify(body));
        }
        req.end();
    });
};

async function runTests() {
    console.log('=== STARTING BACKEND VERIFICATION TESTS ===\n');
    let passed = 0;
    let failed = 0;

    const assert = (name, condition, details = '') => {
        if (condition) {
            console.log(`✅ [PASS] ${name}`);
            passed++;
        } else {
            console.error(`❌ [FAIL] ${name} ${details}`);
            failed++;
        }
    };

    try {
        // Test 1: Get Medicines
        console.log('Testing Inventory...');
        const medsRes = await request('GET', '/api/inventory/medicines');
        assert('GET /api/inventory/medicines returns 200', medsRes.status === 200);
        
        // Ensure we have aspirin in stock or add it
        let aspirin = medsRes.body.medicines ? medsRes.body.medicines.find(m => m.medicine_name.toLowerCase() === 'aspirin') : null;
        if (!aspirin) {
            console.log('Aspirin not found, registering a new medicine...');
            const addMedRes = await request('POST', '/api/inventory/medicines', {
                name: 'Aspirin',
                price: 15.0,
                quantity: 50,
                expiryDate: '2028-12-31'
            });
            assert('POST /api/inventory/medicines (add medicine) returns 201/200', addMedRes.status === 201 || addMedRes.status === 200);
            aspirin = addMedRes.body.medicine;
        } else {
            // If aspirin exists but stock is low, add some stock
            if (aspirin.quantity < 20) {
                console.log('Aspirin stock is low, updating stock...');
                const addStockRes = await request('POST', '/api/inventory/medicines', {
                    name: 'Aspirin',
                    price: aspirin.price || 15.0,
                    quantity: 50,
                    expiryDate: '2028-12-31'
                });
                assert('POST /api/inventory/medicines (replenish stock) returns 200/201', addStockRes.status === 200 || addStockRes.status === 201);
            }
        }

        // Fetch again to get updated medicine details
        const refreshedMeds = await request('GET', '/api/inventory/medicines');
        aspirin = refreshedMeds.body.medicines.find(m => m.medicine_name.toLowerCase() === 'aspirin');
        const aspirinId = aspirin.medicine_id;
        const initialAspirinQty = aspirin.quantity;
        console.log(`Aspirin ID: ${aspirinId}, Current Quantity: ${initialAspirinQty}`);

        // Test 2: Register a new patient with unique phone number
        console.log('\nTesting Patient Management...');
        const testPhone = '90000' + Math.floor(10000 + Math.random() * 90000);
        const registerRes = await request('POST', '/api/patients/register', {
            patient_name: 'Jane Doe Test',
            phone_number: testPhone,
            age: 29,
            gender: 'Female',
            address: '456 Verification Road'
        });
        assert('POST /api/patients/register (new patient) returns 210/201', registerRes.status === 201, `Status: ${registerRes.status}`);
        const patientId = registerRes.body.patient ? registerRes.body.patient.id : null;

        // Test 3: Search patient
        const searchRes = await request('GET', `/api/patients/search?phone=${testPhone}`);
        assert('GET /api/patients/search?phone=... returns 200', searchRes.status === 200);
        assert('Search returns the correct patient ID', searchRes.body.patients && searchRes.body.patients[0].patient_id === patientId);

        // Test 4: Create a visit
        console.log('\nTesting Visit Records...');
        const visitRes = await request('POST', '/api/visits', {
            patient_id: patientId,
            visit_date: new Date().toISOString().slice(0, 19).replace('T', ' '),
            diagnosis: 'Verification check-up',
            blood_pressure: '120/80',
            temperature: 98.6,
            notes: 'Everything is in perfect working order.'
        });
        assert('POST /api/visits (new visit) returns 201', visitRes.status === 201, `Status: ${visitRes.status}`);
        const visitId = visitRes.body.visit ? visitRes.body.visit.visit_id : null;

        // Test 5: Create a prescription (decreases stock)
        console.log('\nTesting Prescription & Stock Reduction...');
        const prescribeRes = await request('POST', '/api/prescriptions', {
            visit_id: visitId,
            medicine_id: aspirinId,
            dosage: '500mg daily',
            quantity: 5,
            duration_days: 5
        });
        assert('POST /api/prescriptions (new prescription) returns 201', prescribeRes.status === 201, `Status: ${prescribeRes.status}`);
        
        // Verify stock decreased
        const medsVerifyRes = await request('GET', '/api/inventory/medicines');
        const aspirinVerify = medsVerifyRes.body.medicines.find(m => m.medicine_id === aspirinId);
        const expectedStock = initialAspirinQty - 5;
        assert('Aspirin inventory quantity reduced by 5 units', aspirinVerify.quantity === expectedStock, `Expected: ${expectedStock}, Found: ${aspirinVerify.quantity}`);

        // Test 6: Get patient history
        console.log('\nTesting Patient History retrieval...');
        const historyRes = await request('GET', `/api/patients/${patientId}/history`);
        assert('GET /api/patients/:id/history returns 200', historyRes.status === 200);
        assert('History includes the newly added visit and prescription details', 
            historyRes.body.visits && historyRes.body.visits.length > 0 && historyRes.body.visits[0].prescriptions.length > 0);

        // Test 7: Get low stock/expiring alerts
        console.log('\nTesting Alerts...');
        const alertsRes = await request('GET', '/api/inventory/alerts');
        assert('GET /api/inventory/alerts returns 200', alertsRes.status === 200);

        // Test 8: Get expiring medicines
        const expiringRes = await request('GET', '/api/inventory/expiring');
        assert('GET /api/inventory/expiring returns 200', expiringRes.status === 200);

        // Test 9: Update medicine stock (REST test)
        console.log('\nTesting Stock Update...');
        const updateStockRes = await request('PUT', `/api/inventory/medicines/${aspirinId}/stock`, {
            quantitySold: 2
        });
        assert('PUT /api/inventory/medicines/:id/stock returns 200 (REST id fix test)', updateStockRes.status === 200, `Status: ${updateStockRes.status}`);

        // Test 10: Delete medicine (REST delete test)
        console.log('\nTesting Delete Medicine...');
        // Let's create a temp medicine to delete so we don't drop aspirin
        const tempMedRes = await request('POST', '/api/inventory/medicines', {
            name: 'Temp Test Med',
            price: 5.0,
            quantity: 10,
            expiryDate: '2029-01-01'
        });
        const tempMedId = tempMedRes.body.medicine.id;
        const deleteMedRes = await request('DELETE', `/api/inventory/medicines/${tempMedId}`);
        assert('DELETE /api/inventory/medicines/:id returns 200 (REST delete fix test)', deleteMedRes.status === 200, `Status: ${deleteMedRes.status}`);

        console.log('\n=== VERIFICATION COMPLETED ===');
        console.log(`Passed: ${passed}/${passed + failed}`);
        if (failed > 0) {
            console.error(`Status: FAILED with ${failed} issues.`);
            process.exit(1);
        } else {
            console.log('Status: ALL ENDPOINTS ARE WORKING PERFECTLY! 🎉');
            process.exit(0);
        }

    } catch (err) {
        console.error('Test execution failed:', err);
        process.exit(1);
    }
}

runTests();

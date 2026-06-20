-- Cloudflare D1 Database Schema for Clinic App

-- 1. Doctors Table
CREATE TABLE IF NOT EXISTS doctors (
    doctor_id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    phone_number TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 2. Staff Table
CREATE TABLE IF NOT EXISTS staff (
    staff_id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    phone_number TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT NOT NULL, -- 'Pharmacist', 'Receptionist', 'Nurse'
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 3. Patients Table
CREATE TABLE IF NOT EXISTS patients (
    patient_id INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_name TEXT NOT NULL,
    phone_number TEXT UNIQUE,
    age INTEGER NOT NULL,
    gender TEXT NOT NULL, -- 'Male', 'Female', 'Other'
    address TEXT,
    registration_date DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 4. Visits Table
CREATE TABLE IF NOT EXISTS visits (
    visit_id INTEGER PRIMARY KEY AUTOINCREMENT,
    doctor_id INTEGER NOT NULL,
    patient_id INTEGER NOT NULL,
    visit_date TEXT NOT NULL,
    diagnosis TEXT DEFAULT 'General Visit',
    blood_pressure TEXT DEFAULT 'N/A',
    temperature REAL DEFAULT 98.6,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(doctor_id) REFERENCES doctors(doctor_id) ON DELETE CASCADE,
    FOREIGN KEY(patient_id) REFERENCES patients(patient_id) ON DELETE CASCADE
);

-- 5. Medicines Table
CREATE TABLE IF NOT EXISTS medicines (
    medicine_id INTEGER PRIMARY KEY AUTOINCREMENT,
    medicine_name TEXT UNIQUE NOT NULL,
    price REAL NOT NULL,
    quantity INTEGER NOT NULL,
    expiry_date TEXT NOT NULL,
    batch_number TEXT,
    supplier_name TEXT,
    purchase_price REAL
);

-- 6. Prescriptions Table
CREATE TABLE IF NOT EXISTS prescriptions (
    prescription_id INTEGER PRIMARY KEY AUTOINCREMENT,
    visit_id INTEGER NOT NULL,
    medicine_id INTEGER NOT NULL,
    dosage TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    duration_days INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(visit_id) REFERENCES visits(visit_id) ON DELETE CASCADE,
    FOREIGN KEY(medicine_id) REFERENCES medicines(medicine_id) ON DELETE CASCADE
);

-- 7. Sales Table
CREATE TABLE IF NOT EXISTS sales (
    sale_id INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id INTEGER,
    medicine_name TEXT NOT NULL,
    quantity_sold INTEGER NOT NULL,
    price_per_unit REAL NOT NULL,
    total_amount REAL NOT NULL,
    sale_type TEXT DEFAULT 'Direct Walk-in',
    created_by INTEGER,
    sale_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(patient_id) REFERENCES patients(patient_id) ON DELETE SET NULL
);

-- 8. Alerts Table
CREATE TABLE IF NOT EXISTS alerts (
    alert_id INTEGER PRIMARY KEY AUTOINCREMENT,
    medicine_id INTEGER NOT NULL,
    alert_type TEXT NOT NULL, -- 'LOW_STOCK'
    message TEXT NOT NULL,
    is_read INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(medicine_id) REFERENCES medicines(medicine_id) ON DELETE CASCADE
);

-- 9. Audit Log Table
CREATE TABLE IF NOT EXISTS audit_log (
    audit_id INTEGER PRIMARY KEY AUTOINCREMENT,
    doctor_id INTEGER,
    action TEXT NOT NULL,
    table_name TEXT NOT NULL,
    record_id INTEGER NOT NULL,
    old_value TEXT,
    new_value TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
);

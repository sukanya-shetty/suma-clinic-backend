-- ============================================================
-- SUMA CLINIC CLOUDFLARE D1 / SQLITE COMPATIBLE MIGRATION BACKUP
-- Generated on: 2026-06-22T03:35:36.471Z
-- ============================================================

PRAGMA foreign_keys = OFF;

DROP TABLE IF EXISTS audit_log;
DROP TABLE IF EXISTS sales;
DROP TABLE IF EXISTS prescriptions;
DROP TABLE IF EXISTS alerts;
DROP TABLE IF EXISTS expiry_tracking;
DROP TABLE IF EXISTS medicines;
DROP TABLE IF EXISTS visits;
DROP TABLE IF EXISTS patients;
DROP TABLE IF EXISTS staff;
DROP TABLE IF EXISTS doctors;

DROP VIEW IF EXISTS patient_visit_history;
DROP VIEW IF EXISTS low_stock_medicines;
DROP VIEW IF EXISTS expiry_alert_medicines;

-- ============================================================
-- TABLE CREATION (DDL)
-- ============================================================

CREATE TABLE doctors (
  doctor_id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  phone_number TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  is_active INTEGER DEFAULT 1,
  reset_token TEXT,
  reset_token_expires TEXT
);

CREATE TABLE staff (
  staff_id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  phone_number TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  role TEXT CHECK(role IN ('Pharmacist', 'Receptionist', 'Nurse')) NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  is_active INTEGER DEFAULT 1,
  reset_token TEXT,
  reset_token_expires TEXT
);

CREATE TABLE patients (
  patient_id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_name TEXT NOT NULL,
  phone_number TEXT UNIQUE,
  age INTEGER NOT NULL,
  gender TEXT CHECK(gender IN ('Male', 'Female', 'Other')) NOT NULL,
  address TEXT,
  registration_date TEXT DEFAULT CURRENT_TIMESTAMP,
  is_active INTEGER DEFAULT 1
);

CREATE TABLE visits (
  visit_id INTEGER PRIMARY KEY AUTOINCREMENT,
  doctor_id INTEGER NOT NULL,
  patient_id INTEGER NOT NULL,
  visit_date TEXT NOT NULL,
  diagnosis TEXT,
  blood_pressure TEXT,
  temperature REAL,
  notes TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (doctor_id) REFERENCES doctors(doctor_id) ON DELETE SET NULL,
  FOREIGN KEY (patient_id) REFERENCES patients(patient_id) ON DELETE CASCADE
);

CREATE TABLE medicines (
  medicine_id INTEGER PRIMARY KEY AUTOINCREMENT,
  medicine_name TEXT UNIQUE NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 0,
  price REAL NOT NULL,
  expiry_date TEXT,
  batch_number TEXT,
  purchase_date TEXT,
  supplier_name TEXT,
  purchase_price REAL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE alerts (
  alert_id INTEGER PRIMARY KEY AUTOINCREMENT,
  medicine_id INTEGER NOT NULL,
  alert_type TEXT CHECK(alert_type IN ('LOW_STOCK', 'EXPIRY_WARNING')) NOT NULL,
  message TEXT NOT NULL,
  is_read INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (medicine_id) REFERENCES medicines(medicine_id) ON DELETE CASCADE
);

CREATE TABLE prescriptions (
  prescription_id INTEGER PRIMARY KEY AUTOINCREMENT,
  visit_id INTEGER NOT NULL,
  medicine_id INTEGER NOT NULL,
  dosage TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  duration_days INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (visit_id) REFERENCES visits(visit_id) ON DELETE CASCADE,
  FOREIGN KEY (medicine_id) REFERENCES medicines(medicine_id) ON DELETE CASCADE
);

CREATE TABLE sales (
  sale_id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER,
  medicine_name TEXT NOT NULL,
  quantity_sold INTEGER NOT NULL,
  price_per_unit REAL NOT NULL,
  total_amount REAL NOT NULL,
  sale_type TEXT CHECK(sale_type IN ('Consultation', 'Direct Walk-in')) DEFAULT 'Consultation',
  sale_date TEXT DEFAULT CURRENT_TIMESTAMP,
  created_by INTEGER,
  FOREIGN KEY (patient_id) REFERENCES patients(patient_id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES doctors(doctor_id) ON DELETE SET NULL
);

CREATE TABLE expiry_tracking (
  expiry_id INTEGER PRIMARY KEY AUTOINCREMENT,
  medicine_id INTEGER NOT NULL,
  batch_number TEXT,
  expiry_date TEXT NOT NULL,
  alert_status TEXT CHECK(alert_status IN ('Normal', 'Near Expiry', 'Expired')) DEFAULT 'Normal',
  last_checked TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (medicine_id) REFERENCES medicines(medicine_id) ON DELETE CASCADE
);

CREATE TABLE audit_log (
  log_id INTEGER PRIMARY KEY AUTOINCREMENT,
  doctor_id INTEGER,
  action TEXT,
  table_name TEXT,
  record_id INTEGER,
  old_value TEXT,
  new_value TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (doctor_id) REFERENCES doctors(doctor_id) ON DELETE SET NULL
);

-- ============================================================
-- INDEXES
-- ============================================================
CREATE INDEX idx_patient_phone ON patients(phone_number);
CREATE INDEX idx_patient_name ON patients(patient_name);
CREATE INDEX idx_visit_patient ON visits(patient_id);
CREATE INDEX idx_visit_date ON visits(visit_date);
CREATE INDEX idx_medicine_name ON medicines(medicine_name);
CREATE INDEX idx_medicine_quantity ON medicines(quantity);
CREATE INDEX idx_medicine_expiry ON medicines(expiry_date);
CREATE INDEX idx_alert_type ON alerts(alert_type);
CREATE INDEX idx_alert_is_read ON alerts(is_read);
CREATE INDEX idx_alert_created ON alerts(created_at);
CREATE INDEX idx_prescription_visit ON prescriptions(visit_id);
CREATE INDEX idx_expiry_status ON expiry_tracking(alert_status);
CREATE INDEX idx_expiry_date ON expiry_tracking(expiry_date);
CREATE INDEX idx_sale_patient ON sales(patient_id);
CREATE INDEX idx_sale_date ON sales(sale_date);
CREATE INDEX idx_sale_type ON sales(sale_type);

-- ============================================================
-- VIEWS
-- ============================================================
CREATE VIEW patient_visit_history AS
SELECT 
  p.patient_id,
  p.patient_name,
  p.phone_number,
  v.visit_id,
  v.visit_date,
  v.diagnosis,
  v.blood_pressure,
  v.temperature,
  v.notes
FROM patients p
LEFT JOIN visits v ON p.patient_id = v.patient_id
ORDER BY v.visit_date DESC;

CREATE VIEW low_stock_medicines AS
SELECT 
  medicine_id,
  medicine_name,
  quantity,
  price,
  expiry_date
FROM medicines
WHERE quantity < 10 AND quantity > 0
ORDER BY quantity ASC;

CREATE VIEW expiry_alert_medicines AS
SELECT 
  m.medicine_id,
  m.medicine_name,
  m.quantity,
  e.expiry_date,
  e.alert_status,
  CAST(julianday(e.expiry_date) - julianday(date('now')) AS INTEGER) as days_until_expiry
FROM medicines m
JOIN expiry_tracking e ON m.medicine_id = e.medicine_id
WHERE julianday(e.expiry_date) - julianday(date('now')) <= 30
ORDER BY e.expiry_date ASC;

-- ============================================================
-- TRIGGERS
-- ============================================================
CREATE TRIGGER update_expiry_status_insert
AFTER INSERT ON expiry_tracking
FOR EACH ROW
BEGIN
  UPDATE expiry_tracking
  SET alert_status = CASE 
    WHEN julianday(NEW.expiry_date) - julianday(date('now')) < 0 THEN 'Expired'
    WHEN julianday(NEW.expiry_date) - julianday(date('now')) < 30 THEN 'Near Expiry'
    ELSE 'Normal'
  END
  WHERE expiry_id = NEW.expiry_id;
END;

CREATE TRIGGER update_expiry_status_update
AFTER UPDATE OF expiry_date ON expiry_tracking
FOR EACH ROW
BEGIN
  UPDATE expiry_tracking
  SET alert_status = CASE 
    WHEN julianday(NEW.expiry_date) - julianday(date('now')) < 0 THEN 'Expired'
    WHEN julianday(NEW.expiry_date) - julianday(date('now')) < 30 THEN 'Near Expiry'
    ELSE 'Normal'
  END
  WHERE expiry_id = NEW.expiry_id;
END;


-- ============================================================
-- DATA INSERTION (DML)
-- ============================================================
-- Table: doctors
INSERT INTO `doctors` (`doctor_id`, `name`, `email`, `phone_number`, `password`, `created_at`, `is_active`) VALUES (1, 'Dr. Abhinava Shetty', 'abhinavashetty50@gmail.com', '9876543210', '$2b$10$ujYCNHxzuKuBCndsdbsp9Oa5xH5TPFd7MGXhKjSBDG9PXB5l0Nq4K', '2026-05-07 22:55:58', 1);
INSERT INTO `doctors` (`doctor_id`, `name`, `email`, `phone_number`, `password`, `created_at`, `is_active`) VALUES (2, 'Test Doctor', 'testdoc+local@clinic.test', '', '$2b$10$EQeV4TSLTRObPLBy3kW6/uxTLtyGLaoVyvWyGt39McCkGCjiQ3WJe', '2026-06-06 20:07:20', 1);

-- Table: staff
INSERT INTO `staff` (`staff_id`, `name`, `email`, `phone_number`, `password`, `role`, `created_at`, `is_active`) VALUES (6, 'chim', 'chim@gmail.com', '4567875432', '$2b$10$D.RO/.JR4eAPFhl1mg26ru9dx4t4QwERHIk1Rb/oGnt2s1QIZdnQG', 'Pharmacist', '2026-06-18 11:21:12', 1);
INSERT INTO `staff` (`staff_id`, `name`, `email`, `phone_number`, `password`, `role`, `created_at`, `is_active`) VALUES (7, 'cham', 'cham@gmail.com', '3245678965', '$2b$10$km082k55w/jZjFK2.rN1m.IPaxajikZ3nvXc5gKkY5zB5zl.73gtC', 'Nurse', '2026-06-18 11:22:37', 1);

-- Table: patients
INSERT INTO `patients` (`patient_id`, `patient_name`, `phone_number`, `age`, `gender`, `address`, `registration_date`, `is_active`) VALUES (1, 'Rajesh Kumar', '9876543210', 36, 'Male', 'Mumbai', '2026-05-27 22:48:24', 1);
INSERT INTO `patients` (`patient_id`, `patient_name`, `phone_number`, `age`, `gender`, `address`, `registration_date`, `is_active`) VALUES (3, 'Jane Doe Test', '9000060357', 29, 'Female', '456 Verification Road', '2026-06-07 14:29:46', 1);
INSERT INTO `patients` (`patient_id`, `patient_name`, `phone_number`, `age`, `gender`, `address`, `registration_date`, `is_active`) VALUES (4, 'Jane Doe Test', '9000016843', 29, 'Female', '456 Verification Road', '2026-06-07 14:30:30', 1);
INSERT INTO `patients` (`patient_id`, `patient_name`, `phone_number`, `age`, `gender`, `address`, `registration_date`, `is_active`) VALUES (5, 'Jane Doe Test', '9000029534', 29, 'Female', '456 Verification Road', '2026-06-07 14:31:07', 1);
INSERT INTO `patients` (`patient_id`, `patient_name`, `phone_number`, `age`, `gender`, `address`, `registration_date`, `is_active`) VALUES (6, 'Bob Green', '9876543211', 40, 'Male', '456 Main Rd', '2026-06-11 22:18:40', 1);
INSERT INTO `patients` (`patient_id`, `patient_name`, `phone_number`, `age`, `gender`, `address`, `registration_date`, `is_active`) VALUES (7, 'Jane Doe Test', '9000039859', 29, 'Female', '456 Verification Road', '2026-06-15 21:58:23', 1);
INSERT INTO `patients` (`patient_id`, `patient_name`, `phone_number`, `age`, `gender`, `address`, `registration_date`, `is_active`) VALUES (8, 'Jane Doe Test', '9000059154', 29, 'Female', '456 Verification Road', '2026-06-15 22:11:16', 1);
INSERT INTO `patients` (`patient_id`, `patient_name`, `phone_number`, `age`, `gender`, `address`, `registration_date`, `is_active`) VALUES (9, 'sam', '9988776655', 45, 'Male', 'hampapura', '2026-06-16 10:45:52', 1);
INSERT INTO `patients` (`patient_id`, `patient_name`, `phone_number`, `age`, `gender`, `address`, `registration_date`, `is_active`) VALUES (10, 'Jane Doe Test', '9000065912', 29, 'Female', '456 Verification Road', '2026-06-16 10:56:20', 1);
INSERT INTO `patients` (`patient_id`, `patient_name`, `phone_number`, `age`, `gender`, `address`, `registration_date`, `is_active`) VALUES (11, 'Jane Doe Test', '9000073683', 29, 'Female', '456 Verification Road', '2026-06-16 21:57:47', 1);
INSERT INTO `patients` (`patient_id`, `patient_name`, `phone_number`, `age`, `gender`, `address`, `registration_date`, `is_active`) VALUES (12, 'Jane Doe Test', '9000016886', 29, 'Female', '456 Verification Road', '2026-06-17 21:48:26', 1);
INSERT INTO `patients` (`patient_id`, `patient_name`, `phone_number`, `age`, `gender`, `address`, `registration_date`, `is_active`) VALUES (13, 'Jane Doe Test', '9000015293', 29, 'Female', '456 Verification Road', '2026-06-18 14:40:58', 1);
INSERT INTO `patients` (`patient_id`, `patient_name`, `phone_number`, `age`, `gender`, `address`, `registration_date`, `is_active`) VALUES (14, 'Jane Doe Test', '9000087309', 29, 'Female', '456 Verification Road', '2026-06-18 14:55:17', 1);
INSERT INTO `patients` (`patient_id`, `patient_name`, `phone_number`, `age`, `gender`, `address`, `registration_date`, `is_active`) VALUES (15, 'john', '9900637290', 45, 'Male', 'udupi', '2026-06-19 14:21:58', 1);
INSERT INTO `patients` (`patient_id`, `patient_name`, `phone_number`, `age`, `gender`, `address`, `registration_date`, `is_active`) VALUES (16, 'Jane Doe Test', '9000087024', 29, 'Female', '456 Verification Road', '2026-06-21 13:14:54', 1);
INSERT INTO `patients` (`patient_id`, `patient_name`, `phone_number`, `age`, `gender`, `address`, `registration_date`, `is_active`) VALUES (17, 'Jane Doe Test', '9000029759', 29, 'Female', '456 Verification Road', '2026-06-21 13:18:15', 1);

-- Table: visits
INSERT INTO `visits` (`visit_id`, `doctor_id`, `patient_id`, `visit_date`, `diagnosis`, `blood_pressure`, `temperature`, `notes`, `created_at`) VALUES (1, 1, 1, '2026-05-28 10:30:00', 'Updated: Common cold with mild fever - patient improving', '120/80', 98.4, 'Prescribed rest and fluids', '2026-05-28 23:14:10');
INSERT INTO `visits` (`visit_id`, `doctor_id`, `patient_id`, `visit_date`, `diagnosis`, `blood_pressure`, `temperature`, `notes`, `created_at`) VALUES (3, 1, 3, '2026-06-07 08:59:46', 'Verification check-up', '120/80', 98.6, 'Everything is in perfect working order.', '2026-06-07 14:29:46');
INSERT INTO `visits` (`visit_id`, `doctor_id`, `patient_id`, `visit_date`, `diagnosis`, `blood_pressure`, `temperature`, `notes`, `created_at`) VALUES (4, 1, 4, '2026-06-07 09:00:30', 'Verification check-up', '120/80', 98.6, 'Everything is in perfect working order.', '2026-06-07 14:30:30');
INSERT INTO `visits` (`visit_id`, `doctor_id`, `patient_id`, `visit_date`, `diagnosis`, `blood_pressure`, `temperature`, `notes`, `created_at`) VALUES (5, 1, 5, '2026-06-07 09:01:07', 'Verification check-up', '120/80', 98.6, 'Everything is in perfect working order.', '2026-06-07 14:31:07');
INSERT INTO `visits` (`visit_id`, `doctor_id`, `patient_id`, `visit_date`, `diagnosis`, `blood_pressure`, `temperature`, `notes`, `created_at`) VALUES (6, 1, 6, '2026-06-11 16:58:00', 'Verification check-up', '120/80', 98.6, 'Blood Sugar: 110 mg/dL | Notes: None', '2026-06-11 22:29:48');
INSERT INTO `visits` (`visit_id`, `doctor_id`, `patient_id`, `visit_date`, `diagnosis`, `blood_pressure`, `temperature`, `notes`, `created_at`) VALUES (7, 1, 7, '2026-06-15 16:28:23', 'Verification check-up', '120/80', 98.6, 'Everything is in perfect working order.', '2026-06-15 21:58:23');
INSERT INTO `visits` (`visit_id`, `doctor_id`, `patient_id`, `visit_date`, `diagnosis`, `blood_pressure`, `temperature`, `notes`, `created_at`) VALUES (8, 1, 8, '2026-06-15 16:41:16', 'Verification check-up', '120/80', 98.6, 'Everything is in perfect working order.', '2026-06-15 22:11:16');
INSERT INTO `visits` (`visit_id`, `doctor_id`, `patient_id`, `visit_date`, `diagnosis`, `blood_pressure`, `temperature`, `notes`, `created_at`) VALUES (9, 1, 9, '2026-06-16 05:19:47', 'fever', 'N/A', 98.6, 'Blood Sugar: - | Notes: None', '2026-06-16 10:49:47');
INSERT INTO `visits` (`visit_id`, `doctor_id`, `patient_id`, `visit_date`, `diagnosis`, `blood_pressure`, `temperature`, `notes`, `created_at`) VALUES (10, 1, 10, '2026-06-16 05:26:20', 'Verification check-up', '120/80', 98.6, 'Everything is in perfect working order.', '2026-06-16 10:56:20');
INSERT INTO `visits` (`visit_id`, `doctor_id`, `patient_id`, `visit_date`, `diagnosis`, `blood_pressure`, `temperature`, `notes`, `created_at`) VALUES (11, 1, 8, '2026-06-16 06:38:16', 'General Visit', 'N/A', 98.6, 'Blood Sugar: - | Notes: None', '2026-06-16 12:08:16');
INSERT INTO `visits` (`visit_id`, `doctor_id`, `patient_id`, `visit_date`, `diagnosis`, `blood_pressure`, `temperature`, `notes`, `created_at`) VALUES (12, 1, 11, '2026-06-16 16:27:47', 'Verification check-up', '120/80', 98.6, 'Everything is in perfect working order.', '2026-06-16 21:57:47');
INSERT INTO `visits` (`visit_id`, `doctor_id`, `patient_id`, `visit_date`, `diagnosis`, `blood_pressure`, `temperature`, `notes`, `created_at`) VALUES (13, 1, 12, '2026-06-17 16:18:26', 'Verification check-up', '120/80', 98.6, 'Everything is in perfect working order.', '2026-06-17 21:48:26');
INSERT INTO `visits` (`visit_id`, `doctor_id`, `patient_id`, `visit_date`, `diagnosis`, `blood_pressure`, `temperature`, `notes`, `created_at`) VALUES (14, 1, 7, '2026-06-18 08:40:01', 'fever', 'N/A', 98.6, 'Blood Sugar: - | Notes: None', '2026-06-18 14:10:01');
INSERT INTO `visits` (`visit_id`, `doctor_id`, `patient_id`, `visit_date`, `diagnosis`, `blood_pressure`, `temperature`, `notes`, `created_at`) VALUES (15, 1, 13, '2026-06-18 09:10:58', 'Verification check-up', '120/80', 98.6, 'Everything is in perfect working order.', '2026-06-18 14:40:58');
INSERT INTO `visits` (`visit_id`, `doctor_id`, `patient_id`, `visit_date`, `diagnosis`, `blood_pressure`, `temperature`, `notes`, `created_at`) VALUES (17, 1, 14, '2026-06-18 14:55:17', 'Verification check-up', '120/80', 98.6, 'Everything is in perfect working order.', '2026-06-18 14:55:17');
INSERT INTO `visits` (`visit_id`, `doctor_id`, `patient_id`, `visit_date`, `diagnosis`, `blood_pressure`, `temperature`, `notes`, `created_at`) VALUES (18, 1, 1, '2026-06-18 15:27:17', 'General Visit', 'N/A', 98.6, 'Blood Sugar: - | Notes: None', '2026-06-18 15:27:17');
INSERT INTO `visits` (`visit_id`, `doctor_id`, `patient_id`, `visit_date`, `diagnosis`, `blood_pressure`, `temperature`, `notes`, `created_at`) VALUES (19, 1, 1, '2026-06-19 09:25:31', 'General Visit', 'N/A', 98.6, 'Blood Sugar: - | Notes: None', '2026-06-19 09:25:31');
INSERT INTO `visits` (`visit_id`, `doctor_id`, `patient_id`, `visit_date`, `diagnosis`, `blood_pressure`, `temperature`, `notes`, `created_at`) VALUES (20, 1, 15, '2026-06-19 14:23:39', 'common cold', 'N/A', 98.6, 'Blood Sugar: - | Notes: None', '2026-06-19 14:23:39');
INSERT INTO `visits` (`visit_id`, `doctor_id`, `patient_id`, `visit_date`, `diagnosis`, `blood_pressure`, `temperature`, `notes`, `created_at`) VALUES (21, 1, 9, '2026-06-19 14:26:25', 'General Visit', 'N/A', 98.6, 'Blood Sugar: - | Notes: None', '2026-06-19 14:26:25');
INSERT INTO `visits` (`visit_id`, `doctor_id`, `patient_id`, `visit_date`, `diagnosis`, `blood_pressure`, `temperature`, `notes`, `created_at`) VALUES (22, 1, 16, '2026-06-21 07:44:54', 'Verification check-up', '120/80', 98.6, 'Everything is in perfect working order.', '2026-06-21 13:14:54');
INSERT INTO `visits` (`visit_id`, `doctor_id`, `patient_id`, `visit_date`, `diagnosis`, `blood_pressure`, `temperature`, `notes`, `created_at`) VALUES (23, 1, 17, '2026-06-21 07:48:15', 'Verification check-up', '120/80', 98.6, 'Everything is in perfect working order.', '2026-06-21 13:18:15');

-- Table: medicines
INSERT INTO `medicines` (`medicine_id`, `medicine_name`, `quantity`, `price`, `expiry_date`, `batch_number`, `purchase_date`, `supplier_name`, `purchase_price`, `created_at`, `updated_at`) VALUES (1, 'aspirin', 41, 50, '2027-12-31 00:00:00', NULL, NULL, NULL, NULL, '2026-05-19 23:13:21', '2026-06-21 13:18:15');
INSERT INTO `medicines` (`medicine_id`, `medicine_name`, `quantity`, `price`, `expiry_date`, `batch_number`, `purchase_date`, `supplier_name`, `purchase_price`, `created_at`, `updated_at`) VALUES (5, 'metformin', 75, 1.5, '2027-12-31 00:00:00', NULL, NULL, NULL, NULL, '2026-06-10 23:32:50', '2026-06-18 15:27:52');
INSERT INTO `medicines` (`medicine_id`, `medicine_name`, `quantity`, `price`, `expiry_date`, `batch_number`, `purchase_date`, `supplier_name`, `purchase_price`, `created_at`, `updated_at`) VALUES (6, 'Paracetamol', 79, 2, '2027-12-31 00:00:00', NULL, NULL, NULL, NULL, '2026-06-11 22:15:32', '2026-06-19 14:28:06');
INSERT INTO `medicines` (`medicine_id`, `medicine_name`, `quantity`, `price`, `expiry_date`, `batch_number`, `purchase_date`, `supplier_name`, `purchase_price`, `created_at`, `updated_at`) VALUES (14, 'dolo 650', 70, 1, '2026-06-27 00:00:00', NULL, NULL, NULL, NULL, '2026-06-19 09:24:36', '2026-06-19 09:25:31');

-- Table: alerts
INSERT INTO `alerts` (`alert_id`, `medicine_id`, `alert_type`, `message`, `is_read`, `created_at`) VALUES (1, 1, 'LOW_STOCK', 'aspirin stock low: 9 tablets remaining', 0, '2026-05-19 23:16:16');
INSERT INTO `alerts` (`alert_id`, `medicine_id`, `alert_type`, `message`, `is_read`, `created_at`) VALUES (2, 1, 'LOW_STOCK', 'Stock for medicine_id 1 is now 7 (below 10)', 0, '2026-06-16 10:49:47');
INSERT INTO `alerts` (`alert_id`, `medicine_id`, `alert_type`, `message`, `is_read`, `created_at`) VALUES (3, 1, 'LOW_STOCK', 'Stock for medicine_id 1 is now 5 (below 10)', 0, '2026-06-16 12:08:16');
INSERT INTO `alerts` (`alert_id`, `medicine_id`, `alert_type`, `message`, `is_read`, `created_at`) VALUES (4, 1, 'LOW_STOCK', 'Stock for medicine_id 1 is now 5 (below 10)', 0, '2026-06-19 14:26:25');

-- Table: prescriptions
INSERT INTO `prescriptions` (`prescription_id`, `visit_id`, `medicine_id`, `dosage`, `quantity`, `duration_days`, `created_at`) VALUES (2, 1, 1, '500mg twice daily', 2, 5, '2026-06-07 09:37:58');
INSERT INTO `prescriptions` (`prescription_id`, `visit_id`, `medicine_id`, `dosage`, `quantity`, `duration_days`, `created_at`) VALUES (3, 1, 1, '500mg twice daily', 2, 5, '2026-06-07 09:40:00');
INSERT INTO `prescriptions` (`prescription_id`, `visit_id`, `medicine_id`, `dosage`, `quantity`, `duration_days`, `created_at`) VALUES (4, 1, 1, '250mg once daily', 3, 7, '2026-06-07 09:44:58');
INSERT INTO `prescriptions` (`prescription_id`, `visit_id`, `medicine_id`, `dosage`, `quantity`, `duration_days`, `created_at`) VALUES (5, 3, 1, '500mg daily', 5, 5, '2026-06-07 14:29:46');
INSERT INTO `prescriptions` (`prescription_id`, `visit_id`, `medicine_id`, `dosage`, `quantity`, `duration_days`, `created_at`) VALUES (6, 4, 1, '500mg daily', 5, 5, '2026-06-07 14:30:30');
INSERT INTO `prescriptions` (`prescription_id`, `visit_id`, `medicine_id`, `dosage`, `quantity`, `duration_days`, `created_at`) VALUES (7, 5, 1, '500mg daily', 5, 5, '2026-06-07 14:31:07');
INSERT INTO `prescriptions` (`prescription_id`, `visit_id`, `medicine_id`, `dosage`, `quantity`, `duration_days`, `created_at`) VALUES (8, 6, 6, '500mg daily', 10, 5, '2026-06-11 22:29:48');
INSERT INTO `prescriptions` (`prescription_id`, `visit_id`, `medicine_id`, `dosage`, `quantity`, `duration_days`, `created_at`) VALUES (9, 7, 1, '500mg daily', 5, 5, '2026-06-15 21:58:23');
INSERT INTO `prescriptions` (`prescription_id`, `visit_id`, `medicine_id`, `dosage`, `quantity`, `duration_days`, `created_at`) VALUES (10, 8, 1, '500mg daily', 5, 5, '2026-06-15 22:11:16');
INSERT INTO `prescriptions` (`prescription_id`, `visit_id`, `medicine_id`, `dosage`, `quantity`, `duration_days`, `created_at`) VALUES (11, 9, 1, '0-0-1', 10, 8, '2026-06-16 10:49:47');
INSERT INTO `prescriptions` (`prescription_id`, `visit_id`, `medicine_id`, `dosage`, `quantity`, `duration_days`, `created_at`) VALUES (12, 10, 1, '500mg daily', 5, 5, '2026-06-16 10:56:20');
INSERT INTO `prescriptions` (`prescription_id`, `visit_id`, `medicine_id`, `dosage`, `quantity`, `duration_days`, `created_at`) VALUES (13, 11, 1, '1-1-0', 45, 20, '2026-06-16 12:08:16');
INSERT INTO `prescriptions` (`prescription_id`, `visit_id`, `medicine_id`, `dosage`, `quantity`, `duration_days`, `created_at`) VALUES (14, 12, 1, '500mg daily', 5, 5, '2026-06-16 21:57:47');
INSERT INTO `prescriptions` (`prescription_id`, `visit_id`, `medicine_id`, `dosage`, `quantity`, `duration_days`, `created_at`) VALUES (15, 13, 1, '500mg daily', 5, 5, '2026-06-17 21:48:26');
INSERT INTO `prescriptions` (`prescription_id`, `visit_id`, `medicine_id`, `dosage`, `quantity`, `duration_days`, `created_at`) VALUES (16, 14, 1, 'SOS', 2, 2, '2026-06-18 14:10:01');
INSERT INTO `prescriptions` (`prescription_id`, `visit_id`, `medicine_id`, `dosage`, `quantity`, `duration_days`, `created_at`) VALUES (17, 15, 1, '500mg daily', 5, 5, '2026-06-18 14:40:58');
INSERT INTO `prescriptions` (`prescription_id`, `visit_id`, `medicine_id`, `dosage`, `quantity`, `duration_days`, `created_at`) VALUES (18, 17, 1, '500mg daily', 5, 5, '2026-06-18 14:55:17');
INSERT INTO `prescriptions` (`prescription_id`, `visit_id`, `medicine_id`, `dosage`, `quantity`, `duration_days`, `created_at`) VALUES (19, 18, 5, '1-0-1', 10, 5, '2026-06-18 15:27:18');
INSERT INTO `prescriptions` (`prescription_id`, `visit_id`, `medicine_id`, `dosage`, `quantity`, `duration_days`, `created_at`) VALUES (20, 19, 14, '1-0-½', 30, 30, '2026-06-19 09:25:31');
INSERT INTO `prescriptions` (`prescription_id`, `visit_id`, `medicine_id`, `dosage`, `quantity`, `duration_days`, `created_at`) VALUES (21, 20, 1, '1-0-1', 10, 6, '2026-06-19 14:23:39');
INSERT INTO `prescriptions` (`prescription_id`, `visit_id`, `medicine_id`, `dosage`, `quantity`, `duration_days`, `created_at`) VALUES (22, 21, 1, '1-0-0', 10, 5, '2026-06-19 14:26:25');
INSERT INTO `prescriptions` (`prescription_id`, `visit_id`, `medicine_id`, `dosage`, `quantity`, `duration_days`, `created_at`) VALUES (23, 22, 1, '500mg daily', 5, 5, '2026-06-21 13:14:54');
INSERT INTO `prescriptions` (`prescription_id`, `visit_id`, `medicine_id`, `dosage`, `quantity`, `duration_days`, `created_at`) VALUES (24, 23, 1, '500mg daily', 5, 5, '2026-06-21 13:18:15');

-- Table: sales
INSERT INTO `sales` (`sale_id`, `patient_id`, `medicine_name`, `quantity_sold`, `price_per_unit`, `total_amount`, `sale_type`, `sale_date`, `created_by`) VALUES (1, NULL, 'metformin', 10, 1.5, 15, 'Direct Walk-in', '2026-06-18 15:27:52', 1);
INSERT INTO `sales` (`sale_id`, `patient_id`, `medicine_name`, `quantity_sold`, `price_per_unit`, `total_amount`, `sale_type`, `sale_date`, `created_by`) VALUES (2, NULL, 'Paracetamol', 1, 2, 2, 'Direct Walk-in', '2026-06-19 14:27:48', 1);
INSERT INTO `sales` (`sale_id`, `patient_id`, `medicine_name`, `quantity_sold`, `price_per_unit`, `total_amount`, `sale_type`, `sale_date`, `created_by`) VALUES (3, NULL, 'Paracetamol', 10, 2, 20, 'Direct Walk-in', '2026-06-19 14:28:06', 1);

-- Table: expiry_tracking
-- (No rows in expiry_tracking)

-- Table: audit_log
INSERT INTO `audit_log` (`log_id`, `doctor_id`, `action`, `table_name`, `record_id`, `old_value`, `new_value`, `created_at`) VALUES (1, 1, 'PRESCRIPTION_UPDATED', 'prescriptions', 4, '{"prescription_id":4,"medicine_id":1,"quantity":3}', '{"prescription_id":4,"visit_id":1,"medicine_id":1,"dosage":"250mg once daily","quantity":3,"duration_days":7}', '2026-06-07 11:07:56');
INSERT INTO `audit_log` (`log_id`, `doctor_id`, `action`, `table_name`, `record_id`, `old_value`, `new_value`, `created_at`) VALUES (2, 1, 'TEST_INSERT', 'prescriptions', 9999, '{x:1}', '{x:2}', '2026-06-07 11:13:12');
INSERT INTO `audit_log` (`log_id`, `doctor_id`, `action`, `table_name`, `record_id`, `old_value`, `new_value`, `created_at`) VALUES (3, 1, 'PRESCRIPTION_CREATED', 'prescriptions', 5, NULL, '{"prescription_id":5,"visit_id":3,"medicine_id":1,"dosage":"500mg daily","quantity":5,"duration_days":5}', '2026-06-07 14:29:46');
INSERT INTO `audit_log` (`log_id`, `doctor_id`, `action`, `table_name`, `record_id`, `old_value`, `new_value`, `created_at`) VALUES (4, 1, 'PRESCRIPTION_CREATED', 'prescriptions', 6, NULL, '{"prescription_id":6,"visit_id":4,"medicine_id":1,"dosage":"500mg daily","quantity":5,"duration_days":5}', '2026-06-07 14:30:30');
INSERT INTO `audit_log` (`log_id`, `doctor_id`, `action`, `table_name`, `record_id`, `old_value`, `new_value`, `created_at`) VALUES (5, 1, 'PRESCRIPTION_CREATED', 'prescriptions', 7, NULL, '{"prescription_id":7,"visit_id":5,"medicine_id":1,"dosage":"500mg daily","quantity":5,"duration_days":5}', '2026-06-07 14:31:07');
INSERT INTO `audit_log` (`log_id`, `doctor_id`, `action`, `table_name`, `record_id`, `old_value`, `new_value`, `created_at`) VALUES (6, 1, 'PRESCRIPTION_CREATED', 'prescriptions', 9, NULL, '{"prescription_id":9,"visit_id":7,"medicine_id":1,"dosage":"500mg daily","quantity":5,"duration_days":5}', '2026-06-15 21:58:23');
INSERT INTO `audit_log` (`log_id`, `doctor_id`, `action`, `table_name`, `record_id`, `old_value`, `new_value`, `created_at`) VALUES (7, 1, 'PRESCRIPTION_CREATED', 'prescriptions', 10, NULL, '{"prescription_id":10,"visit_id":8,"medicine_id":1,"dosage":"500mg daily","quantity":5,"duration_days":5}', '2026-06-15 22:11:16');
INSERT INTO `audit_log` (`log_id`, `doctor_id`, `action`, `table_name`, `record_id`, `old_value`, `new_value`, `created_at`) VALUES (8, 1, 'PRESCRIPTION_CREATED', 'prescriptions', 11, NULL, '{"prescription_id":11,"visit_id":9,"medicine_id":1,"dosage":"0-0-1","quantity":10,"duration_days":8}', '2026-06-16 10:49:47');
INSERT INTO `audit_log` (`log_id`, `doctor_id`, `action`, `table_name`, `record_id`, `old_value`, `new_value`, `created_at`) VALUES (9, 1, 'PRESCRIPTION_CREATED', 'prescriptions', 12, NULL, '{"prescription_id":12,"visit_id":10,"medicine_id":1,"dosage":"500mg daily","quantity":5,"duration_days":5}', '2026-06-16 10:56:20');
INSERT INTO `audit_log` (`log_id`, `doctor_id`, `action`, `table_name`, `record_id`, `old_value`, `new_value`, `created_at`) VALUES (10, 1, 'PRESCRIPTION_CREATED', 'prescriptions', 13, NULL, '{"prescription_id":13,"visit_id":11,"medicine_id":1,"dosage":"1-1-0","quantity":45,"duration_days":20}', '2026-06-16 12:08:16');
INSERT INTO `audit_log` (`log_id`, `doctor_id`, `action`, `table_name`, `record_id`, `old_value`, `new_value`, `created_at`) VALUES (11, 1, 'PRESCRIPTION_CREATED', 'prescriptions', 14, NULL, '{"prescription_id":14,"visit_id":12,"medicine_id":1,"dosage":"500mg daily","quantity":5,"duration_days":5}', '2026-06-16 21:57:47');
INSERT INTO `audit_log` (`log_id`, `doctor_id`, `action`, `table_name`, `record_id`, `old_value`, `new_value`, `created_at`) VALUES (12, 1, 'PRESCRIPTION_CREATED', 'prescriptions', 15, NULL, '{"prescription_id":15,"visit_id":13,"medicine_id":1,"dosage":"500mg daily","quantity":5,"duration_days":5}', '2026-06-17 21:48:26');
INSERT INTO `audit_log` (`log_id`, `doctor_id`, `action`, `table_name`, `record_id`, `old_value`, `new_value`, `created_at`) VALUES (13, 1, 'PRESCRIPTION_CREATED', 'prescriptions', 16, NULL, '{"prescription_id":16,"visit_id":14,"medicine_id":1,"dosage":"SOS","quantity":2,"duration_days":2}', '2026-06-18 14:10:01');
INSERT INTO `audit_log` (`log_id`, `doctor_id`, `action`, `table_name`, `record_id`, `old_value`, `new_value`, `created_at`) VALUES (14, 1, 'PRESCRIPTION_CREATED', 'prescriptions', 17, NULL, '{"prescription_id":17,"visit_id":15,"medicine_id":1,"dosage":"500mg daily","quantity":5,"duration_days":5}', '2026-06-18 14:40:58');
INSERT INTO `audit_log` (`log_id`, `doctor_id`, `action`, `table_name`, `record_id`, `old_value`, `new_value`, `created_at`) VALUES (15, 1, 'PRESCRIPTION_CREATED', 'prescriptions', 18, NULL, '{"prescription_id":18,"visit_id":17,"medicine_id":1,"dosage":"500mg daily","quantity":5,"duration_days":5}', '2026-06-18 14:55:17');
INSERT INTO `audit_log` (`log_id`, `doctor_id`, `action`, `table_name`, `record_id`, `old_value`, `new_value`, `created_at`) VALUES (16, 1, 'PRESCRIPTION_CREATED', 'prescriptions', 19, NULL, '{"prescription_id":19,"visit_id":18,"medicine_id":5,"dosage":"1-0-1","quantity":10,"duration_days":5}', '2026-06-18 15:27:18');
INSERT INTO `audit_log` (`log_id`, `doctor_id`, `action`, `table_name`, `record_id`, `old_value`, `new_value`, `created_at`) VALUES (17, 1, 'PRESCRIPTION_CREATED', 'prescriptions', 20, NULL, '{"prescription_id":20,"visit_id":19,"medicine_id":14,"dosage":"1-0-½","quantity":30,"duration_days":30}', '2026-06-19 09:25:31');
INSERT INTO `audit_log` (`log_id`, `doctor_id`, `action`, `table_name`, `record_id`, `old_value`, `new_value`, `created_at`) VALUES (18, 1, 'PRESCRIPTION_CREATED', 'prescriptions', 21, NULL, '{"prescription_id":21,"visit_id":20,"medicine_id":1,"dosage":"1-0-1","quantity":10,"duration_days":6}', '2026-06-19 14:23:39');
INSERT INTO `audit_log` (`log_id`, `doctor_id`, `action`, `table_name`, `record_id`, `old_value`, `new_value`, `created_at`) VALUES (19, 1, 'PRESCRIPTION_CREATED', 'prescriptions', 22, NULL, '{"prescription_id":22,"visit_id":21,"medicine_id":1,"dosage":"1-0-0","quantity":10,"duration_days":5}', '2026-06-19 14:26:25');
INSERT INTO `audit_log` (`log_id`, `doctor_id`, `action`, `table_name`, `record_id`, `old_value`, `new_value`, `created_at`) VALUES (20, 1, 'PRESCRIPTION_CREATED', 'prescriptions', 23, NULL, '{"prescription_id":23,"visit_id":22,"medicine_id":1,"dosage":"500mg daily","quantity":5,"duration_days":5}', '2026-06-21 13:14:54');
INSERT INTO `audit_log` (`log_id`, `doctor_id`, `action`, `table_name`, `record_id`, `old_value`, `new_value`, `created_at`) VALUES (21, 1, 'PRESCRIPTION_CREATED', 'prescriptions', 24, NULL, '{"prescription_id":24,"visit_id":23,"medicine_id":1,"dosage":"500mg daily","quantity":5,"duration_days":5}', '2026-06-21 13:18:15');

PRAGMA foreign_keys = ON;

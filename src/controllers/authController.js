const pool = require('../config/db');
const bcrypt = require('bcryptjs');

// ============================================================
// REGISTER DOCTOR (ONE-TIME ONLY)
// ============================================================
const registerUser = async (req, res) => {
    try {
        const { name, email, phoneNumber, password, confirmPassword } = req.body;

        // STEP 1: Validate all fields present
        if (!name || !email || !phoneNumber || !password || !confirmPassword) {
            return res.status(400).json({
                success: false,
                message: 'All fields are required'
            });
        }

        // STEP 2: Check password match
        if (password !== confirmPassword) {
            return res.status(400).json({
                success: false,
                message: 'Password and confirm password do not match'
            });
        }

        // STEP 3: One-Time Lock Check (CRITICAL SECURITY)
        const connection = await pool.getConnection();
        const [doctorCount] = await connection.query('SELECT COUNT(*) as count FROM doctors');
        
        if (doctorCount[0].count > 0) {
            connection.release();
            return res.status(403).json({
                success: false,
                message: 'Registration is locked. An administrator account already exists.'
            });
        }

        // STEP 4: Check if email already exists (redundant but good practice)
        const [emailCheck] = await connection.query(
            'SELECT doctor_id FROM doctors WHERE email = ?',
            [email]
        );

        if (emailCheck.length > 0) {
            connection.release();
            return res.status(400).json({
                success: false,
                message: 'This email is already in use.'
            });
        }

        // STEP 5: Check if phone already exists
        const [phoneCheck] = await connection.query(
            'SELECT doctor_id FROM doctors WHERE phone_number = ?',
            [phoneNumber]
        );

        if (phoneCheck.length > 0) {
            connection.release();
            return res.status(400).json({
                success: false,
                message: 'This phone number is already in use.'
            });
        }

        // STEP 6: Hash password with bcrypt (10 salt rounds)
        const hashedPassword = await bcrypt.hash(password, 10);

        // STEP 7: Insert into doctors table
        await connection.query(
            'INSERT INTO doctors (name, email, phone_number, password, is_active) VALUES (?, ?, ?, ?, ?)',
            [name, email, phoneNumber, hashedPassword, true]
        );

        connection.release();

        // STEP 8: Return success
        return res.status(201).json({
            success: true,
            message: 'Doctor registered successfully. You may now log in.'
        });

    } catch (error) {
        console.error('Registration error:', error);
        return res.status(500).json({
            success: false,
            message: 'Database connection failed. Please check WAMP status.'
        });
    }
};

// ============================================================
// UNIVERSAL LOGIN (DOCTOR + STAFF)
// Waterfall Method: Check doctors first, then staff
// ============================================================
const loginUser = async (req, res) => {
    try {
        const { identifier, password } = req.body;
        const jwt = require('jsonwebtoken');

        // STEP 1: Validate fields
        if (!identifier || !password) {
            return res.status(400).json({
                success: false,
                message: 'Email/Username and password are required'
            });
        }

        const connection = await pool.getConnection();
        let user = null;
        let userType = null; // 'doctor' or 'staff'

        // STEP 2: Check doctors table first (Waterfall)
        const [doctors] = await connection.query(
            'SELECT * FROM doctors WHERE (email = ? OR name = ?) AND is_active = ?',
            [identifier, identifier, true]
        );

        if (doctors.length > 0) {
            user = doctors[0];
            userType = 'doctor';
        } else {
            // STEP 3: If not found in doctors, check staff table (by username)
            const [staffList] = await connection.query(
                'SELECT * FROM staff WHERE username = ? AND is_active = ?',
                [identifier, true]
            );

            if (staffList.length > 0) {
                user = staffList[0];
                userType = 'staff';
            }
        }

        // STEP 4: User not found in either table
        if (!user) {
            connection.release();
            return res.status(401).json({
                success: false,
                message: 'Invalid credentials'
            });
        }

        // STEP 5: Compare password with bcrypt
        const passwordMatch = await bcrypt.compare(password, user.password);

        if (!passwordMatch) {
            connection.release();
            return res.status(401).json({
                success: false,
                message: 'Invalid credentials'
            });
        }

        connection.release();

        // STEP 6: Determine role and ID
        let role, id;
        if (userType === 'doctor') {
            role = 'Doctor';
            id = user.doctor_id;
        } else {
            role = user.role; // 'Pharmacist', 'Receptionist', 'Nurse'
            id = user.staff_id;
        }

        // STEP 7: Generate JWT token with standardized payload
        const token = jwt.sign(
            {
                id: id,
                name: user.name,
                role: role
            },
            process.env.JWT_SECRET,
            { expiresIn: process.env.JWT_EXPIRES_IN }
        );

        // STEP 8: Return success with token
        return res.status(200).json({
            success: true,
            message: 'Login successful',
            token: token,
            role: role,
            name: user.name
        });

    } catch (error) {
        console.error('Login error:', error);
        return res.status(500).json({
            success: false,
            message: 'Database connection failed. Please check WAMP status.'
        });
    }
};

module.exports = {
    loginUser,
    registerUser
};
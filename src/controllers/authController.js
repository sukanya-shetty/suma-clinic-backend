const pool = require('../config/db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// Capitalize role for JWT and frontend compatibility
const formatRole = (role) => {
    if (role === 'admin') return 'Admin';
    if (role === 'doctor') return 'Doctor';
    if (role === 'pharmacist') return 'Pharmacist';
    return role;
};

// ============================================================
// REGISTER DOCTOR (ONE-TIME ONLY OR LOCK IF ADMIN EXISTS)
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
        const [adminCount] = await connection.query("SELECT COUNT(*) as count FROM users WHERE role = 'admin'");
        
        if (adminCount[0].count > 0) {
            connection.release();
            return res.status(403).json({
                success: false,
                message: 'Registration is locked. An administrator account already exists.'
            });
        }

        // STEP 4: Check if email already exists
        const [emailCheck] = await connection.query(
            'SELECT user_id FROM users WHERE email = ?',
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
            'SELECT user_id FROM users WHERE phone_number = ?',
            [phoneNumber]
        );

        if (phoneCheck.length > 0) {
            connection.release();
            return res.status(400).json({
                success: false,
                message: 'This phone number is already in use.'
            });
        }

        // STEP 6: Hash password with bcrypt
        const hashedPassword = await bcrypt.hash(password, 10);

        // STEP 7: Insert into users table as doctor
        await connection.query(
            "INSERT INTO users (name, email, phone_number, password, role, is_active) VALUES (?, ?, ?, ?, 'doctor', ?)",
            [name, email, phoneNumber, hashedPassword, true]
        );

        connection.release();

        return res.status(201).json({
            success: true,
            message: 'Doctor registered successfully. You may now log in.'
        });

    } catch (error) {
        console.error('Registration error:', error);
        return res.status(500).json({
            success: false,
            message: 'Database connection failed.'
        });
    }
};

// ============================================================
// UNIVERSAL LOGIN (ADMIN + DOCTOR + PHARMACIST)
// ============================================================
const loginUser = async (req, res) => {
    try {
        const { identifier, password } = req.body;

        // STEP 1: Validate fields
        if (!identifier || !password) {
            return res.status(400).json({
                success: false,
                message: 'Email/Username and password are required'
            });
        }

        const connection = await pool.getConnection();

        // STEP 2: Check users table
        const [userList] = await connection.query(
            'SELECT * FROM users WHERE (email = ? OR name = ?) AND is_active = ?',
            [identifier, identifier, true]
        );

        if (userList.length === 0) {
            connection.release();
            return res.status(401).json({
                success: false,
                message: 'Invalid credentials'
            });
        }

        const user = userList[0];

        // STEP 3: Compare password with bcrypt
        const passwordMatch = await bcrypt.compare(password, user.password);

        if (!passwordMatch) {
            connection.release();
            return res.status(401).json({
                success: false,
                message: 'Invalid credentials'
            });
        }

        connection.release();

        const role = formatRole(user.role);

        // STEP 4: Generate JWT token
        const token = jwt.sign(
            {
                id: user.user_id,
                name: user.name,
                role: role,
                department: user.department
            },
            process.env.JWT_SECRET,
            { expiresIn: process.env.JWT_EXPIRES_IN }
        );

        return res.status(200).json({
            success: true,
            message: 'Login successful',
            token: token,
            role: role,
            name: user.name,
            department: user.department
        });

    } catch (error) {
        console.error('Login error:', error);
        return res.status(500).json({
            success: false,
            message: 'Database connection failed.'
        });
    }
};

module.exports = {
    loginUser,
    registerUser
};
const pool = require('../config/db');
const bcrypt = require('bcryptjs');

// ============================================================
// ADD STAFF (DOCTOR ONLY - PRIVATE ENDPOINT)
// ============================================================
// Only authenticated doctor can add staff
// Staff roles: Pharmacist, Receptionist, Nurse
// ============================================================
const addStaff = async (req, res) => {
    try {
        const { name, email, phoneNumber, password, confirmPassword, role } = req.body;

        // STEP 1: Validate all fields present
        if (!name || !email || !phoneNumber || !password || !confirmPassword || !role) {
            return res.status(400).json({
                success: false,
                message: 'All fields are required'
            });
        }

        // STEP 2: Validate role is one of the allowed roles
        const allowedRoles = ['Pharmacist', 'Receptionist', 'Nurse'];
        if (!allowedRoles.includes(role)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid role. Must be one of: Pharmacist, Receptionist, Nurse'
            });
        }

        // STEP 3: Check password match
        if (password !== confirmPassword) {
            return res.status(400).json({
                success: false,
                message: 'Password and confirm password do not match'
            });
        }

        // STEP 4: Query database for duplicate email
        const connection = await pool.getConnection();
        const [emailCheck] = await connection.query(
            'SELECT staff_id FROM staff WHERE email = ?',
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
            'SELECT staff_id FROM staff WHERE phone_number = ?',
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

        // STEP 7: Insert into staff table
        await connection.query(
            'INSERT INTO staff (name, email, phone_number, password, role, is_active) VALUES (?, ?, ?, ?, ?, ?)',
            [name, email, phoneNumber, hashedPassword, role, true]
        );

        connection.release();

        // STEP 8: Return success
        return res.status(201).json({
            success: true,
            message: `${role} account created successfully.`,
            staff: {
                name: name,
                email: email,
                role: role
            }
        });

    } catch (error) {
        console.error('Add staff error:', error);
        return res.status(500).json({
            success: false,
            message: 'Database connection failed. Please check WAMP status.'
        });
    }
};

// ============================================================
// GET ALL STAFF (DOCTOR ONLY - VIEW ALL STAFF)
// ============================================================
const getAllStaff = async (req, res) => {
    try {
        const connection = await pool.getConnection();
        const [staff] = await connection.query(
            'SELECT staff_id, name, email, phone_number, role, is_active, created_at FROM staff ORDER BY created_at DESC'
        );

        connection.release();

        return res.status(200).json({
            success: true,
            staff: staff,
            total: staff.length
        });

    } catch (error) {
        console.error('Get staff error:', error);
        return res.status(500).json({
            success: false,
            message: 'Database connection failed. Please check WAMP status.'
        });
    }
};

module.exports = {
    addStaff,
    getAllStaff
};

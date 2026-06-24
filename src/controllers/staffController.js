const pool = require('../config/db');
const bcrypt = require('bcryptjs');

// Capitalize role for frontend list compatibility
const formatRole = (role) => {
    if (role === 'admin') return 'Admin';
    if (role === 'doctor') return 'Doctor';
    if (role === 'pharmacist') return 'Pharmacist';
    return role;
};

// ============================================================
// ADD STAFF ACCOUNT (ADMIN ONLY)
// ============================================================
const addStaff = async (req, res) => {
    try {
        const { name, email, phoneNumber, password, confirmPassword, role, department } = req.body;

        // STEP 1: Validate all fields present
        if (!name || !email || !phoneNumber || !password || !confirmPassword || !role) {
            return res.status(400).json({
                success: false,
                message: 'All fields are required'
            });
        }

        // Convert role to lowercase for DB storage
        const dbRole = role.toLowerCase();
        if (dbRole !== 'doctor' && dbRole !== 'pharmacist') {
            return res.status(400).json({
                success: false,
                message: 'Invalid role. Must be Doctor or Pharmacist.'
            });
        }

        // STEP 2: Check password match
        if (password !== confirmPassword) {
            return res.status(400).json({
                success: false,
                message: 'Password and confirm password do not match'
            });
        }

        const connection = await pool.getConnection();

        // STEP 3: Query database for duplicate email
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

        // STEP 4: Check if phone already exists
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

        // STEP 5: Hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        // STEP 6: Insert into users table
        await connection.query(
            'INSERT INTO users (name, email, phone_number, password, role, department, is_active) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [name, email, phoneNumber, hashedPassword, dbRole, dbRole === 'doctor' ? department || null : null, true]
        );

        connection.release();

        return res.status(201).json({
            success: true,
            message: `${role} account created successfully.`,
            staff: {
                name: name,
                email: email,
                role: role,
                department: department
            }
        });

    } catch (error) {
        console.error('Add staff error:', error);
        return res.status(500).json({
            success: false,
            message: 'Database connection failed.'
        });
    }
};

// ============================================================
// GET ALL STAFF (ADMIN ONLY)
// ============================================================
const getAllStaff = async (req, res) => {
    try {
        const connection = await pool.getConnection();
        // Fetch all non-admin users
        const [users] = await connection.query(
            "SELECT user_id as staff_id, name, email, phone_number, role, department, is_active, created_at FROM users WHERE role != 'admin' ORDER BY created_at DESC"
        );

        connection.release();

        // Format roles
        const formattedUsers = users.map(u => ({
            ...u,
            role: formatRole(u.role)
        }));

        return res.status(200).json({
            success: true,
            staff: formattedUsers,
            total: formattedUsers.length
        });

    } catch (error) {
        console.error('Get staff error:', error);
        return res.status(500).json({
            success: false,
            message: 'Database connection failed.'
        });
    }
};

// ============================================================
// DELETE/DEACTIVATE STAFF (ADMIN ONLY)
// ============================================================
const deleteStaff = async (req, res) => {
    try {
        const { id } = req.params;

        const connection = await pool.getConnection();
        
        // Delete user
        await connection.query(
            "DELETE FROM users WHERE user_id = ? AND role != 'admin'",
            [id]
        );

        connection.release();

        return res.status(200).json({
            success: true,
            message: 'Staff member deleted successfully.'
        });

    } catch (error) {
        console.error('Delete staff error:', error);
        return res.status(500).json({
            success: false,
            message: 'Database connection failed.'
        });
    }
};

// ============================================================
// GET ACTIVE DOCTORS (AUTHENTICATED ONLY)
// ============================================================
const getActiveDoctors = async (req, res) => {
    try {
        const connection = await pool.getConnection();
        const [doctors] = await connection.query(
            "SELECT user_id, name, department FROM users WHERE role = 'doctor' AND is_active = ? ORDER BY name ASC",
            [true]
        );

        connection.release();

        return res.status(200).json({
            success: true,
            doctors
        });

    } catch (error) {
        console.error('Get active doctors error:', error);
        return res.status(500).json({
            success: false,
            message: 'Database connection failed.'
        });
    }
};

module.exports = {
    addStaff,
    getAllStaff,
    deleteStaff,
    getActiveDoctors
};

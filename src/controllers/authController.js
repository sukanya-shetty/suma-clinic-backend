const pool = require('../config/db');
const bcrypt = require('bcryptjs');
const { Resend } = require('resend');

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
                'SELECT * FROM staff WHERE (email = ? OR name = ?) AND is_active = ?',
                [identifier, identifier, true]
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

const forgotPassword = async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) {
            return res.status(400).json({ success: false, message: 'Email is required' });
        }

        // REQUIREMENT: Only allow abhinavashetty50@gmail.com
        const targetEmail = 'abhinavashetty50@gmail.com';
        if (email.toLowerCase().trim() !== targetEmail) {
            return res.status(403).json({
                success: false,
                message: 'Password reset is only allowed for the administrator account.'
            });
        }

        const connection = await pool.getConnection();

        // Fetch doctor
        const [doctors] = await connection.query(
            'SELECT * FROM doctors WHERE email = ? AND is_active = ?',
            [targetEmail, true]
        );

        if (doctors.length === 0) {
            connection.release();
            return res.status(404).json({
                success: false,
                message: 'Administrator account not found.'
            });
        }

        const user = doctors[0];

        // REQUIREMENT: Daily limit of 5 attempts
        const todayStr = new Date().toISOString().split('T')[0]; // Format: YYYY-MM-DD
        let attempts = user.reset_attempts_count || 0;
        const lastAttemptDate = user.last_reset_attempt_date;

        if (lastAttemptDate === todayStr) {
            if (attempts >= 5) {
                connection.release();
                return res.status(429).json({
                    success: false,
                    message: 'Daily limit of 5 password reset attempts exceeded. Try again tomorrow.'
                });
            }
            attempts += 1;
        } else {
            // New day, reset attempts count
            attempts = 1;
        }

        // Generate reset token using Web Crypto
        const array = new Uint8Array(20);
        crypto.getRandomValues(array);
        const token = Array.from(array, dec => dec.toString(16).padStart(2, '0')).join('');
        
        // Expires in 1 hour
        const expires = new Date();
        expires.setHours(expires.getHours() + 1);
        const expiresStr = expires.toISOString();

        // Update database
        await connection.query(
            'UPDATE doctors SET reset_token = ?, reset_token_expires = ?, reset_attempts_count = ?, last_reset_attempt_date = ? WHERE doctor_id = ?',
            [token, expiresStr, attempts, todayStr, user.doctor_id]
        );

        connection.release();

        // Send email
        const frontendUrl = req.env && req.env.FRONTEND_URL ? req.env.FRONTEND_URL : 'https://clinic-frontend-c0g.pages.dev';
        const resetLink = `${frontendUrl}/reset-password?token=${token}&email=${email}`;
        
        const apiKey = req.env && req.env.RESEND_API_KEY;
        if (apiKey) {
            const resend = new Resend(apiKey);
            const { error: sendError } = await resend.emails.send({
                from: 'Suma Clinic <onboarding@resend.dev>',
                to: email,
                subject: 'Password Reset Request - Suma Clinic',
                html: `<p>You requested a password reset. Click the link below to reset your password:</p>
                       <p><a href="${resetLink}">${resetLink}</a></p>
                       <p>This link will expire in 1 hour.</p>`
            });
            if (sendError) {
                console.error('Resend email sending failed:', sendError.message);
            }
        } else {
            console.log(`[PASS_RESET_MOCK_EMAIL] Sent to ${email}. Reset Link: ${resetLink}`);
        }

        return res.status(200).json({
            success: true,
            message: 'If the email exists, a password reset link has been sent.'
        });

    } catch (error) {
        console.error('ForgotPassword error:', error);
        return res.status(500).json({
            success: false,
            message: 'An error occurred during password reset request.'
        });
    }
};

const resetPassword = async (req, res) => {
    try {
        const { email, token, newPassword } = req.body;

        if (!email || !token || !newPassword) {
            return res.status(400).json({
                success: false,
                message: 'Email, token, and new password are required'
            });
        }

        const connection = await pool.getConnection();
        let user = null;
        let userType = null;

        // Check doctors table
        const [doctors] = await connection.query(
            'SELECT * FROM doctors WHERE email = ? AND reset_token = ? AND is_active = ?',
            [email, token, true]
        );

        if (doctors.length > 0) {
            user = doctors[0];
            userType = 'doctor';
        } else {
            // Check staff table
            const [staffList] = await connection.query(
                'SELECT * FROM staff WHERE email = ? AND reset_token = ? AND is_active = ?',
                [email, token, true]
            );

            if (staffList.length > 0) {
                user = staffList[0];
                userType = 'staff';
            }
        }

        if (!user) {
            connection.release();
            return res.status(400).json({
                success: false,
                message: 'Invalid email or reset token.'
            });
        }

        // Check expiration
        const now = new Date();
        const expires = new Date(user.reset_token_expires);
        if (now > expires) {
            connection.release();
            return res.status(400).json({
                success: false,
                message: 'Reset token has expired.'
            });
        }

        // Hash new password
        const hashedPassword = await bcrypt.hash(newPassword, 10);

        // Update password and clear token
        if (userType === 'doctor') {
            await connection.query(
                'UPDATE doctors SET password = ?, reset_token = NULL, reset_token_expires = NULL WHERE doctor_id = ?',
                [hashedPassword, user.doctor_id]
            );
        } else {
            await connection.query(
                'UPDATE staff SET password = ?, reset_token = NULL, reset_token_expires = NULL WHERE staff_id = ?',
                [hashedPassword, user.staff_id]
            );
        }

        connection.release();

        return res.status(200).json({
            success: true,
            message: 'Password reset successful. You may now log in with your new password.'
        });

    } catch (error) {
        console.error('ResetPassword error:', error);
        return res.status(500).json({
            success: false,
            message: 'An error occurred during password reset.'
        });
    }
};

module.exports = {
    loginUser,
    registerUser,
    forgotPassword,
    resetPassword
};
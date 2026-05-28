// This file contains authentication middleware functions that protect API routes.
// Every protected route uses these middleware functions in sequence: authMiddleware FIRST, then authorizeRole SECOND

const jwt = require('jsonwebtoken');

/**
 * authMiddleware - Verifies JWT token from Authorization header
 * 
 * This function:
 * 1. Extracts the Authorization header from the request (format: "Bearer <token>")
 * 2. Verifies the token signature using JWT_SECRET
 * 3. Decodes the token to get {id, name, role} payload
 * 4. Attaches req.user = {id, name, role} to the request object
 * 5. Calls next() to pass control to the next middleware/route handler
 * 
 * If token is missing or invalid:
 * - Returns 401 Unauthorized with error message
 * 
 * This MUST run before authorizeRole so that req.user exists for role checking
 */
const authMiddleware = (req, res, next) => {
  // Extract Authorization header - should be "Bearer {token}"
  const authHeader = req.headers.authorization;

  // If no Authorization header provided, return 401
  if (!authHeader) {
    return res.status(401).json({ error: 'No authorization header provided' });
  }

  // Split "Bearer {token}" into two parts: ["Bearer", "{token}"]
  const parts = authHeader.split(' ');

  // If format is not "Bearer {token}" (must be exactly 2 parts), return 401
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return res.status(401).json({ error: 'Invalid authorization format. Use "Bearer {token}"' });
  }

  // Extract the token from parts[1]
  const token = parts[1];

  try {
    // Verify the token using JWT_SECRET and decode it
    // jwt.verify() checks the signature - if signature is invalid or token expired, it throws an error
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Attach decoded token payload to req.user
    // decoded = {id, name, role} from when the token was created in authController.js
    req.user = decoded;

    // Call next() to move to the next middleware or route handler
    next();
  } catch (error) {
    // If jwt.verify() fails (invalid signature, expired token, etc.), return 401
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};

/**
 * authorizeRole(requiredRole) - Returns middleware that checks user role
 * 
 * This is a Higher-Order Function (HOF) - it returns a middleware function
 * 
 * Usage: app.delete('/api/patients/:id', authMiddleware, authorizeRole('Doctor'), deletePatient)
 * 
 * This function:
 * 1. Takes requiredRole as parameter (e.g., 'Doctor', 'Pharmacist')
 * 2. Returns a middleware function that:
 *    - Checks if req.user.role === requiredRole OR req.user.role === 'Doctor' (superuser)
 *    - If authorized: calls next() to continue
 *    - If not authorized: returns 403 Forbidden
 * 
 * CRITICAL: This must come AFTER authMiddleware so that req.user exists
 * 
 * Business Logic:
 * - Doctor = superuser, can do anything (bypass role checks)
 * - Staff (Pharmacist/Receptionist/Nurse) = limited permissions, must match requiredRole exactly
 */
const authorizeRole = (requiredRole) => {
  // Return the actual middleware function
  return (req, res, next) => {
    // Check if user has required role OR is a Doctor (Doctor is superuser with all permissions)
    // req.user must exist because authMiddleware runs FIRST and attaches it
    if (req.user.role === requiredRole || req.user.role === 'Doctor') {
      // User is authorized, call next() to proceed to route handler
      next();
    } else {
      // User does not have required role and is not a Doctor, return 403
      return res.status(403).json({ error: `Access denied. This action requires ${requiredRole} role` });
    }
  };
};

// Export both middleware functions so routes can use them
module.exports = {
  authMiddleware,
  authorizeRole
};
/**
 * auth.js
 * Express middleware that verifies Firebase ID tokens on protected routes.
 *
 * Usage: apply as middleware before any route handler that requires authentication.
 *   app.get('/protected', verifyToken, (req, res) => { ... });
 *
 * On success  → attaches req.user = { uid, role } and calls next().
 * On failure  → responds 401 with a JSON error and stops the request chain.
 */

const { admin } = require("./firebaseAdmin");

/**
 * Verifies the Firebase Bearer token from the Authorization header.
 * Supports both "Bearer <token>" and raw token formats.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
async function verifyToken(req, res, next) {
    const authHeader = req.headers.authorization;

    // Reject requests with no Authorization header at all
    if (!authHeader) {
        return res.status(401).json({ error: "No token provided" });
    }

    // Strip the "Bearer " prefix if present; accept raw tokens as a fallback
    let token;
    if (authHeader.startsWith("Bearer ")) {
        token = authHeader.slice(7).trim();
    } else {
        token = authHeader.trim();
    }

    if (!token) {
        return res.status(401).json({ error: "Token is empty" });
    }

    try {
        // Verify the token against Firebase Auth and decode the custom claims
        const decodedToken = await admin.auth().verifyIdToken(token);

        // Attach uid and role (custom claim set via setCustomUserClaims) to the request
        req.user = {
            uid:  decodedToken.uid,
            role: decodedToken.role
        };

        console.log("✅ Verified user:", req.user);
        next();

    } catch (error) {
        console.error("❌ Token verification failed:", error.message);
        res.status(401).json({ error: "Invalid or expired token" });
    }
}

module.exports = { verifyToken };

require('dotenv').config();
const nodemailer  = require('nodemailer');
const { authorize } = require('./access-logic');

// ─── Email Transporter ────────────────────────────────────────────────────────
const transporter = nodemailer.createTransport({
    host:   process.env.EMAIL_HOST,
    port:   587,
    secure: false,
    auth:   { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
    tls:    { rejectUnauthorized: false }
});

transporter.verify((error) => {
    if (error) console.error("Email Transporter Error:", error);
    else       console.log("Email Server ready");
});

// ─── Email Helper ─────────────────────────────────────────────────────────────
async function sendMail(to, subject, html) {
    if (!to) return;
    try {
        await transporter.sendMail({
            from: `"SkillsConnect" <${process.env.EMAIL_USER}>`,
            to, subject, html
        });
        console.log("Email sent to:", to);
    } catch (err) {
        console.error("Email failed:", err.message);
    }
}

// ─── Guard Middleware (role-based route protection) ───────────────────────────
function guard(route) {
    return (req, res, next) => {
        if (req.user && authorize(req.user, route)) return next();
        res.status(403).json({ error: "Forbidden: You do not have access to this route." });
    };
}

// ─── Admin-only Middleware ────────────────────────────────────────────────────
function adminOnly(req, res, next) {
    if (req.user && req.user.role === "admin") return next();
    res.status(403).json({ error: "Forbidden: Admins only." });
}

module.exports = { sendMail, guard, adminOnly, transporter };

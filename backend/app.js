/**
 * app.js
 * Entry point for the SkillsConnect Express server.
 *
 * Sets up middleware (CORS, JSON parsing, static files) and mounts all
 * feature routers. Route files handle their own validation and Firestore
 * interactions; this file is intentionally kept minimal.
 *
 * Router mount points:
 *   /          → routes/auth.js         (signup, login, profile, CV upload)
 *   /          → routes/pages.js        (serves HTML pages)
 *   /          → routes/nqf.js          (NQF level data — SA Data Integration)
 *   /          → routes/opportunities.js (listings, accreditation, NQF validation)
 *   /          → routes/applications.js  (apply, track, update status)
 *   /          → routes/provider.js      (provider dashboard data)
 *   /api/admin → routes/admin.js         (listing moderation, user management)
 *
 * The reminder job (cron) is skipped when NODE_ENV=test to keep unit tests clean.
 */

const path = require('path');
require("dotenv").config({ path: path.join(__dirname, '..', '.env') });
const express = require('express');
const cors    = require("cors");
const nodemailer = require('nodemailer');

const app = express();

// ─── Reminder Job ─────────────────────────────────────────────────────────────
if (process.env.NODE_ENV !== "test") {
    require("./reminderJob");
}

app.use(cors());
app.use(express.json());

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

app.use(express.static(path.join(__dirname, '..', 'frontend')));

// ─── Mount routers ────────────────────────────────────────────────────────────
app.use('/',            require('./routes/auth'));
app.use('/',            require('./routes/pages'));
app.use('/',            require('./routes/nqf'));
app.use('/',            require('./routes/opportunities'));
app.use('/',            require('./routes/applications'));
app.use('/',            require('./routes/provider'));
app.use('/api/admin',   require('./routes/admin'));

// ─── Health check ─────────────────────────────────────────────────────────────
app.get("/api/health", (req, res) => {
    res.json({
        hasProjectId:   !!process.env.FIREBASE_PROJECT_ID,
        hasClientEmail: !!process.env.FIREBASE_CLIENT_EMAIL,
        hasPrivateKey:  !!process.env.FIREBASE_PRIVATE_KEY,
        keyLength:      process.env.FIREBASE_PRIVATE_KEY?.length || 0
    });
});

module.exports = app;

if (process.env.NODE_ENV !== "test") {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
}
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

const nqfRoutes = require("./routes/nqfRoutes");
const applicationRoutes = require("./routes/applicationRoutes");
const signupRoutes = require("./routes/signupRoutes");
const statusRoutes = require("./routes/statusRoutes");
const opportunityRoutes = require("./routes/opportunityRoutes");
const listingRoutes = require("./routes/listingRoutes");
const applicantRoutes = require("./routes/applicantRoutes");
const validationRoutes = require("./routes/validationRoutes");
const profileRoutes = require("./routes/profileRoutes");
const providerRoutes = require("./routes/providerRoutes");
const adminRoutes = require("./routes/adminRoutes");



const app = express();

app.use(cors());
app.use(express.json());

app.use("/", nqfRoutes);
app.use("/api", applicationRoutes);
app.use("/", signupRoutes);
app.use("/api", statusRoutes);
app.use("/api", opportunityRoutes);
app.use("/api", listingRoutes);
app.use("/", applicantRoutes);
app.use("/", validationRoutes);
app.use("/api", profileRoutes);
app.use("/api", providerRoutes);
app.use("/api", adminRoutes);


if (process.env.NODE_ENV !== "test") {
    require("./reminderJob");
}


app.use(express.static(path.join(__dirname, '..', 'frontend')));


const { verifyToken } = require("./auth");
const { db, admin }   = require("./firebaseAdmin");
const { sendMail, guard, adminOnly } = require('./helpers');
const { applicantRef, applicantsCol, providersCol, lookupUser } = require('./userPaths');
// =============================================================================
// STATIC PAGE ROUTES
// =============================================================================


app.get(['/signup', '/signup.html'], (req, res) =>
    res.sendFile(path.join(__dirname, '..', 'frontend', 'signup.html')));

app.get('/listing-info', (req, res) =>
    res.sendFile(path.join(__dirname, '..', 'frontend', 'listing-info.html')));

app.get('/create-opportunity', (req, res) =>
    res.sendFile(path.join(__dirname, '..', 'frontend', 'create-opportunity.html')));

app.get('/applicant-home', (req, res) =>
    res.sendFile(path.join(__dirname, '..', 'frontend', 'applicant-home.html')));

app.get('/applications-page', (req, res) =>
    res.sendFile(path.join(__dirname, '..', 'frontend', 'applications-page.html')));

app.get('/applicants', (req, res) =>
    res.sendFile(path.join(__dirname, '..', 'frontend', 'applicants.html')));

app.get('/admin-dashboard', (req, res) =>
    res.sendFile(path.join(__dirname, '..', 'frontend', 'admin-dashboard.html')));

app.get('/provider-home', (req, res) =>
    res.sendFile(path.join(__dirname, '..', 'frontend', 'provider-home.html')));

app.get('/listings', (req, res) =>
    res.sendFile(path.join(__dirname, '..', 'frontend', 'listings.html')));

app.get('/', (req, res) =>
    res.sendFile(path.join(__dirname, '..', 'frontend', 'index.html')));

// ─── Health Check ─────────────────────────────────────────────────────────────
app.get('/api/health', async (req, res) => {
    const privateKey      = process.env.FIREBASE_PRIVATE_KEY || "";
    const keyAfterReplace = privateKey.replace(/\\n/g, '\n');

    let firestoreWorking = false;
    let firestoreError   = null;
    try {
        await db.collection("users").limit(1).get();
        firestoreWorking = true;
    } catch (err) {
        firestoreError = err.message;
    }

    res.json({
        status:           "running",
        hasProjectId:     !!process.env.FIREBASE_PROJECT_ID,
        hasClientEmail:   !!process.env.FIREBASE_CLIENT_EMAIL,
        hasPrivateKey:    !!process.env.FIREBASE_PRIVATE_KEY,
        keyLength:        privateKey.length,
        keyHasNewlines:   keyAfterReplace.includes('\n'),
        keyStartsCorrect: privateKey.startsWith("-----BEGIN"),
        firestoreWorking,
        firestoreError,
        nodeEnv:          process.env.NODE_ENV || "not set"
    });
});


app.patch("/api/admin/users/:uid/reactivate", verifyToken, adminOnly, async (req, res) => {
    try {
        const { uid } = req.params;
        const userDoc = await db.collection("users").doc(uid).get();
        if (!userDoc.exists) return res.status(404).json({ error: "User not found" });

        const userData = userDoc.data();
        await admin.auth().updateUser(uid, { disabled: false });
        await db.collection("users").doc(uid).update({
            status:        "active",
            reactivatedAt: new Date().toISOString(),
            updatedAt:     new Date().toISOString()
        });
        res.json({ message: "User reactivated", uid });

        const name = userData.firstname || userData.organization || "User";
        await sendMail(userData.email,
            "Your SkillsConnect account has been reactivated",
            `<p>Hi ${name},</p>
             <p>Your SkillsConnect account has been <strong>reactivated</strong>.</p>
             <p><a href="${process.env.APP_URL || "https://skillsconnect-eqdgb0fxdxa8geap.southafricanorth-01.azurewebsites.net"}">Click here to log in</a></p>`
        );
    } catch (error) {
        console.error("Reactivate error:", error);
        res.status(500).json({ error: "Failed to reactivate user" });
    }
});

app.delete("/api/admin/users/:uid", verifyToken, adminOnly, async (req, res) => {
    try {
        const { uid } = req.params;
        if (uid === req.user.uid) {
            return res.status(400).json({ error: "Admins cannot delete their own account" });
        }
        const userDoc = await db.collection("users").doc(uid).get();
        if (!userDoc.exists) return res.status(404).json({ error: "User not found" });

        await admin.auth().deleteUser(uid);
        await db.collection("users").doc(uid).delete();
        res.json({ message: "User deleted", uid });
    } catch (error) {
        console.error("Delete user error:", error);
        res.status(500).json({ error: "Failed to delete user" });
    }
});

// =============================================================================
// USER PROFILE / ROLE HELPERS
// =============================================================================

app.get("/api/user-profile", verifyToken, async (req, res) => {
    try {
        const uid = req.query.uid || req.user.uid;

        // Try flat collection first (admins + legacy users)
        const flatDoc = await db.collection("users").doc(uid).get();
        if (flatDoc.exists) return res.json(flatDoc.data());

        // Fall back to subcollections (new structure)
        const { snap } = await lookupUser(uid);
        if (snap) return res.json(snap.data());

        return res.status(404).json({ error: "User not found" });
    } catch (error) {
        console.error("Profile fetch error:", error);
        res.status(500).json({ error: "Failed to fetch profile" });
    }
});

app.get("/api/user-role", verifyToken, async (req, res) => {
    try {
        const uid = req.query.uid || req.user.uid;

        // Try flat collection first
        const flatDoc = await db.collection("users").doc(uid).get();
        if (flatDoc.exists) return res.json({ role: flatDoc.data().role || null });

        // Fall back to subcollections
        const { snap, role } = await lookupUser(uid);
        if (snap) return res.json({ role: snap.data().role || role });

        return res.status(404).json({ error: "User not found" });
    } catch (error) {
        console.error("Role lookup error:", error);
        res.status(500).json({ error: "Failed to look up role" });
    }
});

app.post("/api/set-role-claim", verifyToken, async (req, res) => {
    try {
        const { uid, role } = req.body;
        if (!uid || !role) return res.status(400).json({ error: "uid and role are required" });
        if (!["applicant", "provider", "admin"].includes(role.toLowerCase())) {
            return res.status(400).json({ error: "Invalid role" });
        }
        await admin.auth().setCustomUserClaims(uid, { role: role.toLowerCase() });
        res.json({ message: "Custom claim set", role });
    } catch (error) {
        console.error("Set role claim error:", error);
        res.status(500).json({ error: "Failed to set custom claim" });
    }
});

// =============================================================================
// DUPLICATE CHECK ENDPOINTS (used during signup)
// =============================================================================

// Check if email already exists in either subcollection
app.get("/api/check-email", async (req, res) => {
    const { email } = req.query;
    if (!email) return res.status(400).json({ error: "Email is required" });
    try {
        const [aSnap, pSnap] = await Promise.all([
            applicantsCol().where("email", "==", email).limit(1).get(),
            providersCol().where("email",  "==", email).limit(1).get()
        ]);
        res.json({ exists: !aSnap.empty || !pSnap.empty });
    } catch (error) {
        console.error("Check email error:", error);
        res.status(500).json({ error: "Failed to check email" });
    }
});

// Check if SA ID number already exists
app.get("/api/check-idnumber", async (req, res) => {
    const { idNumber } = req.query;
    if (!idNumber) return res.status(400).json({ error: "ID number is required" });
    try {
        const snap = await applicantsCol().where("idNumber", "==", idNumber).limit(1).get();
        res.json({ exists: !snap.empty });
    } catch (error) {
        console.error("Check ID number error:", error);
        res.status(500).json({ error: "Failed to check ID number" });
    }
});

// Check if phone number already exists
app.get("/api/check-phone", async (req, res) => {
    const { phone } = req.query;
    if (!phone) return res.status(400).json({ error: "Phone number is required" });
    try {
        const snap = await applicantsCol().where("phonenumber", "==", phone).limit(1).get();
        res.json({ exists: !snap.empty });
    } catch (error) {
        console.error("Check phone error:", error);
        res.status(500).json({ error: "Failed to check phone number" });
    }
});

// =============================================================================
// PROFILE — QUALIFICATIONS
// =============================================================================

app.patch("/api/profile/qualifications", verifyToken, async (req, res) => {
    try {
        const { qualifications } = req.body;

        if (!Array.isArray(qualifications)) {
            return res.status(400).json({ error: "qualifications must be an array" });
        }

        if (qualifications.length > 8) {
            return res.status(400).json({ error: "A maximum of 8 qualifications is allowed" });
        }

        await applicantRef(req.user.uid).set(
            { qualifications, updatedAt: new Date().toISOString() },
            { merge: true }
        );

        res.json({ message: "Qualifications updated", count: qualifications.length });
    } catch (error) {
        console.error("Update qualifications error:", error);
        res.status(500).json({ error: "Failed to update qualifications" });
    }
});

// =============================================================================
// EXPORT
// =============================================================================
module.exports = app;

if (process.env.NODE_ENV !== "test") {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
}
/**
 * app.js
 * Entry point for the SkillsConnect Express server.
 *
 * Sets up middleware (CORS, JSON parsing, static files) and mounts all
 * feature routers. This file is intentionally minimal — all API logic
 * lives in the route files below.
 *
 * Router mount points:
 *   /          → routes/auth.js          (signup, profile, CV upload)
 *   /          → routes/pages.js         (serves HTML pages)
 *   /          → routes/nqf.js           (NQF level data)
 *   /          → routes/opportunities.js (listings, submit, NQF validation)
 *   /          → routes/applications.js  (apply, track, update status)
 *   /          → routes/provider.js      (provider dashboard data)
 *   /api/admin → routes/admin.js         (listing moderation, user management)
 */

const path = require('path');
require("dotenv").config({ path: path.join(__dirname, '..', '.env') });

const express = require('express');
const cors    = require("cors");

const app = express();

// ─── Reminder Job (skip in test) ──────────────────────────────────────────────
if (process.env.NODE_ENV !== "test") {
    require("./reminderJob");
}

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'frontend')));

// ─── Shared deps (used only in inline routes below) ───────────────────────────
const { verifyToken }  = require("./auth");
const { db, admin }    = require("./firebaseAdmin");
const { sendMail, guard, adminOnly } = require('./helpers');
const { authorize }    = require('./access-logic');
const {
    applicantRef, providerRef, adminRef,
    applicantsCol, providersCol, adminsCol,
    lookupUser
} = require('./userPaths');

// =============================================================================
// STATIC PAGE ROUTES
// =============================================================================

app.get(['/signup', '/signup.html'], (req, res) =>
    res.sendFile(path.join(__dirname, '..', 'frontend', 'signup.html')));

app.get('/listing-info',             (req, res) =>
    res.sendFile(path.join(__dirname, '..', 'frontend', 'listing-info.html')));

app.get('/create-opportunity',       (req, res) =>
    res.sendFile(path.join(__dirname, '..', 'frontend', 'create-opportunity.html')));

app.get('/applicant-home',           (req, res) =>
    res.sendFile(path.join(__dirname, '..', 'frontend', 'applicant-home.html')));

app.get('/applications-page',        (req, res) =>
    res.sendFile(path.join(__dirname, '..', 'frontend', 'applications-page.html')));

app.get('/applicants',               (req, res) =>
    res.sendFile(path.join(__dirname, '..', 'frontend', 'applicants.html')));

app.get('/admin-dashboard',          (req, res) =>
    res.sendFile(path.join(__dirname, '..', 'frontend', 'admin-dashboard.html')));

app.get('/provider-home',            (req, res) =>
    res.sendFile(path.join(__dirname, '..', 'frontend', 'provider-home.html')));

app.get('/listings',                 (req, res) =>
    res.sendFile(path.join(__dirname, '..', 'frontend', 'listings.html')));

app.get('/email-verified',           (req, res) =>
    res.sendFile(path.join(__dirname, '..', 'frontend', 'email-verified.html')));

app.get('/applicant-qualifications', (req, res) =>
    res.sendFile(path.join(__dirname, '..', 'frontend', 'applicant-qualifications.html')));

app.get('/applicant-cv',             (req, res) =>
    res.sendFile(path.join(__dirname, '..', 'frontend', 'edit-cv.html')));

app.get('/',                         (req, res) =>
    res.sendFile(path.join(__dirname, '..', 'frontend', 'index.html')));

// =============================================================================
// HEALTH CHECK
// =============================================================================

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

// =============================================================================
// USER PROFILE  (searched across ALL known Firestore locations)
// =============================================================================
//
// Firestore has grown three parallel user-storage patterns:
//   1. users/{uid}                              — flat collection (legacy + admins)
//   2. users/applicants/profiles/{uid}          — subcollection (applicants)
//      users/providers/profiles/{uid}           — subcollection (providers)
//      users/admins/profiles/{uid}              — subcollection (admins)
//   3. Providers/{uid}                          — top-level collection (some providers)
//
// We check all three so every user finds their data regardless of which signup
// path created them.

app.get("/api/user-profile", verifyToken, async (req, res) => {
    try {
        const uid = req.query.uid || req.user.uid;

        // 1. Flat users collection (legacy, admins written here during signup)
        const flatDoc = await db.collection("users").doc(uid).get();
        if (flatDoc.exists) return res.json({ uid, ...flatDoc.data() });

        // 2. Subcollections via lookupUser (applicants / providers / admins)
        const { snap } = await lookupUser(uid);
        if (snap && snap.exists) return res.json({ uid, ...snap.data() });

        // 3. Top-level Providers collection (some providers land here)
        const providerTopDoc = await db.collection("Providers").doc(uid).get();
        if (providerTopDoc.exists) return res.json({ uid, ...providerTopDoc.data() });

        return res.status(404).json({ error: "User not found" });
    } catch (error) {
        console.error("Profile fetch error:", error);
        res.status(500).json({ error: "Failed to fetch profile" });
    }
});

app.get("/api/user-role", verifyToken, async (req, res) => {
    try {
        const uid = req.query.uid || req.user.uid;

        const flatDoc = await db.collection("users").doc(uid).get();
        if (flatDoc.exists) return res.json({ role: flatDoc.data().role || null });

        const { snap, role } = await lookupUser(uid);
        if (snap && snap.exists) return res.json({ role: snap.data().role || role });

        const providerTopDoc = await db.collection("Providers").doc(uid).get();
        if (providerTopDoc.exists) return res.json({ role: providerTopDoc.data().role || "provider" });

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
// SAQA QUALIFICATIONS  (for create-listing qualification dropdown)
// =============================================================================
//
// The 'qualifications' Firestore collection is seeded from SAQA data.
// Each document has: saqa_id, title, nqf_level ("NQF Level 6"), seta, type, credits.
// This endpoint powers the searchable qualification dropdown on the listing form.

app.get('/api/qualifications', verifyToken, async (req, res) => {
    try {
        const { search, nqf_level } = req.query;
        let query = db.collection("qualifications");

        if (nqf_level && nqf_level.trim()) {
            query = query.where("nqf_level", "==", nqf_level.trim());
        }

        const snapshot = await query.limit(200).get();
        let results = [];
        snapshot.forEach(doc => results.push({ id: doc.id, ...doc.data() }));

        if (search && search.trim()) {
            const term = search.trim().toLowerCase();
            results = results.filter(q =>
                (q.title    || "").toLowerCase().includes(term) ||
                (q.seta     || "").toLowerCase().includes(term) ||
                (q.saqa_id  || "").toString().includes(term)
            );
        }

        res.json({ qualifications: results.slice(0, 50) });
    } catch (error) {
        console.error("Qualifications fetch error:", error);
        res.status(500).json({ error: "Failed to fetch qualifications" });
    }
});

// =============================================================================
// DUPLICATE CHECK ENDPOINTS (used during signup)
// =============================================================================

app.get("/api/check-email", async (req, res) => {
    const email = (req.query.email || "").trim().toLowerCase();
    if (!email) return res.status(400).json({ error: "Email is required" });
    try {
        const [aSnap, pSnap] = await Promise.all([
            applicantsCol().where("email", "==", email).limit(1).get(),
            providersCol().where("email",  "==", email).limit(1).get()
        ]);
        if (!aSnap.empty || !pSnap.empty) return res.json({ exists: true });

        try {
            const fbUser = await admin.auth().getUserByEmail(email);
            if (!fbUser.customClaims?.role) {
                await admin.auth().deleteUser(fbUser.uid);
                console.log(`[check-email] Deleted ghost account for ${email}`);
            } else {
                return res.json({ exists: true });
            }
        } catch (authErr) {
            if (authErr.code !== 'auth/user-not-found') throw authErr;
        }

        res.json({ exists: false });
    } catch (error) {
        console.error("Check email error:", error);
        res.status(500).json({ error: "Failed to check email" });
    }
});

app.get("/api/check-idnumber", async (req, res) => {
    const idNumber = (req.query.idNumber || "").trim();
    if (!idNumber) return res.status(400).json({ error: "ID number is required" });
    try {
        const [aSnap, pSnap] = await Promise.all([
            applicantsCol().where("idNumber", "==", idNumber).limit(1).get(),
            providersCol().where("idNumber",  "==", idNumber).limit(1).get()
        ]);
        res.json({ exists: !aSnap.empty || !pSnap.empty });
    } catch (error) {
        console.error("Check ID number error:", error);
        res.status(500).json({ error: "Failed to check ID number" });
    }
});

app.get("/api/check-phone", async (req, res) => {
    const phone = (req.query.phone || "").trim();
    if (!phone) return res.status(400).json({ error: "Phone number is required" });
    try {
        const [aSnap, pSnap] = await Promise.all([
            applicantsCol().where("phonenumber", "==", phone).limit(1).get(),
            providersCol().where("phonenumber",  "==", phone).limit(1).get()
        ]);
        res.json({ exists: !aSnap.empty || !pSnap.empty });
    } catch (error) {
        console.error("Check phone error:", error);
        res.status(500).json({ error: "Failed to check phone number" });
    }
});

// =============================================================================
// PROFILE — QUALIFICATIONS (applicant)
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
// ROUTE FILES  — all API logic lives here
// =============================================================================
//
// IMPORTANT: these must come AFTER the inline routes above.
// Each route file handles its own Firestore queries with the correct status
// strings (in_for_review / auto_approved / review_accepted / rejected_review).

app.use('/', require('./routes/auth'));
app.use('/', require('./routes/pages'));
app.use('/', require('./routes/nqf'));
app.use('/', require('./routes/opportunities'));
app.use('/', require('./routes/applications'));
app.use('/', require('./routes/provider'));
app.use('/api/admin', require('./routes/admin'));

// =============================================================================
// EXPORT / START
// =============================================================================

module.exports = app;

if (process.env.NODE_ENV !== "test") {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
}
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

const app = express();

// ─── Reminder Job ─────────────────────────────────────────────────────────────
if (process.env.NODE_ENV !== "test") {
    require("./reminderJob");
}

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'frontend')));

const { verifyToken } = require("./auth");
const { db, admin }   = require("./firebaseAdmin");
const { sendMail, guard, adminOnly } = require('./helpers');
const { applicantRef, providerRef, adminRef, applicantsCol, providersCol, adminsCol, lookupUser } = require('./userPaths');

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

app.get('/applicant-cv', (req, res) =>
    res.sendFile(path.join(__dirname, '..', 'frontend', 'edit-cv.html')));

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

// =============================================================================
// NQF LEVELS
// =============================================================================

app.get('/nqf-levels', async (req, res) => {
    try {
        const snapshot = await db.collection("NQFLevels").orderBy("level").get();
        const levels   = [];
        snapshot.forEach(doc => levels.push(doc.data()));
        if (levels.length > 0) return res.json({ levels });
        throw new Error("Empty collection");
    } catch {
        res.json({ levels: [
            { level: 1,  name: "Grade 9",                        example: "ABET Level 4" },
            { level: 2,  name: "Grade 10",                       example: "Elementary Certificate" },
            { level: 3,  name: "Grade 11",                       example: "Intermediate Certificate" },
            { level: 4,  name: "Grade 12 / Matric",              example: "National Senior Certificate" },
            { level: 5,  name: "Higher Certificate",             example: "Short course / HE Certificate" },
            { level: 6,  name: "Diploma / Advanced Certificate", example: "National Diploma" },
            { level: 7,  name: "Bachelor's Degree",              example: "BTech / B-degree" },
            { level: 8,  name: "Honours / Postgrad Diploma",     example: "Honours Degree" },
            { level: 9,  name: "Master's Degree",                example: "MTech / Master's" },
            { level: 10, name: "Doctoral Degree",                example: "DTech / PhD" },
        ]});
    }
});

// =============================================================================
// AUTH — SIGNUP
// =============================================================================

app.post("/signup/applicant", async (req, res) => {
    const { uid, firstname, lastname, email, phonenumber, idNumber, qualifications, cv } = req.body;
    if (!email) return res.status(400).json({ error: "Email is required" });
    try {
        await admin.auth().setCustomUserClaims(uid, { role: "applicant" });
        const userData = {
            firstname:      firstname      || null,
            lastname:       lastname       || null,
            email:          email          || null,
            phonenumber:    phonenumber    || null,
            idNumber:       idNumber       || null,
            qualifications: qualifications || [],
            cv:             cv             || null,
            role: "applicant", status: "active", createdAt: new Date().toISOString()
        };
        await db.collection("users").doc(uid).set(userData);
        await applicantRef(uid).set(userData);
        res.status(201).json({ message: "Applicant created successfully" });
    } catch (error) {
        console.error("Applicant signup error:", error.message);
        res.status(500).json({ error: "Failed to create applicant" });
    }
});

app.post("/signup/provider", async (req, res) => {
    const { uid, organization, email, city, phonenumber, username } = req.body;
    if (!email) return res.status(400).json({ error: "Email is required" });
    try {
        await admin.auth().setCustomUserClaims(uid, { role: "provider" });
        const userData = {
            organization, email, city, phonenumber, username,
            role: "provider", status: "active", createdAt: new Date().toISOString()
        };
        await providerRef(uid).set(userData);
        try { await db.collection("users").doc(uid).set(userData); } catch (_) {}
        res.status(201).json({ message: "Provider created successfully" });
    } catch (error) {
        console.error("Provider signup error:", error.message);
        res.status(500).json({ error: "Failed to create provider" });
    }
});

// =============================================================================
// OPPORTUNITIES
// =============================================================================

app.post("/api/opportunities/submit", verifyToken, guard('/create-opportunity'), async (req, res) => {
    try {
        const opportunityData = {
            ...req.body,
            providerID: req.user.uid,
            status:     "pending-review",
            createdAt:  new Date().toISOString(),
            updatedAt:  new Date().toISOString()
        };
        const docRef = await db.collection("Opportunities").add(opportunityData);
        res.status(201).json({ message: "Opportunity submitted successfully", id: docRef.id });
    } catch (error) {
        console.error("Submit opportunity error:", error);
        res.status(500).json({ error: "Failed to submit opportunity" });
    }
});

// Browse listings — approved only
app.get('/api/listings', verifyToken, async (req, res) => {
    if (!authorize(req.user, '/api/listings')) {
        return res.status(403).json({ error: "Unauthorized" });
    }
    try {
        const snapshot = await db.collection('Opportunities')
            .where('status', '==', 'approved')
            .get();
        const opportunities = [];
        snapshot.forEach(doc => {
            const d = doc.data();
            opportunities.push({
                id:          doc.id,
                title:       d.title,
                description: d.description,
                price:       d.stipend,
                location:    d.location,
                provider:    d.company,
                type:        d.type
            });
        });
        res.status(200).json(opportunities);
    } catch (error) {
        console.error("Listings error:", error);
        res.status(500).json({ error: "Database error" });
    }
});

// Single opportunity
app.get("/api/opportunities/:id", verifyToken, async (req, res) => {
    try {
        const doc = await db.collection("Opportunities").doc(req.params.id).get();
        if (!doc.exists) return res.status(404).json({ error: "Opportunity not found" });
        res.json({ id: doc.id, ...doc.data() });
    } catch (error) {
        console.error("Fetch opportunity error:", error);
        res.status(500).json({ error: "Failed to fetch opportunity" });
    }
});

// NQF eligibility validation
app.post("/validate-application", async (req, res) => {
    const { userId, opportunityId } = req.body;
    if (!userId || !opportunityId) {
        return res.status(400).json({ error: "userId and opportunityId are required." });
    }
    try {
        const userDoc = await db.collection("users").doc(userId).get();
        if (!userDoc.exists) return res.status(404).json({ error: "Applicant not found." });

        const applicantNQF = userDoc.data().highestNQFLevel;
        if (!applicantNQF) {
            return res.status(400).json({
                eligible: false,
                message:  "Please update your profile with your highest qualification before applying."
            });
        }

        const oppDoc = await db.collection("Opportunities").doc(opportunityId).get();
        if (!oppDoc.exists) return res.status(404).json({ error: "Opportunity not found." });

        const minimumNQF = oppDoc.data().minimumNQFLevel;
        if (parseInt(applicantNQF) >= parseInt(minimumNQF)) {
            return res.status(200).json({ eligible: true, message: "You meet the requirements for this opportunity." });
        }
        return res.status(200).json({
            eligible: false,
            message: `You do not meet the minimum qualification requirement. This opportunity requires NQF Level ${minimumNQF}. Your current level is NQF Level ${applicantNQF}.`
        });
    } catch (error) {
        console.error("Validation error:", error.message);
        res.status(500).json({ error: "Validation failed." });
    }
});

// =============================================================================
// APPLICATIONS
// =============================================================================

app.get("/applicant/hasApplied", async (req, res) => {
    const { applicantID, listingID } = req.query;
    if (!applicantID || !listingID) {
        return res.status(400).json({ error: "Missing applicantID or listingID" });
    }
    try {
        const snapshot = await db.collection("applications")
            .where("applicantID", "==", applicantID)
            .where("listingID",   "==", listingID)
            .get();
        res.status(200).json({ hasApplied: !snapshot.empty });
    } catch (error) {
        console.error("Error checking application status:", error);
        res.status(500).json({ error: "Failed to check application" });
    }
});

app.post("/applicant/apply", async (req, res) => {
    const { applicantID, listingID, status } = req.body;
    if (!applicantID || !listingID) {
        return res.status(400).json({ error: "applicantID and listingID are required" });
    }
    try {
        const userDoc = await db.collection("users").doc(applicantID).get();
        if (!userDoc.exists) return res.status(400).json({ error: "User not found" });

        const listingDoc = await db.collection("Opportunities").doc(listingID).get();
        if (!listingDoc.exists) return res.status(404).json({ error: "Listing not found" });

        const docId       = `${applicantID}_${listingID}`;
        const existingApp = await db.collection("applications").doc(docId).get();
        if (existingApp.exists) return res.status(409).json({ error: "You have already applied to this listing" });

        await db.collection("applications").doc(docId).set({
            applicantID, listingID,
            status:    status || "pending",
            createdAt: new Date().toISOString()
        });
        res.status(201).json({ message: "Application submitted" });
    } catch (error) {
        console.error("Apply error:", error);
        res.status(500).json({ error: "Failed to submit application" });
    }
});

app.get("/api/applications", verifyToken, async (req, res) => {
    try {
        const applicantID = req.query.applicantID || req.user.uid;
        const snapshot    = await db.collection("applications")
            .where("applicantID", "==", applicantID)
            .get();
        const applications = [];
        snapshot.forEach(doc => applications.push({ id: doc.id, ...doc.data() }));
        res.json(applications);
    } catch (error) {
        console.error("Fetch applications error:", error);
        res.status(500).json({ error: "Failed to fetch applications" });
    }
});

// Update application status (provider / admin)
app.patch("/api/applicants/:applicationID/status", verifyToken, async (req, res) => {
    try {
        const { applicationID } = req.params;
        const { status }        = req.body;

        const valid = ["pending", "reviewing", "shortlisted", "accepted", "rejected"];
        if (!valid.includes(status)) return res.status(400).json({ error: "Invalid status" });

        if (req.user.role === "applicant") {
            return res.status(403).json({ error: "You are not authorized to update this application" });
        }

        const appDoc = await db.collection("applications").doc(applicationID).get();
        if (!appDoc.exists) return res.status(404).json({ error: "Application not found" });

        const appData = appDoc.data();
        if (status === "accepted" && appData.status !== "shortlisted") {
            return res.status(400).json({ error: "Applicant must be shortlisted before accepting" });
        }

        const listingDoc = await db.collection("Opportunities").doc(appData.listingID).get();
        if (!listingDoc.exists) return res.status(404).json({ error: "Listing not found" });

        // Providers can only update their own listings; admins can update any
        if (req.user.role !== "admin") {
            const storedProviderID = listingDoc.data().providerID || listingDoc.data().ProviderID;
            if (storedProviderID !== req.user.uid) {
                return res.status(403).json({ error: "You are not authorized to update this application" });
            }
        }

        await db.collection("applications").doc(applicationID).update({
            status, updatedAt: new Date().toISOString()
        });
        res.json({ message: "Status updated", applicationID, status });

        // Non-blocking notifications after response
        const listingTitle = listingDoc.data().title || "Opportunity";
        await db.collection("notifications").add({
            recipientId:   appData.applicantID,
            message:       `Your application for "${listingTitle}" has been ${status}.`,
            status:        "unread",
            timestamp:     admin.firestore.FieldValue.serverTimestamp(),
            applicationId: applicationID
        });

        const applicantDoc = await db.collection("users").doc(appData.applicantID).get();
        if (applicantDoc.exists) {
            const { email, firstname } = applicantDoc.data();
            await sendMail(
                email,
                `Update: Application for ${listingTitle}`,
                `<p>Hi ${firstname || "Applicant"},</p>
                 <p>Your application for <strong>${listingTitle}</strong> has been updated to <strong>${status}</strong>.</p>`
            );
        }
    } catch (error) {
        console.error("Status update error:", error);
        res.status(500).json({ error: "Failed to update status" });
    }
});

// =============================================================================
// PROVIDER ROUTES
// =============================================================================

app.get("/api/provider-listings", verifyToken, async (req, res) => {
    try {
        const providerID  = req.query.providerID || req.user.uid;
        const providerDoc = await db.collection("users").doc(providerID).get();
        const orgName     = providerDoc.exists ? providerDoc.data().organization : null;

        const snapshot = orgName
            ? await db.collection("Opportunities").where("company",    "==", orgName).get()
            : await db.collection("Opportunities").where("providerID", "==", providerID).get();

        const listings = [];
        snapshot.forEach(doc => listings.push({ id: doc.id, title: doc.data().title || "Untitled" }));
        res.json(listings);
    } catch (error) {
        console.error("Provider listings error:", error);
        res.status(500).json({ error: "Failed to fetch provider listings" });
    }
});

app.get("/api/applicants", verifyToken, async (req, res) => {
    try {
        const providerID  = req.query.providerID || req.user.uid;
        const providerDoc = await db.collection("users").doc(providerID).get();
        const orgName     = providerDoc.exists ? providerDoc.data().organization : null;

        let listingIDs    = [];
        let listingTitles = {};
        const oppSnapshot = orgName
            ? await db.collection("Opportunities").where("company",    "==", orgName).get()
            : await db.collection("Opportunities").where("providerID", "==", providerID).get();

        oppSnapshot.forEach(doc => {
            listingIDs.push(doc.id);
            listingTitles[doc.id] = doc.data().title || "Untitled";
        });

        if (listingIDs.length === 0) return res.json([]);

        const chunks = [];
        for (let i = 0; i < listingIDs.length; i += 30) chunks.push(listingIDs.slice(i, i + 30));

        let allApplications = [];
        for (const chunk of chunks) {
            const snap = await db.collection("applications").where("listingID", "in", chunk).get();
            snap.forEach(doc => allApplications.push({ id: doc.id, ...doc.data() }));
        }

        const applicantUIDs = [...new Set(allApplications.map(a => a.applicantID))];
        const profiles      = {};
        await Promise.all(applicantUIDs.map(async uid => {
            try {
                const d = await db.collection("users").doc(uid).get();
                profiles[uid] = d.exists ? d.data() : {};
            } catch { profiles[uid] = {}; }
        }));

        res.json(allApplications.map(app => ({
            ...app,
            listingTitle: listingTitles[app.listingID] || app.listingID,
            applicant:    profiles[app.applicantID]    || {}
        })));
    } catch (error) {
        console.error("Get applicants error:", error);
        res.status(500).json({ error: "Failed to fetch applicants" });
    }
});

// =============================================================================
// US-07 — LISTING MODERATION (Admin only)
// =============================================================================

app.get("/api/admin/listings/pending", verifyToken, adminOnly, async (req, res) => {
    try {
        const snapshot = await db.collection("Opportunities")
            .where("status", "==", "pending-review")
            .get();
        const listings = [];
        snapshot.forEach(doc => {
            const d = doc.data();
            listings.push({
                id:         doc.id,
                title:      d.title      || "Untitled",
                company:    d.company    || "Unknown",
                type:       d.type       || "-",
                location:   d.location   || "-",
                stipend:    d.stipend    ?? null,
                providerID: d.providerID || null,
                createdAt:  d.createdAt  || null,
                status:     d.status
            });
        });
        res.json(listings);
    } catch (error) {
        console.error("Pending listings error:", error);
        res.status(500).json({ error: "Failed to fetch pending listings" });
    }
});

app.get("/api/admin/listings", verifyToken, adminOnly, async (req, res) => {
    try {
        const snapshot = await db.collection("Opportunities").get();
        const listings = [];
        snapshot.forEach(doc => {
            const d = doc.data();
            listings.push({
                id:         doc.id,
                title:      d.title      || "Untitled",
                company:    d.company    || "Unknown",
                type:       d.type       || "-",
                location:   d.location   || "-",
                stipend:    d.stipend    ?? null,
                providerID: d.providerID || null,
                createdAt:  d.createdAt  || null,
                status:     d.status     || "unknown"
            });
        });
        res.json(listings);
    } catch (error) {
        console.error("Admin listings error:", error);
        res.status(500).json({ error: "Failed to fetch listings" });
    }
});

app.patch("/api/admin/listings/:id/approve", verifyToken, adminOnly, async (req, res) => {
    try {
        const listingRef = db.collection("Opportunities").doc(req.params.id);
        const listingDoc = await listingRef.get();
        if (!listingDoc.exists) return res.status(404).json({ error: "Listing not found" });

        await listingRef.update({ status: "approved", updatedAt: new Date().toISOString() });
        res.json({ message: "Listing approved", id: req.params.id });

        const d          = listingDoc.data();
        const providerID = d.providerID;
        if (providerID) {
            const providerDoc = await db.collection("users").doc(providerID).get();
            if (providerDoc.exists) {
                const { email, organization, firstname } = providerDoc.data();
                const name  = organization || firstname || "Provider";
                const title = d.title || "your listing";
                await db.collection("notifications").add({
                    recipientId: providerID,
                    message:     `Your listing "${title}" has been approved.`,
                    status:      "unread",
                    timestamp:   admin.firestore.FieldValue.serverTimestamp(),
                    listingId:   req.params.id
                });
                await sendMail(email,
                    `Your listing "${title}" has been approved`,
                    `<p>Hi ${name},</p><p>Your listing <strong>${title}</strong> has been <strong>approved</strong> and is now visible to applicants.</p>`
                );
            }
        }
    } catch (error) {
        console.error("Approve listing error:", error);
        res.status(500).json({ error: "Failed to approve listing" });
    }
});

app.patch("/api/admin/listings/:id/remove", verifyToken, adminOnly, async (req, res) => {
    try {
        const { reason } = req.body;
        const listingRef = db.collection("Opportunities").doc(req.params.id);
        const listingDoc = await listingRef.get();
        if (!listingDoc.exists) return res.status(404).json({ error: "Listing not found" });

        await listingRef.update({
            status:        "removed",
            removalReason: reason || null,
            updatedAt:     new Date().toISOString()
        });
        res.json({ message: "Listing removed", id: req.params.id });

        const d          = listingDoc.data();
        const providerID = d.providerID;
        if (providerID) {
            const providerDoc = await db.collection("users").doc(providerID).get();
            if (providerDoc.exists) {
                const { email, organization, firstname } = providerDoc.data();
                const name  = organization || firstname || "Provider";
                const title = d.title || "your listing";
                await db.collection("notifications").add({
                    recipientId: providerID,
                    message:     `Your listing "${title}" has been removed.`,
                    status:      "unread",
                    timestamp:   admin.firestore.FieldValue.serverTimestamp(),
                    listingId:   req.params.id
                });
                await sendMail(email,
                    `Your listing "${title}" has been removed`,
                    `<p>Hi ${name},</p><p>Your listing <strong>${title}</strong> has been <strong>removed</strong>.${reason ? ` Reason: ${reason}` : ""}</p>`
                );
            }
        }
    } catch (error) {
        console.error("Remove listing error:", error);
        res.status(500).json({ error: "Failed to remove listing" });
    }
});

// =============================================================================
// US-08 — USER ACCOUNT MANAGEMENT (Admin only)
// =============================================================================

app.get("/api/admin/users", verifyToken, adminOnly, async (req, res) => {
    try {
        const { role, page = 1, limit = 20 } = req.query;
        const pageNum  = Math.max(1, parseInt(page)  || 1);
        const pageSize = Math.min(100, parseInt(limit) || 20);

        let query = db.collection("users");
        if (role && ["applicant", "provider", "admin"].includes(role)) {
            query = query.where("role", "==", role);
        }

        const snapshot = await query.get();
        const allUsers = [];
        snapshot.forEach(doc => {
            const d = doc.data();
            allUsers.push({
                uid:          doc.id,
                firstname:    d.firstname    || null,
                lastname:     d.lastname     || null,
                organization: d.organization || null,
                email:        d.email        || null,
                username:     d.username     || null,
                role:         d.role         || null,
                status:       d.status       || "active",
                createdAt:    d.createdAt    || null
            });
        });

        allUsers.sort((a, b) => {
            if (!a.createdAt) return  1;
            if (!b.createdAt) return -1;
            return new Date(b.createdAt) - new Date(a.createdAt);
        });

        const total = allUsers.length;
        const paged = allUsers.slice((pageNum - 1) * pageSize, pageNum * pageSize);
        res.json({
            users: paged,
            pagination: { total, page: pageNum, limit: pageSize, totalPages: Math.ceil(total / pageSize) }
        });
    } catch (error) {
        console.error("Admin users error:", error);
        res.status(500).json({ error: "Failed to fetch users" });
    }
});

app.patch("/api/admin/users/:uid/suspend", verifyToken, adminOnly, async (req, res) => {
    try {
        const { uid } = req.params;
        if (uid === req.user.uid) {
            return res.status(400).json({ error: "Admins cannot suspend their own account" });
        }
        const userDoc = await db.collection("users").doc(uid).get();
        if (!userDoc.exists) return res.status(404).json({ error: "User not found" });

        const userData = userDoc.data();
        await admin.auth().updateUser(uid, { disabled: true });
        await db.collection("users").doc(uid).update({
            status:      "suspended",
            suspendedAt: new Date().toISOString(),
            updatedAt:   new Date().toISOString()
        });
        res.json({ message: "User suspended", uid });

        const name = userData.firstname || userData.organization || "User";
        await sendMail(userData.email,
            "Your SkillsConnect account has been suspended",
            `<p>Hi ${name},</p>
             <p>Your SkillsConnect account has been <strong>suspended</strong> by an administrator.</p>
             <p>If you believe this is a mistake, please contact support at
                <a href="mailto:${process.env.EMAIL_USER}">${process.env.EMAIL_USER}</a>.</p>`
        );
    } catch (error) {
        console.error("Suspend error:", error);
        res.status(500).json({ error: "Failed to suspend user" });
    }
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

app.use('/', require('./routes/auth'));
app.use('/', require('./routes/pages'));
app.use('/', require('./routes/nqf'));
app.use('/', require('./routes/opportunities'));
app.use('/', require('./routes/applications'));
app.use('/', require('./routes/provider'));
app.use('/api/admin', require('./routes/admin'));

// =============================================================================
// EXPORT
// =============================================================================
module.exports = app;

if (process.env.NODE_ENV !== "test") {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
}
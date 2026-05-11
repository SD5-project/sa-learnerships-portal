const express = require('express');
const path = require('path');
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.json());
// Transport Configuration
require('dotenv').config();
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: 587,                   
    secure: false,               // Must be false for port 587
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS 
    },
    tls: {
        rejectUnauthorized: false // This helps avoid connection issues on some networks
    }
});

//Verify connection on startup
transporter.verify((error, success) => {
    if (error) {
        console.error("❌ Email Transporter Error:", error);
    } else {
        console.log("🚀 Email Server is ready to take our messages");
    }
});

// Serve frontend static files
app.use(express.static(path.join(__dirname, '..', 'frontend')));

const { verifyToken } = require("./auth");
const { db, admin } = require("./firebaseAdmin");
const { authorize } = require('./access-logic');

// ─── Guard Middleware ────────────────────────────────────────────────────────
function guard(route) {
    return (req, res, next) => {
        const user = req.user;
        if (user && authorize(user, route)) {
            next();
        } else {
            res.status(403).send("Forbidden: You do not have access to this route.");
        }
    };
}

// ─── Static Page Routes ──────────────────────────────────────────────────────
app.get(['/signup', '/signup.html'], (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'frontend', 'signup.html'));
});

app.get('/create-opportunity', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'frontend', 'create-opportunity.html'));
});

app.get('/applicant-home', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'frontend', 'applicant-home.html'));
});

app.get('/applications-page', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'frontend', 'applications-page.html'));
});

app.get('/applicants', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'frontend', 'applicants.html'));
});

// Serve login page at root
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'frontend', 'index.html'));
});
// ─── Protected Routes ────────────────────────────────────────────────────────
// ✅ Just serve the pages — token is verified client-side
app.get('/applicant-home', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'frontend', 'applicant-home.html'));
});

app.get('/admin-dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'frontend', 'admin-dashboard.html'));
});

app.get('/provider-home', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'frontend', 'provider-home.html'));
});

app.get('/listings', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'frontend', 'listings.html'));
});

// ─── NQF Levels ──────────────────────────────────────────────────────────────
app.get('/nqf-levels', (req, res) => {
    res.json({
        levels: [
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
        ]
    });
});

// ─── Applicant Signup ────────────────────────────────────────────────────────
app.post("/signup/applicant", async (req, res) => {
    const { uid, firstname, lastname, email, username, institution, city, phonenumber, cv } = req.body;

    if (!email) return res.status(400).json({ error: "Email is required" });

    try {
        await admin.auth().setCustomUserClaims(uid, { role: "applicant" });

        await db.collection("users").doc(uid).set({
            firstname,
            lastname,
            email,
            username,
            institution,
            city,
            phonenumber,
            cv,
            role: "applicant",
            createdAt: new Date().toISOString()
        });

        res.status(201).json({ message: "Applicant created successfully" });

    } catch (error) {
        console.error("Signup Error:", error.message);
        res.status(500).json({ error: "Failed to create applicant" });
    }
});

// ─── Provider Signup ─────────────────────────────────────────────────────────
app.post("/signup/provider", async (req, res) => {
    console.log("📥 Received signup request:", req.body);
    const { uid, organization, email, city, phonenumber, username } = req.body;

    if (!email) return res.status(400).json({ error: "Email is required" });

    try {
        await admin.auth().setCustomUserClaims(uid, { role: "provider" });

        await db.collection("users").doc(uid).set({
            organization,
            email,
            city,
            phonenumber,
            username,
            role: "provider",
            createdAt: new Date().toISOString()
        });

        res.status(201).json({ message: "Provider created successfully" });

    } catch (error) {
        console.error("Signup Error:", error.message);
        res.status(500).json({ error: "Failed to create provider" });
    }
});

app.get("/nqf-levels", async (req, res) => {

// ─── Opportunity Routes ──────────────────────────────────────────────────────

// Submit Opportunity
app.post("/api/opportunities/submit", verifyToken, guard('/api/opportunities/submit'), async (req, res) => {
    try {
        const opportunityData = req.body;

        // ✅ IMPORTANT: Attach the UID of the provider creating this
        opportunityData.providerID = req.user.uid; 

        opportunityData.status = "pending-review";
        opportunityData.createdAt = new Date().toISOString();
        opportunityData.updatedAt = new Date().toISOString();

        const docRef = await db.collection("Opportunities").add(opportunityData);

        res.status(201).json({ 
            message: "Opportunity submitted successfully",
            id: docRef.id
        });
    } catch (error) {
        console.error("Error:", error);
        res.status(500).json({ error: "Failed to submit" });
    }
});


// ─── Listings ─────────────────────────────────────────────────────────
app.get('/api/listings', verifyToken, async (req, res) => {
    const isAuthorized = authorize(req.user, '/api/listings');

    if (!isAuthorized) {
        return res.status(403).json({ error: "Unauthorized" });
    }

    try {
        const snapshot = await db.collection('Opportunities').get();
        const opportunities = [];
        
        const snapshot = await db.collection("NQFLevels")
            .orderBy("level")
            .get();

        const levels = [];
        snapshot.forEach(doc => {
            levels.push(doc.data());
        });

        return res.status(200).json({ levels });

    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
});

    // ─── POST /validate-application ─────────────────
// Checks if applicant meets NQF requirements
app.post("/validate-application", async (req, res) => {
    const { userId, opportunityId } = req.body;

    if (!userId || !opportunityId) {
        return res.status(400).json({ 
            error: "userId and opportunityId are required." 
        });
    }

    try {
        // Get applicant's NQF level from Firestore
        const userDoc = await db.collection("users").doc(userId).get();

        if (!userDoc.exists) {
            return res.status(404).json({ 
                error: "Applicant not found." 
            });
        }

        const userData        = userDoc.data();
        const applicantNQF    = userData.highestNQFLevel;

        if (!applicantNQF) {
            return res.status(400).json({
                eligible: false,
                message:  "Please update your profile with your highest qualification before applying."
            });
        }

        // Get opportunity's minimum NQF level from Firestore
        const opportunityDoc = await db.collection("Opportunities")
            .doc(opportunityId)
            .get();

        if (!opportunityDoc.exists) {
            return res.status(404).json({ 
                error: "Opportunity not found." 
            });
        }

        const opportunityData = opportunityDoc.data();
        const minimumNQF      = opportunityData.minimumNQFLevel;

        // Compare NQF levels
        if (parseInt(applicantNQF) >= parseInt(minimumNQF)) {
            return res.status(200).json({
                eligible: true,
                message:  "You meet the requirements for this opportunity."
            });
        } else {
            return res.status(200).json({
                eligible: false,
                message:  `You do not meet the minimum qualification requirement. 
                           This opportunity requires NQF Level ${minimumNQF}. 
                           Your current level is NQF Level ${applicantNQF}.`
            });
        }

    } catch (error) {
        console.error("Provider listings error:", error);
        res.status(500).json({ error: "Failed to fetch provider listings" });
    }
});

// ─── Get Applicants for Provider ─────────────────────────────────────────────
app.get("/api/applicants", verifyToken, async (req, res) => {
    try {
        const providerID  = req.query.providerID || req.user.uid;
        const providerDoc = await db.collection("users").doc(providerID).get();
        const orgName     = providerDoc.exists ? providerDoc.data().organization : null;

        let listingIDs    = [];
        let listingTitles = {};
        let oppSnapshot;

        if (orgName) {
            oppSnapshot = await db.collection("Opportunities").where("company", "==", orgName).get();
        } else {
            oppSnapshot = await db.collection("Opportunities").where("providerID", "==", providerID).get();
        }

        oppSnapshot.forEach(doc => {
            listingIDs.push(doc.id);
            listingTitles[doc.id] = doc.data().title || "Untitled";
        });

        if (listingIDs.length === 0) return res.json([]);

        // Chunk into groups of 30 (Firestore "in" limit)
        const chunks = [];
        for (let i = 0; i < listingIDs.length; i += 30) chunks.push(listingIDs.slice(i, i + 30));

        let allApplications = [];
        for (const chunk of chunks) {
            const snap = await db.collection("applications").where("listingID", "in", chunk).get();
            snap.forEach(doc => allApplications.push({ id: doc.id, ...doc.data() }));
        }

        // Join applicant profiles
        const applicantUIDs = [...new Set(allApplications.map(a => a.applicantID))];
        const profiles = {};
        await Promise.all(applicantUIDs.map(async uid => {
            try {
                const d = await db.collection("users").doc(uid).get();
                profiles[uid] = d.exists ? d.data() : {};
            } catch { profiles[uid] = {}; }
        }));

        const enriched = allApplications.map(app => ({
            ...app,
            listingTitle: listingTitles[app.listingID] || app.listingID,
            applicant:    profiles[app.applicantID] || {}
        }));

        res.json(enriched);
    } catch (error) {
        console.error("Get applicants error:", error);
        res.status(500).json({ error: "Failed to fetch applicants" });
    }
});

// ─── Update Application Status ────────────────────────────────────────────────
app.patch("/api/applicants/:applicationID/status", verifyToken, async (req, res) => {
    try {
        const { applicationID } = req.params;
        const { status }        = req.body;

        // ── Validate status value ─────────────────────────────────────────────
        const valid = ["pending", "reviewing", "shortlisted", "accepted", "rejected"];
        if (!valid.includes(status)) return res.status(400).json({ error: "Invalid status" });

        // ── Applicants cannot update status ───────────────────────────────────
        if (req.user.role === "applicant") {
            return res.status(403).json({ error: "You are not authorized to update this application" });
        }

        // ── Fetch the application ─────────────────────────────────────────────
        const appDoc = await db.collection("applications").doc(applicationID).get();
        if (!appDoc.exists) return res.status(404).json({ error: "Application not found" });

        const appData       = appDoc.data();
        const currentStatus = appData.status;
        const listingID     = appData.listingID;

        // ── Must be shortlisted before accepting ──────────────────────────────
        if (status === "accepted" && currentStatus !== "shortlisted") {
            return res.status(400).json({ error: "Applicant must be shortlisted before accepting" });
        }

        // ── Provider must own the listing ─────────────────────────────────────
        const listingDoc = await db.collection("Opportunities").doc(listingID).get();
        if (!listingDoc.exists) return res.status(404).json({ error: "Listing not found" });

        if (req.user.role !== "admin" && listingDoc.data().providerID !== req.user.uid) {
            return res.status(403).json({ error: "You are not authorized to update this application" });
        }

        // ── Update status ─────────────────────────────────────────────────────
        await db.collection("applications").doc(applicationID).update({
            status,
            updatedAt: new Date().toISOString()
        });

        // ── Respond immediately — notifications happen after ──────────────────
        res.json({ message: "Status updated", applicationID, status });

        // ── In-app notification ───────────────────────────────────────────────
        const listingTitle = listingDoc.data().title || "Opportunity";
        await db.collection("notifications").add({
            recipientId:   appData.applicantID,
            message:       `Your application for "${listingTitle}" has been ${status}.`,
            status:        "unread",
            timestamp:     admin.firestore.FieldValue.serverTimestamp(),
            applicationId: applicationID
        });

        // ── Email notification (failure won't affect status update) ───────────
        try {
            const applicantDoc = await db.collection("users").doc(appData.applicantID).get();
            if (applicantDoc.exists) {
                const { email, firstname } = applicantDoc.data();
                await transporter.sendMail({
                    from:    `"SkillsConnect" <skillsconnectsupport@gmail.com>`,
                    to:      email,
                    subject: `Update: Application for ${listingTitle}`,
                    html: `
                        <p>Hi ${firstname || "Applicant"},</p>
                        <p>Your application for <strong>${listingTitle}</strong> has been updated.</p>
                        <p>New status: <strong>${status}</strong></p>
                        <p>Log in to your dashboard for more details.</p>
                    `
                });
                console.log("✅ Email sent to:", email);
            }
        } catch (emailError) {
            console.error("Email failed but status was updated:", emailError);
        }

    } catch (error) {
        console.error("Status update error:", error);
        res.status(500).json({ error: "Failed to update status" });
    }
});

// GET /api/applications?applicantID=
app.get("/api/applications", verifyToken, async (req, res) => {
    try {
        const applicantID = req.query.applicantID || req.user.uid;

        const snapshot = await db.collection("applications")
            .where("applicantID", "==", applicantID)
            .get({ source: "server" }); // ← force fresh read from Firestore


        const applications = [];
        snapshot.forEach(appDoc => {
            const data = appDoc.data();
            console.log("Doc ID:", appDoc.id, "Status:", data.status); // ← inside forEach
            applications.push({ id: appDoc.id, ...data });
        });
        

        res.json(applications);

    } catch (error) {
        console.error("Fetch applications error:", error);
        res.status(500).json({ error: "Failed to fetch applications" });
    }
});

// GET /api/opportunities/:id
app.get("/api/opportunities/:id", verifyToken, async (req, res) => {
    try {
         console.log("Looking for opportunity ID:", req.params.id); 
        const doc = await db.collection("Opportunities").doc(req.params.id).get();

        if (!doc.exists) return res.status(404).json({ error: "Opportunity not found" });

        res.json({ id: doc.id, ...doc.data() });

    } catch (error) {
        console.error("Fetch opportunity error:", error);
        res.status(500).json({ error: "Failed to fetch opportunity" });
    }
});

// ✅ Export for testing
module.exports = app;

// ✅ Only run server outside tests
if (process.env.NODE_ENV !== "test") {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
}
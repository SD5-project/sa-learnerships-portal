const express = require('express');
const path = require('path');
const cors = require("cors");
const app = express();
const { verifyToken } = require("./auth");
const { db, admin } = require("./firebaseAdmin");
const { authorize } = require('./access-logic');

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

app.get('/listing-info', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'frontend', 'listing-info.html'));
});

app.get('/create-opportunity', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'frontend', 'create-opportunity.html'));
});

app.get('/applicant-home', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'frontend', 'applicant-home.html'));
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
        
        snapshot.forEach(doc => {
            const data = doc.data();
            opportunities.push({ 
                id: doc.id, 
                title: data.title,
                description: data.description,
                price: data.stipend, 
                location: data.location,
                provider: data.company, 
                type: data.type
            });
        });

        res.status(200).json(opportunities);
        
    } catch (error) {
        console.error("Firestore Error:", error);
        res.status(500).json({ error: "Database error" });
    }
});



app.get("/applicant/hasApplied", async (req, res) => {
    const {applicantID, listingID} = req.query;
    try {
        const snapshot = await db.collection("applications")
            .where("applicantID", "==", applicantID)
            .where("listingID", "==", listingID)
            .get();
        res.json({ hasApplied: !snapshot.empty });
    } catch (error) {
        res.status(500).json({ error: "Failed to check application"})
    }
});

//Appicant apply
app.post("/applicant/apply", async(req,res) => {
    const { applicantID, listingID, status} = req.body;

    if(!applicantID || !listingID){
        return res.status(400).json({ error: "applicationID and listing ID are required"});
    }
   
    try {
        const userDoc = await db.collection("users").doc(applicantID).get();
        console.log("👤 User doc exists:", userDoc.exists); // ← add this
        console.log("👤 Looking for UID:", applicantID);
        if(!userDoc.exists){
            return res.status(400).json({ error: "User not found"});
        }

         // ── Validate listing exists ───────────────────────────────────────
        const listingDoc = await db.collection("Opportunities").doc(listingID).get();
        if (!listingDoc.exists) {
            return res.status(404).json({ error: "Listing not found" });
        }

          // ── Prevent duplicate applications ────────────────────────────────
        const docId = `${applicantID}_${listingID}`;
        const existingApp = await db.collection("applications").doc(docId).get();
        if (existingApp.exists) {
            return res.status(409).json({ error: "You have already applied to this listing" });
        }
         
         await db.collection("applications").doc(docId).set({
            applicantID,
            listingID,
            status,
            createdAt: new Date().toISOString()
        });
        res.status(201).json({ message: "Application submitted" });
    } catch (error) {
        console.error("Apply error:", error);
        res.status(500).json({ error: "Failed to submit application" });
    }

})
// ─── User Profile ─────────────────────────────────────────────────────────────
app.get("/api/user-profile", verifyToken, async (req, res) => {
    try {
        const uid     = req.query.uid || req.user.uid;
        const userDoc = await db.collection("users").doc(uid).get();
        if (!userDoc.exists) return res.status(404).json({ error: "User not found" });
        res.json(userDoc.data());
    } catch (error) {
        console.error("Profile fetch error:", error);
        res.status(500).json({ error: "Failed to fetch profile" });
    }
});

// ─── Role Lookup (Firestore fallback for login) ───────────────────────────────
app.get("/api/user-role", verifyToken, async (req, res) => {
    try {
        const uid     = req.query.uid || req.user.uid;
        const userDoc = await db.collection("users").doc(uid).get();
        if (!userDoc.exists) return res.status(404).json({ error: "User not found" });
        res.json({ role: userDoc.data().role || null });
    } catch (error) {
        console.error("Role lookup error:", error);
        res.status(500).json({ error: "Failed to look up role" });
    }
});

// ─── Backfill Custom Claim ────────────────────────────────────────────────────
app.post("/api/set-role-claim", verifyToken, async (req, res) => {
    try {
        const { uid, role } = req.body;
        if (!uid || !role) return res.status(400).json({ error: "uid and role are required" });
        const validRoles = ["applicant", "provider", "admin"];
        if (!validRoles.includes(role.toLowerCase())) return res.status(400).json({ error: "Invalid role" });
        await admin.auth().setCustomUserClaims(uid, { role: role.toLowerCase() });
        res.json({ message: "Custom claim set", role });
    } catch (error) {
        console.error("Set role claim error:", error);
        res.status(500).json({ error: "Failed to set custom claim" });
    }
});

// ─── Provider's listings (for applicants filter) ──────────────────────────────
app.get("/api/provider-listings", verifyToken, async (req, res) => {
    try {
        const providerID  = req.query.providerID || req.user.uid;
        const providerDoc = await db.collection("users").doc(providerID).get();
        const orgName     = providerDoc.exists ? providerDoc.data().organization : null;

        let snapshot;
        if (orgName) {
            snapshot = await db.collection("Opportunities").where("company", "==", orgName).get();
        } else {
            snapshot = await db.collection("Opportunities").where("providerID", "==", providerID).get();
        }

        const listings = [];
        snapshot.forEach(doc => listings.push({ id: doc.id, title: doc.data().title || "Untitled" }));
        res.json(listings);
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
        const { status } = req.body;
        const providerUid = req.user.uid; // From verifyToken middleware

        const valid = ["pending", "reviewing", "shortlisted", "accepted", "rejected"];
        if (!valid.includes(status)) return res.status(400).json({ error: "Invalid status" });

        // DATA ISOLATION (Requirement: Provider cannot modify listings they don't own)
        const appRef = db.collection("applications").doc(applicationID);
        const appDoc = await appRef.get();
        if (!appDoc.exists) return res.status(404).json({ error: "Application not found" });

        const appData = appDoc.data();
        const listingDoc = await db.collection("Opportunities").doc(appData.listingID).get();
        
        // Check if current user is the owner of this opportunity
        if (listingDoc.data().providerID !== providerUid) {
            return res.status(403).json({ error: "Forbidden: You do not own this listing." });
        }

        // INTEGRITY (Requirement: Status transition must be atomic)
        await appRef.update({
            status,
            updatedAt: new Date().toISOString()
        });

        // NOTIFICATION (Requirement: Create in-app notification)
        const listingTitle = listingDoc.data().title || "Opportunity";
        await db.collection("notifications").add({
            recipientId: appData.applicantID,
            message: `Your application for "${listingTitle}" has been ${status}.`,
            status: "unread",
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            applicationId: applicationID
        });

        // EMAIL (Requirement: Catch failure without breaking status update)
        try {
            // Get Applicant details
            const applicantDoc = await db.collection("users").doc(appData.applicantID).get();
            if (applicantDoc.exists) {
                const { email, firstname } = applicantDoc.data();
                
                // Send the Email
                await transporter.sendMail({
                    from: `"SkillsConnect" <skillsconnectsupport@gmail.com>`,
                    to: email,
                    subject: `Update: Application for ${listingDoc.data().title}`,
                    html: `
                        <p>Hi ${firstname || 'Applicant'},</p>
                        <p>Your application for <strong>${listingDoc.data().title}</strong> has been updated.</p>
                        <p>New Status: <strong>${status}</strong></p>
                        <p>Log in to your dashboard for more details.</p>
                    `
                });
                console.log("Email sent successfully to:", email);
            }
        } catch (error) {
            console.error("Email failed but status was updated:", error);
        }

        res.json({ message: "Status updated and applicant notified", status });
    } catch (error) {
        console.error("Status update error:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

// ✅ Export for testing
module.exports = app;

// ✅ Only run server outside tests
if (process.env.NODE_ENV !== "test") {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
}); 
}
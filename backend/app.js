const express = require('express');
const path    = require('path');
const cors    = require("cors");

const app = express();

// ─── Reminder Job ────────────────────────────────
if (process.env.NODE_ENV !== "test") {
    require("./reminderJob");
}

app.use(cors());
app.use(express.json());

// Serve frontend static files
app.use(express.static(path.join(__dirname, '..', 'frontend')));

const { verifyToken } = require("./auth");
const { db, admin }   = require("./firebaseAdmin");
const { authorize }   = require('./access-logic');

// ─── Guard Middleware ────────────────────────────
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

// ─── Static Page Routes ──────────────────────────
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

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'frontend', 'index.html'));
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

// ─── NQF Levels — fetched from Firestore (SAQA) ──
app.get('/nqf-levels', async (req, res) => {
    try {
        const snapshot = await db.collection("NQFLevels")
            .orderBy("level")
            .get();

        const levels = [];
        snapshot.forEach(doc => {
            levels.push(doc.data());
        });

        res.json({ levels });

    } catch (error) {
        console.error("NQF fetch error:", error.message);
        res.status(500).json({ error: "Failed to fetch NQF levels" });
    }
});

// ─── Applicant Signup ─────────────────────────────
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
            role:      "applicant",
            createdAt: new Date().toISOString()
        });

        res.status(201).json({ message: "Applicant created successfully" });

    } catch (error) {
        console.error("Signup Error:", error.message);
        res.status(500).json({ error: "Failed to create applicant" });
    }
});

// ─── Provider Signup ──────────────────────────────
app.post("/signup/provider", async (req, res) => {
    console.log("Received signup request:", req.body);
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
            role:      "provider",
            createdAt: new Date().toISOString()
        });

        res.status(201).json({ message: "Provider created successfully" });

    } catch (error) {
        console.error("Signup Error:", error.message);
        res.status(500).json({ error: "Failed to create provider" });
    }
});

// ─── Submit Opportunity ───────────────────────────
app.post("/api/opportunities/submit", verifyToken, guard('/api/opportunities/submit'), async (req, res) => {
    try {
        const opportunityData = req.body;
        opportunityData.status    = "pending-review";
        opportunityData.createdAt = new Date().toISOString();
        opportunityData.updatedAt = new Date().toISOString();

        const docRef = await db.collection("Opportunities").add(opportunityData);

        res.status(201).json({ 
            message: "Opportunity submitted successfully",
            id:      docRef.id
        });

    } catch (error) {
        console.error("Error submitting opportunity:", error);
        res.status(500).json({ error: "Failed to submit opportunity" });
    }
});

// ─── Listings ─────────────────────────────────────
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
                id:          doc.id, 
                title:       data.title,
                description: data.description,
                price:       data.stipend, 
                location:    data.location,
                provider:    data.company, 
                type:        data.type
            });
        });

        res.status(200).json(opportunities);
        
    } catch (error) {
        console.error("Firestore Error:", error);
        res.status(500).json({ error: "Database error" });
    }
});

// ─── Check if Applicant Applied ───────────────────
app.get("/applicant/hasApplied", async (req, res) => {
    const { applicantID, listingID } = req.query;
    try {
        const snapshot = await db.collection("applications")
            .where("applicantID", "==", applicantID)
            .where("listingID",   "==", listingID)
            .get();
        res.json({ hasApplied: !snapshot.empty });
    } catch (error) {
        res.status(500).json({ error: "Failed to check application" });
    }
});

// ─── Applicant Apply ──────────────────────────────
app.post("/applicant/apply", async (req, res) => {
    const { applicantID, listingID, status } = req.body;

    if (!applicantID || !listingID) {
        return res.status(400).json({ error: "applicantID and listingID are required" });
    }
   
    try {
        const userDoc = await db.collection("users").doc(applicantID).get();
        if (!userDoc.exists) {
            return res.status(400).json({ error: "User not found" });
        }

        const listingDoc = await db.collection("Opportunities").doc(listingID).get();
        if (!listingDoc.exists) {
            return res.status(404).json({ error: "Listing not found" });
        }

        const docId       = `${applicantID}_${listingID}`;
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
});

// ─── NQF Validation ───────────────────────────────
app.post("/validate-application", async (req, res) => {
    const { userId, opportunityId } = req.body;

    if (!userId || !opportunityId) {
        return res.status(400).json({ error: "userId and opportunityId are required." });
    }

    try {
        const userDoc = await db.collection("users").doc(userId).get();

        if (!userDoc.exists) {
            return res.status(404).json({ error: "Applicant not found." });
        }

        const userData     = userDoc.data();
        const applicantNQF = userData.highestNQFLevel;

        if (!applicantNQF) {
            return res.status(400).json({
                eligible: false,
                message:  "Please update your profile with your highest qualification before applying."
            });
        }

        const opportunityDoc = await db.collection("Opportunities").doc(opportunityId).get();

        if (!opportunityDoc.exists) {
            return res.status(404).json({ error: "Opportunity not found." });
        }

        const minimumNQF = opportunityDoc.data().minimumNQFLevel;

        if (parseInt(applicantNQF) >= parseInt(minimumNQF)) {
            return res.status(200).json({
                eligible: true,
                message:  "You meet the requirements for this opportunity."
            });
        } else {
            return res.status(200).json({
                eligible: false,
                message:  `You do not meet the minimum qualification requirement. This opportunity requires NQF Level ${minimumNQF}. Your current level is NQF Level ${applicantNQF}.`
            });
        }

    } catch (error) {
        console.error("Validation error:", error.message);
        return res.status(500).json({ error: "Validation failed." });
    }
});

// ─── User Profile ─────────────────────────────────
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

// ─── Role Lookup ──────────────────────────────────
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

// ─── Backfill Custom Claim ────────────────────────
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

// ─── Provider Listings ────────────────────────────
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

// ─── Get Applicants for Provider ──────────────────
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

        const chunks = [];
        for (let i = 0; i < listingIDs.length; i += 30) chunks.push(listingIDs.slice(i, i + 30));

        let allApplications = [];
        for (const chunk of chunks) {
            const snap = await db.collection("applications").where("listingID", "in", chunk).get();
            snap.forEach(doc => allApplications.push({ id: doc.id, ...doc.data() }));
        }

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
            applicant:    profiles[app.applicantID]    || {}
        }));

        res.json(enriched);
    } catch (error) {
        console.error("Get applicants error:", error);
        res.status(500).json({ error: "Failed to fetch applicants" });
    }
});

// ─── Update Application Status ────────────────────
app.patch("/api/applicants/:applicationID/status", verifyToken, async (req, res) => {
    try {
        const { applicationID } = req.params;
        const { status }        = req.body;
        const valid = ["pending", "reviewing", "shortlisted", "accepted", "rejected"];
        if (!valid.includes(status)) return res.status(400).json({ error: "Invalid status" });

        await db.collection("applications").doc(applicationID).update({
            status,
            updatedAt: new Date().toISOString()
        });
        res.json({ message: "Status updated", applicationID, status });
    } catch (error) {
        console.error("Status update error:", error);
        res.status(500).json({ error: "Failed to update status" });
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
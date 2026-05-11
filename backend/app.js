const express = require('express');
const path = require('path');
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.json());

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

        // Set mandatory metadata
        opportunityData.status = "pending-review";
        opportunityData.createdAt = new Date().toISOString();
        opportunityData.updatedAt = new Date().toISOString();

        // Save directly to the "Opportunities" collection in Firestore
        const docRef = await db.collection("Opportunities").add(opportunityData);

        res.status(201).json({ 
            message: "Opportunity submitted successfully",
            id: docRef.id
        });

    } catch (error) {
        console.error("Error submitting opportunity:", error);
        res.status(500).json({ error: "Failed to submit opportunity" });
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
        console.error("Validation error:", error.message);
        return res.status(500).json({ error: "Validation failed." });
    }
});

// ✅ Export for testing
module.exports = app;

// ✅ Only run server outside tests
if (process.env.NODE_ENV !== "test") {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
}
const express         = require('express');
const { db, admin }   = require('../firebaseAdmin');
const { verifyToken } = require('../auth');
const { guard }       = require('../helpers');
const { authorize }   = require('../access-logic');
const { applicantRef } = require('../userPaths');

const router = express.Router();

// ─── Submit Opportunity (providers and admins only) ───────────────────────────
router.post("/api/opportunities/submit", verifyToken, guard('/create-opportunity'), async (req, res) => {
    try {
        const { type, verificationStatus, saqaId } = req.body;

        // Duplicate check (skip internships with no saqaId)
        if (saqaId) {
            const dupSnap = await db.collection("Opportunities")
                .where("providerID", "==", req.user.uid)
                .where("saqaId",     "==", saqaId)
                .get();
            const activeDup = dupSnap.docs.find(doc => doc.data().status !== "rejected_review");
            if (activeDup) {
                return res.status(409).json({ error: "You already have an active listing for this qualification." });
            }
        }

        // Determine status
        let status;
        if (type === "internship") {
            status = "in_for_review";
        } else if (verificationStatus === "verified") {
            status = "auto_approved";
        } else {
            status = "in_for_review";
        }

        const opportunityData = {
            ...req.body,
            providerID: req.user.uid,
            status,
            createdAt:  new Date().toISOString(),
            updatedAt:  new Date().toISOString()
        };
        const docRef = await db.collection("Opportunities").add(opportunityData);
        res.status(201).json({ message: "Opportunity submitted successfully", id: docRef.id, status });
    } catch (error) {
        console.error("Submit opportunity error:", error);
        res.status(500).json({ error: "Failed to submit opportunity" });
    }
});

// ─── Browse Listings (approved only) ─────────────────────────────────────────
router.get('/api/listings', verifyToken, async (req, res) => {
    if (!authorize(req.user, '/api/listings')) {
        return res.status(403).json({ error: "Unauthorized" });
    }
    try {
        const [snap1, snap2] = await Promise.all([
            db.collection('Opportunities').where('status', '==', 'auto_approved').get(),
            db.collection('Opportunities').where('status', '==', 'review_accepted').get()
        ]);
        const allDocs = [...snap1.docs, ...snap2.docs];
        const snapshot = { forEach: (fn) => allDocs.forEach(fn) };
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

// ─── Single Opportunity ───────────────────────────────────────────────────────
router.get("/api/opportunities/:id", verifyToken, async (req, res) => {
    try {
        const doc = await db.collection("Opportunities").doc(req.params.id).get();
        if (!doc.exists) return res.status(404).json({ error: "Opportunity not found" });
        res.json({ id: doc.id, ...doc.data() });
    } catch (error) {
        console.error("Fetch opportunity error:", error);
        res.status(500).json({ error: "Failed to fetch opportunity" });
    }
});

// ─── NQF Eligibility Validation ───────────────────────────────────────────────
router.post("/validate-application", async (req, res) => {
    const { userId, opportunityId } = req.body;
    if (!userId || !opportunityId) {
        return res.status(400).json({ error: "userId and opportunityId are required." });
    }
    try {
        const userDoc = await applicantRef(userId).get();
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

module.exports = router;

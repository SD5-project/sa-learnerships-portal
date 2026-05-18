/**
 * routes/opportunities.js
 * Manages SETA-accredited learnership, apprenticeship and internship listings.
 *
 * Opportunity status lifecycle:
 *   auto_approved   - Learnership/apprenticeship with verified SETA accreditation; goes live immediately.
 *   in_for_review   - All internships, or unverified learnerships; requires admin review.
 *   review_accepted - Admin approved an in_for_review listing; goes live.
 *   rejected_review - Admin rejected the listing; provider can resubmit if resolved.
 *
 * Routes:
 *   POST /api/opportunities/submit       - Submit a new opportunity listing
 *   GET  /api/listings                   - Browse live listings (auto_approved + review_accepted)
 *   GET  /api/opportunities/:id          - Fetch a single opportunity by ID
 *   POST /validate-application           - Check NQF eligibility for an applicant
 */

const express          = require('express');
const { db, admin }    = require('../firebaseAdmin');
const { verifyToken }  = require('../auth');
const { guard }        = require('../helpers');
const { authorize }    = require('../access-logic');
const { applicantRef } = require('../userPaths');

const router = express.Router();

/**
 * POST /api/opportunities/submit
 * Submits a new opportunity listing. Accessible to providers and admins only.
 *
 * Status assignment logic:
 *   - Internships always go to "in_for_review" (no SETA accreditation required).
 *   - Learnerships/apprenticeships with verified accreditation → "auto_approved" (live immediately).
 *   - Learnerships/apprenticeships without verified accreditation → "in_for_review" (admin review).
 *
 * Duplicate prevention: if the same provider already has an active listing for
 * the same SAQA qualification ID, the submission is rejected with 409.
 *
 * Body: { type, verificationStatus, saqaId, title, description, ... }
 * Response: { message, id, status }
 */
router.post("/api/opportunities/submit", verifyToken, guard('/create-opportunity'), async (req, res) => {
    try {
        const { type, verificationStatus, saqaId } = req.body;

        // Duplicate check — only applies to listings that have a SAQA qualification ID.
        // Internships may not have one, so they are skipped.
        if (saqaId) {
            const dupSnap = await db.collection("Opportunities")
                .where("providerID", "==", req.user.uid)
                .where("saqaId",     "==", saqaId)
                .get();
            // A rejected listing is not considered active, so resubmission is allowed
            const activeDup = dupSnap.docs.find(doc => doc.data().status !== "rejected_review");
            if (activeDup) {
                return res.status(409).json({ error: "You already have an active listing for this qualification." });
            }
        }

        // Determine the initial status based on opportunity type and accreditation result
        let status;
        if (type === "internship") {
            status = "in_for_review";               // Internships always need admin review
        } else if (verificationStatus === "verified") {
            status = "auto_approved";               // Verified accreditation — goes live immediately
        } else {
            status = "in_for_review";               // Unverified — pending admin review
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

/**
 * GET /api/listings
 * Returns all live opportunity listings visible to applicants.
 * "Live" means status is either "auto_approved" or "review_accepted".
 * Two parallel Firestore queries are used because Firestore does not support
 * "in" combined with other inequality filters without a composite index.
 *
 * Response: [{ id, title, description, price, location, provider, type }]
 */
router.get('/api/listings', verifyToken, async (req, res) => {
    if (!authorize(req.user, '/api/listings')) {
        return res.status(403).json({ error: "Unauthorized" });
    }
    try {
        const [snap1, snap2] = await Promise.all([
            db.collection('Opportunities').where('status', '==', 'auto_approved').get(),
            db.collection('Opportunities').where('status', '==', 'review_accepted').get()
        ]);
        // Merge both result sets into a single iterable snapshot
        const snapshot = { forEach: (fn) => { snap1.forEach(fn); snap2.forEach(fn); } };
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

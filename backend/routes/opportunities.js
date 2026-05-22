/**
 * routes/opportunities.js
 * Manages SETA-accredited learnership, apprenticeship and internship listings.
 *
 * Status lifecycle:
 *   auto_approved   — Learnership/apprenticeship with verified SETA accreditation; live immediately.
 *   in_for_review   — Internships or unverified learnerships; requires admin review.
 *   review_accepted — Admin approved an in_for_review listing; goes live.
 *   rejected_review — Admin rejected the listing; provider can resubmit.
 *
 * Routes:
 *   POST /api/opportunities/submit   — Submit a new listing
 *   GET  /api/listings               — Browse live listings
 *   GET  /api/opportunities/:id      — Single listing by ID
 *   POST /validate-application       — Check NQF eligibility
 */

const express          = require('express');
const { db, admin }    = require('../firebaseAdmin');
const { verifyToken }  = require('../auth');
const { guard }        = require('../helpers');
const { authorize }    = require('../access-logic');
const { applicantRef, lookupUser } = require('../userPaths');

const router = express.Router();

// ── Submit opportunity ────────────────────────────────────────────────────────
router.post("/api/opportunities/submit", verifyToken, guard('/create-opportunity'), async (req, res) => {
    try {
        const { type, verificationStatus, saqaId } = req.body;

        // Duplicate check — only for listings with a SAQA ID
        if (saqaId) {
            const dupSnap = await db.collection("Opportunities")
                .where("providerID", "==", req.user.uid)
                .where("saqaId",     "==", saqaId)
                .get();
            const activeDup = dupSnap.docs.find(doc =>
                !["rejected_review", "removed"].includes(doc.data().status)
            );
            if (activeDup) {
                return res.status(409).json({ error: "You already have an active listing for this qualification." });
            }
        }

        // Determine initial status
        let status;
        if (type === "internship") {
            status = "in_for_review";
        } else if (verificationStatus === "verified") {
            status = "auto_approved";
        } else {
            status = "in_for_review";
        }

        // Resolve provider's organisation name as 'company' if not already in body.
        // This ensures listings always display the correct company name.
        let company = req.body.company || null;
        if (!company) {
            try {
                const { snap } = await lookupUser(req.user.uid);
                if (snap && snap.exists) {
                    const pd = snap.data();
                    company = pd.organization || pd.firstname || pd.name || null;
                }
                if (!company) {
                    const topSnap = await db.collection("Providers").doc(req.user.uid).get();
                    if (topSnap.exists) {
                        const pd = topSnap.data();
                        company = pd.organization || pd.firstname || pd.name || null;
                    }
                }
            } catch (e) {
                console.warn("Could not resolve provider company name:", e.message);
            }
        }

        const opportunityData = {
            ...req.body,
            company:    company || "",
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

// ── Browse live listings ──────────────────────────────────────────────────────
// Returns all listings with status auto_approved, review_accepted, OR the legacy
// "approved" value so existing data is never lost.
router.get('/api/listings', verifyToken, async (req, res) => {
    if (!authorize(req.user, '/api/listings')) {
        return res.status(403).json({ error: "Unauthorized" });
    }
    try {
        const [snap1, snap2, snap3] = await Promise.all([
            db.collection('Opportunities').where('status', '==', 'auto_approved').get(),
            db.collection('Opportunities').where('status', '==', 'review_accepted').get(),
            db.collection('Opportunities').where('status', '==', 'approved').get()
        ]);

        const seen = new Set();
        const opportunities = [];
        [snap1, snap2, snap3].forEach(snap => {
            snap.forEach(doc => {
                if (seen.has(doc.id)) return;
                seen.add(doc.id);
                const d = doc.data();
                opportunities.push({
                    id:          doc.id,
                    title:       d.title       || "Untitled",
                    description: d.description || "",
                    price:       d.stipend     ?? null,
                    location:    d.location    || "-",
                    provider:    d.company     || "-",
                    type:        d.type        || "-"
                });
            });
        });

        res.status(200).json(opportunities);
    } catch (error) {
        console.error("Listings error:", error);
        res.status(500).json({ error: "Database error" });
    }
});

// ── Single opportunity ────────────────────────────────────────────────────────
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

// ── NQF eligibility validation ────────────────────────────────────────────────
router.post("/validate-application", async (req, res) => {
    const { userId, opportunityId } = req.body;
    if (!userId || !opportunityId) {
        return res.status(400).json({ error: "userId and opportunityId are required." });
    }
    try {
        const userDoc = await applicantRef(userId).get();
        if (!userDoc.exists) return res.status(404).json({ error: "Applicant not found." });

        const data = userDoc.data();
        const applicantNQF = parseInt(data.highestNQFLevel || data.nqfLevel || "0", 10);
        if (!applicantNQF) {
            return res.status(400).json({
                eligible: false,
                message:  "Please update your profile with your highest qualification before applying."
            });
        }

        const oppDoc = await db.collection("Opportunities").doc(opportunityId).get();
        if (!oppDoc.exists) return res.status(404).json({ error: "Opportunity not found." });

        const minimumNQF = parseInt(oppDoc.data().minimumNQFLevel || oppDoc.data().nqfLevel || "1", 10);

        if (applicantNQF >= minimumNQF) {
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
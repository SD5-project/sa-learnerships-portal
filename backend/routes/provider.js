/**
 * routes/provider.js
 * Routes used by providers to manage their listings and view applicants.
 *
 * Routes:
 *   GET /api/provider-listings  - All opportunity listings created by this provider
 *   GET /api/applicants         - All applicants across the provider's listings, with profiles
 */

const express          = require('express');
const { db, admin }    = require('../firebaseAdmin');
const { verifyToken }  = require('../auth');
const { applicantRef } = require('../userPaths');

const router = express.Router();

/**
 * GET /api/provider-listings?providerID=
 * Returns a list of all opportunities posted by the authenticated provider.
 * Falls back to the token's uid if no providerID query param is supplied.
 *
 * Response: [{ id, title }]
 */
router.get("/api/provider-listings", verifyToken, async (req, res) => {
    try {
        const providerID = req.query.providerID || req.user.uid;
        const snapshot   = await db.collection("Opportunities")
            .where("providerID", "==", providerID)
            .get();
        const listings = [];
        snapshot.forEach(doc => listings.push({ id: doc.id, title: doc.data().title || "Untitled" }));
        res.json(listings);
    } catch (error) {
        console.error("Provider listings error:", error);
        res.status(500).json({ error: "Failed to fetch provider listings" });
    }
});

/**
 * GET /api/applicants?providerID=
 * Returns all applications for every listing owned by the provider, enriched
 * with the applicant's profile data.
 *
 * Firestore's "in" operator is limited to 30 values, so listing IDs are
 * chunked into batches of 30 and queried separately.
 *
 * Response: [{ ...application, listingTitle, applicant: { ...profile } }]
 */
router.get("/api/applicants", verifyToken, async (req, res) => {
    try {
        const providerID = req.query.providerID || req.user.uid;

        // Step 1: Collect all listing IDs owned by this provider
        let listingIDs    = [];
        let listingTitles = {};
        const oppSnapshot = await db.collection("Opportunities")
            .where("providerID", "==", providerID)
            .get();

        oppSnapshot.forEach(doc => {
            listingIDs.push(doc.id);
            listingTitles[doc.id] = doc.data().title || "Untitled";
        });

        if (listingIDs.length === 0) return res.json([]);

        // Step 2: Fetch all applications for those listings in chunks of 30
        const chunks = [];
        for (let i = 0; i < listingIDs.length; i += 30) {
            chunks.push(listingIDs.slice(i, i + 30));
        }

        let allApplications = [];
        for (const chunk of chunks) {
            const snap = await db.collection("applications")
                .where("listingID", "in", chunk)
                .get();
            snap.forEach(doc => allApplications.push({ id: doc.id, ...doc.data() }));
        }

        // Step 3: Fetch all unique applicant profiles in parallel
        const applicantUIDs = [...new Set(allApplications.map(a => a.applicantID))];
        const profiles      = {};
        await Promise.all(applicantUIDs.map(async uid => {
            try {
                const d = await applicantRef(uid).get();
                profiles[uid] = d.exists ? d.data() : {};
            } catch {
                profiles[uid] = {};
            }
        }));

        // Step 4: Merge application data with listing title and applicant profile
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

module.exports = router;

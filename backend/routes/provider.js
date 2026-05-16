const express         = require('express');
const { db, admin }   = require('../firebaseAdmin');
const { verifyToken } = require('../auth');
const { providerRef, applicantRef } = require('../userPaths');

const router = express.Router();

// ─── Provider's Own Listings ──────────────────────────────────────────────────
router.get("/api/provider-listings", verifyToken, async (req, res) => {
    try {
        const providerID  = req.query.providerID || req.user.uid;
        const providerDoc = await providerRef(providerID).get();
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

// ─── Applicants for Provider ──────────────────────────────────────────────────
router.get("/api/applicants", verifyToken, async (req, res) => {
    try {
        const providerID  = req.query.providerID || req.user.uid;
        const providerDoc = await providerRef(providerID).get();
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
                const d = await applicantRef(uid).get();
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

module.exports = router;

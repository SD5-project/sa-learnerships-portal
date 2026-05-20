const express = require("express");
const router = express.Router();

const { verifyToken } = require("../auth");
const { db } = require("../firebaseAdmin");

// Provider Listings
router.get("/provider-listings", verifyToken, async (req, res) => {
    try {
        const providerID = req.query.providerID || req.user.uid;
        const providerDoc = await db.collection("users").doc(providerID).get();

        const orgName = providerDoc.exists ? providerDoc.data().organization : null;

        let snapshot;

        if (orgName) {
            snapshot = await db.collection("Opportunities")
                .where("company", "==", orgName)
                .get();
        } else {
            snapshot = await db.collection("Opportunities")
                .where("providerID", "==", providerID)
                .get();
        }

        const listings = [];

        snapshot.forEach(doc => {
            listings.push({
                id: doc.id,
                title: doc.data().title || "Untitled"
            });
        });

        res.json(listings);

    } catch (error) {
        console.error("Provider listings error:", error);
        res.status(500).json({ error: "Failed to fetch provider listings" });
    }
});

// Get Applicants for Provider
router.get("/applicants", verifyToken, async (req, res) => {
    try {
        const providerID = req.query.providerID || req.user.uid;
        const providerDoc = await db.collection("users").doc(providerID).get();

        const orgName = providerDoc.exists ? providerDoc.data().organization : null;

        let listingIDs = [];
        let listingTitles = {};
        let oppSnapshot;

        if (orgName) {
            oppSnapshot = await db.collection("Opportunities")
                .where("company", "==", orgName)
                .get();
        } else {
            oppSnapshot = await db.collection("Opportunities")
                .where("providerID", "==", providerID)
                .get();
        }

        oppSnapshot.forEach(doc => {
            listingIDs.push(doc.id);
            listingTitles[doc.id] = doc.data().title || "Untitled";
        });

        if (listingIDs.length === 0) {
            return res.json([]);
        }

        const chunks = [];

        for (let i = 0; i < listingIDs.length; i += 30) {
            chunks.push(listingIDs.slice(i, i + 30));
        }

        let allApplications = [];

        for (const chunk of chunks) {
            const snap = await db.collection("applications")
                .where("listingID", "in", chunk)
                .get();

            snap.forEach(doc => {
                allApplications.push({
                    id: doc.id,
                    ...doc.data()
                });
            });
        }

        const applicantUIDs = [
            ...new Set(allApplications.map(a => a.applicantID))
        ];

        const profiles = {};

        await Promise.all(applicantUIDs.map(async uid => {
            try {
                const d = await db.collection("users").doc(uid).get();
                profiles[uid] = d.exists ? d.data() : {};
            } catch {
                profiles[uid] = {};
            }
        }));

        const enriched = allApplications.map(app => ({
            ...app,
            listingTitle: listingTitles[app.listingID] || app.listingID,
            applicant: profiles[app.applicantID] || {}
        }));

        res.json(enriched);

    } catch (error) {
        console.error("Get applicants error:", error);
        res.status(500).json({ error: "Failed to fetch applicants" });
    }
});

module.exports = router;
const express = require("express");
const router = express.Router();

const { db } = require("../firebaseAdmin");

// Check if Applicant Applied
router.get("/applicant/hasApplied", async (req, res) => {
    const { applicantID, listingID } = req.query;

    try {
        const snapshot = await db.collection("applications")
            .where("applicantID", "==", applicantID)
            .where("listingID", "==", listingID)
            .get();

        res.json({ hasApplied: !snapshot.empty });

    } catch (error) {
        res.status(500).json({ error: "Failed to check application" });
    }
});

// Applicant Apply
router.post("/applicant/apply", async (req, res) => {
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
});

module.exports = router;
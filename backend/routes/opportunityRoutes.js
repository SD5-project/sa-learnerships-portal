const express = require("express");
const router = express.Router();

const { verifyToken } = require("../auth");
const { db } = require("../firebaseAdmin");
const { authorize } = require("../access-logic");

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

// Submit Opportunity
router.post("/opportunities/submit", verifyToken, guard("/api/opportunities/submit"), async (req, res) => {
    try {
        const opportunityData = req.body;

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
        res.status(500).json({ error: "Failed to submit opportunity" });
    }
});

// Get Opportunity by ID
router.get("/opportunities/:id", verifyToken, async (req, res) => {
    try {
        console.log("Looking for opportunity ID:", req.params.id);

        const doc = await db.collection("Opportunities").doc(req.params.id).get();

        if (!doc.exists) {
            return res.status(404).json({ error: "Opportunity not found" });
        }

        res.json({ id: doc.id, ...doc.data() });

    } catch (error) {
        console.error("Fetch opportunity error:", error);
        res.status(500).json({ error: "Failed to fetch opportunity" });
    }
});

module.exports = router;
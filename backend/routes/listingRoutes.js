const express = require("express");
const router = express.Router();

const { verifyToken } = require("../auth");
const { db } = require("../firebaseAdmin");
const { authorize } = require("../access-logic");

// Listings
router.get("/listings", verifyToken, async (req, res) => {
    const isAuthorized = authorize(req.user, "/api/listings");

    if (!isAuthorized) {
        return res.status(403).json({ error: "Unauthorized" });
    }

    try {
        const snapshot = await db.collection("Opportunities").get();
        const opportunities = [];

        snapshot.forEach(doc => {
            const data = doc.data();

            opportunities.push({
                id: doc.id,
                title: data.title,
                description: data.description,
                price: data.stipend,
                location: data.location,
                provider: data.company,
                type: data.type
            });
        });

        res.status(200).json(opportunities);

    } catch (error) {
        console.error("Firestore Error:", error);
        res.status(500).json({ error: "Database error" });
    }
});

module.exports = router;
const express = require("express");
const router = express.Router();
const { verifyToken } = require("../auth");
const { db } = require("../firebaseAdmin");


router.get("/applications", verifyToken, async (req, res) => {

    try {
        const applicantID = req.query.applicantID || req.user.uid;
        const snapshot = await db
            .collection("applications")
            .where("applicantID", "==", applicantID)
            .get();

        const applications = [];

        snapshot.forEach(doc => {
            applications.push({
                id: doc.id,
                ...doc.data()
            });
        });

        res.status(200).json( applications );

    } catch (error) {

        console.error("Fetch applications error:", error);

        res.status(500).json({
            error: "Failed to fetch applications"
        });
    }
}); 

router.get("/opportunities/:id", verifyToken, async (req, res) => {
    try {
        const doc = await db
            .collection("Opportunities")
            .doc(req.params.id)
            .get();

        if (!doc.exists) {
            return res.status(404).json({ error: "Opportunity not found" });
        }

        res.json({
            id: doc.id,
            ...doc.data()
        });

    } catch (error) {
        console.error("Fetch opportunity error:", error);

        res.status(500).json({
            error: "Failed to fetch opportunity"
        });
    }
});

module.exports = router;
const express = require("express");
const router = express.Router();
const { verifyToken } = require("../auth");
const { db } = require("../firebaseAdmin");


router.get("/applications", verifyToken, async (req, res) => {

    try {

        const snapshot = await db
            .collection("applications")
            .where("applicantID", "==", req.user.uid)
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

module.exports = router;
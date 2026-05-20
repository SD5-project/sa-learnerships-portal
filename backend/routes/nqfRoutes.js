const express = require("express");
const router = express.Router();

const { db } = require("../firebaseAdmin");

router.get("/nqf-levels", async (req, res) => {

    try {

        const snapshot = await db
            .collection("nqfLevels")
            .orderBy("level")
            .get();

        const levels = [];

        snapshot.forEach(doc => {
            levels.push(doc.data());
        });

        res.status(200).json({ levels });

    } catch (error) {

        console.error("NQF fetch error:", error.message);

        res.status(500).json({
            error: "Failed to fetch NQF levels"
        });
    }
});

module.exports = router;
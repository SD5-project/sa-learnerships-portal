const express = require("express");
const router = express.Router();

const { verifyToken } = require("../auth");
const { db } = require("../firebaseAdmin");

router.get("/user-profile", verifyToken, async (req, res) => {
    try {
        const uid = req.query.uid || req.user.uid;

        const userDoc = await db
            .collection("users")
            .doc(uid)
            .get();

        if (!userDoc.exists) {
             const applicantDoc = await db
                 .collection("applicants")
                .doc(uid)
                .get();

    if (applicantDoc.exists) {
        return res.json(applicantDoc.data());
    }
            return res.status(404).json({
                error: "User not found"
            });
        }

        res.json(userDoc.data());

    } catch (error) {
        console.error("Profile fetch error:", error);
        res.status(500).json({
            error: "Failed to fetch profile"
        });
    }
});

router.get("/user-role", verifyToken, async (req, res) => {
    try {
        const uid = req.query.uid || req.user.uid;

        const userDoc = await db
            .collection("users")
            .doc(uid)
            .get();

        if (!userDoc.exists) {
             const applicantDoc = await db
        .collection("applicants")
        .doc(uid)
        .get();

    if (applicantDoc.exists) {
        return res.json(applicantDoc.data());
    }
            return res.status(404).json({
                error: "User not found"
            });
        }

        res.json({
            role: userDoc.data().role || null
        });

    } catch (error) {
        console.error("Role lookup error:", error);
        res.status(500).json({
            error: "Failed to look up role"
        });
    }
});

module.exports = router;
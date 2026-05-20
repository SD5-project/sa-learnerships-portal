const express = require("express");
const router = express.Router();

const { verifyToken } = require("../auth");
const { admin } = require("../firebaseAdmin");

// Backfill Custom Claim
router.post("/set-role-claim", verifyToken, async (req, res) => {
    try {
        const { uid, role } = req.body;

        if (!uid || !role) {
            return res.status(400).json({ error: "uid and role are required" });
        }

        const validRoles = ["applicant", "provider", "admin"];

        if (!validRoles.includes(role.toLowerCase())) {
            return res.status(400).json({ error: "Invalid role" });
        }

        await admin.auth().setCustomUserClaims(uid, {
            role: role.toLowerCase()
        });

        res.json({
            message: "Custom claim set",
            role
        });

    } catch (error) {
        console.error("Set role claim error:", error);
        res.status(500).json({ error: "Failed to set custom claim" });
    }
});

module.exports = router;
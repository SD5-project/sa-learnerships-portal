const express = require("express");
const router = express.Router();

const { db } = require("../firebaseAdmin");

// NQF Validation
router.post("/validate-application", async (req, res) => {
    const { userId, opportunityId } = req.body;

    if (!userId || !opportunityId) {
        return res.status(400).json({ error: "userId and opportunityId are required." });
    }

    try {
        const userDoc = await db.collection("users").doc(userId).get();

        if (!userDoc.exists) {
            return res.status(404).json({ error: "Applicant not found." });
        }

        const userData = userDoc.data();
        const applicantNQF = userData.highestNQFLevel;

        if (!applicantNQF) {
            return res.status(400).json({
                eligible: false,
                message: "Please update your profile with your highest qualification before applying."
            });
        }

        const opportunityDoc = await db.collection("Opportunities").doc(opportunityId).get();

        if (!opportunityDoc.exists) {
            return res.status(404).json({ error: "Opportunity not found." });
        }

        const minimumNQF = opportunityDoc.data().minimumNQFLevel;

        if (parseInt(applicantNQF) >= parseInt(minimumNQF)) {
            return res.status(200).json({
                eligible: true,
                message: "You meet the requirements for this opportunity."
            });
        }

        return res.status(200).json({
            eligible: false,
            message: `You do not meet the minimum qualification requirement. This opportunity requires NQF Level ${minimumNQF}. Your current level is NQF Level ${applicantNQF}.`
        });

    } catch (error) {
        console.error("Validation error:", error.message);
        return res.status(500).json({ error: "Validation failed." });
    }
});

module.exports = router;
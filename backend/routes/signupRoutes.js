const express = require("express");
const router = express.Router();

const { admin, db } = require("../firebaseAdmin");

// ─── Applicant Signup ─────────────────────────────
router.post("/signup/applicant", async (req, res) => {
    const {
        uid,
        firstname,
        lastname,
        email,
        username,
        institution,
        city,
        phonenumber,
        cv
    } = req.body;

    if (!email) {
        return res.status(400).json({ error: "Email is required" });
    }

    try {
        if (admin.auth && typeof admin.auth === "function") {
    await admin.auth().setCustomUserClaims(uid, {
        role: "applicant"
    });
}
        await db.collection("users").doc(uid).set({
            firstname: firstname || "",
            lastname: lastname || "",
            email: email || "",
            username: username || "",
            institution: institution || "",
            city: city || "",
            phonenumber: phonenumber || "",
            cv: cv || "",
            role: "applicant",
            createdAt: new Date().toISOString()
        });

        res.status(201).json({ message: "Applicant created successfully" });

    } catch (error) {
        console.error("Signup Error:", error.message);
        res.status(500).json({ error: "Failed to create applicant" });
    }
});

// ─── Provider Signup ──────────────────────────────
router.post("/signup/provider", async (req, res) => {
    const {
        uid,
        organization,
        email,
        city,
        phonenumber,
        username
    } = req.body;

    if (!email) {
        return res.status(400).json({ error: "Email is required" });
    }

    try {
       if (admin.auth && typeof admin.auth === "function") {
    await admin.auth().setCustomUserClaims(uid, {
        role: "provider"
    });
}

        await db.collection("users").doc(uid).set({
            organization: organization || "",
            email: email || "",
            city: city || "",
            phonenumber: phonenumber || "",
            username: username || "",
            role: "provider",
            createdAt: new Date().toISOString()
        });

        res.status(201).json({ message: "Provider created successfully" });

    } catch (error) {
        console.error("Signup Error:", error.message);
        res.status(500).json({ error: "Failed to create provider" });
    }
});

module.exports = router;
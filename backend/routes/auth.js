const express         = require('express');
const { admin }       = require('../firebaseAdmin');
const { verifyToken } = require('../auth');
const {
    applicantsCol, providersCol, lookupUser
} = require('../userPaths');

const router = express.Router();

// ─── Check Email Uniqueness ───────────────────────────────────────────────────
router.get("/api/check-email", async (req, res) => {
    const email = (req.query.email || "").trim().toLowerCase();
    if (!email) return res.status(400).json({ error: "Email is required" });
    try {
        // Firebase Auth is the source of truth — check it first
        try {
            const authUser = await admin.auth().getUserByEmail(email);
            // If the account has no role claim it's an incomplete signup — clean it up
            // so the user can re-register with the same email.
            if (!authUser.customClaims?.role) {
                await admin.auth().deleteUser(authUser.uid);
            } else {
                return res.json({ exists: true });
            }
        } catch (authErr) {
            if (authErr.code !== 'auth/user-not-found') throw authErr;
        }
        // Fall back to Firestore subcollections
        const [aSnap, pSnap] = await Promise.all([
            applicantsCol().where("email", "==", email).limit(1).get(),
            providersCol().where("email",  "==", email).limit(1).get()
        ]);
        res.json({ exists: !aSnap.empty || !pSnap.empty });
    } catch (error) {
        console.error("Email check error:", error.message);
        res.status(500).json({ error: "Failed to check email" });
    }
});

// ─── Check ID Number Uniqueness ──────────────────────────────────────────────
router.get("/api/check-idnumber", async (req, res) => {
    const idNumber = (req.query.idNumber || "").trim();
    if (!idNumber) return res.status(400).json({ error: "ID number is required" });
    try {
        const [aSnap, pSnap] = await Promise.all([
            applicantsCol().where("idNumber", "==", idNumber).limit(1).get(),
            providersCol().where("idNumber",  "==", idNumber).limit(1).get()
        ]);
        res.json({ exists: !aSnap.empty || !pSnap.empty });
    } catch (error) {
        console.error("ID number check error:", error.message);
        res.status(500).json({ error: "Failed to check ID number" });
    }
});

// ─── Check Phone Number Uniqueness ───────────────────────────────────────────
router.get("/api/check-phone", async (req, res) => {
    const phone = (req.query.phone || "").trim();
    if (!phone) return res.status(400).json({ error: "Phone number is required" });
    try {
        const [aSnap, pSnap] = await Promise.all([
            applicantsCol().where("phonenumber", "==", phone).limit(1).get(),
            providersCol().where("phonenumber",  "==", phone).limit(1).get()
        ]);
        res.json({ exists: !aSnap.empty || !pSnap.empty });
    } catch (error) {
        console.error("Phone check error:", error.message);
        res.status(500).json({ error: "Failed to check phone number" });
    }
});

// ─── Get User Profile ─────────────────────────────────────────────────────────
router.get("/api/user-profile", verifyToken, async (req, res) => {
    try {
        const uid        = req.query.uid || req.user.uid;
        const { snap }   = await lookupUser(uid);
        if (!snap || !snap.exists) return res.status(404).json({ error: "User not found" });
        res.json(snap.data());
    } catch (error) {
        console.error("Profile fetch error:", error);
        res.status(500).json({ error: "Failed to fetch profile" });
    }
});

// ─── Get User Role ────────────────────────────────────────────────────────────
router.get("/api/user-role", verifyToken, async (req, res) => {
    try {
        const uid      = req.query.uid || req.user.uid;
        const { snap } = await lookupUser(uid);
        if (!snap || !snap.exists) return res.status(404).json({ error: "User not found" });
        res.json({ role: snap.data().role || null });
    } catch (error) {
        console.error("Role lookup error:", error);
        res.status(500).json({ error: "Failed to look up role" });
    }
});

// ─── Set Custom Role Claim ────────────────────────────────────────────────────
router.post("/api/set-role-claim", verifyToken, async (req, res) => {
    try {
        const { uid, role } = req.body;
        if (!uid || !role) return res.status(400).json({ error: "uid and role are required" });
        if (!["applicant", "provider", "admin"].includes(role.toLowerCase())) {
            return res.status(400).json({ error: "Invalid role" });
        }
        await admin.auth().setCustomUserClaims(uid, { role: role.toLowerCase() });
        res.json({ message: "Custom claim set", role });
    } catch (error) {
        console.error("Set role claim error:", error);
        res.status(500).json({ error: "Failed to set custom claim" });
    }
});

module.exports = router;

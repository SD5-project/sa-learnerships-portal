/**
 * routes/auth.js
 * Authentication, user profile, signup, and CV upload routes.
 *
 * CV uploads are handled via Cloudinary using multer-storage-cloudinary.
 * Files are stored in the "cvs" folder on Cloudinary and the public URL
 * is saved on the applicant's Firestore profile document.
 *
 * Profile reads use lookupUser() which checks the subcollections first,
 * then falls back to the flat users/{uid} collection for backwards compatibility
 * with accounts created before the subcollection structure was introduced.
 *
 * Routes:
 *   GET  /api/check-email            - Check if an email is already registered
 *   GET  /api/check-idnumber         - Check if an ID number is already registered
 *   GET  /api/check-phone            - Check if a phone number is already registered
 *   POST /signup/applicant           - Register a new applicant (with optional CV upload)
 *   POST /signup/provider            - Register a new provider
 *   GET  /api/user-profile           - Fetch the authenticated user's profile
 *   GET  /api/user-role              - Fetch the authenticated user's role
 *   POST /api/set-role-claim         - Set a Firebase custom role claim (admin tool)
 *   POST /api/upload-cv              - Upload or replace a CV for an applicant
 *   PATCH /api/profile/qualifications - Save an applicant's qualifications (max 8)
 */

const express               = require('express');
const { admin, db }         = require('../firebaseAdmin');
const { verifyToken }       = require('../auth');
const cloudinary            = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const multer                = require('multer');
const {
    applicantsCol, providersCol, applicantRef, providerRef, lookupUser
} = require('../userPaths');

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key:    process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

const storage = new CloudinaryStorage({
    cloudinary,
    params: (req, file) => ({
        folder:          "cvs",
        allowed_formats: ["pdf", "doc", "docx"],
        resource_type:   "raw",
        public_id:       file.originalname.replace(/\.[^/.]+$/, ""),
        use_filename:    true,
        unique_filename: false
    })
});

const upload = multer({ storage });

const router = express.Router();

// ─── Check Email Uniqueness ───────────────────────────────────────────────────
router.get("/api/check-email", async (req, res) => {
    const email = (req.query.email || "").trim().toLowerCase();
    if (!email) return res.status(400).json({ error: "Email is required" });
    try {
        try {
            const authUser = await admin.auth().getUserByEmail(email);
            if (!authUser.customClaims?.role) {
                await admin.auth().deleteUser(authUser.uid);
            } else {
                return res.json({ exists: true });
            }
        } catch (authErr) {
            if (authErr.code !== 'auth/user-not-found') throw authErr;
        }
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

// ─── Signup: Applicant ────────────────────────────────────────────────────────
router.post("/signup/applicant", async (req, res) => {
    const { uid, firstname, lastname, email, phonenumber, idNumber, qualifications, cv } = req.body;
    if (!email) return res.status(400).json({ error: "Email is required" });
    try {
        await admin.auth().setCustomUserClaims(uid, { role: "applicant" });
        const userData = {
            firstname:      firstname      || null,
            lastname:       lastname       || null,
            email:          email          || null,
            phonenumber:    phonenumber    || null,
            idNumber:       idNumber       || null,
            qualifications: qualifications || [],
            cv:             cv             || null,
            role: "applicant", status: "active", createdAt: new Date().toISOString()
        };
        await db.collection("users").doc(uid).set(userData);
        await applicantRef(uid).set(userData);
        res.status(201).json({ message: "Applicant created successfully" });
    } catch (error) {
        console.error("Applicant signup error:", error.message);
        res.status(500).json({ error: "Failed to create applicant" });
    }
});

// ─── Signup: Provider ─────────────────────────────────────────────────────────
router.post("/signup/provider", verifyToken, async (req, res) => {
    const { uid, organization, email, phonenumber } = req.body;
    if (!email) return res.status(400).json({ error: "Email is required" });
    try {
        await admin.auth().setCustomUserClaims(uid, { role: "provider" });
        await providerRef(uid).set({
            organization: (organization || "").trim(),
            email:        (email        || "").trim(),
            phonenumber:  (phonenumber  || "").trim(),
            role: "provider", status: "active", createdAt: new Date().toISOString()
        });
        res.status(201).json({ message: "Provider created successfully" });
    } catch (error) {
        console.error("Provider signup error:", error.message);
        res.status(500).json({ error: "Failed to create provider" });
    }
});

// ─── Get User Profile ─────────────────────────────────────────────────────────
router.get("/api/user-profile", verifyToken, async (req, res) => {
    try {
        const uid      = req.query.uid || req.user.uid;
        const { snap } = await lookupUser(uid);
        if (snap && snap.exists) return res.json(snap.data());

        // Fallback: profile may be in the flat users collection (older signup flow)
        const flatDoc = await db.collection("users").doc(uid).get();
        if (!flatDoc.exists) return res.status(404).json({ error: "User not found" });
        res.json(flatDoc.data());
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

// ─── Upload CV ────────────────────────────────────────────────────────────────
router.post("/api/upload-cv", verifyToken, upload.single("cv"), async (req, res) => {
    try {
        const uid    = req.body.uid || req.user.uid;
        const cvUrl  = req.file ? req.file.path         : null;
        const cvName = req.file ? req.file.originalname : null;

        if (!cvUrl) return res.status(400).json({ error: "No file uploaded" });

        // Update both flat collection and subcollection
        await Promise.all([
            applicantRef(uid).update({ cv: cvUrl, cvFilename: cvName }),
            db.collection("users").doc(uid).update({ cv: cvUrl, cvFilename: cvName })
        ]);

        res.json({ message: "CV uploaded successfully", cv: cvUrl });
    } catch (error) {
        console.error("CV upload error:", error);
        res.status(500).json({ error: "Failed to upload CV" });
    }
});

// ─── Save Qualifications ──────────────────────────────────────────────────────
router.patch("/api/profile/qualifications", verifyToken, async (req, res) => {
    try {
        const { qualifications } = req.body;
        if (!Array.isArray(qualifications)) {
            return res.status(400).json({ error: "qualifications must be an array" });
        }
        if (qualifications.length > 8) {
            return res.status(400).json({ error: "A maximum of 8 qualifications is allowed" });
        }
        await applicantRef(req.user.uid).set({
            qualifications,
            updatedAt: new Date().toISOString()
        }, { merge: true });
        res.json({ message: "Qualifications updated" });
    } catch (error) {
        console.error("Qualifications update error:", error);
        res.status(500).json({ error: "Failed to update qualifications" });
    }
});

router.delete("/api/delete-cv", verifyToken, async (req, res) => {
    try {
        const uid = req.user.uid;
        await Promise.all([
            applicantRef(uid).update({ cv: null, cvFilename: null }),
            db.collection("users").doc(uid).update({ cv: null, cvFilename: null })
        ]);
        res.json({ message: "CV deleted successfully" });
    } catch (error) {
        console.error("CV delete error:", error);
        res.status(500).json({ error: "Failed to delete CV" });
    }
});
module.exports = router;

const express             = require('express');
const { admin }           = require('../firebaseAdmin');
const { verifyToken }     = require('../auth');
const cloudinary          = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const multer              = require('multer');
const {
    applicantsCol, providersCol, applicantRef, providerRef, lookupUser
} = require('../userPaths');
//auth.js
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key:    process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

const storage = new CloudinaryStorage({
    cloudinary,
    params: (req, file) =>({
        folder:          "cvs",
        allowed_formats: ["pdf", "doc", "docx"],
        resource_type:   "raw",
        public_id:       file.originalname.replace(/\.[^/.]+$/, ""), // filename without extension
        use_filename:     true,
        unique_filename:  false
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

// ─── Check ID Number Uniqueness ───────────────────────────────────────────────
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
router.post("/signup/applicant", verifyToken, upload.single("cv"), async (req, res) => {
    const {
        uid, firstname, lastname, email, phonenumber,
        idNumber, qualifications
    } = req.body;
    const cvUrl      = req.file ? req.file.path         : null;
    const cvFilename = req.file ? req.file.originalname : null;

    if (!email) return res.status(400).json({ error: "Email is required" });

    try {
        await admin.auth().setCustomUserClaims(uid, { role: "applicant" });
        await applicantRef(uid).set({
            firstname:      (firstname   || "").trim(),
            lastname:       (lastname    || "").trim(),
            email:          (email       || "").trim(),
            phonenumber:    (phonenumber || "").trim(),
            ...(idNumber   ? { idNumber: idNumber.trim() } : {}),
            ...(cvUrl      ? { cv: cvUrl, cvFilename }     : {}),
            qualifications: qualifications || [],
            role: "applicant", status: "active", createdAt: new Date().toISOString()
        });
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

router.post("/api/upload-cv", verifyToken, upload.single("cv"), async (req, res) => {
    try {
        console.log("CV upload hit");
        console.log("req.file:", req.file);
        console.log("req.body.uid:", req.body.uid);
        console.log("req.user.uid:", req.user?.uid);

        const uid    = req.body.uid || req.user.uid;
        const cvUrl  = req.file ? req.file.path         : null;
        const cvName = req.file ? req.file.originalname : null;

        if (!cvUrl) return res.status(400).json({ error: "No file uploaded" });

        await applicantRef(uid).update({ cv: cvUrl, cvFilename: cvName });
        res.json({ message: "CV uploaded successfully", cv: cvUrl });
    } catch (error) {
        console.error("CV upload error:", error);
        res.status(500).json({ error: "Failed to upload CV" });
    }
});

module.exports = router;
const express = require('express');
const nqfRoutes = require("./routes/nqfRoutes");
const applicationRoutes = require("./routes/applicationRoutes");
const signupRoutes = require("./routes/signupRoutes");
const statusRoutes = require("./routes/statusRoutes");
const opportunityRoutes = require("./routes/opportunityRoutes");
const listingRoutes = require("./routes/listingRoutes");
const applicantRoutes = require("./routes/applicantRoutes");
const validationRoutes = require("./routes/validationRoutes");
const profileRoutes = require("./routes/profileRoutes");
const providerRoutes = require("./routes/providerRoutes");
const adminRoutes = require("./routes/adminRoutes");
const path    = require('path');
const cors    = require("cors");

const app = express();

app.use(cors());
app.use(express.json());

app.use("/", nqfRoutes);
app.use("/api", applicationRoutes);
app.use("/", signupRoutes);
app.use("/api", statusRoutes);
app.use("/api", opportunityRoutes);
app.use("/api", listingRoutes);
app.use("/", applicantRoutes);
app.use("/", validationRoutes);
app.use("/api", profileRoutes);
app.use("/api", providerRoutes);
app.use("/api", adminRoutes);

// ─── Reminder Job ────────────────────────────────
if (process.env.NODE_ENV !== "test") {
    require("./reminderJob");
}


// Transport Configuration
//require('dotenv').config();
//const nodemailer = require('nodemailer');

//const transporter = nodemailer.createTransport({
 //   host: process.env.EMAIL_HOST,
 //   port: 587,                   
   // secure: false,               // Must be false for port 587
   // auth: {
   //     user: process.env.EMAIL_USER,
    //    pass: process.env.EMAIL_PASS 
   // },
   // tls: {
    //    rejectUnauthorized: false // This helps avoid connection issues on some networks
    //}
//});

// Verify connection on startup, but not during tests
//if (process.env.NODE_ENV !== "test") {
 //   transporter.verify((error, success) => {
 //       if (error) {
 //           console.error("❌ Email Transporter Error:", error);
 //       } else {
 //           console.log("🚀 Email Server is ready to take our messages");
 //       }
 //   });
//}

// Serve frontend static files
app.use(express.static(path.join(__dirname, '..', 'frontend')));

//const { verifyToken } = require("./auth");
//const { db, admin }   = require("./firebaseAdmin");
//const { authorize }   = require('./access-logic');

// ─── Guard Middleware ────────────────────────────
//function guard(route) {
//    return (req, res, next) => {
 //       const user = req.user;
 //       if (user && authorize(user, route)) {
 //           next();
 //       } else {
 //           res.status(403).send("Forbidden: You do not have access to this route.");
 //       }
 //   };
//}

// ─── Static Page Routes ──────────────────────────
app.get(['/signup', '/signup.html'], (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'frontend', 'signup.html'));
});

app.get('/listing-info', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'frontend', 'listing-info.html'));
});

app.get('/create-opportunity', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'frontend', 'create-opportunity.html'));
});

app.get('/applicant-home', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'frontend', 'applicant-home.html'));
});

app.get('/applications-page', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'frontend', 'applications-page.html'));
});

app.get('/applicants', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'frontend', 'applicants.html'));
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'frontend', 'index.html'));
});

app.get('/admin-dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'frontend', 'admin-dashboard.html'));
});

app.get('/provider-home', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'frontend', 'provider-home.html'));
});

app.get('/listings', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'frontend', 'listings.html'));
});


// ✅ Export for testing
module.exports = app;

// ✅ Only run server outside tests
if (process.env.NODE_ENV !== "test") {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
        console.log(`Server running on http://localhost:${PORT}`);
    });
}
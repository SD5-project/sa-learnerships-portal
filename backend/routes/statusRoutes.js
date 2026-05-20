const express = require("express");
const router = express.Router();

const nodemailer = require("nodemailer");

const { verifyToken } = require("../auth");
const { db, admin } = require("../firebaseAdmin");

const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: 587,
    secure: false,
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    },
    tls: {
        rejectUnauthorized: false
    }
});

// ─── Update Application Status ────────────────────
router.patch("/applicants/:applicationID/status", verifyToken, async (req, res) => {

    try {

        const { applicationID } = req.params;
        const { status } = req.body;

        // ── Validate status value ─────────────────────────────────────────────
        const valid = [
            "pending",
            "reviewing",
            "shortlisted",
            "accepted",
            "rejected"
        ];

        if (!valid.includes(status)) {
            return res.status(400).json({
                error: "Invalid status"
            });
        }

        // ── Applicants cannot update status ───────────────────────────────────
        if (req.user.role === "applicant") {
            return res.status(403).json({
                error: "You are not authorized to update this application"
            });
        }

        // ── Fetch the application ─────────────────────────────────────────────
        const appDoc = await db
            .collection("applications")
            .doc(applicationID)
            .get();

        if (!appDoc.exists) {
            return res.status(404).json({
                error: "Application not found"
            });
        }

        const appData = appDoc.data();

        const currentStatus = appData.status;
        const listingID = appData.listingID;

        // ── Must be shortlisted before accepting ──────────────────────────────
        if (
            status === "accepted" &&
            currentStatus !== "shortlisted"
        ) {
            return res.status(400).json({
                error: "Applicant must be shortlisted before accepting"
            });
        }

        // ── Provider must own the listing ─────────────────────────────────────
        const listingDoc = await db
            .collection("Opportunities")
            .doc(listingID)
            .get();

        if (!listingDoc.exists) {
            return res.status(404).json({
                error: "Listing not found"
            });
        }

        if (
            req.user.role !== "admin" &&
            listingDoc.data().providerID !== req.user.uid
        ) {
            return res.status(403).json({
                error: "You are not authorized to update this application"
            });
        }

        // ── Update status ─────────────────────────────────────────────────────
        await db
            .collection("applications")
            .doc(applicationID)
            .update({
                status,
                updatedAt: new Date().toISOString()
            });

        // ── Respond immediately — notifications happen after ──────────────────
        res.json({
            message: "Status updated",
            applicationID,
            status
        });

        // ── In-app notification ───────────────────────────────────────────────
        const listingTitle = listingDoc.data().title || "Opportunity";

        await db.collection("notifications").add({
            recipientId: appData.applicantID,
            message: `Your application for "${listingTitle}" has been ${status}.`,
            status: "unread",
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            applicationId: applicationID
        });

        // ── Email notification ────────────────────────────────────────────────
        try {

            const applicantDoc = await db
                .collection("users")
                .doc(appData.applicantID)
                .get();

            if (applicantDoc.exists) {

                const { email, firstname } = applicantDoc.data();

                await transporter.sendMail({
                    from: `"SkillsConnect" <skillsconnectsupport@gmail.com>`,
                    to: email,
                    subject: `Update: Application for ${listingTitle}`,
                    html: `
                        <p>Hi ${firstname || "Applicant"},</p>
                        <p>Your application for <strong>${listingTitle}</strong> has been updated.</p>
                        <p>New status: <strong>${status}</strong></p>
                        <p>Log in to your dashboard for more details.</p>
                    `
                });

                console.log("✅ Email sent to:", email);
            }

        } catch (emailError) {

            console.error(
                "Email failed but status was updated:",
                emailError
            );
        }

    } catch (error) {

        console.error("Status update error:", error);

        res.status(500).json({
            error: "Failed to update status"
        });
    }
});

module.exports = router;
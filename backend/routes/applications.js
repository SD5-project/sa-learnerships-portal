/**
 * routes/applications.js
 * Handles the full application lifecycle between applicants and opportunity listings.
 *
 * Routes:
 *   GET  /applicant/hasApplied              - Check whether an applicant has already applied
 *   POST /applicant/apply                   - Submit a new application
 *   GET  /api/applications                  - Fetch all applications for the logged-in applicant
 *   PATCH /api/applicants/:id/status        - Update an application's status (provider/admin only)
 *
 * Status flow: pending → reviewing → shortlisted → accepted / rejected
 * An application must be shortlisted before it can be accepted.
 */

const express         = require('express');
const { db, admin }   = require('../firebaseAdmin');
const { verifyToken } = require('../auth');
const { sendMail }    = require('../helpers');
const { applicantRef } = require('../userPaths');

const router = express.Router();

/**
 * GET /applicant/hasApplied?applicantID=&listingID=
 * Checks whether a specific applicant has already applied to a specific listing.
 * Used by the listing detail page to show/hide the Apply button.
 *
 * Response: { hasApplied: boolean }
 */
router.get("/applicant/hasApplied", async (req, res) => {
    const { applicantID, listingID } = req.query;

    if (!applicantID || !listingID) {
        return res.status(400).json({ error: "Missing applicantID or listingID" });
    }

    try {
        const snapshot = await db.collection("applications")
            .where("applicantID", "==", applicantID)
            .where("listingID",   "==", listingID)
            .get();

        // If snapshot is not empty, the applicant has already applied
        res.status(200).json({ hasApplied: !snapshot.empty });
    } catch (error) {
        console.error("Error checking application status:", error);
        res.status(500).json({ error: "Failed to check application" });
    }
});

/**
 * POST /applicant/apply
 * Submits a new application for an applicant to a listing.
 * Prevents duplicate applications using a composite document ID (applicantID_listingID).
 *
 * Body: { applicantID, listingID, status? }
 * Response: 201 on success, 409 if already applied.
 */
router.post("/applicant/apply", async (req, res) => {
    const { applicantID, listingID, status } = req.body;
    if (!applicantID || !listingID) {
        return res.status(400).json({ error: "applicantID and listingID are required" });
    }
    try {
        // Verify both the applicant and listing exist before creating an application
        const userDoc = await applicantRef(applicantID).get();
        if (!userDoc.exists) return res.status(400).json({ error: "User not found" });

        const listingDoc = await db.collection("Opportunities").doc(listingID).get();
        if (!listingDoc.exists) return res.status(404).json({ error: "Listing not found" });

        // Use a deterministic document ID to enforce the one-application-per-listing rule
        const docId       = `${applicantID}_${listingID}`;
        const existingApp = await db.collection("applications").doc(docId).get();
        if (existingApp.exists) return res.status(409).json({ error: "You have already applied to this listing" });

        await db.collection("applications").doc(docId).set({
            applicantID, listingID,
            status:    status || "pending",
            createdAt: new Date().toISOString()
        });
        res.status(201).json({ message: "Application submitted" });
    } catch (error) {
        console.error("Apply error:", error);
        res.status(500).json({ error: "Failed to submit application" });
    }
});

/**
 * GET /api/applications?applicantID=
 * Returns all applications submitted by the authenticated applicant.
 * Falls back to the token's uid if no applicantID query param is provided.
 *
 * Response: [{ id, applicantID, listingID, status, createdAt }]
 */
router.get("/api/applications", verifyToken, async (req, res) => {
    try {
        const applicantID = req.query.applicantID || req.user.uid;
        const snapshot    = await db.collection("applications")
            .where("applicantID", "==", applicantID)
            .get();
        const applications = [];
        snapshot.forEach(doc => applications.push({ id: doc.id, ...doc.data() }));
        res.json(applications);
    } catch (error) {
        console.error("Fetch applications error:", error);
        res.status(500).json({ error: "Failed to fetch applications" });
    }
});

/**
 * PATCH /api/applicants/:applicationID/status
 * Updates the status of an application. Restricted to providers (who own the listing)
 * and admins. Applicants may not change their own application status.
 *
 * Enforced transition rule: an application must be "shortlisted" before it can be "accepted".
 * After updating, sends an in-app notification and email to the applicant.
 *
 * Body:   { status: "pending"|"reviewing"|"shortlisted"|"accepted"|"rejected" }
 * Response: { message, applicationID, status }
 */
router.patch("/api/applicants/:applicationID/status", verifyToken, async (req, res) => {
    try {
        const { applicationID } = req.params;
        const { status }        = req.body;

        const validStatuses = ["pending", "reviewing", "shortlisted", "accepted", "rejected"];
        if (!validStatuses.includes(status)) {
            return res.status(400).json({ error: "Invalid status" });
        }

        // Applicants cannot update their own application status
        if (req.user.role === "applicant") {
            return res.status(403).json({ error: "You are not authorized to update this application" });
        }

        const appDoc = await db.collection("applications").doc(applicationID).get();
        if (!appDoc.exists) return res.status(404).json({ error: "Application not found" });

        const appData = appDoc.data();

        // Enforce shortlist-before-accept transition rule
        if (status === "accepted" && appData.status !== "shortlisted") {
            return res.status(400).json({ error: "Applicant must be shortlisted before accepting" });
        }

        const listingDoc = await db.collection("Opportunities").doc(appData.listingID).get();
        if (!listingDoc.exists) return res.status(404).json({ error: "Listing not found" });

        // Providers can only update applications for listings they own
        if (req.user.role !== "admin" && listingDoc.data().providerID !== req.user.uid) {
            return res.status(403).json({ error: "You are not authorized to update this application" });
        }

        await db.collection("applications").doc(applicationID).update({
            status, updatedAt: new Date().toISOString()
        });
        res.json({ message: "Status updated", applicationID, status });

        // Non-blocking: notify the applicant via in-app notification and email
        const listingTitle = listingDoc.data().title || "Opportunity";
        await db.collection("notifications").add({
            recipientId:   appData.applicantID,
            message:       `Your application for "${listingTitle}" has been ${status}.`,
            status:        "unread",
            timestamp:     admin.firestore.FieldValue.serverTimestamp(),
            applicationId: applicationID
        });

        const applicantDoc = await applicantRef(appData.applicantID).get();
        if (applicantDoc.exists) {
            const { email, firstname } = applicantDoc.data();
            await sendMail(
                email,
                `Update: Application for ${listingTitle}`,
                `<p>Hi ${firstname || "Applicant"},</p>
                 <p>Your application for <strong>${listingTitle}</strong> has been updated to <strong>${status}</strong>.</p>`
            );
        }
    } catch (error) {
        console.error("Status update error:", error);
        res.status(500).json({ error: "Failed to update status" });
    }
});

module.exports = router;

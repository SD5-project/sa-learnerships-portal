/**
 * routes/admin.js
 * Admin-only routes for moderating listings and managing user accounts.
 *
 * All routes in this file are protected by verifyToken + adminOnly middleware,
 * which is applied at the router level so individual handlers stay clean.
 *
 * Listing moderation routes (mounted at /api/admin):
 *   GET   /listings/pending    - Listings awaiting admin review (in_for_review)
 *   GET   /listings            - All listings regardless of status
 *   GET   /listings/rejected   - All rejected listings
 *   PATCH /listings/:id/approve - Accept a listing → review_accepted (notifies provider)
 *   PATCH /listings/:id/remove  - Reject a listing → rejected_review (notifies provider)
 *
 * User management routes (mounted at /api/admin):
 *   GET   /users               - Paginated, filterable list of all users
 *   PATCH /users/:uid/suspend  - Disable a user's Firebase Auth account
 *   PATCH /users/:uid/reactivate - Re-enable a user's Firebase Auth account
 *   DELETE /users/:uid         - Permanently delete a user (Auth + Firestore)
 */

const express         = require('express');
const { admin, db }   = require('../firebaseAdmin');
const { verifyToken } = require('../auth');
const { adminOnly, sendMail } = require('../helpers');
const {
    applicantsCol, providersCol,
    providerRef, lookupUser
} = require('../userPaths');

const router = express.Router();

// Every route in this file requires a valid token AND the admin role
router.use(verifyToken, adminOnly);

// ─── Pending Listings Queue (in_for_review) ───────────────────────────────────
router.get("/listings/pending", async (req, res) => {
    try {
        const snapshot = await db.collection("Opportunities")
            .where("status", "==", "in_for_review")
            .get();
        const listings = [];
        snapshot.forEach(doc => {
            const d = doc.data();
            listings.push({
                id:         doc.id,
                title:      d.title      || "Untitled",
                company:    d.company    || "Unknown",
                type:       d.type       || "-",
                location:   d.location   || "-",
                stipend:    d.stipend    ?? null,
                providerID: d.providerID || null,
                createdAt:  d.createdAt  || null,
                status:     d.status
            });
        });
        res.json(listings);
    } catch (error) {
        console.error("Pending listings error:", error);
        res.status(500).json({ error: "Failed to fetch pending listings" });
    }
});

// ─── All Listings (any status) ────────────────────────────────────────────────
router.get("/listings", async (req, res) => {
    try {
        const snapshot = await db.collection("Opportunities").get();
        const listings = [];
        snapshot.forEach(doc => {
            const d = doc.data();
            listings.push({
                id:         doc.id,
                title:      d.title      || "Untitled",
                company:    d.company    || "Unknown",
                type:       d.type       || "-",
                location:   d.location   || "-",
                stipend:    d.stipend    ?? null,
                providerID: d.providerID || null,
                createdAt:  d.createdAt  || null,
                status:     d.status     || "unknown"
            });
        });
        res.json(listings);
    } catch (error) {
        console.error("Admin listings error:", error);
        res.status(500).json({ error: "Failed to fetch listings" });
    }
});

// ─── Approve Listing ──────────────────────────────────────────────────────────
router.patch("/listings/:id/approve", async (req, res) => {
    try {
        const listingRef = db.collection("Opportunities").doc(req.params.id);
        const listingDoc = await listingRef.get();
        if (!listingDoc.exists) return res.status(404).json({ error: "Listing not found" });

        await listingRef.update({ status: "review_accepted", updatedAt: new Date().toISOString() });
        res.json({ message: "Listing accepted", id: req.params.id });

        const d          = listingDoc.data();
        const providerID = d.providerID;
        if (providerID) {
            const providerDoc = await providerRef(providerID).get();
            if (providerDoc.exists) {
                const { email, organization, firstname } = providerDoc.data();
                const name  = organization || firstname || "Provider";
                const title = d.title || "your listing";
                await db.collection("notifications").add({
                    recipientId: providerID,
                    message:     `Your listing "${title}" has been accepted and is now live.`,
                    status:      "unread",
                    timestamp:   admin.firestore.FieldValue.serverTimestamp(),
                    listingId:   req.params.id
                });
                await sendMail(
                    email,
                    `Your listing "${title}" has been accepted`,
                    `<p>Hi ${name},</p><p>Your listing <strong>${title}</strong> has been <strong>accepted</strong> and is now visible to applicants.</p>`
                );
            }
        }
    } catch (error) {
        console.error("Approve listing error:", error);
        res.status(500).json({ error: "Failed to approve listing" });
    }
});

// ─── Remove Listing ───────────────────────────────────────────────────────────
router.patch("/listings/:id/remove", async (req, res) => {
    try {
        const { reason } = req.body || {};
        const listingRef = db.collection("Opportunities").doc(req.params.id);
        const listingDoc = await listingRef.get();
        if (!listingDoc.exists) return res.status(404).json({ error: "Listing not found" });

        await listingRef.update({
            status:        "rejected_review",
            removalReason: reason || null,
            updatedAt:     new Date().toISOString()
        });
        res.json({ message: "Listing rejected", id: req.params.id });

        const d          = listingDoc.data();
        const providerID = d.providerID;
        if (providerID) {
            const providerDoc = await providerRef(providerID).get();
            if (providerDoc.exists) {
                const { email, organization, firstname } = providerDoc.data();
                const name  = organization || firstname || "Provider";
                const title = d.title || "your listing";
                await db.collection("notifications").add({
                    recipientId: providerID,
                    message:     `Your listing "${title}" has been rejected.${reason ? ` Reason: ${reason}` : ""}`,
                    status:      "unread",
                    timestamp:   admin.firestore.FieldValue.serverTimestamp(),
                    listingId:   req.params.id
                });
                await sendMail(
                    email,
                    `Your listing "${title}" has been rejected`,
                    `<p>Hi ${name},</p><p>Your listing <strong>${title}</strong> has been <strong>rejected</strong>.${reason ? ` Reason: ${reason}` : ""}</p>`
                );
            }
        }
    } catch (error) {
        console.error("Remove listing error:", error);
        res.status(500).json({ error: "Failed to remove listing" });
    }
});

// ─── Rejected Listings ────────────────────────────────────────────────────────
router.get("/listings/rejected", async (req, res) => {
    try {
        const snapshot = await db.collection("Opportunities")
            .where("status", "==", "rejected_review")
            .get();
        const listings = [];
        snapshot.forEach(doc => {
            const d = doc.data();
            listings.push({
                id:            doc.id,
                title:         d.title      || "Untitled",
                company:       d.company    || "Unknown",
                type:          d.type       || "-",
                location:      d.location   || "-",
                providerID:    d.providerID || null,
                createdAt:     d.createdAt  || null,
                removalReason: d.removalReason || null,
                status:        d.status
            });
        });
        res.json(listings);
    } catch (error) {
        console.error("Rejected listings error:", error);
        res.status(500).json({ error: "Failed to fetch rejected listings" });
    }
});

// ─── List All Users (paginated, filterable) ───────────────────────────────────
router.get("/users", async (req, res) => {
    try {
        const { role, page = 1, limit = 20 } = req.query;
        const pageNum  = Math.max(1, parseInt(page)  || 1);
        const pageSize = Math.min(100, parseInt(limit) || 20);

        let snaps = [];

        if (!role || role === "applicant") {
            const s = await applicantsCol().get();
            s.forEach(doc => snaps.push({ uid: doc.id, ...doc.data() }));
        }
        if (!role || role === "provider") {
            const s = await providersCol().get();
            s.forEach(doc => snaps.push({ uid: doc.id, ...doc.data() }));
        }
        if (role === "admin") {
            const [aSnap, pSnap] = await Promise.all([
                applicantsCol().where("role", "==", "admin").get(),
                providersCol().where("role",  "==", "admin").get()
            ]);
            snaps = [];
            aSnap.forEach(doc => snaps.push({ uid: doc.id, ...doc.data() }));
            pSnap.forEach(doc => snaps.push({ uid: doc.id, ...doc.data() }));
        }

        const allUsers = snaps.map(d => ({
            uid:          d.uid,
            firstname:    d.firstname    || null,
            lastname:     d.lastname     || null,
            organization: d.organization || null,
            email:        d.email        || null,
            username:     d.username     || null,
            role:         d.role         || null,
            status:       d.status       || "active",
            createdAt:    d.createdAt    || null
        }));

        allUsers.sort((a, b) => {
            if (!a.createdAt) return  1;
            if (!b.createdAt) return -1;
            return new Date(b.createdAt) - new Date(a.createdAt);
        });

        const total = allUsers.length;
        const paged = allUsers.slice((pageNum - 1) * pageSize, pageNum * pageSize);
        res.json({
            users: paged,
            pagination: { total, page: pageNum, limit: pageSize, totalPages: Math.ceil(total / pageSize) }
        });
    } catch (error) {
        console.error("Admin users error:", error);
        res.status(500).json({ error: "Failed to fetch users" });
    }
});

// ─── Suspend User ─────────────────────────────────────────────────────────────
router.patch("/users/:uid/suspend", async (req, res) => {
    try {
        const { uid } = req.params;
        if (uid === req.user.uid) {
            return res.status(400).json({ error: "Admins cannot suspend their own account" });
        }
        const { snap, ref } = await lookupUser(uid);
        if (!snap || !snap.exists) return res.status(404).json({ error: "User not found" });

        const userData = snap.data();
        await admin.auth().updateUser(uid, { disabled: true });
        await ref.update({ status: "suspended", suspendedAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
        res.json({ message: "User suspended", uid });

        const name = userData.firstname || userData.organization || "User";
        await sendMail(
            userData.email,
            "Your SkillsConnect account has been suspended",
            `<p>Hi ${name},</p>
             <p>Your SkillsConnect account has been <strong>suspended</strong> by an administrator.</p>
             <p>You will not be able to log in while your account is suspended.</p>
             <p>If you believe this is a mistake, please contact support at
                <a href="mailto:${process.env.EMAIL_USER}">${process.env.EMAIL_USER}</a>.
             </p>`
        );
    } catch (error) {
        console.error("Suspend error:", error);
        res.status(500).json({ error: "Failed to suspend user" });
    }
});

// ─── Reactivate User ──────────────────────────────────────────────────────────
router.patch("/users/:uid/reactivate", async (req, res) => {
    try {
        const { uid }       = req.params;
        const { snap, ref } = await lookupUser(uid);
        if (!snap || !snap.exists) return res.status(404).json({ error: "User not found" });

        const userData = snap.data();
        await admin.auth().updateUser(uid, { disabled: false });
        await ref.update({ status: "active", reactivatedAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
        res.json({ message: "User reactivated", uid });

        const name = userData.firstname || userData.organization || "User";
        await sendMail(
            userData.email,
            "Your SkillsConnect account has been reactivated",
            `<p>Hi ${name},</p>
             <p>Good news — your SkillsConnect account has been <strong>reactivated</strong>.</p>
             <p>You can now log in and access the platform again.</p>
             <p><a href="${process.env.APP_URL || "https://skillsconnect.azurewebsites.net"}">Click here to log in</a></p>`
        );
    } catch (error) {
        console.error("Reactivate error:", error);
        res.status(500).json({ error: "Failed to reactivate user" });
    }
});

// ─── Delete User (Firebase Auth + Firestore) ──────────────────────────────────
router.delete("/users/:uid", async (req, res) => {
    try {
        const { uid } = req.params;
        if (uid === req.user.uid) {
            return res.status(400).json({ error: "Admins cannot delete their own account" });
        }
        const { snap, ref } = await lookupUser(uid);
        if (!snap || !snap.exists) return res.status(404).json({ error: "User not found" });

        await admin.auth().deleteUser(uid);
        await ref.delete();
        res.json({ message: "User deleted", uid });
    } catch (error) {
        console.error("Delete user error:", error);
        res.status(500).json({ error: "Failed to delete user" });
    }
});

module.exports = router;

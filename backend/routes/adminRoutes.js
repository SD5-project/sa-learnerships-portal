const express = require("express");
const router = express.Router();

const { verifyToken } = require("../auth");
const { admin, db } = require("../firebaseAdmin");


// Backfill Custom Claim
router.post("/set-role-claim", verifyToken, async (req, res) => {
    try {
       const isAdmin =
    req.user &&
    (req.user.role === "admin" || req.user.admin === true);

if (!isAdmin) {
    return res.status(403).json({
        error: "Forbidden"
    });
}
        const { uid, role } = req.body;

        if (!uid || !role) {
            return res.status(400).json({ error: "uid and role are required" });
        }

        if (!["applicant", "provider", "admin"].includes(role.toLowerCase())) {
            return res.status(400).json({ error: "Invalid role" });
        }

        if (admin.auth && typeof admin.auth === "function") {
    await admin.auth().setCustomUserClaims(uid, {
        role: role.toLowerCase()
    });
}

        res.json({ message: "Custom claim set", role });

    } catch (error) {
        res.status(500).json({ error: "Failed to set custom claim" });
    }
});

// Pending listings
router.get("/admin/listings/pending", verifyToken,  async (req, res) => {
    try {
       const isAdmin =
    req.user &&
    (req.user.role === "admin" || req.user.admin === true);

if (!isAdmin) {
    return res.status(403).json({
        error: "Forbidden"
    });
}
        const snapshot = await db.collection("Opportunities")
            .where("status", "==", "pending-review")
            .get();

        const listings = [];
        snapshot.forEach(doc => listings.push({ id: doc.id, ...doc.data() }));

        res.json(listings);

    } catch (error) {
        res.status(500).json({ error: "Failed to fetch pending listings" });
    }
});

// All listings
router.get("/admin/listings", verifyToken, async (req, res) => {
    try {
        const isAdmin =
    req.user &&
    (req.user.role === "admin" || req.user.admin === true);

if (!isAdmin) {
    return res.status(403).json({
        error: "Forbidden"
    });
}
        const snapshot = await db.collection("Opportunities").get();

        const listings = [];
        snapshot.forEach(doc => listings.push({ id: doc.id, ...doc.data() }));

        res.json(listings);

    } catch (error) {
        res.status(500).json({ error: "Failed to fetch listings" });
    }
});

// Approve listing
router.patch("/admin/listings/:id/approve", verifyToken, async (req, res) => {
    try {
        const isAdmin =
    req.user &&
    (req.user.role === "admin" || req.user.admin === true);

if (!isAdmin) {
    return res.status(403).json({
        error: "Forbidden"
    });
}
        const listingRef = db.collection("Opportunities").doc(req.params.id);
        const listingDoc = await listingRef.get();

        if (!listingDoc.exists) {
            return res.status(404).json({ error: "Listing not found" });
        }

        await listingRef.update({
            status: "review_accepted",
            updatedAt: new Date().toISOString()
        });

        res.json({
            message: "Listing accepted",
            id: req.params.id
        });

        const data = listingDoc.data();
        const providerUID = data.providerID || data.providerId;

       if (providerUID) {
    try {
        await db.collection("notifications").add({
            recipientId: providerUID,
            status: "unread",
            message: `Your listing "${data.title || "your listing"}" has been accepted.`,
            listingId: req.params.id,
            timestamp: admin.firestore.FieldValue.serverTimestamp()
        });

    } catch (e) {
        console.error("Notification error:", e.message);
    }
}

    } catch (error) {
        res.status(500).json({ error: "Failed to approve listing" });
    }
});

// Remove listing
router.patch("/admin/listings/:id/remove", verifyToken, async (req, res) => {
    try {
        const isAdmin =
    req.user &&
    (req.user.role === "admin" || req.user.admin === true);

if (!isAdmin) {
    return res.status(403).json({
        error: "Forbidden"
    });
}
        const listingRef = db.collection("Opportunities").doc(req.params.id);
        const listingDoc = await listingRef.get();

        if (!listingDoc.exists) {
            return res.status(404).json({ error: "Listing not found" });
        }

       const reason = req.body?.reason || null;

        await listingRef.update({
            status: "rejected_review",
            removalReason: reason || null,
            updatedAt: new Date().toISOString()
        });

        res.json({
            message: "Listing rejected",
            id: req.params.id
        });

        const data = listingDoc.data();

        const providerUID = data.providerID || data.providerId;

        if (providerUID) {
    try {
        await db.collection("notifications").add({
            recipientId: providerUID,
            status: "unread",
            message: `Your listing "${data.title || "your listing"}" has been accepted.`,
            listingId: req.params.id,
            timestamp: admin.firestore.FieldValue.serverTimestamp()
        });
    } catch (e) {
        console.error("Notification error:", e.message);
    }
}
    } catch (error) {
        res.status(500).json({ error: "Failed to remove listing" });
    }
});

// Users list
router.get("/admin/users", verifyToken, async (req, res) => {
    try {
        const isAdmin =
    req.user &&
    (req.user.role === "admin" || req.user.admin === true);

if (!isAdmin) {
    return res.status(403).json({
        error: "Forbidden"
    });
}
        const { role, page, limit } = req.query;

        let query = db.collection("users");

        if (
    role &&
    ["applicant", "provider", "admin"].includes(role.toLowerCase())
) {
    query = query.where("role", "==", role.toLowerCase());
}

        const snapshot = await query.get();

        const users = [];
        snapshot.forEach(doc => {
            const data = doc.data();

            users.push({
                uid: doc.id,
                firstname: data.firstname || null,
                lastname: data.lastname || null,
                organization: data.organization || null,
                email: data.email || null,
                username: data.username || null,
                role: data.role || null,
                status: data.status || "active",
                createdAt: data.createdAt || null
            });
        });

       const total = users.length;

// only paginate when page and limit exist
if (page && limit) {

    const pageNum = parseInt(page);
    const pageSize = parseInt(limit);

    const pagedUsers = users.slice(
        (pageNum - 1) * pageSize,
        (pageNum - 1) * pageSize + pageSize
    );

    return res.json({
        users: pagedUsers,
        pagination: {
            total,
            page: pageNum,
            limit: pageSize,
            totalPages: Math.ceil(total / pageSize)
        }
    });
}

// default: return all users
res.json({
    users,
    pagination: {
        total,
        page: 1,
        limit: total,
        totalPages: 1
    }
});

    } catch (error) {
        res.status(500).json({ error: "Failed to fetch users" });
    }
});

// Suspend user
router.patch("/admin/users/:uid/suspend", verifyToken,  async (req, res) => {
    try {
       const isAdmin =
    req.user &&
    (req.user.role === "admin" || req.user.admin === true);

if (!isAdmin) {
    return res.status(403).json({
        error: "Forbidden"
    });
}
        const { uid } = req.params;

       if (req.user && uid === req.user.uid) {
            return res.status(400).json({ error: "Admins cannot suspend their own account" });
        }

        const userDoc = await db.collection("users").doc(uid).get();
        if (!userDoc || !userDoc.exists){
            return res.status(404).json({ error: "User not found" });
        }

        if (admin.auth && typeof admin.auth === "function") {
            await admin.auth().updateUser(uid, { disabled: true });
}

        await db.collection("users").doc(uid).update({
            status: "suspended",
            suspendedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        });

        res.json({
            message: "User suspended",
            uid
        });

    } catch (error) {
        res.status(500).json({ error: "Failed to suspend user" });
    }
});
// REACTIVATE user
router.patch("/admin/users/:uid/reactivate", verifyToken, async (req, res) => {
    try {
        const isAdmin =
    req.user &&
    (req.user.role === "admin" || req.user.admin === true);

if (!isAdmin) {
    return res.status(403).json({
        error: "Forbidden"
    });
}
        const { uid } = req.params;

        const userDoc = await db.collection("users").doc(uid).get();

        if (!userDoc || !userDoc.exists){
            return res.status(404).json({ error: "User not found" });
        }

        if (admin.auth && typeof admin.auth === "function") {
    await admin.auth().updateUser(uid, {
        disabled: false
    });
}

        await db.collection("users").doc(uid).update({
            status: "active",
            reactivatedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        });

        res.json({
            message: "User reactivated",
            uid
        });

    } catch (error) {
        console.error("Reactivate user error:", error);
        res.status(500).json({ error: "Failed to reactivate user" });
    }
});

// DELETE user
router.delete("/admin/users/:uid", verifyToken, async (req, res) => {
    try {
        const isAdmin =
    req.user &&
    (req.user.role === "admin" || req.user.admin === true);

if (!isAdmin) {
    return res.status(403).json({
        error: "Forbidden"
    });
}
        const { uid } = req.params;

        if (uid === req.user.uid) {
            return res.status(400).json({
                error: "Admins cannot delete their own account"
            });
        }

        const userDoc = await db.collection("users").doc(uid).get();
       if (!userDoc || !userDoc.exists){
            return res.status(404).json({ error: "User not found" });
        }

        if (admin.auth && typeof admin.auth === "function") {
    await admin.auth().deleteUser(uid);
}

        await db.collection("users").doc(uid).delete();

        res.json({
            message: "User deleted",
            uid
        });

    } catch (error) {
        console.error("Delete user error:", error);
        res.status(500).json({ error: "Failed to delete user" });
    }
});

module.exports = router;
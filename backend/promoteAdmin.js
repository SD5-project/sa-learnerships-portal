// backend/promoteAdmin.js
// ─────────────────────────────────────────────────
// Run this ONCE to promote a user to admin.
// It updates BOTH Firebase Auth custom claim AND Firestore.
//
// Usage:
//   node backend/promoteAdmin.js <uid>
//
// Example:
//   node backend/promoteAdmin.js B7m4y3uLSqSfQ7Uc2L50I7wVQaV2
// ─────────────────────────────────────────────────

const { db, admin } = require("./firebaseAdmin");

const uid = process.argv[2];

if (!uid) {
    console.error("❌ Please provide a UID as an argument.");
    console.error("   Usage: node backend/promoteAdmin.js <uid>");
    process.exit(1);
}

async function promoteToAdmin(uid) {
    console.log(`\nPromoting user ${uid} to admin...\n`);

    try {
        // ── Step 1: Check user exists in Firebase Auth ──────────────────────
        let authUser;
        try {
            authUser = await admin.auth().getUser(uid);
            console.log(`✅ Found Auth user: ${authUser.email}`);
        } catch (err) {
            console.error(`❌ User not found in Firebase Auth: ${err.message}`);
            process.exit(1);
        }

        // ── Step 2: Update Firebase Auth custom claim ───────────────────────
        await admin.auth().setCustomUserClaims(uid, { role: "admin" });
        console.log(`✅ Firebase Auth custom claim set to: admin`);

        // ── Step 3: Update Firestore users collection ───────────────────────
        const userRef = db.collection("users").doc(uid);
        const userDoc = await userRef.get();

        if (userDoc.exists) {
            await userRef.update({
                role:      "admin",
                updatedAt: new Date().toISOString()
            });
            console.log(`✅ Firestore users/${uid} role updated to: admin`);
        } else {
            // User exists in Auth but not Firestore — create the document
            await userRef.set({
                email:     authUser.email,
                role:      "admin",
                status:    "active",
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            });
            console.log(`✅ Firestore document created for ${uid} with role: admin`);
        }

        // ── Step 4: Verify ──────────────────────────────────────────────────
        const updated = await admin.auth().getUser(uid);
        const claims  = updated.customClaims;
        console.log(`\n✅ Verification — current custom claims:`, claims);

        if (claims && claims.role === "admin") {
            console.log(`\n🎉 Success! ${authUser.email} is now an admin.`);
            console.log(`   They must log OUT and log back IN for the change to take effect.\n`);
        } else {
            console.error(`\n❌ Something went wrong — claim not set correctly.`);
        }

    } catch (error) {
        console.error("❌ Promotion failed:", error.message);
    }

    process.exit(0);
}

promoteToAdmin(uid);
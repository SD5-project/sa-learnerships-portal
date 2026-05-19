// backend/promoteAdmin.js
// Run once: node backend/promoteAdmin.js <uid>

const { db, admin } = require("./firebaseAdmin");
const { adminRef }  = require("./userPaths");

const uid = process.argv[2];
if (!uid) {
    console.error("❌ Usage: node backend/promoteAdmin.js <uid>");
    process.exit(1);
}

async function promoteToAdmin(uid) {
    console.log(`\nPromoting user ${uid} to admin...\n`);
    try {
        // Step 1: Verify user exists in Firebase Auth
        let authUser;
        try {
            authUser = await admin.auth().getUser(uid);
            console.log(`✅ Found Auth user: ${authUser.email}`);
        } catch (err) {
            console.error(`❌ User not found in Firebase Auth: ${err.message}`);
            process.exit(1);
        }

        // Step 2: Set custom claim
        await admin.auth().setCustomUserClaims(uid, { role: "admin" });
        console.log(`✅ Firebase Auth custom claim set to: admin`);

        // Step 3: Write to users/admins/profiles/{uid}
        const adminData = {
            email:     authUser.email,
            role:      "admin",
            status:    "active",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
        await adminRef(uid).set(adminData, { merge: true });
        console.log(`✅ Written to users/admins/profiles/${uid}`);

        // Step 4: Also update flat users collection if it exists
        const flatDoc = await db.collection("users").doc(uid).get();
        if (flatDoc.exists) {
            await db.collection("users").doc(uid).update({ role: "admin", updatedAt: new Date().toISOString() });
            console.log(`✅ Updated flat users/${uid} role to admin`);
        }

        // Step 5: Verify
        const updated = await admin.auth().getUser(uid);
        const claims  = updated.customClaims;
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
// firebaseAdmin.js
const admin = require("firebase-admin");

let credential;

if (process.env.FIREBASE_PROJECT_ID) {
    // ✅ Azure — decode private key from Base64 to avoid newline corruption
    let privateKey;

    if (process.env.FIREBASE_PRIVATE_KEY_BASE64) {
        // Preferred: Base64 encoded key (no newline issues)
        privateKey = Buffer.from(process.env.FIREBASE_PRIVATE_KEY_BASE64, 'base64').toString('utf8');
        console.log("✅ Using Base64 decoded private key");
    } else {
        // Fallback: raw key with newline replacement
        privateKey = process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n');
        console.log("⚠️ Using raw private key with newline replacement");
    }

    credential = admin.credential.cert({
        projectId:   process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey
    });
} else {
    // ✅ Local — use serviceAccountKey.json
    const serviceAccount = require("./serviceAccountKey.json");
    credential = admin.credential.cert(serviceAccount);
    console.log("✅ Using local serviceAccountKey.json");
}

admin.initializeApp({
    credential,
    storageBucket: "sd5-project-77355.appspot.com"
});

const db = admin.firestore();

module.exports = { admin, db };
/* listing-logic.js*/

const { db } = require("./firebaseAdmin");

async function getAllListings() {
    try {
        const snapshot = await db.collection('listings').get();
        return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (error) {
        throw new Error("Failed to fetch listings: " + error.message);
    }
}

module.exports = { getAllListings };
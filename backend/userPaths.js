/**
 * userPaths.js
 * Centralises all Firestore document references for user profiles.
 *
 * Data structure:
 *   users/
 *     applicants/
 *       profiles/
 *         {uid}   ← applicant profile document
 *     providers/
 *       profiles/
 *         {uid}   ← provider profile document
 *
 * Using helper functions instead of inline collection paths prevents
 * typos and makes it easy to restructure the database in one place.
 */

const { db } = require('./firebaseAdmin');

/** Returns a reference to the applicants sub-collection. */
const applicantsCol = () => db.collection('users').doc('applicants').collection('profiles');

/** Returns a reference to the providers sub-collection. */
const providersCol  = () => db.collection('users').doc('providers').collection('profiles');

/**
 * Returns a DocumentReference for a specific applicant profile.
 * @param {string} uid - Firebase Auth UID of the applicant.
 */
const applicantRef = (uid) => applicantsCol().doc(uid);

/**
 * Returns a DocumentReference for a specific provider profile.
 * @param {string} uid - Firebase Auth UID of the provider.
 */
const providerRef  = (uid) => providersCol().doc(uid);

/**
 * Looks up a user in both subcollections when the role is unknown.
 * Checks applicants first, then providers.
 *
 * @param {string} uid - Firebase Auth UID to look up.
 * @returns {{ snap: FirebaseFirestore.DocumentSnapshot|null, ref: FirebaseFirestore.DocumentReference|null, role: string|null }}
 */
async function lookupUser(uid) {
    const [aSnap, pSnap] = await Promise.all([
        applicantRef(uid).get(),
        providerRef(uid).get()
    ]);

    if (aSnap.exists) return { snap: aSnap, ref: applicantRef(uid), role: 'applicant' };
    if (pSnap.exists) return { snap: pSnap, ref: providerRef(uid), role: 'provider' };

    // User not found in either subcollection
    return { snap: null, ref: null, role: null };
}

module.exports = { applicantsCol, providersCol, applicantRef, providerRef, lookupUser };

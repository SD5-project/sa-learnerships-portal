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
 *     admins/
 *       profiles/
 *         {uid}   ← admin profile document
 */

const { db } = require('./firebaseAdmin');

// ─── Collection references ────────────────────────────────────────────────────
const applicantsCol = () => db.collection('users').doc('applicants').collection('profiles');
const providersCol  = () => db.collection('users').doc('providers').collection('profiles');
const adminsCol     = () => db.collection('users').doc('admins').collection('profiles');

// ─── Document references ──────────────────────────────────────────────────────
const applicantRef = (uid) => applicantsCol().doc(uid);
const providerRef  = (uid) => providersCol().doc(uid);
const adminRef     = (uid) => adminsCol().doc(uid);

/**
 * Looks up a user across all three subcollections when the role is unknown.
 * Checks applicants first, then providers, then admins.
 *
 * @param {string} uid
 * @returns {{ snap, ref, role }}
 */
async function lookupUser(uid) {
    const [aSnap, pSnap, adSnap] = await Promise.all([
        applicantRef(uid).get(),
        providerRef(uid).get(),
        adminRef(uid).get()
    ]);

    if (aSnap.exists)  return { snap: aSnap,  ref: applicantRef(uid), role: 'applicant' };
    if (pSnap.exists)  return { snap: pSnap,  ref: providerRef(uid),  role: 'provider'  };
    if (adSnap.exists) return { snap: adSnap, ref: adminRef(uid),     role: 'admin'     };

    return { snap: null, ref: null, role: null };
}

module.exports = { applicantsCol, providersCol, adminsCol, applicantRef, providerRef, adminRef, lookupUser };
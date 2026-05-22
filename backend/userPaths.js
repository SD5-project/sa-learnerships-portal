/**
 * userPaths.js
 * Centralises all Firestore document references for user profiles.
 *
 * Firestore has three parallel user-storage patterns that grew over time:
 *
 *   Pattern 1 — flat (legacy + admins written during signup):
 *     users/{uid}
 *
 *   Pattern 2 — subcollections (current signup flow):
 *     users/applicants/profiles/{uid}
 *     users/providers/profiles/{uid}
 *     users/admins/profiles/{uid}
 *
 *   Pattern 3 — top-level (some providers written here):
 *     Providers/{uid}
 *
 * lookupUser() checks all four locations so every user finds their data.
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
 * Looks up a user across ALL known Firestore locations.
 * Order: subcollections first (most common), then flat, then top-level Providers.
 *
 * @param {string} uid
 * @returns {Promise<{ snap: FirestoreDocSnap|null, ref: DocRef|null, role: string|null }>}
 */
async function lookupUser(uid) {
    // Check all locations in parallel for speed
    const [aSnap, pSnap, adSnap, flatSnap, topProvSnap] = await Promise.all([
        applicantRef(uid).get(),
        providerRef(uid).get(),
        adminRef(uid).get(),
        db.collection('users').doc(uid).get(),
        db.collection('Providers').doc(uid).get()
    ]);

    if (aSnap.exists)    return { snap: aSnap,       ref: applicantRef(uid),                       role: 'applicant' };
    if (pSnap.exists)    return { snap: pSnap,        ref: providerRef(uid),                        role: 'provider'  };
    if (adSnap.exists)   return { snap: adSnap,       ref: adminRef(uid),                           role: 'admin'     };
    if (flatSnap.exists) return { snap: flatSnap,     ref: db.collection('users').doc(uid),         role: flatSnap.data().role || null };
    if (topProvSnap.exists) return { snap: topProvSnap, ref: db.collection('Providers').doc(uid),   role: 'provider'  };

    return { snap: null, ref: null, role: null };
}

module.exports = { applicantsCol, providersCol, adminsCol, applicantRef, providerRef, adminRef, lookupUser };
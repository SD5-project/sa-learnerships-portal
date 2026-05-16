const { db } = require('./firebaseAdmin');

const applicantsCol = () => db.collection('users').doc('applicants').collection('profiles');
const providersCol  = () => db.collection('users').doc('providers').collection('profiles');

const applicantRef = (uid) => applicantsCol().doc(uid);
const providerRef  = (uid) => providersCol().doc(uid);

// Checks both subcollections — use when role is unknown
async function lookupUser(uid) {
    const [aSnap, pSnap] = await Promise.all([
        applicantRef(uid).get(),
        providerRef(uid).get()
    ]);
    if (aSnap.exists) return { snap: aSnap, ref: applicantRef(uid), role: 'applicant' };
    if (pSnap.exists) return { snap: pSnap, ref: providerRef(uid), role: 'provider' };
    return { snap: null, ref: null, role: null };
}

module.exports = { applicantsCol, providersCol, applicantRef, providerRef, lookupUser };

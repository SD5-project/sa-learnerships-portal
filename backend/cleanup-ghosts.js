/**
 * cleanup-ghosts.js
 * One-time script to delete Firebase Auth accounts that have no matching
 * Firestore profile (i.e. abandoned signups / ghost accounts).
 *
 * Run from the backend folder:
 *   node cleanup-ghosts.js
 *
 * Dry-run mode (lists ghosts without deleting):
 *   node cleanup-ghosts.js --dry-run
 */

const path    = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { admin, db } = require('./firebaseAdmin');

const DRY_RUN = process.argv.includes('--dry-run');

async function cleanupGhosts() {
    console.log(DRY_RUN ? '--- DRY RUN (nothing will be deleted) ---\n' : '--- LIVE RUN ---\n');

    let pageToken;
    let totalChecked = 0;
    let ghostCount   = 0;

    do {
        const result = await admin.auth().listUsers(1000, pageToken);

        for (const user of result.users) {
            totalChecked++;

            // Check all three profile subcollections
            const [aSnap, pSnap, adSnap] = await Promise.all([
                db.collection('users').doc('applicants').collection('profiles').doc(user.uid).get(),
                db.collection('users').doc('providers').collection('profiles').doc(user.uid).get(),
                db.collection('users').doc('admins').collection('profiles').doc(user.uid).get()
            ]);

            // Also check the flat users collection (legacy structure)
            const flatSnap = await db.collection('users').doc(user.uid).get();

            const hasRecord = aSnap.exists || pSnap.exists || adSnap.exists || flatSnap.exists;

            if (!hasRecord) {
                ghostCount++;
                console.log(`GHOST: ${user.email} | uid: ${user.uid} | verified: ${user.emailVerified} | created: ${user.metadata.creationTime}`);

                if (!DRY_RUN) {
                    await admin.auth().deleteUser(user.uid);
                    console.log(`  → Deleted.`);
                }
            }
        }

        pageToken = result.pageToken;
    } while (pageToken);

    console.log(`\nChecked: ${totalChecked} accounts`);
    console.log(`Ghosts ${DRY_RUN ? 'found' : 'deleted'}: ${ghostCount}`);
}

cleanupGhosts().catch(err => {
    console.error('Cleanup failed:', err.message);
    process.exit(1);
});

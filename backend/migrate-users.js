// backend/migrate-users.js
// Run ONCE: node backend/migrate-users.js
// Copies documents to the new nested paths WITHOUT deleting originals.
// Verify data in Firebase console, then delete originals when ready.

const { db } = require('./firebaseAdmin');

async function migrate() {
    let count;

    // ── 1. users/* → users/applicants/profiles/* ─────────────────────────────
    console.log('\nReading users collection...');
    const usersSnap        = await db.collection('users').get();
    const applicantsTarget = db.collection('users').doc('applicants').collection('profiles');

    count = 0;
    for (const doc of usersSnap.docs) {
        await applicantsTarget.doc(doc.id).set(doc.data());
        count++;
        if (count % 20 === 0) console.log(`  Copied ${count} docs...`);
    }
    console.log(`Done: ${count} doc(s) copied to users/applicants/profiles/`);

    // ── 2. Provider/* → users/providers/profiles/* ───────────────────────────
    console.log('\nReading Provider collection...');
    const providerSnap    = await db.collection('Provider').get();
    const providersTarget = db.collection('users').doc('providers').collection('profiles');

    count = 0;
    for (const doc of providerSnap.docs) {
        await providersTarget.doc(doc.id).set(doc.data());
        count++;
        if (count % 20 === 0) console.log(`  Copied ${count} docs...`);
    }
    console.log(`Done: ${count} doc(s) copied to users/providers/profiles/`);

    console.log('\nMigration complete.');
    console.log('Originals in users/ and Provider/ have NOT been touched.');
    console.log('Verify the data in Firebase console, then confirm deletion when ready.');
}

migrate()
    .catch(err => { console.error('Migration failed:', err); process.exit(1); })
    .finally(() => process.exit(0));

/**
 * reminderJob.js
 * Scheduled cron job that sends closing-date reminders to eligible applicants.
 *
 * Runs every day at 08:00 AM. For each live listing closing within 3 days,
 * it finds applicants whose NQF level meets the minimum requirement, checks that
 * they haven't already applied or received a reminder, then sends an in-app
 * notification and an email. Failures per applicant are caught individually so
 * one bad record does not stop the entire job.
 *
 * Fixes applied:
 *  1. getClosingListings: queries all live statuses (auto_approved, review_accepted,
 *     approved legacy) instead of just "approved", matching the real Firestore data.
 *  2. getEligibleApplicants: nqfLevel is stored as a STRING in Firestore (e.g. "6"),
 *     so Firestore's >= operator compares lexicographically and breaks on numbers > 9.
 *     We now fetch all applicants and filter in-memory by parsing the integer value.
 *     We also check both 'nqfLevel' and 'highestNQFLevel' field names for compatibility.
 *  3. createInAppNotification: uses 'recipientId' (not 'userId') to match the field
 *     name expected by the applicant-home notifications listener.
 *  4. sendReminderEmail: reuses the shared transporter from helpers.js instead of
 *     creating a new nodemailer instance on every call (avoids credential duplication).
 *  5. runReminderJob: parses minimumNQFLevel as an integer from the listing doc
 *     (stored as string "6" in Firestore per the screenshot) before comparing.
 *
 * Exported functions are unit-tested in backend/__tests__/reminderJob.test.js.
 */

const { db, admin } = require("./firebaseAdmin");

// ── GET CLOSING LISTINGS ─────────────────────────────────────────────────────
/**
 * Fetches all live opportunity listings whose closing date falls
 * within the next 3 days (inclusive of today).
 *
 * Queries all three live status values in parallel to handle both legacy
 * ("approved") and current ("auto_approved", "review_accepted") status strings.
 *
 * @returns {Promise<Array<{ id: string, [key: string]: any }>>}
 */
async function getClosingListings() {
    const now     = new Date();
    const in3Days = new Date();
    in3Days.setDate(now.getDate() + 3);

    const todayStr    = now.toISOString().split("T")[0];
    const in3DaysStr  = in3Days.toISOString().split("T")[0];

    // Query all live statuses in parallel — Firestore doesn't support OR queries
    // on the same field without a composite index, so we run three queries.
    const [snap1, snap2, snap3] = await Promise.all([
        db.collection("Opportunities")
            .where("status",      "==", "auto_approved")
            .where("closingDate", ">=", todayStr)
            .where("closingDate", "<=", in3DaysStr)
            .get(),
        db.collection("Opportunities")
            .where("status",      "==", "review_accepted")
            .where("closingDate", ">=", todayStr)
            .where("closingDate", "<=", in3DaysStr)
            .get(),
        db.collection("Opportunities")
            .where("status",      "==", "approved")
            .where("closingDate", ">=", todayStr)
            .where("closingDate", "<=", in3DaysStr)
            .get()
    ]);

    const seen     = new Set();
    const listings = [];
    [snap1, snap2, snap3].forEach(snap => {
        snap.forEach(doc => {
            if (seen.has(doc.id)) return;
            seen.add(doc.id);
            listings.push({ id: doc.id, ...doc.data() });
        });
    });

    console.log(`Found ${listings.length} listings closing within 3 days`);
    return listings;
}

// ── GET ELIGIBLE APPLICANTS ──────────────────────────────────────────────────
/**
 * Returns all applicants whose NQF level is >= the given minimum.
 *
 * The nqfLevel field is stored as a STRING in Firestore (e.g. "6"), so we
 * cannot rely on Firestore's >= operator (lexicographic comparison breaks for
 * multi-digit numbers). Instead we fetch all applicants and filter in JS.
 *
 * We check both 'nqfLevel' and 'highestNQFLevel' field names for compatibility
 * with different signup flows.
 *
 * @param {number} minimumNQFLevel - The minimum NQF level required (integer).
 * @returns {Promise<Array<{ id: string, [key: string]: any }>>}
 */
async function getEligibleApplicants(minimumNQFLevel) {
    const minLevel = parseInt(minimumNQFLevel, 10);

    const snapshot = await db.collection("users")
        .where("role", "==", "applicant")
        .get();

    const applicants = [];
    snapshot.forEach(doc => {
        const data = doc.data();
        // Support both field names — nqfLevel (from reminderJob) and highestNQFLevel (from profile)
        const rawLevel = data.nqfLevel || data.highestNQFLevel || null;
        if (rawLevel === null) return; // skip applicants with no NQF level set

        const applicantLevel = parseInt(rawLevel, 10);
        if (isNaN(applicantLevel)) return; // skip unparseable values

        if (applicantLevel >= minLevel) {
            applicants.push({ id: doc.id, ...data });
        }
    });

    return applicants;
}

// ── CHECK IF APPLICANT ALREADY APPLIED ──────────────────────────────────────
async function hasAlreadyApplied(applicantId, listingId) {
    const snapshot = await db.collection("applications")
        .where("applicantID", "==", applicantId)
        .where("listingID",   "==", listingId)
        .get();

    return !snapshot.empty; // true = already applied
}

// ── CHECK IF REMINDER ALREADY SENT ──────────────────────────────────────────
async function reminderAlreadySent(applicantId, listingId) {
    const snapshot = await db.collection("reminderLogs")
        .where("applicantID", "==", applicantId)
        .where("listingId",   "==", listingId)
        .get();

    return !snapshot.empty; // true = already sent
}

// ── CREATE IN-APP NOTIFICATION ───────────────────────────────────────────────
/**
 * Writes a notification document readable by the applicant-home notification
 * listener, which filters on 'recipientId' (not 'userId').
 */
async function createInAppNotification(applicantId, listing) {
    await db.collection("notifications").add({
        recipientId: applicantId,          // matches applicant-home listener query
        userId:      applicantId,          // kept for backwards compatibility
        type:        "closing_reminder",
        message:     `Reminder: "${listing.title}" closes in 3 days on ${listing.closingDate}. Don't miss out!`,
        listingId:   listing.id,
        status:      "unread",
        read:        false,
        timestamp:   admin.firestore.FieldValue.serverTimestamp(),
        createdAt:   admin.firestore.FieldValue.serverTimestamp()
    });
}

// ── SEND EMAIL REMINDER ──────────────────────────────────────────────────────
/**
 * Sends a closing-date reminder email. Reuses the shared transporter from
 * helpers.js so credentials are configured in one place (via .env).
 * In test mode, logs instead of sending.
 */
async function sendReminderEmail(applicantEmail, applicantName, listing) {
    if (!applicantEmail) {
        console.warn(`[reminderJob] Skipping email — no address for applicant`);
        return;
    }

    // Skip real email in test environment
    if (process.env.NODE_ENV === "test") {
        console.log(`[TEST] Would send reminder email to ${applicantEmail}`);
        return;
    }

    // Reuse the shared sendMail helper (nodemailer transporter in helpers.js)
    const { sendMail } = require("./helpers");

    await sendMail(
        applicantEmail,
        `Reminder: "${listing.title}" closes in 3 days!`,
        `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 24px;">
            <h2 style="color: #0ea5e9;">⏳ Don't miss out!</h2>
            <p>Hi ${applicantName},</p>
            <p>The opportunity <strong>${listing.title}</strong> is closing in <strong>3 days</strong> on <strong>${listing.closingDate}</strong>.</p>
            ${listing.company   ? `<p>Company: <strong>${listing.company}</strong></p>` : ""}
            ${listing.location  ? `<p>Location: ${listing.location}</p>` : ""}
            ${listing.type      ? `<p>Type: ${listing.type}</p>` : ""}
            <br>
            <p>Log in to the SA Learnerships Portal to apply now before it closes.</p>
            <a href="${process.env.APP_URL || "https://skillsconnect.azurewebsites.net"}/listing-info?listingID=${listing.id}"
               style="display:inline-block;background:#0ea5e9;color:#000;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;margin-top:12px;">
               View &amp; Apply Now →
            </a>
            <p style="margin-top:24px;font-size:12px;color:#64748b;">
                You received this email because your NQF level meets the requirements for this opportunity.
            </p>
        </div>
        `
    );

    console.log(`Reminder email sent to ${applicantEmail} for "${listing.title}"`);
}

// ── MAIN REMINDER JOB ────────────────────────────────────────────────────────
async function runReminderJob() {
    console.log("Running closing date reminder job...");

    // Step 1: Get listings closing within 3 days (all live statuses)
    const listings = await getClosingListings();

    if (listings.length === 0) {
        console.log("No listings closing within 3 days — job complete.");
        return;
    }

    for (const listing of listings) {

        // Parse minimumNQFLevel as integer — stored as string "6" in Firestore
        const minNQF = parseInt(listing.minimumNQFLevel || listing.nqfLevel || "1", 10);

        // Step 2: Get eligible applicants (in-memory NQF filter)
        const applicants = await getEligibleApplicants(isNaN(minNQF) ? 1 : minNQF);

        console.log(`Processing "${listing.title}" — ${applicants.length} eligible applicants`);

        for (const applicant of applicants) {

            // Error handling per applicant: one failure doesn't stop the whole job
            try {
                // Step 3: Skip if already applied
                const applied = await hasAlreadyApplied(applicant.id, listing.id);
                if (applied) continue;

                // Step 4: Skip if reminder already sent for this listing
                const alreadySent = await reminderAlreadySent(applicant.id, listing.id);
                if (alreadySent) continue;

                // Step 5: Send in-app notification
                await createInAppNotification(applicant.id, listing);

                // Step 6: Send email reminder
                await sendReminderEmail(
                    applicant.email,
                    applicant.firstname || "Applicant",
                    listing
                );

                // Step 7: Log that reminder was sent (prevents duplicates)
                await db.collection("reminderLogs").add({
                    applicantID: applicant.id,
                    listingId:   listing.id,
                    sentAt:      admin.firestore.FieldValue.serverTimestamp()
                });

                console.log(`✓ Reminder sent to ${applicant.email} for "${listing.title}"`);

            } catch (error) {
                console.error(
                    `✗ Failed to process applicant ${applicant.id} for listing ${listing.id}:`,
                    error.message
                );
            }
        }
    }

    console.log("Reminder job complete.");
}

// ── CRON SCHEDULE ────────────────────────────────────────────────────────────
const cron = require("node-cron");

// Runs every day at 8:00 AM server time
cron.schedule("0 8 * * *", () => {
    console.log("Scheduled reminder job triggered...");
    runReminderJob().catch(err => console.error("Reminder job crashed:", err.message));
});

// ── EXPORTS (for unit testing) ────────────────────────────────────────────────
module.exports = {
    runReminderJob,
    getClosingListings,
    getEligibleApplicants,
    hasAlreadyApplied,
    reminderAlreadySent,
    createInAppNotification,
    sendReminderEmail
};
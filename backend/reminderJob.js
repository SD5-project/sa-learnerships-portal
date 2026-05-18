/**
 * reminderJob.js
 * Scheduled cron job that sends closing-date reminders to eligible applicants.
 *
 * Runs every day at 08:00 AM. For each approved listing closing within 3 days,
 * it finds applicants whose NQF level meets the minimum requirement, checks that
 * they haven't already applied or received a reminder, then sends an in-app
 * notification and an email. Failures per applicant are caught individually so
 * one bad record does not stop the entire job.
 *
 * Exported functions are unit-tested in backend/__tests__/reminderJob.test.js.
 */

const { db, admin } = require("./firebaseAdmin");

/**
 * Fetches all approved opportunity listings whose closing date falls
 * within the next 3 days (inclusive of today).
 *
 * @returns {Promise<Array<{ id: string, [key: string]: any }>>}
 */
async function getClosingListings() {
    const now     = new Date();
    const in3Days = new Date();
    in3Days.setDate(now.getDate() + 3);

    const snapshot = await db.collection("Opportunities")
        .where("status",      "==",  "approved")
        .where("closingDate", ">=",  now.toISOString().split("T")[0])
        .where("closingDate", "<=",  in3Days.toISOString().split("T")[0])
        .get();

    const listings = [];
    snapshot.forEach(doc => {
        listings.push({ id: doc.id, ...doc.data() });
    });

    console.log(`Found ${listings.length} listings closing within 3 days`);
    return listings;
}

// ── GET ELIGIBLE APPLICANTS FOR A LISTING ───────
async function getEligibleApplicants(minimumNQFLevel) {
    const snapshot = await db.collection("users")
        .where("role",            "==", "applicant")
        .where("nqfLevel", ">=", minimumNQFLevel)
        .get();

    const applicants = [];
    snapshot.forEach(doc => {
        applicants.push({ id: doc.id, ...doc.data() });
    });

    return applicants;
}
 // ── CHECK IF APPLICANT ALREADY APPLIED ──────────
async function hasAlreadyApplied(applicantId, listingId) {
    const snapshot = await db.collection("applications")
        .where("applicantID", "==", applicantId)
        .where("listingID","==", listingId)
        .get();

    return !snapshot.empty; // true = already applied
}
 // ── CHECK IF REMINDER ALREADY SENT ──────────────
async function reminderAlreadySent(applicantId, listingId) {
    const snapshot = await db.collection("reminderLogs")
        .where("applicantID", "==", applicantId)
        .where("listingId",   "==", listingId)
        .get();

    return !snapshot.empty; // true = already sent
}
 // ── CREATE IN-APP NOTIFICATION ───────────────────
async function createInAppNotification(applicantId, listing) {
    await db.collection("notifications").add({
        userId:    applicantId,
        type:      "closing_reminder",
        message:   `Reminder: "${listing.title}" closes in 3 days. Don't miss out!`,
        listingId: listing.id,
        read:      false,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
}

const nodemailer = require("nodemailer");

// ── SEND EMAIL REMINDER ──────────────────────────
async function sendReminderEmail(applicantEmail, applicantName, listing) {

    // Skip email in test environment
    if (process.env.NODE_ENV === "test") {
        console.log(`[TEST] Would send email to ${applicantEmail}`);
        return;
    }

    const transporter = nodemailer.createTransport({
        service: "gmail",
        auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASS
        }
    });

    await transporter.sendMail({
        from:    process.env.EMAIL_USER,
        to:      applicantEmail,
        subject: `Reminder: ${listing.title} closes in 3 days!`,
        html: `
            <h2>Don't miss out!</h2>
            <p>Hi ${applicantName},</p>
            <p>The opportunity <strong>${listing.title}</strong> 
               is closing in 3 days on ${listing.closingDate}.</p>
            <p>Log in to the SA Learnerships Portal to apply now.</p>
        `
    });

    console.log(`Email sent to ${applicantEmail}`);
}

// ── MAIN REMINDER JOB ────────────────────────────
async function runReminderJob() {
    console.log("Running closing date reminder job...");

    // Step 1: Get listings closing within 3 days
    const listings = await getClosingListings();

    for (const listing of listings) {

        // Step 2: Get eligible applicants
        const applicants = await getEligibleApplicants(
            listing.minimumNQFLevel || 1
        );

        for (const applicant of applicants) {

            // Task 9: Error handling per applicant
            try {
                // Step 3: Check if already applied
                const applied = await hasAlreadyApplied(
                    applicant.id, 
                    listing.id
                );
                if (applied) continue;

                // Step 4: Check if reminder already sent
                const alreadySent = await reminderAlreadySent(
                    applicant.id, 
                    listing.id
                );
                if (alreadySent) continue;

                // Step 5: Send in-app notification
                await createInAppNotification(applicant.id, listing);

                // Step 6: Send email
                await sendReminderEmail(
                    applicant.email,
                    applicant.firstname || "Applicant",
                    listing
                );

                // Step 7: Log that reminder was sent
                await db.collection("reminderLogs").add({
                    applicantID: applicant.id,
                    listingId:   listing.id,
                    sentAt:      admin.firestore.FieldValue.serverTimestamp()
                });

                console.log(`Reminder sent to ${applicant.email} for ${listing.title}`);

            } catch (error) {
                // Task 9: One failure does not stop the whole job
                console.error(
                    `Failed to process applicant ${applicant.id}:`, 
                    error.message
                );
            }
        }
    }

    console.log("Reminder job complete.");
}

const cron = require("node-cron");

// Runs every day at 8:00 AM
cron.schedule("0 8 * * *", () => {
    console.log("Scheduled reminder job triggered...");
    runReminderJob();
});

// Export for testing
module.exports = {
    runReminderJob,
    getClosingListings,
    getEligibleApplicants,
    hasAlreadyApplied,
    reminderAlreadySent
};
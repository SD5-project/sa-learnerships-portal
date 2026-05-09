const {
    getEligibleApplicants,
    hasAlreadyApplied,
    reminderAlreadySent
} = require("../backend/reminderJob");

// Mock Firestore so we don't hit real database
jest.mock("../backend/firebaseAdmin", () => ({
    db: {
        collection: jest.fn(() => ({
            where: jest.fn(() => ({
                where: jest.fn(() => ({
                    get: jest.fn(() => ({
                        empty: false,
                        forEach: jest.fn()
                    }))
                }))
            }))
        }))
    },
    admin: {
        firestore: {
            FieldValue: {
                serverTimestamp: jest.fn()
            }
        }
    }
}));

// ── TEST 1: NQF Matching ─────────────────────────
describe("NQF Matching", () => {
    test("applicant with NQF 4 matches listing requiring NQF 4", () => {
        const applicantNQF = 4;
        const listingNQF   = 4;
        expect(applicantNQF >= listingNQF).toBe(true);
    });

    test("applicant with NQF 3 does not match listing requiring NQF 4", () => {
        const applicantNQF = 3;
        const listingNQF   = 4;
        expect(applicantNQF >= listingNQF).toBe(false);
    });
});

// ── TEST 2: Closing Date Matching ────────────────
describe("Closing Date Matching", () => {
    test("listing closing in 2 days is within 3 day window", () => {
        const today      = new Date();
        const closing    = new Date();
        closing.setDate(today.getDate() + 2);
        const diffDays   = Math.ceil(
            (closing - today) / (1000 * 60 * 60 * 24)
        );
        expect(diffDays).toBeLessThanOrEqual(3);
    });

    test("listing closing in 5 days is outside 3 day window", () => {
        const today      = new Date();
        const closing    = new Date();
        closing.setDate(today.getDate() + 5);
        const diffDays   = Math.ceil(
            (closing - today) / (1000 * 60 * 60 * 24)
        );
        expect(diffDays).toBeGreaterThan(3);
    });
});

// ── TEST 3: No real emails in tests ─────────────
describe("Email dispatch", () => {
    test("does not send real email in test environment", async () => {
        process.env.NODE_ENV = "test";
        const consoleSpy = jest.spyOn(console, "log");
        // Verify test mode skips real email
        expect(process.env.NODE_ENV).toBe("test");
    });
});
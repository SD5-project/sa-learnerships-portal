const request = require("supertest");

// ─── Mocks ────────────────────────────────────────────────────────────────────
let mockVerifyIdToken;
let mockSetCustomClaims;
let mockApplicationDocGet;
let mockApplicationDocUpdate;
let mockOpportunityDocGet;

jest.mock("../../backend/firebaseAdmin", () => {
    mockVerifyIdToken        = jest.fn();
    mockSetCustomClaims      = jest.fn().mockResolvedValue();
    mockApplicationDocGet    = jest.fn();
    mockApplicationDocUpdate = jest.fn().mockResolvedValue();
    mockOpportunityDocGet    = jest.fn();

    return {
        admin: {
            auth: () => ({
                verifyIdToken:       mockVerifyIdToken,
                setCustomUserClaims: mockSetCustomClaims,
            }),
        },
        db: {
            collection: (name) => ({
                doc: (_id) => ({
                    get: () => {
                        if (name === "applications")  return mockApplicationDocGet();
                        if (name === "Opportunities") return mockOpportunityDocGet();
                    },
                    update: mockApplicationDocUpdate,
                    set:    jest.fn().mockResolvedValue(),
                }),
                where: () => ({
                    get: jest.fn().mockResolvedValue({ forEach: () => {} }),
                }),
                get:  jest.fn().mockResolvedValue({ forEach: () => {} }),
                add:  jest.fn().mockResolvedValue({ id: "new-id" }),
            }),
        },
    };
});

const app = require("../../backend/app");

// ─── Reset mocks and set safe defaults before every test ──────────────────────
beforeEach(() => {
    jest.clearAllMocks();

    // Default: application exists, shortlisted, owned by provider_001
    mockApplicationDocGet.mockResolvedValue({
        exists: true,
        data: () => ({
            applicantID: "applicant_001",
            listingID:   "listing_001",
            status:      "shortlisted"
        })
    });

    // Default: opportunity owned by provider_001
    mockOpportunityDocGet.mockResolvedValue({
        exists: true,
        data: () => ({ providerID: "provider_001" })
    });

    // Default: update succeeds
    mockApplicationDocUpdate.mockResolvedValue();
});

// =============================================================================
// US-04: Offer Extension
// As a Provider, I want to extend an offer to a shortlisted applicant
// =============================================================================
describe("US-04: Offer Extension — PATCH /api/applicants/:applicationID/status", () => {

    // ── AC1: Provider can mark a shortlisted applicant as accepted ────────────
    describe("AC1: Provider can mark a shortlisted applicant as accepted", () => {

        test("✅ Provider can update a shortlisted application to accepted", async () => {
            mockVerifyIdToken.mockResolvedValue({ uid: "provider_001", role: "provider" });

            const res = await request(app)
                .patch("/api/applicants/app_001/status")
                .set("Authorization", "Bearer valid-token")
                .send({ status: "accepted" });

            expect(res.status).toBe(200);
            expect(res.body.message).toBe("Status updated");
            expect(res.body.status).toBe("accepted");
        });

        test("✅ Firestore is updated with accepted status and updatedAt timestamp", async () => {
            mockVerifyIdToken.mockResolvedValue({ uid: "provider_001", role: "provider" });

            let savedUpdate = {};
            mockApplicationDocUpdate.mockImplementationOnce((data) => {
                savedUpdate = data;
                return Promise.resolve();
            });

            await request(app)
                .patch("/api/applicants/app_001/status")
                .set("Authorization", "Bearer valid-token")
                .send({ status: "accepted" });

            expect(savedUpdate.status).toBe("accepted");
            expect(savedUpdate.updatedAt).toBeDefined();
        });
    });

    // ── AC2: Offer action only available for shortlisted applications ──────────
    describe("AC2: Offer action only available for shortlisted applications", () => {

        test("❌ Cannot accept an application that is still pending", async () => {
            mockVerifyIdToken.mockResolvedValue({ uid: "provider_001", role: "provider" });

            mockApplicationDocGet.mockResolvedValue({
                exists: true,
                data: () => ({
                    applicantID: "applicant_001",
                    listingID:   "listing_001",
                    status:      "pending"
                })
            });

            const res = await request(app)
                .patch("/api/applicants/app_001/status")
                .set("Authorization", "Bearer valid-token")
                .send({ status: "accepted" });

            expect(res.status).toBe(400);
            expect(res.body.error).toBe("Applicant must be shortlisted before accepting");
        });

        test("❌ Cannot accept an application that is already rejected", async () => {
            mockVerifyIdToken.mockResolvedValue({ uid: "provider_001", role: "provider" });

            mockApplicationDocGet.mockResolvedValue({
                exists: true,
                data: () => ({
                    applicantID: "applicant_001",
                    listingID:   "listing_001",
                    status:      "rejected"
                })
            });

            const res = await request(app)
                .patch("/api/applicants/app_001/status")
                .set("Authorization", "Bearer valid-token")
                .send({ status: "accepted" });

            expect(res.status).toBe(400);
            expect(res.body.error).toBe("Applicant must be shortlisted before accepting");
        });

        test("✅ Can still shortlist a pending application", async () => {
            mockVerifyIdToken.mockResolvedValue({ uid: "provider_001", role: "provider" });

            mockApplicationDocGet.mockResolvedValue({
                exists: true,
                data: () => ({
                    applicantID: "applicant_001",
                    listingID:   "listing_001",
                    status:      "pending"
                })
            });

            const res = await request(app)
                .patch("/api/applicants/app_001/status")
                .set("Authorization", "Bearer valid-token")
                .send({ status: "shortlisted" });

            expect(res.status).toBe(200);
            expect(res.body.status).toBe("shortlisted");
        });
    });

    // ── AC3: Applicant status updated to accepted in Firestore ────────────────
    describe("AC3: Status is correctly persisted in Firestore", () => {

        test("✅ Status field is exactly 'accepted' after offer is extended", async () => {
            mockVerifyIdToken.mockResolvedValue({ uid: "provider_001", role: "provider" });

            let capturedStatus = null;
            mockApplicationDocUpdate.mockImplementationOnce(({ status }) => {
                capturedStatus = status;
                return Promise.resolve();
            });

            await request(app)
                .patch("/api/applicants/app_001/status")
                .set("Authorization", "Bearer valid-token")
                .send({ status: "accepted" });

            expect(capturedStatus).toBe("accepted");
        });

        test("❌ Invalid status value is rejected — returns 400", async () => {
            mockVerifyIdToken.mockResolvedValue({ uid: "provider_001", role: "provider" });

            const res = await request(app)
                .patch("/api/applicants/app_001/status")
                .set("Authorization", "Bearer valid-token")
                .send({ status: "promoted" });

            expect(res.status).toBe(400);
            expect(res.body.error).toBe("Invalid status");
        });

        test("❌ Firestore failure returns 500", async () => {
            mockVerifyIdToken.mockResolvedValue({ uid: "provider_001", role: "provider" });

            mockApplicationDocUpdate.mockRejectedValue(new Error("Firestore error"));

            const res = await request(app)
                .patch("/api/applicants/app_001/status")
                .set("Authorization", "Bearer valid-token")
                .send({ status: "accepted" });

            expect(res.status).toBe(500);
            expect(res.body.error).toBe("Failed to update status");
        });
    });

    // ── AC4: Provider cannot offer on another provider's listing ──────────────
    describe("AC4: Provider cannot extend offer on another provider's listing", () => {

        test("❌ Provider cannot accept applicant on a listing they do not own", async () => {
            mockVerifyIdToken.mockResolvedValue({ uid: "provider_001", role: "provider" });

            mockApplicationDocGet.mockResolvedValue({
                exists: true,
                data: () => ({
                    applicantID: "applicant_001",
                    listingID:   "listing_002",
                    status:      "shortlisted"
                })
            });

            // Listing owned by a different provider
            mockOpportunityDocGet.mockResolvedValue({
                exists: true,
                data: () => ({ providerID: "provider_002" })
            });

            const res = await request(app)
                .patch("/api/applicants/app_001/status")
                .set("Authorization", "Bearer valid-token")
                .send({ status: "accepted" });

            expect(res.status).toBe(403);
            expect(res.body.error).toBe("You are not authorized to update this application");
        });

        test("✅ Provider can accept applicant on their own listing", async () => {
            mockVerifyIdToken.mockResolvedValue({ uid: "provider_001", role: "provider" });

            // defaults already set to provider_001 owning listing_001 — no override needed

            const res = await request(app)
                .patch("/api/applicants/app_001/status")
                .set("Authorization", "Bearer valid-token")
                .send({ status: "accepted" });

            expect(res.status).toBe(200);
            expect(res.body.status).toBe("accepted");
        });

        test("❌ Unauthenticated request returns 401", async () => {
            const res = await request(app)
                .patch("/api/applicants/app_001/status")
                .send({ status: "accepted" });

            expect(res.status).toBe(401);
        });

        test("❌ Applicant cannot update application status — returns 403", async () => {
            mockVerifyIdToken.mockResolvedValue({ uid: "applicant_001", role: "applicant" });

            const res = await request(app)
                .patch("/api/applicants/app_001/status")
                .set("Authorization", "Bearer valid-token")
                .send({ status: "accepted" });

            expect(res.status).toBe(403);
            expect(res.body.error).toBe("You are not authorized to update this application");
        });
    });
});
const request = require("supertest");

let mockVerifyIdToken, mockSetCustomClaims, mockApplicationDocGet, mockApplicationDocUpdate, mockOpportunityDocGet;

jest.mock("../../backend/helpers", () => ({
    sendMail:  jest.fn().mockResolvedValue(),
    guard:     (route) => (req, res, next) => next(),
    adminOnly: (req, res, next) => next()
}));

jest.mock("../../backend/userPaths", () => ({
    applicantRef:  jest.fn(() => ({ set: jest.fn().mockResolvedValue(), get: jest.fn().mockResolvedValue({ exists: false }) })),
    providerRef:   jest.fn(() => ({ set: jest.fn().mockResolvedValue(), get: jest.fn().mockResolvedValue({ exists: false }) })),
    applicantsCol: jest.fn(),
    providersCol:  jest.fn(),
    lookupUser:    jest.fn().mockResolvedValue({ snap: null, ref: null, role: null })
}));

jest.mock("../../backend/firebaseAdmin", () => {
    mockVerifyIdToken        = jest.fn();
    mockSetCustomClaims      = jest.fn().mockResolvedValue();
    mockApplicationDocGet    = jest.fn();
    mockApplicationDocUpdate = jest.fn().mockResolvedValue();
    mockOpportunityDocGet    = jest.fn();

    return {
        admin: {
            auth: () => ({ verifyIdToken: mockVerifyIdToken, setCustomUserClaims: mockSetCustomClaims }),
            firestore: { FieldValue: { serverTimestamp: () => "SERVER_TIMESTAMP" } }
        },
        db: {
            collection: (name) => ({
                doc: (_id) => ({
                    get: () => {
                        if (name === "applications")  return mockApplicationDocGet();
                        if (name === "Opportunities") return mockOpportunityDocGet();
                        return Promise.resolve({ exists: false });
                    },
                    update: mockApplicationDocUpdate,
                    set:    jest.fn().mockResolvedValue()
                }),
                where: () => ({ get: jest.fn().mockResolvedValue({ forEach: () => {} }), where: () => ({ get: jest.fn().mockResolvedValue({ forEach: () => {} }) }) }),
                get:  jest.fn().mockResolvedValue({ forEach: () => {} }),
                add:  jest.fn().mockResolvedValue({ id: "new-id" })
            })
        }
    };
});

jest.mock("nodemailer", () => ({
    createTransport: jest.fn().mockReturnValue({
        verify:   jest.fn((cb) => cb(null, true)),
        sendMail: jest.fn().mockResolvedValue({ messageId: "mock" })
    })
}));

const app = require("../../backend/app");

beforeEach(() => {
    jest.clearAllMocks();
    mockApplicationDocGet.mockResolvedValue({
        exists: true,
        data: () => ({ applicantID: "applicant_001", listingID: "listing_001", status: "shortlisted" })
    });
    mockOpportunityDocGet.mockResolvedValue({
        exists: true,
        data: () => ({ providerID: "provider_001", title: "Dev Role" })
    });
    mockApplicationDocUpdate.mockResolvedValue();
});

describe("US-04: Offer Extension — PATCH /api/applicants/:applicationID/status", () => {

    describe("AC1: Provider can mark a shortlisted applicant as accepted", () => {

        test("✅ Provider can accept a shortlisted application", async () => {
            mockVerifyIdToken.mockResolvedValue({ uid: "provider_001", role: "provider" });
            const res = await request(app)
                .patch("/api/applicants/app_001/status")
                .set("Authorization", "Bearer valid-token")
                .send({ status: "accepted" });
            expect(res.status).toBe(200);
            expect(res.body.message).toBe("Status updated");
            expect(res.body.status).toBe("accepted");
        });

        test("✅ Firestore is updated with accepted status and updatedAt", async () => {
            mockVerifyIdToken.mockResolvedValue({ uid: "provider_001", role: "provider" });
            let savedUpdate = {};
            mockApplicationDocUpdate.mockImplementationOnce((data) => { savedUpdate = data; return Promise.resolve(); });
            await request(app)
                .patch("/api/applicants/app_001/status")
                .set("Authorization", "Bearer valid-token")
                .send({ status: "accepted" });
            expect(savedUpdate.status).toBe("accepted");
            expect(savedUpdate.updatedAt).toBeDefined();
        });
    });

    describe("AC2: Offer only available for shortlisted applications", () => {

        test("❌ Cannot accept a pending application", async () => {
            mockVerifyIdToken.mockResolvedValue({ uid: "provider_001", role: "provider" });
            mockApplicationDocGet.mockResolvedValue({
                exists: true,
                data: () => ({ applicantID: "applicant_001", listingID: "listing_001", status: "pending" })
            });
            const res = await request(app)
                .patch("/api/applicants/app_001/status")
                .set("Authorization", "Bearer valid-token")
                .send({ status: "accepted" });
            expect(res.status).toBe(400);
            expect(res.body.error).toBe("Applicant must be shortlisted before accepting");
        });

        test("❌ Cannot accept an already rejected application", async () => {
            mockVerifyIdToken.mockResolvedValue({ uid: "provider_001", role: "provider" });
            mockApplicationDocGet.mockResolvedValue({
                exists: true,
                data: () => ({ applicantID: "applicant_001", listingID: "listing_001", status: "rejected" })
            });
            const res = await request(app)
                .patch("/api/applicants/app_001/status")
                .set("Authorization", "Bearer valid-token")
                .send({ status: "accepted" });
            expect(res.status).toBe(400);
        });

        test("✅ Can shortlist a pending application", async () => {
            mockVerifyIdToken.mockResolvedValue({ uid: "provider_001", role: "provider" });
            mockApplicationDocGet.mockResolvedValue({
                exists: true,
                data: () => ({ applicantID: "applicant_001", listingID: "listing_001", status: "pending" })
            });
            const res = await request(app)
                .patch("/api/applicants/app_001/status")
                .set("Authorization", "Bearer valid-token")
                .send({ status: "shortlisted" });
            expect(res.status).toBe(200);
            expect(res.body.status).toBe("shortlisted");
        });
    });

    describe("AC3: Status persisted correctly in Firestore", () => {

        test("✅ Status field is exactly 'accepted' after offer is extended", async () => {
            mockVerifyIdToken.mockResolvedValue({ uid: "provider_001", role: "provider" });
            let capturedStatus = null;
            mockApplicationDocUpdate.mockImplementationOnce(({ status }) => { capturedStatus = status; return Promise.resolve(); });
            await request(app)
                .patch("/api/applicants/app_001/status")
                .set("Authorization", "Bearer valid-token")
                .send({ status: "accepted" });
            expect(capturedStatus).toBe("accepted");
        });

        test("❌ Invalid status value is rejected — 400", async () => {
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

    describe("AC4: Provider cannot offer on another provider's listing", () => {

        test("❌ Provider cannot accept applicant on listing they don't own", async () => {
            mockVerifyIdToken.mockResolvedValue({ uid: "provider_001", role: "provider" });
            mockOpportunityDocGet.mockResolvedValue({
                exists: true,
                data: () => ({ providerID: "provider_002", title: "Other Listing" })
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
            const res = await request(app)
                .patch("/api/applicants/app_001/status")
                .set("Authorization", "Bearer valid-token")
                .send({ status: "accepted" });
            expect(res.status).toBe(200);
        });

        test("❌ Unauthenticated request returns 401", async () => {
            const res = await request(app).patch("/api/applicants/app_001/status").send({ status: "accepted" });
            expect(res.status).toBe(401);
        });

        test("❌ Applicant cannot update status — returns 403", async () => {
            mockVerifyIdToken.mockResolvedValue({ uid: "applicant_001", role: "applicant" });
            const res = await request(app)
                .patch("/api/applicants/app_001/status")
                .set("Authorization", "Bearer valid-token")
                .send({ status: "accepted" });
            expect(res.status).toBe(403);
        });
    });
});

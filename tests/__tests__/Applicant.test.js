/**
 * applications.test.js
 * Tests for routes/applications.js
 * Covers: hasApplied, apply, list applications, update status
 *
 * Key change: applicantRef is now used for user lookup in /applicant/apply
 * (not db.collection("users").doc())
 */
const request = require("supertest");

jest.mock("../../backend/helpers", () => ({
    sendMail:  jest.fn().mockResolvedValue(),
    guard:     (route) => (req, res, next) => next(),
    adminOnly: (req, res, next) => next()
}));

jest.mock("nodemailer", () => ({
    createTransport: jest.fn().mockReturnValue({
        verify:   jest.fn((cb) => cb(null, true)),
        sendMail: jest.fn().mockResolvedValue({ messageId: "mock" })
    })
}));

jest.mock("cloudinary", () => ({ v2: { config: jest.fn() } }), { virtual: true });
jest.mock("multer-storage-cloudinary", () => ({ CloudinaryStorage: jest.fn(() => ({})) }), { virtual: true });
jest.mock("multer", () => jest.fn(() => ({ single: () => (req, res, next) => next() })), { virtual: true });

let mockVerifyIdToken, mockSetCustomClaims;
let mockDocGet, mockDocSet, mockDocUpdate;
let mockCollectionGet, mockCollectionAdd, mockWhereGet;
let mockApplicantRefGet;

jest.mock("../../backend/firebaseAdmin", () => {
    mockVerifyIdToken   = jest.fn();
    mockSetCustomClaims = jest.fn().mockResolvedValue();
    mockDocGet          = jest.fn().mockResolvedValue({ exists: false });
    mockDocSet          = jest.fn().mockResolvedValue();
    mockDocUpdate       = jest.fn().mockResolvedValue();
    mockCollectionGet   = jest.fn();
    mockCollectionAdd   = jest.fn().mockResolvedValue({ id: "new-id" });
    mockWhereGet        = jest.fn();

    const makeCollection = (name) => ({
        get:   () => mockCollectionGet(name),
        add:   (data) => mockCollectionAdd(name, data),
        where: (f, op, v) => ({
            get:   () => mockWhereGet(name, f, op, v),
            where: (f2, o2, v2) => ({ get: () => mockWhereGet(name, `${f}+${f2}`, op, v) })
        }),
        doc: (id) => ({
            get:    () => mockDocGet(name, id),
            set:    (d) => mockDocSet(name, id, d),
            update: (d) => mockDocUpdate(name, id, d)
        }),
        limit: () => ({ get: () => mockCollectionGet(name) }),
        orderBy: () => ({ get: () => mockCollectionGet(name) })
    });

    return {
        admin: {
            auth: () => ({ verifyIdToken: mockVerifyIdToken, setCustomUserClaims: mockSetCustomClaims, getUserByEmail: jest.fn().mockRejectedValue(Object.assign(new Error(), { code: "auth/user-not-found" })) }),
            firestore: { FieldValue: { serverTimestamp: () => "SERVER_TIMESTAMP" } }
        },
        db: { collection: makeCollection }
    };
});

jest.mock("../../backend/userPaths", () => {
    mockApplicantRefGet = jest.fn();
    return {
        applicantsCol: jest.fn(() => ({ where: jest.fn(() => ({ limit: jest.fn(() => ({ get: jest.fn().mockResolvedValue({ empty: true }) })) })), get: jest.fn().mockResolvedValue({ forEach: () => {} }) })),
        providersCol:  jest.fn(() => ({ where: jest.fn(() => ({ limit: jest.fn(() => ({ get: jest.fn().mockResolvedValue({ empty: true }) })) })), get: jest.fn().mockResolvedValue({ forEach: () => {} }) })),
        adminsCol:     jest.fn(() => ({ get: jest.fn().mockResolvedValue({ forEach: () => {} }) })),
        applicantRef:  jest.fn((uid) => ({ get: () => mockApplicantRefGet(uid), set: jest.fn().mockResolvedValue(), update: jest.fn().mockResolvedValue() })),
        providerRef:   jest.fn(() => ({ get: jest.fn().mockResolvedValue({ exists: false }), set: jest.fn().mockResolvedValue() })),
        adminRef:      jest.fn(() => ({ get: jest.fn().mockResolvedValue({ exists: false }), set: jest.fn().mockResolvedValue() })),
        lookupUser:    jest.fn().mockResolvedValue({ snap: null, ref: null, role: null })
    };
});

const app = require("../../backend/app");

beforeEach(() => {
    jest.clearAllMocks();
    mockDocGet.mockResolvedValue({ exists: false });
    mockDocSet.mockResolvedValue();
    mockDocUpdate.mockResolvedValue();
    mockCollectionAdd.mockResolvedValue({ id: "new-id" });
    mockApplicantRefGet.mockResolvedValue({ exists: false });
});

// =============================================================================
// GET /applicant/hasApplied
// =============================================================================
describe("GET /applicant/hasApplied", () => {

    test("✅ Returns false when applicant has not applied", async () => {
        mockWhereGet.mockResolvedValue({ empty: true });
        const res = await request(app).get("/applicant/hasApplied").query({ applicantID: "u1", listingID: "l1" });
        expect(res.status).toBe(200);
        expect(res.body.hasApplied).toBe(false);
    });

    test("✅ Returns true when applicant has already applied", async () => {
        mockWhereGet.mockResolvedValue({ empty: false });
        const res = await request(app).get("/applicant/hasApplied").query({ applicantID: "u1", listingID: "l1" });
        expect(res.status).toBe(200);
        expect(res.body.hasApplied).toBe(true);
    });

    test("❌ Missing applicantID returns 400", async () => {
        const res = await request(app).get("/applicant/hasApplied").query({ listingID: "l1" });
        expect(res.status).toBe(400);
        expect(res.body.error).toBe("Missing applicantID or listingID");
    });

    test("❌ Missing listingID returns 400", async () => {
        const res = await request(app).get("/applicant/hasApplied").query({ applicantID: "u1" });
        expect(res.status).toBe(400);
    });

    test("❌ Missing both params returns 400", async () => {
        const res = await request(app).get("/applicant/hasApplied");
        expect(res.status).toBe(400);
    });

    test("❌ Firestore failure returns 500", async () => {
        mockWhereGet.mockRejectedValue(new Error("DB error"));
        const res = await request(app).get("/applicant/hasApplied").query({ applicantID: "u1", listingID: "l1" });
        expect(res.status).toBe(500);
        expect(res.body.error).toBe("Failed to check application");
    });
});

// =============================================================================
// POST /applicant/apply
// =============================================================================
describe("POST /applicant/apply", () => {

    test("✅ Valid applicant applies successfully", async () => {
        mockApplicantRefGet.mockResolvedValue({ exists: true, data: () => ({ role: "applicant" }) });
        mockDocGet
            .mockResolvedValueOnce({ exists: true })  // listing
            .mockResolvedValueOnce({ exists: false }); // no duplicate
        const res = await request(app).post("/applicant/apply").send({ applicantID: "u1", listingID: "l1" });
        expect(res.status).toBe(201);
        expect(res.body.message).toBe("Application submitted");
    });

    test("✅ Default status is 'pending' when not provided", async () => {
        mockApplicantRefGet.mockResolvedValue({ exists: true });
        mockDocGet.mockResolvedValueOnce({ exists: true }).mockResolvedValueOnce({ exists: false });
        let savedData = {};
        mockDocSet.mockImplementationOnce((name, id, data) => { savedData = data; return Promise.resolve(); });
        await request(app).post("/applicant/apply").send({ applicantID: "u1", listingID: "l1" });
        expect(savedData.status).toBe("pending");
    });

    test("✅ Custom status is saved when provided", async () => {
        mockApplicantRefGet.mockResolvedValue({ exists: true });
        mockDocGet.mockResolvedValueOnce({ exists: true }).mockResolvedValueOnce({ exists: false });
        let savedData = {};
        mockDocSet.mockImplementationOnce((name, id, data) => { savedData = data; return Promise.resolve(); });
        await request(app).post("/applicant/apply").send({ applicantID: "u1", listingID: "l1", status: "reviewing" });
        expect(savedData.status).toBe("reviewing");
    });

    test("❌ Missing applicantID returns 400", async () => {
        const res = await request(app).post("/applicant/apply").send({ listingID: "l1" });
        expect(res.status).toBe(400);
    });

    test("❌ Missing listingID returns 400", async () => {
        const res = await request(app).post("/applicant/apply").send({ applicantID: "u1" });
        expect(res.status).toBe(400);
    });

    test("❌ User not found returns 400", async () => {
        mockApplicantRefGet.mockResolvedValue({ exists: false });
        const res = await request(app).post("/applicant/apply").send({ applicantID: "ghost", listingID: "l1" });
        expect(res.status).toBe(400);
        expect(res.body.error).toBe("User not found");
    });

    test("❌ Listing not found returns 404", async () => {
        mockApplicantRefGet.mockResolvedValue({ exists: true });
        mockDocGet.mockResolvedValueOnce({ exists: false });
        const res = await request(app).post("/applicant/apply").send({ applicantID: "u1", listingID: "ghost" });
        expect(res.status).toBe(404);
        expect(res.body.error).toBe("Listing not found");
    });

    test("❌ Duplicate application returns 409", async () => {
        mockApplicantRefGet.mockResolvedValue({ exists: true });
        mockDocGet.mockResolvedValueOnce({ exists: true }).mockResolvedValueOnce({ exists: true });
        const res = await request(app).post("/applicant/apply").send({ applicantID: "u1", listingID: "l1" });
        expect(res.status).toBe(409);
        expect(res.body.error).toBe("You have already applied to this listing");
    });

    test("❌ Firestore write failure returns 500", async () => {
        mockApplicantRefGet.mockResolvedValue({ exists: true });
        mockDocGet.mockResolvedValueOnce({ exists: true }).mockResolvedValueOnce({ exists: false });
        mockDocSet.mockRejectedValue(new Error("Write failed"));
        const res = await request(app).post("/applicant/apply").send({ applicantID: "u1", listingID: "l1" });
        expect(res.status).toBe(500);
        expect(res.body.error).toBe("Failed to submit application");
    });
});

// =============================================================================
// GET /api/applications
// =============================================================================
describe("GET /api/applications", () => {

    test("✅ Returns applicant's applications", async () => {
        mockVerifyIdToken.mockResolvedValue({ uid: "u1", role: "applicant" });
        mockWhereGet.mockResolvedValue({
            forEach: (cb) => {
                cb({ id: "app1", data: () => ({ applicantID: "u1", listingID: "l1", status: "pending",  createdAt: "2026-01-01" }) });
                cb({ id: "app2", data: () => ({ applicantID: "u1", listingID: "l2", status: "accepted", createdAt: "2026-01-02" }) });
            }
        });
        const res = await request(app).get("/api/applications").set("Authorization", "Bearer valid-token");
        expect(res.status).toBe(200);
        expect(res.body.length).toBe(2);
        expect(res.body[0].status).toBe("pending");
    });

    test("✅ Returns empty array when no applications", async () => {
        mockVerifyIdToken.mockResolvedValue({ uid: "u1", role: "applicant" });
        mockWhereGet.mockResolvedValue({ forEach: () => {} });
        const res = await request(app).get("/api/applications").set("Authorization", "Bearer valid-token");
        expect(res.status).toBe(200);
        expect(res.body).toEqual([]);
    });

    test("✅ Uses applicantID from query param if provided", async () => {
        mockVerifyIdToken.mockResolvedValue({ uid: "u1", role: "applicant" });
        mockWhereGet.mockResolvedValue({ forEach: () => {} });
        const res = await request(app).get("/api/applications?applicantID=u2").set("Authorization", "Bearer valid-token");
        expect(res.status).toBe(200);
    });

    test("❌ Unauthenticated returns 401", async () => {
        const res = await request(app).get("/api/applications");
        expect(res.status).toBe(401);
    });

    test("❌ Firestore failure returns 500", async () => {
        mockVerifyIdToken.mockResolvedValue({ uid: "u1", role: "applicant" });
        mockWhereGet.mockRejectedValue(new Error("DB error"));
        const res = await request(app).get("/api/applications").set("Authorization", "Bearer valid-token");
        expect(res.status).toBe(500);
        expect(res.body.error).toBe("Failed to fetch applications");
    });
});

// =============================================================================
// PATCH /api/applicants/:applicationID/status
// =============================================================================
describe("PATCH /api/applicants/:applicationID/status", () => {

    const makeAppDoc = (status = "shortlisted") => ({
        exists: true,
        data: () => ({ listingID: "l1", applicantID: "a1", status })
    });
    const makeListingDoc = (providerID = "provider-uid") => ({
        exists: true,
        data: () => ({ title: "Dev Role", providerID })
    });

    beforeEach(() => {
        mockApplicantRefGet.mockResolvedValue({ exists: false });
    });

    test("✅ Provider accepts shortlisted applicant", async () => {
        mockVerifyIdToken.mockResolvedValue({ uid: "provider-uid", role: "provider" });
        mockDocGet
            .mockResolvedValueOnce(makeAppDoc("shortlisted"))
            .mockResolvedValueOnce(makeListingDoc("provider-uid"));
        const res = await request(app)
            .patch("/api/applicants/app1/status")
            .set("Authorization", "Bearer valid-token")
            .send({ status: "accepted" });
        expect(res.status).toBe(200);
        expect(res.body.status).toBe("accepted");
    });

    test("✅ Provider shortlists a pending application", async () => {
        mockVerifyIdToken.mockResolvedValue({ uid: "provider-uid", role: "provider" });
        mockDocGet
            .mockResolvedValueOnce(makeAppDoc("pending"))
            .mockResolvedValueOnce(makeListingDoc("provider-uid"));
        const res = await request(app)
            .patch("/api/applicants/app1/status")
            .set("Authorization", "Bearer valid-token")
            .send({ status: "shortlisted" });
        expect(res.status).toBe(200);
        expect(res.body.status).toBe("shortlisted");
    });

    test("✅ Admin can update any application regardless of ownership", async () => {
        mockVerifyIdToken.mockResolvedValue({ uid: "admin-uid", role: "admin" });
        mockDocGet
            .mockResolvedValueOnce(makeAppDoc("shortlisted"))
            .mockResolvedValueOnce(makeListingDoc("other-provider"));
        const res = await request(app)
            .patch("/api/applicants/app1/status")
            .set("Authorization", "Bearer valid-token")
            .send({ status: "accepted" });
        expect(res.status).toBe(200);
    });

    test("✅ Firestore updated with new status and updatedAt", async () => {
        mockVerifyIdToken.mockResolvedValue({ uid: "provider-uid", role: "provider" });
        mockDocGet
            .mockResolvedValueOnce(makeAppDoc("shortlisted"))
            .mockResolvedValueOnce(makeListingDoc("provider-uid"));
        await request(app)
            .patch("/api/applicants/app1/status")
            .set("Authorization", "Bearer valid-token")
            .send({ status: "accepted" });
        expect(mockDocUpdate).toHaveBeenCalledWith(
            "applications", "app1",
            expect.objectContaining({ status: "accepted", updatedAt: expect.any(String) })
        );
    });

    test("❌ Invalid status returns 400", async () => {
        mockVerifyIdToken.mockResolvedValue({ uid: "provider-uid", role: "provider" });
        const res = await request(app)
            .patch("/api/applicants/app1/status")
            .set("Authorization", "Bearer valid-token")
            .send({ status: "promoted" });
        expect(res.status).toBe(400);
        expect(res.body.error).toBe("Invalid status");
    });

    test("❌ Applicant cannot update status — 403", async () => {
        mockVerifyIdToken.mockResolvedValue({ uid: "applicant-uid", role: "applicant" });
        const res = await request(app)
            .patch("/api/applicants/app1/status")
            .set("Authorization", "Bearer valid-token")
            .send({ status: "shortlisted" });
        expect(res.status).toBe(403);
    });

    test("❌ Application not found returns 404", async () => {
        mockVerifyIdToken.mockResolvedValue({ uid: "provider-uid", role: "provider" });
        mockDocGet.mockResolvedValueOnce({ exists: false });
        const res = await request(app)
            .patch("/api/applicants/ghost/status")
            .set("Authorization", "Bearer valid-token")
            .send({ status: "shortlisted" });
        expect(res.status).toBe(404);
        expect(res.body.error).toBe("Application not found");
    });

    test("❌ Cannot accept without first being shortlisted", async () => {
        mockVerifyIdToken.mockResolvedValue({ uid: "provider-uid", role: "provider" });
        mockDocGet
            .mockResolvedValueOnce(makeAppDoc("pending"))
            .mockResolvedValueOnce(makeListingDoc("provider-uid"));
        const res = await request(app)
            .patch("/api/applicants/app1/status")
            .set("Authorization", "Bearer valid-token")
            .send({ status: "accepted" });
        expect(res.status).toBe(400);
        expect(res.body.error).toBe("Applicant must be shortlisted before accepting");
    });

    test("❌ Provider cannot update another provider's listing — 403", async () => {
        mockVerifyIdToken.mockResolvedValue({ uid: "provider-uid", role: "provider" });
        mockDocGet
            .mockResolvedValueOnce(makeAppDoc("shortlisted"))
            .mockResolvedValueOnce(makeListingDoc("other-provider"));
        const res = await request(app)
            .patch("/api/applicants/app1/status")
            .set("Authorization", "Bearer valid-token")
            .send({ status: "accepted" });
        expect(res.status).toBe(403);
    });

    test("❌ Unauthenticated returns 401", async () => {
        const res = await request(app).patch("/api/applicants/app1/status").send({ status: "shortlisted" });
        expect(res.status).toBe(401);
    });

    test("❌ Firestore update failure returns 500", async () => {
        mockVerifyIdToken.mockResolvedValue({ uid: "provider-uid", role: "provider" });
        mockDocGet
            .mockResolvedValueOnce(makeAppDoc("shortlisted"))
            .mockResolvedValueOnce(makeListingDoc("provider-uid"));
        mockDocUpdate.mockRejectedValue(new Error("Firestore error"));
        const res = await request(app)
            .patch("/api/applicants/app1/status")
            .set("Authorization", "Bearer valid-token")
            .send({ status: "accepted" });
        expect(res.status).toBe(500);
        expect(res.body.error).toBe("Failed to update status");
    });
});
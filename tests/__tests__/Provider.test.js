/**
 * provider.test.js
 * Tests for routes/provider.js
 * Covers: GET /api/provider-listings, GET /api/applicants
 *
 * Key change: applicantRef is now used for profile lookup (not flat users/ collection)
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

let mockVerifyIdToken, mockWhereGet, mockApplicantRefGet;

jest.mock("../../backend/firebaseAdmin", () => {
    mockVerifyIdToken = jest.fn();
    mockWhereGet      = jest.fn();

    const makeCollection = (name) => ({
        where: jest.fn(() => ({
            get:   () => mockWhereGet(name),
            where: jest.fn(() => ({ get: () => mockWhereGet(name) }))
        })),
        get:     jest.fn().mockResolvedValue({ forEach: () => {} }),
        add:     jest.fn().mockResolvedValue({ id: "new-id" }),
        orderBy: () => ({ get: jest.fn().mockResolvedValue({ forEach: () => {} }) }),
        limit:   () => ({ get: jest.fn().mockResolvedValue({ forEach: () => {} }) }),
        doc: () => ({ get: jest.fn().mockResolvedValue({ exists: false }), set: jest.fn().mockResolvedValue(), update: jest.fn().mockResolvedValue() })
    });

    return {
        admin: {
            auth: () => ({ verifyIdToken: mockVerifyIdToken, setCustomUserClaims: jest.fn().mockResolvedValue(), getUserByEmail: jest.fn().mockRejectedValue(Object.assign(new Error(), { code: "auth/user-not-found" })) }),
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

const providerToken = () => {
    mockVerifyIdToken.mockResolvedValue({ uid: "provider-uid", role: "provider" });
    return "Bearer prov-tok";
};

beforeEach(() => {
    jest.clearAllMocks();
    mockWhereGet.mockResolvedValue({ forEach: () => {} });
    mockApplicantRefGet.mockResolvedValue({ exists: false });
});

// =============================================================================
// GET /api/provider-listings
// =============================================================================
describe("GET /api/provider-listings", () => {

    test("✅ Returns listings for authenticated provider", async () => {
        mockWhereGet.mockResolvedValue({
            forEach: (cb) => {
                cb({ id: "l1", data: () => ({ title: "Dev Learnership" }) });
                cb({ id: "l2", data: () => ({ title: "QA Internship" }) });
            }
        });
        const res = await request(app).get("/api/provider-listings").set("Authorization", providerToken());
        expect(res.status).toBe(200);
        expect(res.body.length).toBe(2);
        expect(res.body[0].title).toBe("Dev Learnership");
    });

    test("✅ Returns empty array when provider has no listings", async () => {
        mockWhereGet.mockResolvedValue({ forEach: () => {} });
        const res = await request(app).get("/api/provider-listings").set("Authorization", providerToken());
        expect(res.status).toBe(200);
        expect(res.body).toEqual([]);
    });

    test("✅ Accepts providerID from query param", async () => {
        mockWhereGet.mockResolvedValue({ forEach: (cb) => cb({ id: "l1", data: () => ({ title: "T" }) }) });
        const res = await request(app).get("/api/provider-listings?providerID=other-uid").set("Authorization", providerToken());
        expect(res.status).toBe(200);
    });

    test("✅ Defaults missing title to Untitled", async () => {
        mockWhereGet.mockResolvedValue({ forEach: (cb) => cb({ id: "l1", data: () => ({}) }) });
        const res = await request(app).get("/api/provider-listings").set("Authorization", providerToken());
        expect(res.body[0].title).toBe("Untitled");
    });

    test("❌ Unauthenticated returns 401", async () => {
        const res = await request(app).get("/api/provider-listings");
        expect(res.status).toBe(401);
    });

    test("❌ Firestore failure returns 500", async () => {
        mockWhereGet.mockRejectedValue(new Error("DB error"));
        const res = await request(app).get("/api/provider-listings").set("Authorization", providerToken());
        expect(res.status).toBe(500);
        expect(res.body.error).toBe("Failed to fetch provider listings");
    });
});

// =============================================================================
// GET /api/applicants
// =============================================================================
describe("GET /api/applicants", () => {

    test("✅ Returns empty array when provider has no listings", async () => {
        mockWhereGet.mockResolvedValue({ forEach: () => {} });
        const res = await request(app).get("/api/applicants").set("Authorization", providerToken());
        expect(res.status).toBe(200);
        expect(res.body).toEqual([]);
    });

    test("✅ Returns enriched applicants when listings and applications exist", async () => {
        mockApplicantRefGet.mockResolvedValue({
            exists: true,
            data: () => ({ firstname: "Thabo", email: "t@test.com" })
        });
        mockWhereGet
            .mockResolvedValueOnce({ forEach: (cb) => { cb({ id: "l1", data: () => ({ title: "Dev Role" }) }); } })
            .mockResolvedValueOnce({ forEach: (cb) => { cb({ id: "app1", data: () => ({ applicantID: "a1", listingID: "l1", status: "pending" }) }); } });

        const res = await request(app).get("/api/applicants").set("Authorization", providerToken());
        expect(res.status).toBe(200);
        expect(res.body.length).toBe(1);
        expect(res.body[0].listingTitle).toBe("Dev Role");
        expect(res.body[0].applicant.firstname).toBe("Thabo");
    });

    test("✅ Applicant profile is empty object when not found in subcollection", async () => {
        mockApplicantRefGet.mockResolvedValue({ exists: false });
        mockWhereGet
            .mockResolvedValueOnce({ forEach: (cb) => { cb({ id: "l1", data: () => ({ title: "Dev Role" }) }); } })
            .mockResolvedValueOnce({ forEach: (cb) => { cb({ id: "app1", data: () => ({ applicantID: "ghost", listingID: "l1", status: "pending" }) }); } });

        const res = await request(app).get("/api/applicants").set("Authorization", providerToken());
        expect(res.status).toBe(200);
        expect(res.body[0].applicant).toEqual({});
    });

    test("✅ Deduplicates applicant profile lookups", async () => {
        mockApplicantRefGet.mockResolvedValue({ exists: true, data: () => ({ firstname: "Sipho" }) });
        mockWhereGet
            .mockResolvedValueOnce({ forEach: (cb) => { cb({ id: "l1", data: () => ({ title: "Role" }) }); } })
            .mockResolvedValueOnce({ forEach: (cb) => {
                cb({ id: "app1", data: () => ({ applicantID: "a1", listingID: "l1", status: "pending" }) });
                cb({ id: "app2", data: () => ({ applicantID: "a1", listingID: "l1", status: "reviewing" }) });
            }});

        const res = await request(app).get("/api/applicants").set("Authorization", providerToken());
        expect(res.status).toBe(200);
        // Same applicant should only be fetched once
        expect(mockApplicantRefGet).toHaveBeenCalledTimes(1);
    });

    test("❌ Unauthenticated returns 401", async () => {
        const res = await request(app).get("/api/applicants");
        expect(res.status).toBe(401);
    });

    test("❌ Firestore failure returns 500", async () => {
        mockWhereGet.mockRejectedValue(new Error("DB error"));
        const res = await request(app).get("/api/applicants").set("Authorization", providerToken());
        expect(res.status).toBe(500);
        expect(res.body.error).toBe("Failed to fetch applicants");
    });
});
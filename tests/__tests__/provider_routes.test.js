const request = require("supertest");

let mockVerifyIdToken, mockProviderDocGet, mockWhereGet, mockApplicantDocGet;

jest.mock("../../backend/helpers", () => ({
    sendMail:  jest.fn().mockResolvedValue(),
    guard:     (route) => (req, res, next) => next(),
    adminOnly: (req, res, next) => next()
}));

jest.mock("../../backend/firebaseAdmin", () => {
    mockVerifyIdToken = jest.fn();
    mockProviderDocGet = jest.fn();
    mockWhereGet       = jest.fn();

    return {
        admin: {
            auth: () => ({ verifyIdToken: mockVerifyIdToken }),
            firestore: { FieldValue: { serverTimestamp: () => "SERVER_TIMESTAMP" } }
        },
        db: {
            collection: (name) => ({
                doc: () => ({ get: () => mockProviderDocGet(), set: jest.fn().mockResolvedValue(), update: jest.fn().mockResolvedValue() }),
                where: jest.fn(() => ({
                    get:   () => mockWhereGet(name),
                    where: jest.fn(() => ({ get: () => mockWhereGet(name) }))
                })),
                get: jest.fn().mockResolvedValue({ forEach: () => {} }),
                add: jest.fn().mockResolvedValue({ id: "notif-id" })
            })
        }
    };
});

jest.mock("../../backend/userPaths", () => {
    mockApplicantDocGet = jest.fn();

    return {
        applicantsCol: jest.fn(),
        providersCol:  jest.fn(),
        providerRef:   jest.fn(() => ({ get: mockApplicantDocGet, set: jest.fn().mockResolvedValue() })),
        applicantRef:  jest.fn(() => ({ get: mockApplicantDocGet, set: jest.fn().mockResolvedValue() })),
        lookupUser:    jest.fn().mockResolvedValue({ snap: null, ref: null, role: null })
    };
});

jest.mock("nodemailer", () => ({
    createTransport: jest.fn().mockReturnValue({
        verify:   jest.fn((cb) => cb(null, true)),
        sendMail: jest.fn().mockResolvedValue({ messageId: "mock" })
    })
}));

const app = require("../../backend/app");

const providerToken = () => {
    mockVerifyIdToken.mockResolvedValue({ uid: "provider-uid", role: "provider" });
    return "Bearer prov-tok";
};

beforeEach(() => {
    jest.clearAllMocks();
    mockWhereGet.mockResolvedValue({ forEach: () => {} });
    mockProviderDocGet.mockResolvedValue({ exists: false });
    mockApplicantDocGet.mockResolvedValue({ exists: false });
});

// =============================================================================
// GET /api/provider-listings
// =============================================================================
describe("GET /api/provider-listings", () => {

    test("returns listings matched by providerID when org name is absent", async () => {
        mockProviderDocGet.mockResolvedValue({ exists: true, data: () => ({}) });
        mockWhereGet.mockResolvedValue({
            forEach: (cb) => {
                cb({ id: "l1", data: () => ({ title: "Dev Learnership" }) });
                cb({ id: "l2", data: () => ({ title: "QA Internship" }) });
            }
        });

        const res = await request(app).get("/api/provider-listings").set("Authorization", providerToken());
        expect(res.status).toBe(200);
        expect(res.body.length).toBe(2);
    });

    test("returns listings matched by company name when org name is present", async () => {
        mockProviderDocGet.mockResolvedValue({ exists: true, data: () => ({ organization: "TechCorp SA" }) });
        mockWhereGet.mockResolvedValue({
            forEach: (cb) => { cb({ id: "l1", data: () => ({ title: "SA Internship" }) }); }
        });

        const res = await request(app).get("/api/provider-listings").set("Authorization", providerToken());
        expect(res.status).toBe(200);
        expect(res.body.length).toBe(1);
    });

    test("returns empty array when provider has no listings", async () => {
        mockProviderDocGet.mockResolvedValue({ exists: true, data: () => ({}) });
        mockWhereGet.mockResolvedValue({ forEach: () => {} });
        const res = await request(app).get("/api/provider-listings").set("Authorization", providerToken());
        expect(res.status).toBe(200);
        expect(res.body).toEqual([]);
    });

    test("returns 401 when unauthenticated", async () => {
        const res = await request(app).get("/api/provider-listings");
        expect(res.status).toBe(401);
    });

    test("returns 500 on Firestore error", async () => {
        mockWhereGet.mockRejectedValueOnce(new Error("DB down"));
        const res = await request(app).get("/api/provider-listings").set("Authorization", providerToken());
        expect(res.status).toBe(500);
        expect(res.body.error).toBe("Failed to fetch provider listings");
    });
});

// =============================================================================
// GET /api/applicants
// =============================================================================
describe("GET /api/applicants", () => {

    test("returns empty array when provider has no listings", async () => {
        mockProviderDocGet.mockResolvedValue({ exists: true, data: () => ({}) });
        mockWhereGet.mockResolvedValue({ forEach: () => {} });
        const res = await request(app).get("/api/applicants").set("Authorization", providerToken());
        expect(res.status).toBe(200);
        expect(res.body).toEqual([]);
    });

    test("returns applicants enriched with profile data", async () => {
        mockApplicantDocGet.mockResolvedValue({
            exists: true,
            data: () => ({ firstname: "Thabo", email: "t@test.com" })
        });

        mockWhereGet
            .mockResolvedValueOnce({
                forEach: (cb) => { cb({ id: "listing-1", data: () => ({ title: "Dev Role" }) }); }
            })
            .mockResolvedValueOnce({
                forEach: (cb) => { cb({ id: "app-1", data: () => ({ applicantID: "uid-a1", listingID: "listing-1", status: "pending" }) }); }
            });

        const res = await request(app).get("/api/applicants").set("Authorization", providerToken());
        expect(res.status).toBe(200);
        expect(res.body.length).toBe(1);
        expect(res.body[0].applicantID).toBe("uid-a1");
        expect(res.body[0].listingTitle).toBe("Dev Role");
    });

    test("returns 401 when unauthenticated", async () => {
        const res = await request(app).get("/api/applicants");
        expect(res.status).toBe(401);
    });

    test("returns 500 on Firestore error", async () => {
        mockWhereGet.mockRejectedValueOnce(new Error("DB down"));
        const res = await request(app).get("/api/applicants").set("Authorization", providerToken());
        expect(res.status).toBe(500);
        expect(res.body.error).toBe("Failed to fetch applicants");
    });
});

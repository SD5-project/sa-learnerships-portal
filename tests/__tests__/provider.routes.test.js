const request = require("supertest");

let mockVerifyIdToken;
let mockProviderDocGet;
let mockWhereGet;
let mockApplicantDocGet;

jest.mock("../../backend/firebaseAdmin", () => {
    mockVerifyIdToken  = jest.fn();
    mockWhereGet       = jest.fn();

    return {
        admin: { auth: () => ({ verifyIdToken: mockVerifyIdToken }) },
        db: {
            collection: (name) => ({
                where: jest.fn(() => ({
                    get:   () => mockWhereGet(name),
                    where: jest.fn(() => ({ get: () => mockWhereGet(name) })),
                    in:    jest.fn(() => ({ get: () => mockWhereGet(name) }))
                })),
                get: jest.fn().mockResolvedValue({ forEach: () => {} })
            })
        }
    };
});

jest.mock("../../backend/userPaths", () => {
    mockProviderDocGet  = jest.fn();
    mockApplicantDocGet = jest.fn();

    return {
        applicantsCol: jest.fn(),
        providersCol:  jest.fn(),
        providerRef:   jest.fn(() => ({ get: mockProviderDocGet })),
        applicantRef:  jest.fn(() => ({ get: mockApplicantDocGet })),
        lookupUser:    jest.fn()
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
    mockProviderDocGet.mockResolvedValue({ exists: false });
    mockApplicantDocGet.mockResolvedValue({ exists: false });
});

// =============================================================================
// GET /api/provider-listings
// =============================================================================
describe("GET /api/provider-listings", () => {

    test("returns listings matched by providerID when org name is absent", async () => {
        mockProviderDocGet.mockResolvedValue({ exists: true, data: () => ({}) }); // no organization
        mockWhereGet.mockResolvedValue({
            forEach: (cb) => {
                cb({ id: "l1", data: () => ({ title: "Dev Learnership" }) });
                cb({ id: "l2", data: () => ({ title: "QA Internship" }) });
            }
        });

        const res = await request(app)
            .get("/api/provider-listings")
            .set("Authorization", providerToken());

        expect(res.status).toBe(200);
        expect(res.body.length).toBe(2);
        expect(res.body[0].title).toBe("Dev Learnership");
    });

    test("returns listings matched by company name when org name is present", async () => {
        mockProviderDocGet.mockResolvedValue({
            exists: true,
            data:   () => ({ organization: "TechCorp SA" })
        });
        mockWhereGet.mockResolvedValue({
            forEach: (cb) => {
                cb({ id: "l1", data: () => ({ title: "SA Internship" }) });
            }
        });

        const res = await request(app)
            .get("/api/provider-listings")
            .set("Authorization", providerToken());

        expect(res.status).toBe(200);
        expect(res.body.length).toBe(1);
        expect(res.body[0].id).toBe("l1");
    });

    test("returns empty array when provider has no listings", async () => {
        mockProviderDocGet.mockResolvedValue({ exists: true, data: () => ({}) });
        mockWhereGet.mockResolvedValue({ forEach: () => {} });

        const res = await request(app)
            .get("/api/provider-listings")
            .set("Authorization", providerToken());

        expect(res.status).toBe(200);
        expect(res.body).toEqual([]);
    });

    test("returns 401 when unauthenticated", async () => {
        const res = await request(app).get("/api/provider-listings");
        expect(res.status).toBe(401);
    });

    test("returns 500 on Firestore error", async () => {
        mockProviderDocGet.mockRejectedValue(new Error("DB down"));

        const res = await request(app)
            .get("/api/provider-listings")
            .set("Authorization", providerToken());

        expect(res.status).toBe(500);
        expect(res.body.error).toBe("Failed to fetch provider listings");
    });
});

// =============================================================================
// GET /api/applicants  (applicants who applied to this provider's listings)
// =============================================================================
describe("GET /api/applicants", () => {

    test("returns empty array when provider has no listings", async () => {
        mockProviderDocGet.mockResolvedValue({ exists: true, data: () => ({}) });
        mockWhereGet.mockResolvedValue({ forEach: () => {} }); // no listings

        const res = await request(app)
            .get("/api/applicants")
            .set("Authorization", providerToken());

        expect(res.status).toBe(200);
        expect(res.body).toEqual([]);
    });

    test("returns applicants with profile data enriched", async () => {
        mockProviderDocGet.mockResolvedValue({ exists: true, data: () => ({}) });

        // First where() call returns listings
        mockWhereGet
            .mockResolvedValueOnce({
                forEach: (cb) => {
                    cb({ id: "listing-1", data: () => ({ title: "Dev Role" }) });
                }
            })
            // Second where() call returns applications for those listings
            .mockResolvedValueOnce({
                forEach: (cb) => {
                    cb({ id: "app-1", data: () => ({ applicantID: "uid-a1", listingID: "listing-1", status: "pending" }) });
                }
            });

        mockApplicantDocGet.mockResolvedValue({
            exists: true,
            data:   () => ({ firstname: "Thabo", email: "t@test.com" })
        });

        const res = await request(app)
            .get("/api/applicants")
            .set("Authorization", providerToken());

        expect(res.status).toBe(200);
        expect(res.body.length).toBe(1);
        expect(res.body[0].applicantID).toBe("uid-a1");
        expect(res.body[0].listingTitle).toBe("Dev Role");
        expect(res.body[0].applicant.firstname).toBe("Thabo");
    });

    test("returns 401 when unauthenticated", async () => {
        const res = await request(app).get("/api/applicants");
        expect(res.status).toBe(401);
    });

    test("returns 500 on Firestore error", async () => {
        mockProviderDocGet.mockRejectedValue(new Error("DB down"));

        const res = await request(app)
            .get("/api/applicants")
            .set("Authorization", providerToken());

        expect(res.status).toBe(500);
        expect(res.body.error).toBe("Failed to fetch applicants");
    });
});

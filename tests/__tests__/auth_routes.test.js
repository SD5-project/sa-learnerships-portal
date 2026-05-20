const request = require("supertest");

let mockVerifyIdToken, mockSetCustomClaims, mockApplicantSet, mockProviderSet;
let mockApplicantWhereGet, mockProviderWhereGet, mockLookupUser, mockFlatDocGet;

jest.mock("../../backend/helpers", () => ({
    sendMail:  jest.fn().mockResolvedValue(),
    guard:     (route) => (req, res, next) => next(),
    adminOnly: (req, res, next) => next()
}));

jest.mock("../../backend/firebaseAdmin", () => {
    mockVerifyIdToken   = jest.fn();
    mockSetCustomClaims = jest.fn().mockResolvedValue();
    mockFlatDocGet      = jest.fn().mockResolvedValue({ exists: false });

    return {
        admin: {
            auth: () => ({
                verifyIdToken:       mockVerifyIdToken,
                setCustomUserClaims: mockSetCustomClaims,
                getUserByEmail:      jest.fn().mockRejectedValue(Object.assign(new Error("Not found"), { code: "auth/user-not-found" }))
            })
        },
        db: {
            collection: () => ({
                doc: () => ({ get: mockFlatDocGet, set: jest.fn().mockResolvedValue() }),
                where: () => ({ get: jest.fn().mockResolvedValue({ forEach: () => {} }), limit: () => ({ get: jest.fn().mockResolvedValue({ empty: true }) }) }),
                get: jest.fn().mockResolvedValue({ forEach: () => {} })
            })
        }
    };
});

jest.mock("../../backend/userPaths", () => {
    mockApplicantSet      = jest.fn().mockResolvedValue();
    mockProviderSet       = jest.fn().mockResolvedValue();
    mockApplicantWhereGet = jest.fn().mockResolvedValue({ empty: true });
    mockProviderWhereGet  = jest.fn().mockResolvedValue({ empty: true });
    mockLookupUser        = jest.fn();

    return {
        applicantsCol: jest.fn(() => ({
            where: jest.fn(() => ({ limit: jest.fn(() => ({ get: mockApplicantWhereGet })) }))
        })),
        providersCol: jest.fn(() => ({
            where: jest.fn(() => ({ limit: jest.fn(() => ({ get: mockProviderWhereGet })) }))
        })),
        applicantRef: jest.fn(() => ({ set: mockApplicantSet, get: jest.fn().mockResolvedValue({ exists: false }) })),
        providerRef:  jest.fn(() => ({ set: mockProviderSet,  get: jest.fn().mockResolvedValue({ exists: false }) })),
        lookupUser:   mockLookupUser
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
    mockSetCustomClaims.mockResolvedValue();
    mockApplicantSet.mockResolvedValue();
    mockProviderSet.mockResolvedValue();
    mockApplicantWhereGet.mockResolvedValue({ empty: true });
    mockProviderWhereGet.mockResolvedValue({ empty: true });
    mockFlatDocGet.mockResolvedValue({ exists: false });
    mockLookupUser.mockResolvedValue({ snap: null, ref: null, role: null });
});

// =============================================================================
// GET /api/check-email
// =============================================================================
describe("GET /api/check-email", () => {

    test("returns exists: false when email is not registered", async () => {
        const res = await request(app).get("/api/check-email?email=new@test.com");
        expect(res.status).toBe(200);
        expect(res.body.exists).toBe(false);
    });

    test("returns exists: true when email is in applicants", async () => {
        mockApplicantWhereGet.mockResolvedValueOnce({ empty: false });
        const res = await request(app).get("/api/check-email?email=taken@test.com");
        expect(res.status).toBe(200);
        expect(res.body.exists).toBe(true);
    });

    test("returns exists: true when email is in providers", async () => {
        mockProviderWhereGet.mockResolvedValueOnce({ empty: false });
        const res = await request(app).get("/api/check-email?email=provider@test.com");
        expect(res.status).toBe(200);
        expect(res.body.exists).toBe(true);
    });

    test("returns 400 when email param is missing", async () => {
        const res = await request(app).get("/api/check-email");
        expect(res.status).toBe(400);
        expect(res.body.error).toBe("Email is required");
    });

    test("returns 500 on Firestore error", async () => {
        mockApplicantWhereGet.mockRejectedValueOnce(new Error("DB error"));
        const res = await request(app).get("/api/check-email?email=err@test.com");
        expect(res.status).toBe(500);
        expect(res.body.error).toBe("Failed to check email");
    });
});

// =============================================================================
// GET /api/check-idnumber
// =============================================================================
describe("GET /api/check-idnumber", () => {

    test("returns exists: false when ID is not registered", async () => {
        const res = await request(app).get("/api/check-idnumber?idNumber=0001010000000");
        expect(res.status).toBe(200);
        expect(res.body.exists).toBe(false);
    });

    test("returns exists: true when ID is already in use", async () => {
        mockApplicantWhereGet.mockResolvedValueOnce({ empty: false });
        const res = await request(app).get("/api/check-idnumber?idNumber=9001010000000");
        expect(res.status).toBe(200);
        expect(res.body.exists).toBe(true);
    });

    test("returns 400 when idNumber param is missing", async () => {
        const res = await request(app).get("/api/check-idnumber");
        expect(res.status).toBe(400);
        expect(res.body.error).toBe("ID number is required");
    });

    test("returns 500 on Firestore error", async () => {
        mockApplicantWhereGet.mockRejectedValueOnce(new Error("DB error"));
        const res = await request(app).get("/api/check-idnumber?idNumber=9001010000000");
        expect(res.status).toBe(500);
        expect(res.body.error).toBe("Failed to check ID number");
    });
});

// =============================================================================
// GET /api/check-phone
// =============================================================================
describe("GET /api/check-phone", () => {

    test("returns exists: false when phone is not registered", async () => {
        const res = await request(app).get("/api/check-phone?phone=%2B27820000000");
        expect(res.status).toBe(200);
        expect(res.body.exists).toBe(false);
    });

    test("returns exists: true when phone is already in use", async () => {
        mockApplicantWhereGet.mockResolvedValueOnce({ empty: false });
        const res = await request(app).get("/api/check-phone?phone=%2B27821234567");
        expect(res.status).toBe(200);
        expect(res.body.exists).toBe(true);
    });

    test("returns 400 when phone param is missing", async () => {
        const res = await request(app).get("/api/check-phone");
        expect(res.status).toBe(400);
        expect(res.body.error).toBe("Phone number is required");
    });

    test("returns 500 on Firestore error", async () => {
        mockApplicantWhereGet.mockRejectedValueOnce(new Error("DB error"));
        const res = await request(app).get("/api/check-phone?phone=%2B27821234567");
        expect(res.status).toBe(500);
        expect(res.body.error).toBe("Failed to check phone number");
    });
});

// =============================================================================
// GET /api/user-profile
// =============================================================================
describe("GET /api/user-profile", () => {

    test("returns profile data when user is in flat collection", async () => {
        mockVerifyIdToken.mockResolvedValue({ uid: "uid-123", role: "applicant" });
        mockFlatDocGet.mockResolvedValue({
            exists: true,
            data: () => ({ firstname: "Alice", email: "a@test.com", role: "applicant" })
        });
        const res = await request(app)
            .get("/api/user-profile")
            .set("Authorization", "Bearer token");
        expect(res.status).toBe(200);
        expect(res.body.firstname).toBe("Alice");
    });

    test("returns profile data via lookupUser fallback", async () => {
        mockVerifyIdToken.mockResolvedValue({ uid: "uid-123", role: "applicant" });
        mockFlatDocGet.mockResolvedValue({ exists: false });
        mockLookupUser.mockResolvedValue({
            snap: { exists: true, data: () => ({ firstname: "Bob", email: "b@test.com", role: "applicant" }) },
            ref: null, role: "applicant"
        });
        const res = await request(app)
            .get("/api/user-profile")
            .set("Authorization", "Bearer token");
        expect(res.status).toBe(200);
        expect(res.body.firstname).toBe("Bob");
    });

    test("returns 404 when user not found anywhere", async () => {
        mockVerifyIdToken.mockResolvedValue({ uid: "ghost", role: "applicant" });
        mockFlatDocGet.mockResolvedValue({ exists: false });
        mockLookupUser.mockResolvedValue({ snap: null, ref: null, role: null });
        const res = await request(app)
            .get("/api/user-profile")
            .set("Authorization", "Bearer token");
        expect(res.status).toBe(404);
        expect(res.body.error).toBe("User not found");
    });

    test("returns 401 when unauthenticated", async () => {
        const res = await request(app).get("/api/user-profile");
        expect(res.status).toBe(401);
    });
});

// =============================================================================
// GET /api/user-role
// =============================================================================
describe("GET /api/user-role", () => {

    test("returns role when user is in flat collection", async () => {
        mockVerifyIdToken.mockResolvedValue({ uid: "uid-123", role: "provider" });
        mockFlatDocGet.mockResolvedValue({
            exists: true,
            data: () => ({ role: "provider" })
        });
        const res = await request(app)
            .get("/api/user-role")
            .set("Authorization", "Bearer token");
        expect(res.status).toBe(200);
        expect(res.body.role).toBe("provider");
    });

    test("returns 404 when user does not exist", async () => {
        mockVerifyIdToken.mockResolvedValue({ uid: "ghost", role: "applicant" });
        mockFlatDocGet.mockResolvedValue({ exists: false });
        mockLookupUser.mockResolvedValue({ snap: null, ref: null, role: null });
        const res = await request(app)
            .get("/api/user-role")
            .set("Authorization", "Bearer token");
        expect(res.status).toBe(404);
    });

    test("returns 401 when unauthenticated", async () => {
        const res = await request(app).get("/api/user-role");
        expect(res.status).toBe(401);
    });
});

// =============================================================================
// POST /api/set-role-claim
// =============================================================================
describe("POST /api/set-role-claim", () => {

    test("sets a valid role claim", async () => {
        mockVerifyIdToken.mockResolvedValue({ uid: "admin-uid", role: "admin" });
        const res = await request(app)
            .post("/api/set-role-claim")
            .set("Authorization", "Bearer token")
            .send({ uid: "uid-123", role: "provider" });
        expect(res.status).toBe(200);
        expect(res.body.message).toBe("Custom claim set");
        expect(mockSetCustomClaims).toHaveBeenCalledWith("uid-123", { role: "provider" });
    });

    test("returns 400 for invalid role", async () => {
        mockVerifyIdToken.mockResolvedValue({ uid: "admin-uid", role: "admin" });
        const res = await request(app)
            .post("/api/set-role-claim")
            .set("Authorization", "Bearer token")
            .send({ uid: "uid-123", role: "superuser" });
        expect(res.status).toBe(400);
        expect(res.body.error).toBe("Invalid role");
    });

    test("returns 400 when uid or role is missing", async () => {
        mockVerifyIdToken.mockResolvedValue({ uid: "admin-uid", role: "admin" });
        const res = await request(app)
            .post("/api/set-role-claim")
            .set("Authorization", "Bearer token")
            .send({ uid: "uid-123" });
        expect(res.status).toBe(400);
        expect(res.body.error).toBe("uid and role are required");
    });

    test("returns 401 when unauthenticated", async () => {
        const res = await request(app).post("/api/set-role-claim").send({ uid: "uid-123", role: "provider" });
        expect(res.status).toBe(401);
    });
});

/**
 * auth_routes.test.js
 * Tests for routes/auth.js — covers signup, profile, role, check endpoints,
 * CV upload/delete, qualifications, set-role-claim.
 * Also covers backend/auth.js verifyToken middleware paths.
 */
const request = require("supertest");

// ─── Standard mocks ───────────────────────────────────────────────────────────
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
jest.mock("multer", () => jest.fn(() => ({
    single: () => (req, res, next) => {
        if (req.headers["x-mock-cv"] === "true") {
            req.file = { path: "https://res.cloudinary.com/demo/raw/upload/cvs/cv.pdf", originalname: "cv.pdf" };
        }
        next();
    }
})), { virtual: true });

// ─── Firebase mock ────────────────────────────────────────────────────────────
let mockVerifyIdToken, mockSetCustomClaims, mockGetUserByEmail, mockDeleteUser;
let mockDocGet, mockDocSet, mockDocUpdate;
let mockCollectionGet, mockWhereGet;

jest.mock("../../backend/firebaseAdmin", () => {
    mockVerifyIdToken   = jest.fn();
    mockSetCustomClaims = jest.fn().mockResolvedValue();
    mockGetUserByEmail  = jest.fn();
    mockDeleteUser      = jest.fn().mockResolvedValue();
    mockDocGet          = jest.fn().mockResolvedValue({ exists: false });
    mockDocSet          = jest.fn().mockResolvedValue();
    mockDocUpdate       = jest.fn().mockResolvedValue();
    mockCollectionGet   = jest.fn().mockResolvedValue({ forEach: () => {} });
    mockWhereGet        = jest.fn();

    const makeCollection = (name) => ({
        get:     () => mockCollectionGet(name),
        add:     jest.fn().mockResolvedValue({ id: "new-id" }),
        orderBy: () => ({ get: () => mockCollectionGet(name) }),
        limit:   () => ({ get: () => mockCollectionGet(name) }),
        where: (f, op, v) => ({
            get:   () => mockWhereGet(name, f, op, v),
            limit: () => ({ get: () => mockWhereGet(name, f, op, v) }),
            where: (f2) => ({ get: () => mockWhereGet(name, `${f}+${f2}`, op, v) })
        }),
        doc: (id) => ({
            get:    () => mockDocGet(name, id),
            set:    (d, o) => mockDocSet(name, id, d, o),
            update: (d) => mockDocUpdate(name, id, d)
        })
    });

    return {
        admin: {
            auth: () => ({
                verifyIdToken:       mockVerifyIdToken,
                setCustomUserClaims: mockSetCustomClaims,
                getUserByEmail:      mockGetUserByEmail,
                deleteUser:          mockDeleteUser
            }),
            firestore: { FieldValue: { serverTimestamp: () => "SERVER_TIMESTAMP" } }
        },
        db: { collection: makeCollection }
    };
});

// ─── userPaths mock ───────────────────────────────────────────────────────────
let mockApplicantRefGet, mockApplicantRefSet, mockApplicantRefUpdate;
let mockProviderRefSet, mockProviderRefGet;
let mockApplicantWhereGet, mockProviderWhereGet;
let mockLookupUser;

jest.mock("../../backend/userPaths", () => {
    mockApplicantRefGet    = jest.fn();
    mockApplicantRefSet    = jest.fn().mockResolvedValue();
    mockApplicantRefUpdate = jest.fn().mockResolvedValue();
    mockProviderRefSet     = jest.fn().mockResolvedValue();
    mockProviderRefGet     = jest.fn().mockResolvedValue({ exists: false });
    mockApplicantWhereGet  = jest.fn().mockResolvedValue({ empty: true });
    mockProviderWhereGet   = jest.fn().mockResolvedValue({ empty: true });
    mockLookupUser         = jest.fn();

    return {
        applicantsCol: jest.fn(() => ({
            where: jest.fn(() => ({ limit: jest.fn(() => ({ get: mockApplicantWhereGet })) })),
            get:   jest.fn().mockResolvedValue({ forEach: () => {} })
        })),
        providersCol: jest.fn(() => ({
            where: jest.fn(() => ({ limit: jest.fn(() => ({ get: mockProviderWhereGet })) })),
            get:   jest.fn().mockResolvedValue({ forEach: () => {} })
        })),
        adminsCol:    jest.fn(() => ({ get: jest.fn().mockResolvedValue({ forEach: () => {} }) })),
        applicantRef: jest.fn((uid) => ({
            get:    () => mockApplicantRefGet(uid),
            set:    (d, o) => mockApplicantRefSet(uid, d, o),
            update: (d) => mockApplicantRefUpdate(uid, d)
        })),
        providerRef: jest.fn((uid) => ({
            get: () => mockProviderRefGet(uid),
            set: (d) => mockProviderRefSet(uid, d)
        })),
        adminRef:    jest.fn(() => ({ get: jest.fn().mockResolvedValue({ exists: false }), set: jest.fn().mockResolvedValue() })),
        lookupUser:  (...args) => mockLookupUser(...args)
    };
});

const app = require("../../backend/app");

beforeEach(() => {
    jest.clearAllMocks();
    mockSetCustomClaims.mockResolvedValue();
    mockApplicantRefSet.mockResolvedValue();
    mockApplicantRefUpdate.mockResolvedValue();
    mockProviderRefSet.mockResolvedValue();
    mockApplicantWhereGet.mockResolvedValue({ empty: true });
    mockProviderWhereGet.mockResolvedValue({ empty: true });
    mockDocGet.mockResolvedValue({ exists: false });
    mockDocSet.mockResolvedValue();
    mockDocUpdate.mockResolvedValue();
    mockLookupUser.mockResolvedValue({ snap: null, ref: null, role: null });
    mockGetUserByEmail.mockRejectedValue(Object.assign(new Error("Not found"), { code: "auth/user-not-found" }));
});

// =============================================================================
// GET /api/check-email
// =============================================================================
describe("GET /api/check-email", () => {

    test("✅ Returns false when email not registered anywhere", async () => {
        const res = await request(app).get("/api/check-email?email=new@test.com");
        expect(res.status).toBe(200);
        expect(res.body.exists).toBe(false);
    });

    test("✅ Returns true when email is in applicants subcollection", async () => {
        mockApplicantWhereGet.mockResolvedValueOnce({ empty: false });
        const res = await request(app).get("/api/check-email?email=taken@test.com");
        expect(res.status).toBe(200);
        expect(res.body.exists).toBe(true);
    });

    test("✅ Returns true when email is in providers subcollection", async () => {
        mockProviderWhereGet.mockResolvedValueOnce({ empty: false });
        const res = await request(app).get("/api/check-email?email=prov@test.com");
        expect(res.status).toBe(200);
        expect(res.body.exists).toBe(true);
    });

    test("✅ Ghost Auth account is deleted and returns false", async () => {
        // Auth finds the user but Firestore doesn't — ghost account
        mockGetUserByEmail.mockResolvedValueOnce({ uid: "ghost-uid", email: "ghost@test.com" });
        mockApplicantWhereGet.mockResolvedValue({ empty: true });
        mockProviderWhereGet.mockResolvedValue({ empty: true });
        const res = await request(app).get("/api/check-email?email=ghost@test.com");
        expect(res.status).toBe(200);
        expect(res.body.exists).toBe(false);
        expect(mockDeleteUser).toHaveBeenCalledWith("ghost-uid");
    });

    test("✅ Auth user with role claim returns exists: true", async () => {
        mockGetUserByEmail.mockResolvedValueOnce({ uid: "uid-1", customClaims: { role: "applicant" } });
        const res = await request(app).get("/api/check-email?email=existing@test.com");
        expect(res.status).toBe(200);
        expect(res.body.exists).toBe(true);
    });

    test("❌ Missing email returns 400", async () => {
        const res = await request(app).get("/api/check-email");
        expect(res.status).toBe(400);
        expect(res.body.error).toBe("Email is required");
    });

    test("❌ Firestore error returns 500", async () => {
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

    test("✅ Returns false when ID not registered", async () => {
        const res = await request(app).get("/api/check-idnumber?idNumber=9001010000000");
        expect(res.status).toBe(200);
        expect(res.body.exists).toBe(false);
    });

    test("✅ Returns true when ID already registered", async () => {
        mockApplicantWhereGet.mockResolvedValueOnce({ empty: false });
        const res = await request(app).get("/api/check-idnumber?idNumber=9001010000000");
        expect(res.status).toBe(200);
        expect(res.body.exists).toBe(true);
    });

    test("❌ Missing idNumber returns 400", async () => {
        const res = await request(app).get("/api/check-idnumber");
        expect(res.status).toBe(400);
        expect(res.body.error).toBe("ID number is required");
    });

    test("❌ Firestore error returns 500", async () => {
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

    test("✅ Returns false when phone not registered", async () => {
        const res = await request(app).get("/api/check-phone?phone=%2B27820000000");
        expect(res.status).toBe(200);
        expect(res.body.exists).toBe(false);
    });

    test("✅ Returns true when phone already registered", async () => {
        mockApplicantWhereGet.mockResolvedValueOnce({ empty: false });
        const res = await request(app).get("/api/check-phone?phone=%2B27821234567");
        expect(res.status).toBe(200);
        expect(res.body.exists).toBe(true);
    });

    test("❌ Missing phone returns 400", async () => {
        const res = await request(app).get("/api/check-phone");
        expect(res.status).toBe(400);
        expect(res.body.error).toBe("Phone number is required");
    });

    test("❌ Firestore error returns 500", async () => {
        mockApplicantWhereGet.mockRejectedValueOnce(new Error("DB error"));
        const res = await request(app).get("/api/check-phone?phone=%2B27821234567");
        expect(res.status).toBe(500);
        expect(res.body.error).toBe("Failed to check phone number");
    });
});

// =============================================================================
// POST /signup/applicant
// =============================================================================
describe("POST /signup/applicant", () => {

    test("✅ Creates applicant with correct role claim", async () => {
        let savedClaims = {};
        mockSetCustomClaims.mockImplementationOnce((uid, claims) => { savedClaims = claims; return Promise.resolve(); });

        const res = await request(app)
            .post("/signup/applicant")
            .send({ uid: "u1", email: "a@test.com", firstname: "Alice", lastname: "Smith" });

        expect(res.status).toBe(201);
        expect(savedClaims.role).toBe("applicant");
    });

    test("✅ Saves to both flat users/ and applicantRef subcollection", async () => {
        const setCalls = [];
        mockDocSet.mockImplementation((name) => { setCalls.push(name); return Promise.resolve(); });
        mockApplicantRefSet.mockImplementation(() => { setCalls.push("applicantRef"); return Promise.resolve(); });

        await request(app).post("/signup/applicant").send({ uid: "u1", email: "a@test.com" });

        expect(setCalls).toContain("users");
        expect(setCalls).toContain("applicantRef");
    });

    test("✅ Role spoofing attempt is overwritten — always applicant", async () => {
        let savedData = {};
        mockApplicantRefSet.mockImplementationOnce((uid, data) => { savedData = data; return Promise.resolve(); });

        await request(app).post("/signup/applicant").send({ uid: "u1", email: "a@test.com", role: "admin" });

        expect(savedData.role).toBe("applicant");
        expect(savedData.role).not.toBe("admin");
    });

    test("✅ CV is stored when provided", async () => {
        let savedData = {};
        mockDocSet.mockImplementation((name, id, data) => { if (name === "users") savedData = data; return Promise.resolve(); });
        const cvUrl = "https://cloudinary.com/cv.pdf";
        await request(app).post("/signup/applicant").send({ uid: "u1", email: "a@test.com", cv: cvUrl });
        expect(savedData.cv).toBe(cvUrl);
    });

    test("✅ CV is null when not provided", async () => {
        let savedData = {};
        mockDocSet.mockImplementation((name, id, data) => { if (name === "users") savedData = data; return Promise.resolve(); });
        await request(app).post("/signup/applicant").send({ uid: "u1", email: "a@test.com" });
        expect(savedData.cv).toBeNull();
    });

    test("✅ qualifications defaults to empty array", async () => {
        let savedData = {};
        mockDocSet.mockImplementation((name, id, data) => { if (name === "users") savedData = data; return Promise.resolve(); });
        await request(app).post("/signup/applicant").send({ uid: "u1", email: "a@test.com" });
        expect(savedData.qualifications).toEqual([]);
    });

    test("❌ Missing email returns 400", async () => {
        const res = await request(app).post("/signup/applicant").send({ uid: "u1" });
        expect(res.status).toBe(400);
        expect(res.body.error).toBe("Email is required");
    });

    test("❌ Firebase setCustomUserClaims failure returns 500", async () => {
        mockSetCustomClaims.mockRejectedValueOnce(new Error("Firebase error"));
        const res = await request(app).post("/signup/applicant").send({ uid: "u1", email: "a@test.com" });
        expect(res.status).toBe(500);
        expect(res.body.error).toBe("Failed to create applicant");
    });
});

// =============================================================================
// POST /signup/provider — requires verifyToken
// =============================================================================
describe("POST /signup/provider", () => {

    test("✅ Creates provider with correct role claim", async () => {
        mockVerifyIdToken.mockResolvedValue({ uid: "p1", role: "provider" });
        let savedClaims = {};
        mockSetCustomClaims.mockImplementationOnce((uid, claims) => { savedClaims = claims; return Promise.resolve(); });

        const res = await request(app)
            .post("/signup/provider")
            .set("Authorization", "Bearer valid-token")
            .send({ uid: "p1", email: "p@test.com", organization: "SkillUp SA" });

        expect(res.status).toBe(201);
        expect(savedClaims.role).toBe("provider");
    });

    test("✅ Saves to providerRef subcollection", async () => {
        mockVerifyIdToken.mockResolvedValue({ uid: "p1", role: "provider" });
        let savedData = {};
        mockProviderRefSet.mockImplementationOnce((uid, data) => { savedData = data; return Promise.resolve(); });

        await request(app)
            .post("/signup/provider")
            .set("Authorization", "Bearer valid-token")
            .send({ uid: "p1", email: "p@test.com", organization: "SkillUp SA", city: "JHB", phonenumber: "+27821234567" });

        expect(savedData.role).toBe("provider");
        expect(savedData.organization).toBe("SkillUp SA");
    });

    test("✅ Trims whitespace from input fields", async () => {
        mockVerifyIdToken.mockResolvedValue({ uid: "p1", role: "provider" });
        let savedData = {};
        mockProviderRefSet.mockImplementationOnce((uid, data) => { savedData = data; return Promise.resolve(); });

        await request(app)
            .post("/signup/provider")
            .set("Authorization", "Bearer valid-token")
            .send({ uid: "p1", email: "  p@test.com  ", organization: "  SkillUp  " });

        expect(savedData.organization).toBe("SkillUp");
        expect(savedData.email).toBe("p@test.com");
    });

    test("❌ Missing email returns 400", async () => {
        mockVerifyIdToken.mockResolvedValue({ uid: "p1", role: "provider" });
        const res = await request(app)
            .post("/signup/provider")
            .set("Authorization", "Bearer valid-token")
            .send({ uid: "p1" });
        expect(res.status).toBe(400);
        expect(res.body.error).toBe("Email is required");
    });

    test("❌ Unauthenticated returns 401", async () => {
        const res = await request(app).post("/signup/provider").send({ uid: "p1", email: "p@test.com" });
        expect(res.status).toBe(401);
    });

    test("❌ Firestore failure returns 500", async () => {
        mockVerifyIdToken.mockResolvedValue({ uid: "p1", role: "provider" });
        mockProviderRefSet.mockRejectedValueOnce(new Error("Firestore error"));
        const res = await request(app)
            .post("/signup/provider")
            .set("Authorization", "Bearer valid-token")
            .send({ uid: "p1", email: "p@test.com" });
        expect(res.status).toBe(500);
        expect(res.body.error).toBe("Failed to create provider");
    });
});

// =============================================================================
// GET /api/user-profile
// =============================================================================
describe("GET /api/user-profile", () => {

    test("✅ Returns profile from subcollection via lookupUser", async () => {
        mockVerifyIdToken.mockResolvedValue({ uid: "u1", role: "applicant" });
        mockLookupUser.mockResolvedValue({
            snap: { exists: true, data: () => ({ firstname: "Alice", email: "a@test.com", role: "applicant" }) },
            ref: null, role: "applicant"
        });
        const res = await request(app).get("/api/user-profile").set("Authorization", "Bearer valid-token");
        expect(res.status).toBe(200);
        expect(res.body.firstname).toBe("Alice");
    });

    test("✅ Falls back to flat users/ collection when subcollection returns null", async () => {
        mockVerifyIdToken.mockResolvedValue({ uid: "u1", role: "applicant" });
        mockLookupUser.mockResolvedValue({ snap: null, ref: null, role: null });
        mockDocGet.mockResolvedValueOnce({ exists: true, data: () => ({ firstname: "Bob", role: "applicant" }) });
        const res = await request(app).get("/api/user-profile").set("Authorization", "Bearer valid-token");
        expect(res.status).toBe(200);
        expect(res.body.firstname).toBe("Bob");
    });

    test("❌ 404 when user not found in any collection", async () => {
        mockVerifyIdToken.mockResolvedValue({ uid: "ghost", role: "applicant" });
        mockLookupUser.mockResolvedValue({ snap: null, ref: null, role: null });
        mockDocGet.mockResolvedValue({ exists: false });
        const res = await request(app).get("/api/user-profile").set("Authorization", "Bearer valid-token");
        expect(res.status).toBe(404);
        expect(res.body.error).toBe("User not found");
    });

    test("❌ Unauthenticated returns 401", async () => {
        const res = await request(app).get("/api/user-profile");
        expect(res.status).toBe(401);
    });

    test("❌ Firestore failure returns 500", async () => {
        mockVerifyIdToken.mockResolvedValue({ uid: "u1", role: "applicant" });
        mockLookupUser.mockRejectedValueOnce(new Error("DB error"));
        const res = await request(app).get("/api/user-profile").set("Authorization", "Bearer valid-token");
        expect(res.status).toBe(500);
        expect(res.body.error).toBe("Failed to fetch profile");
    });
});

// =============================================================================
// GET /api/user-role
// =============================================================================
describe("GET /api/user-role", () => {

    test("✅ Returns role from subcollection", async () => {
        mockVerifyIdToken.mockResolvedValue({ uid: "u1", role: "provider" });
        mockLookupUser.mockResolvedValue({
            snap: { exists: true, data: () => ({ role: "provider" }) },
            ref: null, role: "provider"
        });
        const res = await request(app).get("/api/user-role").set("Authorization", "Bearer valid-token");
        expect(res.status).toBe(200);
        expect(res.body.role).toBe("provider");
    });

    test("❌ 404 when user not found", async () => {
        mockVerifyIdToken.mockResolvedValue({ uid: "ghost", role: "applicant" });
        mockLookupUser.mockResolvedValue({ snap: null, ref: null, role: null });
        const res = await request(app).get("/api/user-role").set("Authorization", "Bearer valid-token");
        expect(res.status).toBe(404);
        expect(res.body.error).toBe("User not found");
    });

    test("❌ Unauthenticated returns 401", async () => {
        const res = await request(app).get("/api/user-role");
        expect(res.status).toBe(401);
    });

    test("❌ Firestore failure returns 500", async () => {
        mockVerifyIdToken.mockResolvedValue({ uid: "u1", role: "applicant" });
        mockLookupUser.mockRejectedValueOnce(new Error("DB error"));
        const res = await request(app).get("/api/user-role").set("Authorization", "Bearer valid-token");
        expect(res.status).toBe(500);
        expect(res.body.error).toBe("Failed to look up role");
    });
});

// =============================================================================
// POST /api/set-role-claim
// =============================================================================
describe("POST /api/set-role-claim", () => {

    test("✅ Sets a valid role claim", async () => {
        mockVerifyIdToken.mockResolvedValue({ uid: "admin", role: "admin" });
        const res = await request(app)
            .post("/api/set-role-claim")
            .set("Authorization", "Bearer valid-token")
            .send({ uid: "u1", role: "provider" });
        expect(res.status).toBe(200);
        expect(res.body.message).toBe("Custom claim set");
        expect(mockSetCustomClaims).toHaveBeenCalledWith("u1", { role: "provider" });
    });

    test("✅ Role is case-insensitive — ADMIN becomes admin", async () => {
        mockVerifyIdToken.mockResolvedValue({ uid: "admin", role: "admin" });
        const res = await request(app)
            .post("/api/set-role-claim")
            .set("Authorization", "Bearer valid-token")
            .send({ uid: "u1", role: "APPLICANT" });
        expect(res.status).toBe(200);
        expect(mockSetCustomClaims).toHaveBeenCalledWith("u1", { role: "applicant" });
    });

    test("❌ Invalid role returns 400", async () => {
        mockVerifyIdToken.mockResolvedValue({ uid: "admin", role: "admin" });
        const res = await request(app)
            .post("/api/set-role-claim")
            .set("Authorization", "Bearer valid-token")
            .send({ uid: "u1", role: "superuser" });
        expect(res.status).toBe(400);
        expect(res.body.error).toBe("Invalid role");
    });

    test("❌ Missing uid returns 400", async () => {
        mockVerifyIdToken.mockResolvedValue({ uid: "admin", role: "admin" });
        const res = await request(app)
            .post("/api/set-role-claim")
            .set("Authorization", "Bearer valid-token")
            .send({ role: "applicant" });
        expect(res.status).toBe(400);
        expect(res.body.error).toBe("uid and role are required");
    });

    test("❌ Missing role returns 400", async () => {
        mockVerifyIdToken.mockResolvedValue({ uid: "admin", role: "admin" });
        const res = await request(app)
            .post("/api/set-role-claim")
            .set("Authorization", "Bearer valid-token")
            .send({ uid: "u1" });
        expect(res.status).toBe(400);
    });

    test("❌ Unauthenticated returns 401", async () => {
        const res = await request(app).post("/api/set-role-claim").send({ uid: "u1", role: "applicant" });
        expect(res.status).toBe(401);
    });

    test("❌ Firebase failure returns 500", async () => {
        mockVerifyIdToken.mockResolvedValue({ uid: "admin", role: "admin" });
        mockSetCustomClaims.mockRejectedValueOnce(new Error("Firebase error"));
        const res = await request(app)
            .post("/api/set-role-claim")
            .set("Authorization", "Bearer valid-token")
            .send({ uid: "u1", role: "applicant" });
        expect(res.status).toBe(500);
        expect(res.body.error).toBe("Failed to set custom claim");
    });
});

// =============================================================================
// POST /api/upload-cv
// =============================================================================
describe("POST /api/upload-cv", () => {

    test("✅ Authenticated user can upload CV", async () => {
        mockVerifyIdToken.mockResolvedValue({ uid: "u1", role: "applicant" });
        const res = await request(app)
            .post("/api/upload-cv")
            .set("Authorization", "Bearer valid-token")
            .set("x-mock-cv", "true")
            .field("uid", "u1");
        expect(res.status).toBe(200);
        expect(res.body.message).toBe("CV uploaded successfully");
        expect(res.body.cv).toContain("cloudinary.com");
    });

    test("✅ CV is saved to both flat and subcollection", async () => {
        mockVerifyIdToken.mockResolvedValue({ uid: "u1", role: "applicant" });
        await request(app)
            .post("/api/upload-cv")
            .set("Authorization", "Bearer valid-token")
            .set("x-mock-cv", "true")
            .field("uid", "u1");
        expect(mockApplicantRefUpdate).toHaveBeenCalledWith("u1", expect.objectContaining({ cv: expect.any(String) }));
        expect(mockDocUpdate).toHaveBeenCalledWith("users", "u1", expect.objectContaining({ cv: expect.any(String) }));
    });

    test("❌ No file uploaded returns 400", async () => {
        mockVerifyIdToken.mockResolvedValue({ uid: "u1", role: "applicant" });
        const res = await request(app)
            .post("/api/upload-cv")
            .set("Authorization", "Bearer valid-token")
            .field("uid", "u1");
        expect(res.status).toBe(400);
        expect(res.body.error).toBe("No file uploaded");
    });

    test("❌ Unauthenticated returns 401", async () => {
        const res = await request(app).post("/api/upload-cv").set("x-mock-cv", "true");
        expect(res.status).toBe(401);
    });

    test("❌ Firestore update failure returns 500", async () => {
        mockVerifyIdToken.mockResolvedValue({ uid: "u1", role: "applicant" });
        mockApplicantRefUpdate.mockRejectedValueOnce(new Error("Firestore error"));
        const res = await request(app)
            .post("/api/upload-cv")
            .set("Authorization", "Bearer valid-token")
            .set("x-mock-cv", "true")
            .field("uid", "u1");
        expect(res.status).toBe(500);
        expect(res.body.error).toBe("Failed to upload CV");
    });
});

// =============================================================================
// DELETE /api/delete-cv
// =============================================================================
describe("DELETE /api/delete-cv", () => {

    test("✅ Authenticated user can delete CV", async () => {
        mockVerifyIdToken.mockResolvedValue({ uid: "u1", role: "applicant" });
        const res = await request(app)
            .delete("/api/delete-cv")
            .set("Authorization", "Bearer valid-token");
        expect(res.status).toBe(200);
        expect(res.body.message).toBe("CV deleted successfully");
    });

    test("✅ Sets cv to null in both collections", async () => {
        mockVerifyIdToken.mockResolvedValue({ uid: "u1", role: "applicant" });
        await request(app).delete("/api/delete-cv").set("Authorization", "Bearer valid-token");
        expect(mockApplicantRefUpdate).toHaveBeenCalledWith("u1", { cv: null, cvFilename: null });
        expect(mockDocUpdate).toHaveBeenCalledWith("users", "u1", { cv: null, cvFilename: null });
    });

    test("❌ Unauthenticated returns 401", async () => {
        const res = await request(app).delete("/api/delete-cv");
        expect(res.status).toBe(401);
    });

    test("❌ Firestore failure returns 500", async () => {
        mockVerifyIdToken.mockResolvedValue({ uid: "u1", role: "applicant" });
        mockApplicantRefUpdate.mockRejectedValueOnce(new Error("Firestore error"));
        const res = await request(app).delete("/api/delete-cv").set("Authorization", "Bearer valid-token");
        expect(res.status).toBe(500);
        expect(res.body.error).toBe("Failed to delete CV");
    });
});

// =============================================================================
// PATCH /api/profile/qualifications
// =============================================================================
describe("PATCH /api/profile/qualifications", () => {
    const AUTH = { Authorization: "Bearer valid-token" };
    const makeQuals = (n) => Array.from({ length: n }, (_, i) => ({
        institution: `Inst${i+1}`, name: `Qual${i+1}`, nqfLevel: "7", dateObtained: "2023-11", subjects: []
    }));

    beforeEach(() => mockVerifyIdToken.mockResolvedValue({ uid: "u1", role: "applicant" }));

    test("✅ Saves valid qualifications array", async () => {
        const res = await request(app)
            .patch("/api/profile/qualifications")
            .set(AUTH)
            .send({ qualifications: makeQuals(3) });
        expect(res.status).toBe(200);
        expect(res.body.message).toBe("Qualifications updated");
    });

    test("✅ Saves with merge:true", async () => {
        const quals = makeQuals(2);
        await request(app).patch("/api/profile/qualifications").set(AUTH).send({ qualifications: quals });
        expect(mockApplicantRefSet).toHaveBeenCalledWith(
            "u1",
            expect.objectContaining({ qualifications: quals }),
            { merge: true }
        );
    });

    test("✅ Accepts empty array (clearing qualifications)", async () => {
        const res = await request(app).patch("/api/profile/qualifications").set(AUTH).send({ qualifications: [] });
        expect(res.status).toBe(200);
    });

    test("✅ Accepts exactly 8 qualifications (upper bound)", async () => {
        const res = await request(app).patch("/api/profile/qualifications").set(AUTH).send({ qualifications: makeQuals(8) });
        expect(res.status).toBe(200);
    });

    test("❌ Rejects 9 qualifications (over limit)", async () => {
        const res = await request(app).patch("/api/profile/qualifications").set(AUTH).send({ qualifications: makeQuals(9) });
        expect(res.status).toBe(400);
        expect(res.body.error).toBe("A maximum of 8 qualifications is allowed");
    });

    test("❌ Rejects non-array input", async () => {
        const res = await request(app).patch("/api/profile/qualifications").set(AUTH).send({ qualifications: "bad" });
        expect(res.status).toBe(400);
        expect(res.body.error).toBe("qualifications must be an array");
    });

    test("❌ Rejects object input", async () => {
        const res = await request(app).patch("/api/profile/qualifications").set(AUTH).send({ qualifications: { a: 1 } });
        expect(res.status).toBe(400);
    });

    test("❌ Rejects missing field", async () => {
        const res = await request(app).patch("/api/profile/qualifications").set(AUTH).send({});
        expect(res.status).toBe(400);
    });

    test("❌ Unauthenticated returns 401", async () => {
        const res = await request(app).patch("/api/profile/qualifications").send({ qualifications: [] });
        expect(res.status).toBe(401);
    });

    test("❌ Firestore failure returns 500", async () => {
        mockApplicantRefSet.mockRejectedValueOnce(new Error("Firestore error"));
        const res = await request(app).patch("/api/profile/qualifications").set(AUTH).send({ qualifications: makeQuals(1) });
        expect(res.status).toBe(500);
        expect(res.body.error).toBe("Failed to update qualifications");
    });

    test("❌ Does not call Firestore on invalid input", async () => {
        await request(app).patch("/api/profile/qualifications").set(AUTH).send({ qualifications: "bad" });
        expect(mockApplicantRefSet).not.toHaveBeenCalled();
    });
});

// =============================================================================
// backend/auth.js — verifyToken middleware coverage
// =============================================================================
describe("verifyToken middleware coverage", () => {

    test("❌ No Authorization header returns 401", async () => {
        // Use any protected route without token
        const res = await request(app).get("/api/user-profile");
        expect(res.status).toBe(401);
        expect(res.body.error).toBe("No token provided");
    });

    test("❌ Invalid/expired token returns 401", async () => {
        mockVerifyIdToken.mockRejectedValueOnce(new Error("Token expired"));
        const res = await request(app)
            .get("/api/user-profile")
            .set("Authorization", "Bearer bad-token");
        expect(res.status).toBe(401);
        expect(res.body.error).toBe("Invalid or expired token");
    });

    test("✅ Raw token without Bearer prefix is accepted", async () => {
        mockVerifyIdToken.mockResolvedValue({ uid: "u1", role: "applicant" });
        mockLookupUser.mockResolvedValue({
            snap: { exists: true, data: () => ({ firstname: "Test", role: "applicant" }) },
            ref: null, role: "applicant"
        });
        const res = await request(app)
            .get("/api/user-profile")
            .set("Authorization", "raw-token-without-bearer");
        expect(res.status).toBe(200);
    });
});
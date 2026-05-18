/**
 * signup.api.test.js
 * Tests that signup API endpoints correctly create user profiles and set role claims.
 */
const request = require("supertest");

let mockSet;
let mockSetCustomClaims;
let mockVerifyIdToken;

jest.mock("../../backend/firebaseAdmin", () => {
    mockVerifyIdToken   = jest.fn().mockResolvedValue({ uid: "test-uid", role: "applicant" });
    mockSetCustomClaims = jest.fn().mockResolvedValue();
    return {
        admin: {
            auth: () => ({
                verifyIdToken:       mockVerifyIdToken,
                setCustomUserClaims: mockSetCustomClaims,
                getUserByEmail:      jest.fn().mockRejectedValue(Object.assign(new Error("Not found"), { code: "auth/user-not-found" }))
            })
        },
        db: {}
    };
});

jest.mock("../../backend/userPaths", () => {
    mockSet = jest.fn().mockResolvedValue();
    return {
        applicantRef:  jest.fn(() => ({ set: mockSet })),
        providerRef:   jest.fn(() => ({ set: mockSet })),
        applicantsCol: jest.fn(() => ({ where: jest.fn(() => ({ limit: jest.fn(() => ({ get: jest.fn().mockResolvedValue({ empty: true }) })) })) })),
        providersCol:  jest.fn(() => ({ where: jest.fn(() => ({ limit: jest.fn(() => ({ get: jest.fn().mockResolvedValue({ empty: true }) })) })) })),
        lookupUser:    jest.fn().mockResolvedValue({ snap: null, ref: null, role: null })
    };
});

jest.mock("cloudinary", () => ({ v2: { config: jest.fn() } }), { virtual: true });
jest.mock("multer-storage-cloudinary", () => ({ CloudinaryStorage: jest.fn(() => ({})) }), { virtual: true });
jest.mock("multer", () => jest.fn(() => ({ single: () => (req, res, next) => next() })), { virtual: true });

const app = require("../../backend/app");

beforeEach(() => {
    jest.clearAllMocks();
    mockVerifyIdToken.mockResolvedValue({ uid: "test-uid", role: "applicant" });
    mockSet.mockResolvedValue();
    mockSetCustomClaims.mockResolvedValue();
});

describe("TC-01: Applicant Role Assignment", () => {
    it("should assign 'applicant' role in Firestore and as a custom claim", async () => {
        let savedData = {}, savedClaims = {};
        mockSet.mockImplementationOnce((data) => { savedData = data; return Promise.resolve(); });
        mockSetCustomClaims.mockImplementationOnce((uid, claims) => { savedClaims = claims; return Promise.resolve(); });

        const res = await request(app)
            .post("/signup/applicant")
            .set("Authorization", "Bearer valid-token")
            .send({ uid: "manual_test_uid_001", email: "applicant@test.com", firstname: "John", lastname: "Doe" });

        expect(res.statusCode).toBe(201);
        expect(savedData.role).toBe("applicant");
        expect(savedClaims.role).toBe("applicant");
    });
});

describe("TC-02: Provider Role Assignment", () => {
    it("should assign 'provider' role in Firestore and as a custom claim", async () => {
        let savedData = {}, savedClaims = {};
        mockSet.mockImplementationOnce((data) => { savedData = data; return Promise.resolve(); });
        mockSetCustomClaims.mockImplementationOnce((uid, claims) => { savedClaims = claims; return Promise.resolve(); });

        const res = await request(app)
            .post("/signup/provider")
            .set("Authorization", "Bearer valid-token")
            .send({ uid: "manual_test_uid_002", email: "hr@company.com", organization: "SkillUp Academy", phonenumber: "+27831234567" });

        expect(res.statusCode).toBe(201);
        expect(savedData.role).toBe("provider");
        expect(savedClaims.role).toBe("provider");
    });
});

describe("TC-03: Role Spoofing Attempt", () => {
    it("should overwrite spoofed 'admin' role and assign 'applicant' instead", async () => {
        let savedData = {}, savedClaims = {};
        mockSet.mockImplementationOnce((data) => { savedData = data; return Promise.resolve(); });
        mockSetCustomClaims.mockImplementationOnce((uid, claims) => { savedClaims = claims; return Promise.resolve(); });

        const res = await request(app)
            .post("/signup/applicant")
            .set("Authorization", "Bearer valid-token")
            .send({ uid: "hacker_uid_999", email: "hacker@evil.com", role: "admin" });

        expect(res.statusCode).toBe(201);
        expect(savedData.role).toBe("applicant");
        expect(savedData.role).not.toBe("admin");
        expect(savedClaims.role).toBe("applicant");
        expect(savedClaims.role).not.toBe("admin");
    });
});

describe("TC-04: Missing UID", () => {
    it("should return 500 when UID is missing and role assignment fails", async () => {
        mockSetCustomClaims.mockRejectedValueOnce(new Error("UID is required by Firebase"));

        const res = await request(app)
            .post("/signup/applicant")
            .set("Authorization", "Bearer valid-token")
            .send({ email: "error@test.com" });

        expect(res.statusCode).toBe(500);
        expect(res.body.error).toBe("Failed to create applicant");
    });
});

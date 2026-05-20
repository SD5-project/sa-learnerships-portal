const request = require("supertest");

let mockSet, mockSetCustomClaims, mockVerifyIdToken;

jest.mock("../../backend/helpers", () => ({
    sendMail:  jest.fn().mockResolvedValue(),
    guard:     (route) => (req, res, next) => next(),
    adminOnly: (req, res, next) => next()
}));

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
        db: {
            collection: () => ({
                doc: () => ({ set: jest.fn().mockResolvedValue(), get: jest.fn().mockResolvedValue({ exists: false }) }),
                where: () => ({ limit: () => ({ get: jest.fn().mockResolvedValue({ empty: true }) }), get: jest.fn().mockResolvedValue({ forEach: () => {} }) }),
                get: jest.fn().mockResolvedValue({ forEach: () => {} })
            })
        }
    };
});

jest.mock("../../backend/userPaths", () => {
    mockSet = jest.fn().mockResolvedValue();
    return {
        applicantRef:  jest.fn(() => ({ set: mockSet, get: jest.fn().mockResolvedValue({ exists: false }) })),
        providerRef:   jest.fn(() => ({ set: mockSet, get: jest.fn().mockResolvedValue({ exists: false }) })),
        applicantsCol: jest.fn(() => ({ where: jest.fn(() => ({ limit: jest.fn(() => ({ get: jest.fn().mockResolvedValue({ empty: true }) })) })) })),
        providersCol:  jest.fn(() => ({ where: jest.fn(() => ({ limit: jest.fn(() => ({ get: jest.fn().mockResolvedValue({ empty: true }) })) })) })),
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
            .send({ uid: "test_uid_001", email: "applicant@test.com", firstname: "John", lastname: "Doe" });

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
            .send({ uid: "test_uid_002", email: "hr@company.com", organization: "SkillUp Academy" });

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
            .send({ uid: "hacker_999", email: "hacker@evil.com", role: "admin" });

        expect(res.statusCode).toBe(201);
        expect(savedData.role).toBe("applicant");
        expect(savedData.role).not.toBe("admin");
        expect(savedClaims.role).toBe("applicant");
    });
});

describe("TC-04: Missing UID — Firebase fails", () => {
    it("should return 500 when Firebase claim setting fails", async () => {
        mockSetCustomClaims.mockRejectedValueOnce(new Error("UID is required by Firebase"));

        const res = await request(app)
            .post("/signup/applicant")
            .send({ email: "error@test.com" });

        expect(res.statusCode).toBe(500);
        expect(res.body.error).toBe("Failed to create applicant");
    });
});

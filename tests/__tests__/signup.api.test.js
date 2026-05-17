const request = require("supertest");

// ─── Hoisted Mocks ────────────────────────────────────────────────────────────
let mockSet;
let mockSetCustomClaims;

jest.mock("../../backend/firebaseAdmin", () => {
    mockSet             = jest.fn().mockResolvedValue();
    mockSetCustomClaims = jest.fn().mockResolvedValue();
    return {
        admin: { auth: () => ({ setCustomUserClaims: mockSetCustomClaims }) },
        db: { collection: () => ({ doc: () => ({ set: mockSet }) }) }
    };
});

const app = require("../../backend/app");

// ─── Reset mocks between tests ────────────────────────────────────────────────
beforeEach(() => {
    mockSet.mockReset();
    mockSetCustomClaims.mockReset();
    mockSet.mockResolvedValue();
    mockSetCustomClaims.mockResolvedValue();
});

// ─── TC-01: Applicant Role Assignment ────────────────────────────────────────
describe("TC-01: Applicant Role Assignment", () => {
    it("should assign 'applicant' role in Firestore and as a custom claim", async () => {
        let savedData   = {};
        let savedClaims = {};

        mockSet.mockImplementationOnce((data) => {
            savedData = data;
            return Promise.resolve();
        });

        mockSetCustomClaims.mockImplementationOnce((uid, claims) => {
            savedClaims = claims;
            return Promise.resolve();
        });

        const res = await request(app)
            .post("/signup/applicant")
            .send({
                uid:         "manual_test_uid_001",
                email:       "applicant@test.com",
                firstname:   "John",
                lastname:    "Doe",
                username:    "johndoe",
                institution: "Test University",
                city:        "Cape Town",
                phonenumber: "+27821234567",
                cv:          ""
            });

        expect(res.statusCode).toBe(201);
        expect(savedData.role).toBe("applicant");
        expect(savedClaims.role).toBe("applicant");
    });
});

// ─── TC-02: Provider Role Assignment ─────────────────────────────────────────
describe("TC-02: Provider Role Assignment", () => {
    it("should assign 'provider' role in Firestore and as a custom claim", async () => {
        let savedData   = {};
        let savedClaims = {};

        mockSet.mockImplementationOnce((data) => {
            savedData = data;
            return Promise.resolve();
        });

        mockSetCustomClaims.mockImplementationOnce((uid, claims) => {
            savedClaims = claims;
            return Promise.resolve();
        });

        const res = await request(app)
            .post("/signup/provider")
            .send({
                uid:          "manual_test_uid_002",
                email:        "hr@company.com",
                organization: "SkillUp Academy",
                city:         "Johannesburg",
                phonenumber:  "+27831234567",
                username:     "skillup_hr"
            });

        expect(res.statusCode).toBe(201);
        expect(savedData.role).toBe("provider");
        expect(savedClaims.role).toBe("provider");
    });
});

// ─── TC-03: Security Check — Role Spoofing ────────────────────────────────────
describe("TC-03: Role Spoofing Attempt", () => {
    it("should overwrite spoofed 'admin' role and assign 'applicant' instead", async () => {
        let savedData   = {};
        let savedClaims = {};

        mockSet.mockImplementationOnce((data) => {
            savedData = data;
            return Promise.resolve();
        });

        mockSetCustomClaims.mockImplementationOnce((uid, claims) => {
            savedClaims = claims;
            return Promise.resolve();
        });

        const res = await request(app)
            .post("/signup/applicant")
            .send({
                uid:   "hacker_uid_999",
                email: "hacker@evil.com",
                role:  "admin"
            });

        expect(res.statusCode).toBe(201);
        expect(savedData.role).toBe("applicant");
        expect(savedData.role).not.toBe("admin");
        expect(savedClaims.role).toBe("applicant");
        expect(savedClaims.role).not.toBe("admin");
    });
});

// ─── TC-04: Failure Path — Missing UID ───────────────────────────────────────
describe("TC-04: Missing UID", () => {
    it("should return 500 when UID is missing and role assignment fails", async () => {
        mockSetCustomClaims.mockRejectedValueOnce(
            new Error("UID is required by Firebase")
        );

        const res = await request(app)
            .post("/signup/applicant")
            .send({
                email: "error@test.com"
            });

        expect(res.statusCode).toBe(500);
        expect(res.body.error).toBe("Failed to create applicant");
    });
});
/**
 * cv.test.js
 * Tests for the CV feature:
 *   - CV saved during applicant signup (POST /signup/applicant)
 *   - CV upload from dashboard (POST /api/upload-cv)
 *   - CV replace from dashboard (POST /api/upload-cv with existing CV)
 *   - CV delete from dashboard (DELETE /api/delete-cv)
 *   - CV visible on user profile (GET /api/user-profile)
 */

const request = require("supertest");

// ─── Mock variables ───────────────────────────────────────────────────────────
let mockVerifyIdToken;
let mockSetCustomClaims;
let mockDocGet;
let mockDocSet;
let mockDocUpdate;
let mockLookupUser;
let mockApplicantRefGet;
let mockApplicantRefUpdate;
let mockApplicantRefSet;

// ─── Mock Firestore & Firebase Admin ─────────────────────────────────────────
jest.mock("../../backend/firebaseAdmin", () => {
    mockVerifyIdToken   = jest.fn();
    mockSetCustomClaims = jest.fn().mockResolvedValue();
    mockDocGet          = jest.fn();
    mockDocSet          = jest.fn().mockResolvedValue();
    mockDocUpdate       = jest.fn().mockResolvedValue();

    const makeDoc = (name, id) => ({
        get:    () => mockDocGet(name, id),
        set:    (d) => mockDocSet(name, id, d),
        update: (d) => mockDocUpdate(name, id, d)
    });

    const makeCollection = (name) => ({
        get:     () => Promise.resolve({ forEach: () => {} }),
        add:     jest.fn().mockResolvedValue({ id: "new-id" }),
        limit:   () => ({ get: () => Promise.resolve({ forEach: () => {} }) }),
        orderBy: () => ({ get: () => Promise.resolve({ forEach: () => {} }) }),
        where: (f, op, v) => ({
            get:   () => Promise.resolve({ forEach: () => {} }),
            where: (f2) => ({ get: () => Promise.resolve({ forEach: () => {} }) }),
            limit: () => ({ get: () => Promise.resolve({ forEach: () => {} }) })
        }),
        doc: (id) => makeDoc(name, id)
    });

    return {
        admin: {
            auth: () => ({
                verifyIdToken:       mockVerifyIdToken,
                setCustomUserClaims: mockSetCustomClaims,
                getUserByEmail:      jest.fn().mockRejectedValue(
                    Object.assign(new Error("Not found"), { code: "auth/user-not-found" })
                )
            }),
            firestore: { FieldValue: { serverTimestamp: () => "SERVER_TS" } }
        },
        db: { collection: makeCollection }
    };
});

// ─── Mock nodemailer ──────────────────────────────────────────────────────────
jest.mock("nodemailer", () => ({
    createTransport: jest.fn().mockReturnValue({
        verify:   jest.fn((cb) => cb(null, true)),
        sendMail: jest.fn().mockResolvedValue({ messageId: "test" })
    })
}));

// ─── Mock userPaths ───────────────────────────────────────────────────────────
jest.mock("../../backend/userPaths", () => {
    mockApplicantRefGet    = jest.fn();
    mockApplicantRefUpdate = jest.fn().mockResolvedValue();
    mockApplicantRefSet    = jest.fn().mockResolvedValue();
    mockLookupUser         = jest.fn();

    return {
        applicantsCol: jest.fn(),
        providersCol:  jest.fn(),
        applicantRef:  jest.fn((uid) => ({
            get:    () => mockApplicantRefGet(uid),
            set:    (d) => mockApplicantRefSet(uid, d),
            update: (d) => mockApplicantRefUpdate(uid, d)
        })),
        providerRef: jest.fn((uid) => ({
            get: jest.fn().mockResolvedValue({ exists: false }),
            set: jest.fn().mockResolvedValue()
        })),
        lookupUser: (...args) => mockLookupUser(...args)
    };
});

// ─── Mock Cloudinary + Multer ─────────────────────────────────────────────────
// Multer is mocked to simulate a successful file upload without hitting Cloudinary
jest.mock("cloudinary", () => ({ v2: { config: jest.fn() } }), { virtual: true });
jest.mock("multer-storage-cloudinary", () => ({
    CloudinaryStorage: jest.fn(() => ({}))
}), { virtual: true });
jest.mock("multer", () => {
    return jest.fn(() => ({
        single: () => (req, res, next) => {
            // Simulate a successfully uploaded file
            if (req.headers["x-mock-cv"] === "true") {
                req.file = {
                    path:         "https://res.cloudinary.com/demo/raw/upload/cvs/test_cv.pdf",
                    originalname: "test_cv.pdf",
                    mimetype:     "application/pdf"
                };
            }
            next();
        }
    }));
}, { virtual: true });

const app = require("../../backend/app");

beforeEach(() => {
    jest.clearAllMocks();
    mockSetCustomClaims.mockResolvedValue();
    mockDocSet.mockResolvedValue();
    mockDocUpdate.mockResolvedValue();
    mockApplicantRefSet.mockResolvedValue();
    mockApplicantRefUpdate.mockResolvedValue();
});

// =============================================================================
// CV during signup — POST /signup/applicant
// =============================================================================
describe("CV during signup — POST /signup/applicant", () => {

    test("✅ Signup saves CV URL when provided", async () => {
        const cvUrl = "https://res.cloudinary.com/demo/raw/upload/cvs/my_cv.pdf";
        let savedToFlat = {};
        let savedToSub  = {};

        mockDocSet.mockImplementation((name, id, data) => {
            if (name === "users") savedToFlat = data;
            return Promise.resolve();
        });
        mockApplicantRefSet.mockImplementation((uid, data) => {
            savedToSub = data;
            return Promise.resolve();
        });

        const res = await request(app)
            .post("/signup/applicant")
            .send({
                uid:       "uid-001",
                email:     "cv@test.com",
                firstname: "Test",
                lastname:  "User",
                cv:        cvUrl
            });

        expect(res.status).toBe(201);
        expect(savedToFlat.cv).toBe(cvUrl);
        expect(savedToSub.cv).toBe(cvUrl);
    });

    test("✅ Signup without CV saves cv as null or undefined", async () => {
        let savedData = {};
        mockDocSet.mockImplementation((name, id, data) => {
            if (name === "users") savedData = data;
            return Promise.resolve();
        });

        const res = await request(app)
            .post("/signup/applicant")
            .send({ uid: "uid-002", email: "nocv@test.com", firstname: "No", lastname: "CV" });

        expect(res.status).toBe(201);
        // cv field should be absent or falsy — never a string
        expect(savedData.cv || null).toBeNull();
    });

    test("✅ Signup saves CV to both flat and subcollection", async () => {
        const setCalls = [];
        mockDocSet.mockImplementation((name) => { setCalls.push(name); return Promise.resolve(); });
        mockApplicantRefSet.mockImplementation(() => { setCalls.push("applicantRef"); return Promise.resolve(); });

        await request(app)
            .post("/signup/applicant")
            .send({
                uid:   "uid-003",
                email: "both@test.com",
                cv:    "https://cloudinary.com/cv.pdf"
            });

        expect(setCalls).toContain("users");
        expect(setCalls).toContain("applicantRef");
    });

    test("✅ CV role is always 'applicant' regardless of body", async () => {
        let savedClaims = {};
        mockSetCustomClaims.mockImplementationOnce((uid, claims) => {
            savedClaims = claims;
            return Promise.resolve();
        });

        await request(app)
            .post("/signup/applicant")
            .send({ uid: "uid-004", email: "role@test.com", cv: "https://cloudinary.com/cv.pdf" });

        expect(savedClaims.role).toBe("applicant");
    });

    test("❌ Signup without email returns 400", async () => {
        const res = await request(app)
            .post("/signup/applicant")
            .send({ uid: "uid-005", cv: "https://cloudinary.com/cv.pdf" });

        expect(res.status).toBe(400);
        expect(res.body.error).toBe("Email is required");
    });

    test("❌ Firestore failure during signup returns 500", async () => {
        mockDocSet.mockRejectedValue(new Error("Firestore down"));

        const res = await request(app)
            .post("/signup/applicant")
            .send({ uid: "uid-006", email: "err@test.com", cv: "https://cloudinary.com/cv.pdf" });

        expect(res.status).toBe(500);
        expect(res.body.error).toBe("Failed to create applicant");
    });
});

// =============================================================================
// CV upload from dashboard — POST /api/upload-cv
// =============================================================================
describe("CV upload from dashboard — POST /api/upload-cv", () => {

    test("✅ Authenticated applicant can upload a CV", async () => {
        mockVerifyIdToken.mockResolvedValue({ uid: "uid-100", role: "applicant" });

        const res = await request(app)
            .post("/api/upload-cv")
            .set("Authorization", "Bearer valid-token")
            .set("x-mock-cv", "true")   // triggers multer mock to attach req.file
            .field("uid", "uid-100");

        expect(res.status).toBe(200);
        expect(res.body.message).toBe("CV uploaded successfully");
        expect(res.body.cv).toBe("https://res.cloudinary.com/demo/raw/upload/cvs/test_cv.pdf");
    });

    test("✅ CV URL saved to applicant subcollection", async () => {
        mockVerifyIdToken.mockResolvedValue({ uid: "uid-100", role: "applicant" });

        await request(app)
            .post("/api/upload-cv")
            .set("Authorization", "Bearer valid-token")
            .set("x-mock-cv", "true")
            .field("uid", "uid-100");

        expect(mockApplicantRefUpdate).toHaveBeenCalledWith(
            "uid-100",
            expect.objectContaining({
                cv:         "https://res.cloudinary.com/demo/raw/upload/cvs/test_cv.pdf",
                cvFilename: "test_cv.pdf"
            })
        );
    });

    test("✅ CV URL saved to flat users collection", async () => {
        mockVerifyIdToken.mockResolvedValue({ uid: "uid-100", role: "applicant" });

        await request(app)
            .post("/api/upload-cv")
            .set("Authorization", "Bearer valid-token")
            .set("x-mock-cv", "true")
            .field("uid", "uid-100");

        expect(mockDocUpdate).toHaveBeenCalledWith(
            "users",
            "uid-100",
            expect.objectContaining({
                cv:         "https://res.cloudinary.com/demo/raw/upload/cvs/test_cv.pdf",
                cvFilename: "test_cv.pdf"
            })
        );
    });

    test("❌ Returns 400 when no file is attached", async () => {
        mockVerifyIdToken.mockResolvedValue({ uid: "uid-100", role: "applicant" });

        const res = await request(app)
            .post("/api/upload-cv")
            .set("Authorization", "Bearer valid-token")
            .field("uid", "uid-100");
        // x-mock-cv NOT set → req.file is undefined

        expect(res.status).toBe(400);
        expect(res.body.error).toBe("No file uploaded");
    });

    test("❌ Returns 401 when unauthenticated", async () => {
        const res = await request(app)
            .post("/api/upload-cv")
            .set("x-mock-cv", "true");

        expect(res.status).toBe(401);
    });

    test("❌ Returns 500 when Firestore update fails", async () => {
        mockVerifyIdToken.mockResolvedValue({ uid: "uid-100", role: "applicant" });
        mockApplicantRefUpdate.mockRejectedValue(new Error("Firestore error"));

        const res = await request(app)
            .post("/api/upload-cv")
            .set("Authorization", "Bearer valid-token")
            .set("x-mock-cv", "true")
            .field("uid", "uid-100");

        expect(res.status).toBe(500);
        expect(res.body.error).toBe("Failed to upload CV");
    });
});

// =============================================================================
// CV replace from dashboard — POST /api/upload-cv (called again with new file)
// Replacing is the same endpoint — just re-uploading overwrites the old URL
// =============================================================================
describe("CV replace from dashboard", () => {

    test("✅ Replacing a CV updates both collections with new URL", async () => {
        mockVerifyIdToken.mockResolvedValue({ uid: "uid-200", role: "applicant" });

        const subCalls = [];
        const flatCalls = [];

        mockApplicantRefUpdate.mockImplementation((uid, data) => {
            subCalls.push(data);
            return Promise.resolve();
        });
        mockDocUpdate.mockImplementation((name, id, data) => {
            if (name === "users") flatCalls.push(data);
            return Promise.resolve();
        });

        const res = await request(app)
            .post("/api/upload-cv")
            .set("Authorization", "Bearer valid-token")
            .set("x-mock-cv", "true")
            .field("uid", "uid-200");

        expect(res.status).toBe(200);
        expect(subCalls[0].cv).toBe("https://res.cloudinary.com/demo/raw/upload/cvs/test_cv.pdf");
        expect(flatCalls[0].cv).toBe("https://res.cloudinary.com/demo/raw/upload/cvs/test_cv.pdf");
    });

    test("✅ Replace returns the new CV URL in response", async () => {
        mockVerifyIdToken.mockResolvedValue({ uid: "uid-200", role: "applicant" });

        const res = await request(app)
            .post("/api/upload-cv")
            .set("Authorization", "Bearer valid-token")
            .set("x-mock-cv", "true")
            .field("uid", "uid-200");

        expect(res.body.cv).toBeDefined();
        expect(typeof res.body.cv).toBe("string");
        expect(res.body.cv).toContain("cloudinary.com");
    });

    test("❌ Replace without file returns 400", async () => {
        mockVerifyIdToken.mockResolvedValue({ uid: "uid-200", role: "applicant" });

        const res = await request(app)
            .post("/api/upload-cv")
            .set("Authorization", "Bearer valid-token")
            .field("uid", "uid-200");

        expect(res.status).toBe(400);
        expect(res.body.error).toBe("No file uploaded");
    });

    test("❌ Replace without auth returns 401", async () => {
        const res = await request(app)
            .post("/api/upload-cv")
            .set("x-mock-cv", "true");

        expect(res.status).toBe(401);
    });
});

// =============================================================================
// CV delete from dashboard — DELETE /api/delete-cv
// =============================================================================
describe("CV delete from dashboard — DELETE /api/delete-cv", () => {

    test("✅ Authenticated applicant can delete their CV", async () => {
        mockVerifyIdToken.mockResolvedValue({ uid: "uid-300", role: "applicant" });

        const res = await request(app)
            .delete("/api/delete-cv")
            .set("Authorization", "Bearer valid-token");

        expect(res.status).toBe(200);
        expect(res.body.message).toBe("CV deleted successfully");
    });

    test("✅ Delete sets cv to null in applicant subcollection", async () => {
        mockVerifyIdToken.mockResolvedValue({ uid: "uid-300", role: "applicant" });

        await request(app)
            .delete("/api/delete-cv")
            .set("Authorization", "Bearer valid-token");

        expect(mockApplicantRefUpdate).toHaveBeenCalledWith(
            "uid-300",
            expect.objectContaining({ cv: null, cvFilename: null })
        );
    });

    test("✅ Delete sets cv to null in flat users collection", async () => {
        mockVerifyIdToken.mockResolvedValue({ uid: "uid-300", role: "applicant" });

        await request(app)
            .delete("/api/delete-cv")
            .set("Authorization", "Bearer valid-token");

        expect(mockDocUpdate).toHaveBeenCalledWith(
            "users",
            "uid-300",
            expect.objectContaining({ cv: null, cvFilename: null })
        );
    });

    test("✅ Delete clears both collections atomically", async () => {
        mockVerifyIdToken.mockResolvedValue({ uid: "uid-300", role: "applicant" });

        await request(app)
            .delete("/api/delete-cv")
            .set("Authorization", "Bearer valid-token");

        // Both should have been called
        expect(mockApplicantRefUpdate).toHaveBeenCalledTimes(1);
        expect(mockDocUpdate).toHaveBeenCalledTimes(1);
    });

    test("❌ Returns 401 when unauthenticated", async () => {
        const res = await request(app).delete("/api/delete-cv");
        expect(res.status).toBe(401);
    });

    test("❌ Returns 500 when Firestore update fails", async () => {
        mockVerifyIdToken.mockResolvedValue({ uid: "uid-300", role: "applicant" });
        mockApplicantRefUpdate.mockRejectedValue(new Error("Firestore error"));

        const res = await request(app)
            .delete("/api/delete-cv")
            .set("Authorization", "Bearer valid-token");

        expect(res.status).toBe(500);
        expect(res.body.error).toBe("Failed to delete CV");
    });
});

// =============================================================================
// CV visible on user profile — GET /api/user-profile
// =============================================================================
describe("CV visible on GET /api/user-profile", () => {

    test("✅ Profile returns cv URL when CV has been uploaded", async () => {
        mockVerifyIdToken.mockResolvedValue({ uid: "uid-400", role: "applicant" });
        mockLookupUser.mockResolvedValue({
            snap: {
                exists: true,
                data:   () => ({
                    firstname:  "Test",
                    email:      "test@test.com",
                    role:       "applicant",
                    cv:         "https://res.cloudinary.com/demo/raw/upload/cvs/test_cv.pdf",
                    cvFilename: "test_cv.pdf"
                })
            },
            ref:  null,
            role: "applicant"
        });

        const res = await request(app)
            .get("/api/user-profile")
            .set("Authorization", "Bearer valid-token");

        expect(res.status).toBe(200);
        expect(res.body.cv).toBe("https://res.cloudinary.com/demo/raw/upload/cvs/test_cv.pdf");
        expect(res.body.cvFilename).toBe("test_cv.pdf");
    });

    test("✅ Profile returns cv as null when no CV uploaded", async () => {
        mockVerifyIdToken.mockResolvedValue({ uid: "uid-401", role: "applicant" });
        mockLookupUser.mockResolvedValue({
            snap: {
                exists: true,
                data:   () => ({
                    firstname: "No",
                    email:     "nocv@test.com",
                    role:      "applicant",
                    cv:        null
                })
            },
            ref:  null,
            role: "applicant"
        });

        const res = await request(app)
            .get("/api/user-profile")
            .set("Authorization", "Bearer valid-token");

        expect(res.status).toBe(200);
        expect(res.body.cv).toBeNull();
    });

    test("❌ Returns 401 when unauthenticated", async () => {
        const res = await request(app).get("/api/user-profile");
        expect(res.status).toBe(401);
    });

    test("❌ Returns 404 when user not found", async () => {
        mockVerifyIdToken.mockResolvedValue({ uid: "ghost", role: "applicant" });
        mockLookupUser.mockResolvedValue({ snap: null, ref: null, role: null });
        mockDocGet.mockResolvedValue({ exists: false });

        const res = await request(app)
            .get("/api/user-profile")
            .set("Authorization", "Bearer valid-token");

        expect(res.status).toBe(404);
        expect(res.body.error).toBe("User not found");
    });
});
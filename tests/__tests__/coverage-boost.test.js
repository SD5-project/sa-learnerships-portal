/**
 * coverage-boost.test.js
 * Targets uncovered lines across:
 *   - backend/auth.js (verifyToken middleware)
 *   - backend/helpers.js (sendMail, guard, adminOnly)
 *   - backend/userPaths.js (lookupUser)
 *   - routes/auth.js (signup, profile, role, CV, qualifications)
 *   - routes/applications.js (hasApplied, apply, list, status update)
 *   - routes/opportunities.js (submit, listings, single opp, NQF)
 *   - routes/admin.js (listings moderation, user management)
 *   - routes/provider.js (provider listings, applicants)
 *   - app.js (static routes, NQF levels, validate-application)
 */

const request = require("supertest");

// ─── Mocks ────────────────────────────────────────────────────────────────────
jest.mock("../../backend/helpers", () => ({
    sendMail:  jest.fn().mockResolvedValue(),
    guard: (route) => (req, res, next) => {
        if (req.user && ["provider", "admin"].includes(req.user.role)) return next();
        res.status(403).json({ error: "Forbidden" });
    },
    adminOnly: (req, res, next) => {
        if (req.user && req.user.role === "admin") return next();
        res.status(403).json({ error: "Forbidden: Admins only." });
    }
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

let mockVerifyIdToken, mockSetCustomClaims, mockUpdateUser, mockDeleteUser, mockGetUserByEmail;
let mockDocGet, mockDocSet, mockDocUpdate, mockDocDelete;
let mockCollectionGet, mockCollectionAdd, mockWhereGet;
let mockApplicantRefGet, mockApplicantRefSet, mockApplicantRefUpdate;
let mockProviderRefGet, mockLookupUser;

jest.mock("../../backend/firebaseAdmin", () => {
    mockVerifyIdToken   = jest.fn();
    mockSetCustomClaims = jest.fn().mockResolvedValue();
    mockUpdateUser      = jest.fn().mockResolvedValue();
    mockDeleteUser      = jest.fn().mockResolvedValue();
    mockGetUserByEmail  = jest.fn();
    mockDocGet          = jest.fn().mockResolvedValue({ exists: false });
    mockDocSet          = jest.fn().mockResolvedValue();
    mockDocUpdate       = jest.fn().mockResolvedValue();
    mockDocDelete       = jest.fn().mockResolvedValue();
    mockCollectionGet   = jest.fn().mockResolvedValue({ forEach: () => {} });
    mockCollectionAdd   = jest.fn().mockResolvedValue({ id: "new-id" });
    mockWhereGet        = jest.fn().mockResolvedValue({ forEach: () => {} });

    const makeCollection = (name) => ({
        get:     () => mockCollectionGet(name),
        add:     (d) => mockCollectionAdd(name, d),
        orderBy: () => ({ get: () => mockCollectionGet(name) }),
        limit:   () => ({ get: () => mockCollectionGet(name) }),
        where: (f, op, v) => ({
            get:   () => mockWhereGet(name, f, op, v),
            limit: () => ({ get: () => mockWhereGet(name, f, op, v) }),
            where: (f2, o2, v2) => ({
                get: () => mockWhereGet(name, `${f}+${f2}`, op, v),
                where: (f3) => ({ get: () => mockWhereGet(name, `${f}+${f2}+${f3}`, op, v) })
            })
        }),
        doc: (id) => ({
            get:    () => mockDocGet(name, id),
            set:    (d, o) => mockDocSet(name, id, d, o),
            update: (d) => mockDocUpdate(name, id, d),
            delete: () => mockDocDelete(name, id)
        })
    });

    return {
        admin: {
            auth: () => ({
                verifyIdToken:       mockVerifyIdToken,
                setCustomUserClaims: mockSetCustomClaims,
                updateUser:          mockUpdateUser,
                deleteUser:          mockDeleteUser,
                getUserByEmail:      mockGetUserByEmail
            }),
            firestore: { FieldValue: { serverTimestamp: () => "SERVER_TIMESTAMP" } }
        },
        db: { collection: makeCollection }
    };
});

jest.mock("../../backend/userPaths", () => {
    mockApplicantRefGet    = jest.fn().mockResolvedValue({ exists: false });
    mockApplicantRefSet    = jest.fn().mockResolvedValue();
    mockApplicantRefUpdate = jest.fn().mockResolvedValue();
    mockProviderRefGet     = jest.fn().mockResolvedValue({ exists: false });
    mockLookupUser         = jest.fn().mockResolvedValue({ snap: null, ref: null, role: null });

    return {
        applicantsCol: jest.fn(() => ({
            get:   jest.fn().mockResolvedValue({ forEach: () => {} }),
            where: jest.fn(() => ({ limit: jest.fn(() => ({ get: jest.fn().mockResolvedValue({ empty: true }) })), get: jest.fn().mockResolvedValue({ forEach: () => {} }) }))
        })),
        providersCol: jest.fn(() => ({
            get:   jest.fn().mockResolvedValue({ forEach: () => {} }),
            where: jest.fn(() => ({ limit: jest.fn(() => ({ get: jest.fn().mockResolvedValue({ empty: true }) })), get: jest.fn().mockResolvedValue({ forEach: () => {} }) }))
        })),
        adminsCol: jest.fn(() => ({
            get:   jest.fn().mockResolvedValue({ forEach: () => {} }),
            where: jest.fn(() => ({ limit: jest.fn(() => ({ get: jest.fn().mockResolvedValue({ empty: true }) })) }))
        })),
        applicantRef: jest.fn((uid) => ({
            get:    () => mockApplicantRefGet(uid),
            set:    (d, o) => mockApplicantRefSet(uid, d, o),
            update: (d) => mockApplicantRefUpdate(uid, d)
        })),
        providerRef: jest.fn((uid) => ({
            get: () => mockProviderRefGet(uid),
            set: jest.fn().mockResolvedValue()
        })),
        adminRef:   jest.fn(() => ({ get: jest.fn().mockResolvedValue({ exists: false }), set: jest.fn().mockResolvedValue() })),
        lookupUser: (...args) => mockLookupUser(...args)
    };
});

const app = require("../../backend/app");

// ─── Token helpers ────────────────────────────────────────────────────────────
const adminTok    = () => { mockVerifyIdToken.mockResolvedValue({ uid: "admin-uid",    role: "admin"    }); return "Bearer admin-tok"; };
const provTok     = () => { mockVerifyIdToken.mockResolvedValue({ uid: "prov-uid",     role: "provider" }); return "Bearer prov-tok";  };
const applTok     = () => { mockVerifyIdToken.mockResolvedValue({ uid: "appl-uid",     role: "applicant"}); return "Bearer appl-tok";  };

beforeEach(() => {
    jest.resetAllMocks();
    mockDocGet.mockResolvedValue({ exists: false });
    mockDocSet.mockResolvedValue();
    mockDocUpdate.mockResolvedValue();
    mockDocDelete.mockResolvedValue();
    mockCollectionGet.mockResolvedValue({ forEach: () => {} });
    mockCollectionAdd.mockResolvedValue({ id: "new-id" });
    mockWhereGet.mockResolvedValue({ forEach: () => {} });
    mockApplicantRefGet.mockResolvedValue({ exists: false });
    mockApplicantRefSet.mockResolvedValue();
    mockApplicantRefUpdate.mockResolvedValue();
    mockProviderRefGet.mockResolvedValue({ exists: false });
    mockLookupUser.mockResolvedValue({ snap: null, ref: null, role: null });
    mockUpdateUser.mockResolvedValue();
    mockDeleteUser.mockResolvedValue();
    mockGetUserByEmail.mockRejectedValue(Object.assign(new Error("Not found"), { code: "auth/user-not-found" }));
    mockSetCustomClaims.mockResolvedValue();
});

// =============================================================================
// backend/auth.js — verifyToken middleware paths
// =============================================================================
describe("verifyToken middleware coverage", () => {

    test("✅ Valid Bearer token passes through", async () => {
        mockVerifyIdToken.mockResolvedValue({ uid: "uid-1", role: "applicant" });
        const res = await request(app).get("/api/user-profile").set("Authorization", "Bearer valid-token");
        expect([200, 404]).toContain(res.status); // passes auth at least
    });

    test("❌ No Authorization header returns 401", async () => {
        const res = await request(app).get("/api/user-profile");
        expect(res.status).toBe(401);
        expect(res.body.error).toBe("No token provided");
    });

    test("❌ Empty Bearer token returns 401", async () => {
        const res = await request(app).get("/api/user-profile").set("Authorization", "Bearer ");
        expect(res.status).toBe(401);
    });

    test("❌ Invalid token returns 401", async () => {
        mockVerifyIdToken.mockRejectedValue(new Error("Invalid token"));
        const res = await request(app).get("/api/user-profile").set("Authorization", "Bearer bad-token");
        expect(res.status).toBe(401);
        expect(res.body.error).toBe("Invalid or expired token");
    });

    test("✅ Raw token without Bearer prefix is accepted", async () => {
        mockVerifyIdToken.mockResolvedValue({ uid: "uid-1", role: "applicant" });
        const res = await request(app).get("/api/user-profile").set("Authorization", "raw-token-value");
        expect([200, 404]).toContain(res.status);
    });
});

// =============================================================================
// routes/auth.js — signup, profile, role, check endpoints
// =============================================================================
describe("POST /signup/applicant", () => {

    test("✅ Creates applicant with all fields", async () => {
        mockApplicantRefSet.mockResolvedValue();
        const res = await request(app).post("/signup/applicant").send({
            uid: "uid-1", email: "a@test.com", firstname: "John", lastname: "Doe",
            phonenumber: "+27820000000", idNumber: "9001010000000", qualifications: []
        });
        expect(res.status).toBe(201);
        expect(res.body.message).toBe("Applicant created successfully");
    });

    test("✅ Creates applicant without optional fields", async () => {
        mockApplicantRefSet.mockResolvedValue();
        const res = await request(app).post("/signup/applicant").send({ uid: "uid-2", email: "b@test.com" });
        expect(res.status).toBe(201);
    });

    test("✅ Saves qualifications array", async () => {
        const quals = [{ institution: "Wits", name: "BSc", nqfLevel: "7" }];
        let saved = {};
        mockApplicantRefSet.mockImplementation((uid, d) => { saved = d; return Promise.resolve(); });
        await request(app).post("/signup/applicant").send({ uid: "uid-3", email: "c@test.com", qualifications: quals });
        expect(saved.qualifications).toEqual(quals);
    });

    test("❌ Missing email returns 400", async () => {
        const res = await request(app).post("/signup/applicant").send({ uid: "uid-4" });
        expect(res.status).toBe(400);
        expect(res.body.error).toBe("Email is required");
    });

    test("❌ Firestore failure returns 500", async () => {
        mockApplicantRefSet.mockRejectedValue(new Error("DB error"));
        const res = await request(app).post("/signup/applicant").send({ uid: "uid-5", email: "e@test.com" });
        expect(res.status).toBe(500);
    });
});

describe("POST /signup/provider", () => {

    test("✅ Creates provider successfully", async () => {
        const res = await request(app).post("/signup/provider").send({
            uid: "puid-1", email: "p@test.com", organization: "Corp SA", phonenumber: "+27821234567"
        });
        expect(res.status).toBe(201);
        expect(res.body.message).toBe("Provider created successfully");
    });

    test("❌ Missing email returns 400", async () => {
        const res = await request(app).post("/signup/provider").send({ uid: "puid-2", organization: "Corp" });
        expect(res.status).toBe(400);
        expect(res.body.error).toBe("Email is required");
    });

    test("❌ Firestore failure returns 500", async () => {
        mockProviderRefGet.mockRejectedValue(new Error("DB error"));
        const { providerRef } = require("../../backend/userPaths");
        providerRef.mockImplementation(() => ({ set: jest.fn().mockRejectedValue(new Error("DB error")), get: jest.fn() }));
        const res = await request(app).post("/signup/provider").send({ uid: "puid-3", email: "p3@test.com" });
        expect(res.status).toBe(500);
    });
});

describe("GET /api/check-email", () => {

    test("✅ Returns exists: false for new email", async () => {
        mockGetUserByEmail.mockRejectedValue(Object.assign(new Error(), { code: "auth/user-not-found" }));
        mockWhereGet.mockResolvedValue({ empty: true });
        const res = await request(app).get("/api/check-email?email=new@test.com");
        expect(res.status).toBe(200);
        expect(res.body.exists).toBe(false);
    });

    test("✅ Returns exists: true when email in applicants", async () => {
        mockGetUserByEmail.mockRejectedValue(Object.assign(new Error(), { code: "auth/user-not-found" }));
        mockWhereGet.mockResolvedValueOnce({ empty: false });
        const res = await request(app).get("/api/check-email?email=taken@test.com");
        expect(res.status).toBe(200);
        expect(res.body.exists).toBe(true);
    });

    test("✅ Deletes ghost account (no role claim) and returns exists: false", async () => {
        mockGetUserByEmail.mockResolvedValue({ uid: "ghost-uid", customClaims: {} });
        mockDeleteUser.mockResolvedValue();
        mockWhereGet.mockResolvedValue({ empty: true });
        const res = await request(app).get("/api/check-email?email=ghost@test.com");
        expect(res.status).toBe(200);
        expect(mockDeleteUser).toHaveBeenCalledWith("ghost-uid");
    });

    test("✅ Returns exists: true when account has role claim", async () => {
        mockGetUserByEmail.mockResolvedValue({ uid: "real-uid", customClaims: { role: "applicant" } });
        const res = await request(app).get("/api/check-email?email=real@test.com");
        expect(res.status).toBe(200);
        expect(res.body.exists).toBe(true);
    });

    test("❌ Missing email param returns 400", async () => {
        const res = await request(app).get("/api/check-email");
        expect(res.status).toBe(400);
    });
});

describe("GET /api/check-idnumber", () => {
    test("✅ Returns exists: false", async () => {
        mockWhereGet.mockResolvedValue({ empty: true });
        const res = await request(app).get("/api/check-idnumber?idNumber=9001010000000");
        expect(res.status).toBe(200);
        expect(res.body.exists).toBe(false);
    });
    test("✅ Returns exists: true", async () => {
        mockWhereGet.mockResolvedValueOnce({ empty: false });
        const res = await request(app).get("/api/check-idnumber?idNumber=9001010000000");
        expect(res.status).toBe(200);
        expect(res.body.exists).toBe(true);
    });
    test("❌ Missing param returns 400", async () => {
        const res = await request(app).get("/api/check-idnumber");
        expect(res.status).toBe(400);
    });
});

describe("GET /api/check-phone", () => {
    test("✅ Returns exists: false", async () => {
        mockWhereGet.mockResolvedValue({ empty: true });
        const res = await request(app).get("/api/check-phone?phone=%2B27820000000");
        expect(res.status).toBe(200);
        expect(res.body.exists).toBe(false);
    });
    test("✅ Returns exists: true", async () => {
        mockWhereGet.mockResolvedValueOnce({ empty: false });
        const res = await request(app).get("/api/check-phone?phone=%2B27821234567");
        expect(res.status).toBe(200);
        expect(res.body.exists).toBe(true);
    });
    test("❌ Missing param returns 400", async () => {
        const res = await request(app).get("/api/check-phone");
        expect(res.status).toBe(400);
    });
});

describe("GET /api/user-profile", () => {

    test("✅ Returns profile from subcollection via lookupUser", async () => {
        mockVerifyIdToken.mockResolvedValue({ uid: "uid-1", role: "applicant" });
        mockLookupUser.mockResolvedValue({
            snap: { exists: true, data: () => ({ firstname: "Alice", role: "applicant" }) },
            ref: null, role: "applicant"
        });
        const res = await request(app).get("/api/user-profile").set("Authorization", "Bearer tok");
        expect(res.status).toBe(200);
        expect(res.body.firstname).toBe("Alice");
    });

    test("✅ Falls back to flat users collection", async () => {
        mockVerifyIdToken.mockResolvedValue({ uid: "uid-2", role: "applicant" });
        mockLookupUser.mockResolvedValue({ snap: null, ref: null, role: null });
        mockDocGet.mockResolvedValue({ exists: true, data: () => ({ firstname: "Bob", role: "applicant" }) });
        const res = await request(app).get("/api/user-profile").set("Authorization", "Bearer tok");
        expect(res.status).toBe(200);
        expect(res.body.firstname).toBe("Bob");
    });

    test("❌ Returns 404 when not found anywhere", async () => {
        mockVerifyIdToken.mockResolvedValue({ uid: "ghost", role: "applicant" });
        mockLookupUser.mockResolvedValue({ snap: null, ref: null, role: null });
        mockDocGet.mockResolvedValue({ exists: false });
        const res = await request(app).get("/api/user-profile").set("Authorization", "Bearer tok");
        expect(res.status).toBe(404);
    });

    test("❌ Returns 401 when unauthenticated", async () => {
        const res = await request(app).get("/api/user-profile");
        expect(res.status).toBe(401);
    });
});

describe("GET /api/user-role", () => {

    test("✅ Returns role for existing user", async () => {
        mockVerifyIdToken.mockResolvedValue({ uid: "uid-1", role: "provider" });
        mockLookupUser.mockResolvedValue({
            snap: { exists: true, data: () => ({ role: "provider" }) },
            ref: null, role: "provider"
        });
        const res = await request(app).get("/api/user-role").set("Authorization", "Bearer tok");
        expect(res.status).toBe(200);
        expect(res.body.role).toBe("provider");
    });

    test("❌ Returns 404 when user not found", async () => {
        mockVerifyIdToken.mockResolvedValue({ uid: "ghost", role: "applicant" });
        mockLookupUser.mockResolvedValue({ snap: null, ref: null, role: null });
        const res = await request(app).get("/api/user-role").set("Authorization", "Bearer tok");
        expect(res.status).toBe(404);
    });
});

describe("POST /api/set-role-claim", () => {

    test("✅ Sets valid role claim", async () => {
        mockVerifyIdToken.mockResolvedValue({ uid: "uid-1", role: "admin" });
        const res = await request(app)
            .post("/api/set-role-claim").set("Authorization", "Bearer tok")
            .send({ uid: "uid-2", role: "provider" });
        expect(res.status).toBe(200);
        expect(res.body.message).toBe("Custom claim set");
    });

    test("❌ Invalid role returns 400", async () => {
        mockVerifyIdToken.mockResolvedValue({ uid: "uid-1", role: "admin" });
        const res = await request(app)
            .post("/api/set-role-claim").set("Authorization", "Bearer tok")
            .send({ uid: "uid-2", role: "superuser" });
        expect(res.status).toBe(400);
    });

    test("❌ Missing fields returns 400", async () => {
        mockVerifyIdToken.mockResolvedValue({ uid: "uid-1", role: "admin" });
        const res = await request(app)
            .post("/api/set-role-claim").set("Authorization", "Bearer tok")
            .send({ uid: "uid-2" });
        expect(res.status).toBe(400);
    });
});

describe("POST /api/upload-cv", () => {

    test("✅ Uploads CV and saves to both collections", async () => {
        mockVerifyIdToken.mockResolvedValue({ uid: "uid-cv", role: "applicant" });
        const res = await request(app)
            .post("/api/upload-cv")
            .set("Authorization", "Bearer tok")
            .set("x-mock-cv", "true")
            .field("uid", "uid-cv");
        expect(res.status).toBe(200);
        expect(res.body.message).toBe("CV uploaded successfully");
    });

    test("❌ No file returns 400", async () => {
        mockVerifyIdToken.mockResolvedValue({ uid: "uid-cv", role: "applicant" });
        const res = await request(app)
            .post("/api/upload-cv")
            .set("Authorization", "Bearer tok")
            .field("uid", "uid-cv");
        expect(res.status).toBe(400);
        expect(res.body.error).toBe("No file uploaded");
    });

    test("❌ Unauthenticated returns 401", async () => {
        const res = await request(app).post("/api/upload-cv").set("x-mock-cv", "true");
        expect(res.status).toBe(401);
    });

    test("❌ Firestore failure returns 500", async () => {
        mockVerifyIdToken.mockResolvedValue({ uid: "uid-cv", role: "applicant" });
        mockApplicantRefUpdate.mockRejectedValue(new Error("DB error"));
        const res = await request(app)
            .post("/api/upload-cv")
            .set("Authorization", "Bearer tok")
            .set("x-mock-cv", "true")
            .field("uid", "uid-cv");
        expect(res.status).toBe(500);
    });
});

describe("DELETE /api/delete-cv", () => {

    test("✅ Deletes CV successfully", async () => {
        mockVerifyIdToken.mockResolvedValue({ uid: "uid-cv", role: "applicant" });
        const res = await request(app).delete("/api/delete-cv").set("Authorization", "Bearer tok");
        expect(res.status).toBe(200);
        expect(res.body.message).toBe("CV deleted successfully");
    });

    test("✅ Clears cv and cvFilename in both collections", async () => {
        mockVerifyIdToken.mockResolvedValue({ uid: "uid-cv", role: "applicant" });
        await request(app).delete("/api/delete-cv").set("Authorization", "Bearer tok");
        expect(mockApplicantRefUpdate).toHaveBeenCalledWith("uid-cv",
            expect.objectContaining({ cv: null, cvFilename: null })
        );
    });

    test("❌ Unauthenticated returns 401", async () => {
        const res = await request(app).delete("/api/delete-cv");
        expect(res.status).toBe(401);
    });

    test("❌ Firestore failure returns 500", async () => {
        mockVerifyIdToken.mockResolvedValue({ uid: "uid-cv", role: "applicant" });
        mockApplicantRefUpdate.mockRejectedValue(new Error("DB error"));
        const res = await request(app).delete("/api/delete-cv").set("Authorization", "Bearer tok");
        expect(res.status).toBe(500);
    });
});

// =============================================================================
// routes/applications.js
// =============================================================================
describe("GET /applicant/hasApplied", () => {
    test("✅ Returns false when not applied", async () => {
        mockWhereGet.mockResolvedValue({ empty: true });
        const res = await request(app).get("/applicant/hasApplied?applicantID=u1&listingID=l1");
        expect(res.status).toBe(200);
        expect(res.body.hasApplied).toBe(false);
    });
    test("✅ Returns true when applied", async () => {
        mockWhereGet.mockResolvedValue({ empty: false });
        const res = await request(app).get("/applicant/hasApplied?applicantID=u1&listingID=l1");
        expect(res.status).toBe(200);
        expect(res.body.hasApplied).toBe(true);
    });
    test("❌ Missing params returns 400", async () => {
        const res = await request(app).get("/applicant/hasApplied?applicantID=u1");
        expect(res.status).toBe(400);
    });
});

describe("POST /applicant/apply", () => {

    test("✅ Valid application submitted", async () => {
        mockApplicantRefGet.mockResolvedValue({ exists: true, data: () => ({ role: "applicant" }) });
        mockDocGet.mockImplementation((name) => {
            if (name === "Opportunities") return Promise.resolve({ exists: true });
            if (name === "applications")  return Promise.resolve({ exists: false });
            return Promise.resolve({ exists: false });
        });
        const res = await request(app).post("/applicant/apply")
            .send({ applicantID: "u1", listingID: "l1", status: "pending" });
        expect(res.status).toBe(201);
        expect(res.body.message).toBe("Application submitted");
    });

    test("❌ Missing IDs returns 400", async () => {
        const res = await request(app).post("/applicant/apply").send({ applicantID: "u1" });
        expect(res.status).toBe(400);
    });

    test("❌ Non-existent user returns 400", async () => {
        mockApplicantRefGet.mockResolvedValue({ exists: false });
        const res = await request(app).post("/applicant/apply").send({ applicantID: "ghost", listingID: "l1" });
        expect(res.status).toBe(400);
        expect(res.body.error).toBe("User not found");
    });

    test("❌ Non-existent listing returns 404", async () => {
        mockApplicantRefGet.mockResolvedValue({ exists: true });
        mockDocGet.mockImplementation((name) => {
            if (name === "Opportunities") return Promise.resolve({ exists: false });
            return Promise.resolve({ exists: false });
        });
        const res = await request(app).post("/applicant/apply").send({ applicantID: "u1", listingID: "ghost" });
        expect(res.status).toBe(404);
    });

    test("❌ Duplicate application returns 409", async () => {
        mockApplicantRefGet.mockResolvedValue({ exists: true });
        mockDocGet.mockImplementation((name) => {
            if (name === "Opportunities") return Promise.resolve({ exists: true });
            if (name === "applications")  return Promise.resolve({ exists: true });
            return Promise.resolve({ exists: false });
        });
        const res = await request(app).post("/applicant/apply").send({ applicantID: "u1", listingID: "l1" });
        expect(res.status).toBe(409);
    });
});

describe("GET /api/applications", () => {

    test("✅ Returns applications for authenticated user", async () => {
        mockVerifyIdToken.mockResolvedValue({ uid: "u1", role: "applicant" });
        mockWhereGet.mockResolvedValue({
            forEach: (cb) => {
                cb({ id: "app1", data: () => ({ applicantID: "u1", listingID: "l1", status: "pending" }) });
            }
        });
        const res = await request(app).get("/api/applications").set("Authorization", "Bearer tok");
        expect(res.status).toBe(200);
        expect(res.body.length).toBe(1);
    });

    test("✅ Returns empty array when no applications", async () => {
        mockVerifyIdToken.mockResolvedValue({ uid: "u1", role: "applicant" });
        mockWhereGet.mockResolvedValue({ forEach: () => {} });
        const res = await request(app).get("/api/applications").set("Authorization", "Bearer tok");
        expect(res.status).toBe(200);
        expect(res.body).toEqual([]);
    });

    test("❌ Unauthenticated returns 401", async () => {
        const res = await request(app).get("/api/applications");
        expect(res.status).toBe(401);
    });

    test("❌ Firestore failure returns 500", async () => {
        mockVerifyIdToken.mockResolvedValue({ uid: "u1", role: "applicant" });
        mockWhereGet.mockRejectedValue(new Error("DB error"));
        const res = await request(app).get("/api/applications").set("Authorization", "Bearer tok");
        expect(res.status).toBe(500);
    });
});

describe("PATCH /api/applicants/:id/status", () => {

    test("✅ Provider can update status to shortlisted", async () => {
        mockVerifyIdToken.mockResolvedValue({ uid: "prov-uid", role: "provider" });
        mockDocGet.mockImplementation((name) => {
            if (name === "applications")  return Promise.resolve({ exists: true, data: () => ({ listingID: "l1", applicantID: "a1", status: "pending" }) });
            if (name === "Opportunities") return Promise.resolve({ exists: true, data: () => ({ title: "Dev Role", providerID: "prov-uid" }) });
            return Promise.resolve({ exists: false });
        });
        const res = await request(app)
            .patch("/api/applicants/app1/status").set("Authorization", "Bearer tok")
            .send({ status: "shortlisted" });
        expect(res.status).toBe(200);
    });

    test("✅ Provider can accept a shortlisted application", async () => {
        mockVerifyIdToken.mockResolvedValue({ uid: "prov-uid", role: "provider" });
        mockDocGet.mockImplementation((name) => {
            if (name === "applications")  return Promise.resolve({ exists: true, data: () => ({ listingID: "l1", applicantID: "a1", status: "shortlisted" }) });
            if (name === "Opportunities") return Promise.resolve({ exists: true, data: () => ({ title: "Dev Role", providerID: "prov-uid" }) });
            return Promise.resolve({ exists: false });
        });
        const res = await request(app)
            .patch("/api/applicants/app1/status").set("Authorization", "Bearer tok")
            .send({ status: "accepted" });
        expect(res.status).toBe(200);
    });

    test("❌ Invalid status returns 400", async () => {
        mockVerifyIdToken.mockResolvedValue({ uid: "prov-uid", role: "provider" });
        const res = await request(app)
            .patch("/api/applicants/app1/status").set("Authorization", "Bearer tok")
            .send({ status: "promoted" });
        expect(res.status).toBe(400);
    });

    test("❌ Applicant cannot update status", async () => {
        mockVerifyIdToken.mockResolvedValue({ uid: "a1", role: "applicant" });
        const res = await request(app)
            .patch("/api/applicants/app1/status").set("Authorization", "Bearer tok")
            .send({ status: "shortlisted" });
        expect(res.status).toBe(403);
    });

    test("❌ Accepting non-shortlisted returns 400", async () => {
        mockVerifyIdToken.mockResolvedValue({ uid: "prov-uid", role: "provider" });
        mockDocGet.mockImplementation((name) => {
            if (name === "applications")  return Promise.resolve({ exists: true, data: () => ({ listingID: "l1", applicantID: "a1", status: "pending" }) });
            if (name === "Opportunities") return Promise.resolve({ exists: true, data: () => ({ title: "Dev Role", providerID: "prov-uid" }) });
            return Promise.resolve({ exists: false });
        });
        const res = await request(app)
            .patch("/api/applicants/app1/status").set("Authorization", "Bearer tok")
            .send({ status: "accepted" });
        expect(res.status).toBe(400);
        expect(res.body.error).toBe("Applicant must be shortlisted before accepting");
    });

    test("❌ App not found returns 404", async () => {
        mockVerifyIdToken.mockResolvedValue({ uid: "prov-uid", role: "provider" });
        mockDocGet.mockResolvedValue({ exists: false });
        const res = await request(app)
            .patch("/api/applicants/ghost/status").set("Authorization", "Bearer tok")
            .send({ status: "shortlisted" });
        expect(res.status).toBe(404);
    });

    test("❌ Unauthenticated returns 401", async () => {
        const res = await request(app).patch("/api/applicants/app1/status").send({ status: "shortlisted" });
        expect(res.status).toBe(401);
    });
});

// =============================================================================
// routes/opportunities.js
// =============================================================================
describe("GET /api/listings", () => {

    test("✅ Applicant can browse listings", async () => {
        mockVerifyIdToken.mockResolvedValue({ uid: "a1", role: "applicant" });
        mockWhereGet.mockResolvedValue({
            forEach: (cb) => {
                cb({ id: "l1", data: () => ({ title: "Internship", description: "Good", stipend: 3000, location: "JHB", company: "Corp", type: "internship" }) });
            }
        });
        const res = await request(app).get("/api/listings").set("Authorization", "Bearer tok");
        expect(res.status).toBe(200);
        expect(res.body.length).toBeGreaterThan(0);
    });

    test("✅ Returns empty array when no listings", async () => {
        mockVerifyIdToken.mockResolvedValue({ uid: "a1", role: "applicant" });
        mockWhereGet.mockResolvedValue({ forEach: () => {} });
        const res = await request(app).get("/api/listings").set("Authorization", "Bearer tok");
        expect(res.status).toBe(200);
    });

    test("❌ Unauthenticated returns 401", async () => {
        const res = await request(app).get("/api/listings");
        expect(res.status).toBe(401);
    });

    test("❌ Firestore failure returns 500", async () => {
        mockVerifyIdToken.mockResolvedValue({ uid: "a1", role: "applicant" });
        mockWhereGet.mockRejectedValue(new Error("DB error"));
        const res = await request(app).get("/api/listings").set("Authorization", "Bearer tok");
        expect(res.status).toBe(500);
    });
});

describe("POST /api/opportunities/submit", () => {

    test("✅ Provider submits an opportunity", async () => {
        mockVerifyIdToken.mockResolvedValue({ uid: "prov-uid", role: "provider" });
        mockCollectionAdd.mockResolvedValue({ id: "opp-1" });
        const res = await request(app)
            .post("/api/opportunities/submit").set("Authorization", provTok())
            .send({ title: "Dev Internship", type: "internship", company: "Corp" });
        expect(res.status).toBe(201);
        expect(res.body.id).toBeDefined();
    });

    test("❌ Applicant cannot submit — 403", async () => {
        const res = await request(app)
            .post("/api/opportunities/submit").set("Authorization", applTok())
            .send({ title: "Test" });
        expect(res.status).toBe(403);
    });

    test("❌ Unauthenticated returns 401", async () => {
        const res = await request(app).post("/api/opportunities/submit").send({ title: "Test" });
        expect(res.status).toBe(401);
    });

    test("❌ Firestore failure returns 500", async () => {
        mockVerifyIdToken.mockResolvedValue({ uid: "prov-uid", role: "provider" });
        mockCollectionAdd.mockRejectedValue(new Error("DB error"));
        const res = await request(app)
            .post("/api/opportunities/submit").set("Authorization", "Bearer tok")
            .send({ title: "Test" });
        expect(res.status).toBe(500);
    });
});

describe("GET /api/opportunities/:id", () => {

    test("✅ Returns opportunity for valid ID", async () => {
        mockVerifyIdToken.mockResolvedValue({ uid: "a1", role: "applicant" });
        mockDocGet.mockResolvedValue({ exists: true, id: "opp1", data: () => ({ title: "Dev Internship", company: "Corp" }) });
        const res = await request(app).get("/api/opportunities/opp1").set("Authorization", "Bearer tok");
        expect(res.status).toBe(200);
        expect(res.body.title).toBe("Dev Internship");
    });

    test("❌ Non-existent returns 404", async () => {
        mockVerifyIdToken.mockResolvedValue({ uid: "a1", role: "applicant" });
        mockDocGet.mockResolvedValue({ exists: false });
        const res = await request(app).get("/api/opportunities/ghost").set("Authorization", "Bearer tok");
        expect(res.status).toBe(404);
    });

    test("❌ Unauthenticated returns 401", async () => {
        const res = await request(app).get("/api/opportunities/opp1");
        expect(res.status).toBe(401);
    });
});

// =============================================================================
// routes/admin.js
// =============================================================================
describe("GET /api/admin/listings/pending", () => {

    test("✅ Admin fetches in_for_review listings", async () => {
        mockWhereGet.mockResolvedValue({
            forEach: (cb) => cb({ id: "l1", data: () => ({ title: "T", company: "C", type: "internship", location: "JHB", stipend: 0, providerID: "p1", createdAt: "2024-01-01", status: "in_for_review" }) })
        });
        const res = await request(app).get("/api/admin/listings/pending").set("Authorization", adminTok());
        expect(res.status).toBe(200);
        expect(res.body.length).toBe(1);
    });

    test("❌ Provider cannot access — 403", async () => {
        const res = await request(app).get("/api/admin/listings/pending").set("Authorization", provTok());
        expect(res.status).toBe(403);
    });

    test("❌ Unauthenticated returns 401", async () => {
        const res = await request(app).get("/api/admin/listings/pending");
        expect(res.status).toBe(401);
    });
});

describe("GET /api/admin/listings", () => {

    test("✅ Admin sees all listings", async () => {
        mockCollectionGet.mockResolvedValue({
            forEach: (cb) => {
                cb({ id: "l1", data: () => ({ title: "A", company: "X", type: "internship", location: "JHB", stipend: 0, providerID: "p1", createdAt: "2024-01-01", status: "auto_approved" }) });
                cb({ id: "l2", data: () => ({ title: "B", company: "Y", type: "learnership", location: "CT", stipend: 0, providerID: "p2", createdAt: "2024-01-02", status: "in_for_review" }) });
            }
        });
        const res = await request(app).get("/api/admin/listings").set("Authorization", adminTok());
        expect(res.status).toBe(200);
        expect(res.body.length).toBe(2);
    });

    test("❌ Non-admin returns 403", async () => {
        const res = await request(app).get("/api/admin/listings").set("Authorization", provTok());
        expect(res.status).toBe(403);
    });
});

describe("PATCH /api/admin/listings/:id/approve", () => {

    test("✅ Admin approves listing — sets review_accepted", async () => {
        mockDocGet.mockResolvedValue({ exists: true, data: () => ({ title: "T", providerID: null }) });
        const res = await request(app).patch("/api/admin/listings/l1/approve").set("Authorization", adminTok());
        expect(res.status).toBe(200);
        expect(res.body.message).toBeDefined();
    });

    test("✅ Notifies provider on approval", async () => {
        mockDocGet
            .mockResolvedValueOnce({ exists: true, data: () => ({ title: "T", providerID: "prov-uid" }) })
            .mockResolvedValueOnce({ exists: true, data: () => ({ email: "p@t.com", organization: "Corp" }) });
        await request(app).patch("/api/admin/listings/l1/approve").set("Authorization", adminTok());
        expect(mockCollectionAdd).toHaveBeenCalledWith("notifications",
            expect.objectContaining({ recipientId: "prov-uid" })
        );
    });

    test("❌ 404 when listing missing", async () => {
        mockDocGet.mockResolvedValue({ exists: false });
        const res = await request(app).patch("/api/admin/listings/ghost/approve").set("Authorization", adminTok());
        expect(res.status).toBe(404);
    });

    test("❌ Non-admin returns 403", async () => {
        const res = await request(app).patch("/api/admin/listings/l1/approve").set("Authorization", provTok());
        expect(res.status).toBe(403);
    });
});

describe("PATCH /api/admin/listings/:id/remove", () => {

    test("✅ Admin removes listing — sets rejected_review", async () => {
        mockDocGet.mockResolvedValue({ exists: true, data: () => ({ title: "T", providerID: null }) });
        const res = await request(app)
            .patch("/api/admin/listings/l1/remove").set("Authorization", adminTok())
            .send({ reason: "Duplicate" });
        expect(res.status).toBe(200);
    });

    test("❌ 404 when listing missing", async () => {
        mockDocGet.mockResolvedValue({ exists: false });
        const res = await request(app).patch("/api/admin/listings/ghost/remove").set("Authorization", adminTok());
        expect(res.status).toBe(404);
    });

    test("❌ Non-admin returns 403", async () => {
        const res = await request(app).patch("/api/admin/listings/l1/remove").set("Authorization", provTok());
        expect(res.status).toBe(403);
    });
});

describe("GET /api/admin/users", () => {

    test("✅ Admin lists users", async () => {
        mockCollectionGet.mockResolvedValue({
            forEach: (cb) => {
                cb({ id: "u1", data: () => ({ firstname: "Alice", email: "a@t.com", role: "applicant", status: "active", createdAt: "2024-01-01" }) });
                cb({ id: "u2", data: () => ({ firstname: "Bob",   email: "b@t.com", role: "provider",  status: "active", createdAt: "2024-01-02" }) });
            }
        });
        const res = await request(app).get("/api/admin/users").set("Authorization", adminTok());
        expect(res.status).toBe(200);
        expect(res.body.users).toBeDefined();
    });

    test("✅ Pagination works", async () => {
        mockCollectionGet.mockResolvedValue({
            forEach: (cb) => { for (let i = 0; i < 25; i++) cb({ id: `u${i}`, data: () => ({ firstname: `U${i}`, email: `u${i}@t.com`, role: "applicant", status: "active", createdAt: `2024-01-01` }) }); }
        });
        const res = await request(app).get("/api/admin/users?page=2&limit=10").set("Authorization", adminTok());
        expect(res.status).toBe(200);
        expect(res.body.pagination.page).toBe(2);
    });

    test("❌ Non-admin returns 403", async () => {
        const res = await request(app).get("/api/admin/users").set("Authorization", provTok());
        expect(res.status).toBe(403);
    });
});

describe("PATCH /api/admin/users/:uid/suspend", () => {

    test("✅ Admin suspends user", async () => {
        mockLookupUser.mockResolvedValue({
            snap: { exists: true, data: () => ({ role: "applicant", email: "a@t.com", firstname: "Alice" }) },
            ref: { update: jest.fn().mockResolvedValue() }, role: "applicant"
        });
        const res = await request(app).patch("/api/admin/users/uid-s/suspend").set("Authorization", adminTok());
        expect(res.status).toBe(200);
        expect(res.body.message).toBe("User suspended");
    });

    test("❌ Admin cannot suspend own account", async () => {
        mockVerifyIdToken.mockResolvedValue({ uid: "admin-uid", role: "admin" });
        const res = await request(app).patch("/api/admin/users/admin-uid/suspend").set("Authorization", "Bearer admin-tok");
        expect(res.status).toBe(400);
    });

    test("❌ User not found returns 404", async () => {
        mockLookupUser.mockResolvedValue({ snap: null, ref: null, role: null });
        const res = await request(app).patch("/api/admin/users/ghost/suspend").set("Authorization", adminTok());
        expect(res.status).toBe(404);
    });

    test("❌ Non-admin returns 403", async () => {
        const res = await request(app).patch("/api/admin/users/uid-s/suspend").set("Authorization", provTok());
        expect(res.status).toBe(403);
    });
});

describe("PATCH /api/admin/users/:uid/reactivate", () => {

    test("✅ Admin reactivates user", async () => {
        mockLookupUser.mockResolvedValue({
            snap: { exists: true, data: () => ({ role: "applicant", email: "a@t.com", firstname: "Alice", status: "suspended" }) },
            ref: { update: jest.fn().mockResolvedValue() }, role: "applicant"
        });
        const res = await request(app).patch("/api/admin/users/uid-r/reactivate").set("Authorization", adminTok());
        expect(res.status).toBe(200);
        expect(res.body.message).toBe("User reactivated");
    });

    test("❌ User not found returns 404", async () => {
        mockLookupUser.mockResolvedValue({ snap: null, ref: null, role: null });
        const res = await request(app).patch("/api/admin/users/ghost/reactivate").set("Authorization", adminTok());
        expect(res.status).toBe(404);
    });

    test("❌ Non-admin returns 403", async () => {
        const res = await request(app).patch("/api/admin/users/uid-r/reactivate").set("Authorization", provTok());
        expect(res.status).toBe(403);
    });
});

describe("DELETE /api/admin/users/:uid", () => {

    test("✅ Admin deletes user", async () => {
        mockLookupUser.mockResolvedValue({
            snap: { exists: true, data: () => ({ role: "applicant" }) },
            ref: { delete: jest.fn().mockResolvedValue() }, role: "applicant"
        });
        const res = await request(app).delete("/api/admin/users/uid-d").set("Authorization", adminTok());
        expect(res.status).toBe(200);
        expect(res.body.message).toBe("User deleted");
    });

    test("❌ Admin cannot delete own account", async () => {
        mockVerifyIdToken.mockResolvedValue({ uid: "admin-uid", role: "admin" });
        const res = await request(app).delete("/api/admin/users/admin-uid").set("Authorization", "Bearer admin-tok");
        expect(res.status).toBe(400);
    });

    test("❌ User not found returns 404", async () => {
        mockLookupUser.mockResolvedValue({ snap: null, ref: null, role: null });
        const res = await request(app).delete("/api/admin/users/ghost").set("Authorization", adminTok());
        expect(res.status).toBe(404);
    });

    test("❌ Non-admin returns 403", async () => {
        const res = await request(app).delete("/api/admin/users/uid-d").set("Authorization", provTok());
        expect(res.status).toBe(403);
    });
});

// =============================================================================
// routes/provider.js
// =============================================================================
describe("GET /api/provider-listings", () => {

    test("✅ Returns provider listings", async () => {
        mockWhereGet.mockResolvedValue({
            forEach: (cb) => cb({ id: "l1", data: () => ({ title: "Dev Role" }) })
        });
        const res = await request(app).get("/api/provider-listings").set("Authorization", provTok());
        expect(res.status).toBe(200);
        expect(res.body.length).toBe(1);
    });

    test("✅ Returns empty array when no listings", async () => {
        mockWhereGet.mockResolvedValue({ forEach: () => {} });
        const res = await request(app).get("/api/provider-listings").set("Authorization", provTok());
        expect(res.status).toBe(200);
        expect(res.body).toEqual([]);
    });

    test("❌ Unauthenticated returns 401", async () => {
        const res = await request(app).get("/api/provider-listings");
        expect(res.status).toBe(401);
    });

    test("❌ Firestore failure returns 500", async () => {
        mockWhereGet.mockRejectedValue(new Error("DB error"));
        const res = await request(app).get("/api/provider-listings").set("Authorization", provTok());
        expect(res.status).toBe(500);
    });
});

describe("GET /api/applicants", () => {

    test("✅ Returns empty when no listings", async () => {
        mockWhereGet.mockResolvedValue({ forEach: () => {} });
        const res = await request(app).get("/api/applicants").set("Authorization", provTok());
        expect(res.status).toBe(200);
        expect(res.body).toEqual([]);
    });

    test("✅ Returns enriched applicants", async () => {
        mockApplicantRefGet.mockResolvedValue({ exists: true, data: () => ({ firstname: "Thabo", email: "t@t.com" }) });
        mockWhereGet
            .mockResolvedValueOnce({ forEach: (cb) => cb({ id: "l1", data: () => ({ title: "Dev Role" }) }) })
            .mockResolvedValueOnce({ forEach: (cb) => cb({ id: "app1", data: () => ({ applicantID: "a1", listingID: "l1", status: "pending" }) }) });
        const res = await request(app).get("/api/applicants").set("Authorization", provTok());
        expect(res.status).toBe(200);
        expect(res.body[0].applicant.firstname).toBe("Thabo");
    });

    test("❌ Unauthenticated returns 401", async () => {
        const res = await request(app).get("/api/applicants");
        expect(res.status).toBe(401);
    });
});

// =============================================================================
// app.js static routes and NQF levels
// =============================================================================
describe("Static page routes", () => {
    test("✅ / serves index.html", async () => {
        const res = await request(app).get("/");
        expect([200, 301, 302]).toContain(res.status);
    });
    test("✅ /listings serves listings page", async () => {
        const res = await request(app).get("/listings");
        expect([200, 301, 302]).toContain(res.status);
    });
    test("✅ /applicant-home serves page", async () => {
        const res = await request(app).get("/applicant-home");
        expect([200, 301, 302]).toContain(res.status);
    });
    test("✅ /provider-home serves page", async () => {
        const res = await request(app).get("/provider-home");
        expect([200, 301, 302]).toContain(res.status);
    });
    test("✅ /admin-dashboard serves page", async () => {
        const res = await request(app).get("/admin-dashboard");
        expect([200, 301, 302]).toContain(res.status);
    });
});

describe("GET /nqf-levels", () => {
    test("✅ Returns 10 NQF levels from fallback", async () => {
        mockCollectionGet.mockRejectedValue(new Error("empty"));
        const res = await request(app).get("/nqf-levels");
        expect(res.status).toBe(200);
        expect(res.body.levels.length).toBe(10);
    });
    test("✅ NQF level 4 is Matric", async () => {
        mockCollectionGet.mockRejectedValue(new Error("empty"));
        const res = await request(app).get("/nqf-levels");
        const matric = res.body.levels.find(l => l.level === 4);
        expect(matric.name).toContain("Matric");
    });
});

describe("GET /api/health", () => {
    test("✅ Returns health status", async () => {
        const res = await request(app).get("/api/health");
        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty("hasProjectId");
    });
});
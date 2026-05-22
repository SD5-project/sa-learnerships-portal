/**
 * opportunities.test.js
 * Tests for routes/opportunities.js
 * Covers: submit, browse listings, single opportunity, NQF validation
 *
 * Key changes vs old tests:
 *   - /api/listings now fetches auto_approved AND review_accepted (two parallel queries)
 *   - /api/opportunities/submit has duplicate SAQA check + smart status logic
 *   - status values: "auto_approved", "in_for_review" (not "pending-review" / "approved")
 */
const request = require("supertest");

jest.mock("../../backend/helpers", () => ({
    sendMail:  jest.fn().mockResolvedValue(),
    guard:     (route) => (req, res, next) => {
        if (req.user && ["provider","admin"].includes(req.user.role)) return next();
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
jest.mock("multer", () => jest.fn(() => ({ single: () => (req, res, next) => next() })), { virtual: true });

let mockVerifyIdToken, mockSetCustomClaims;
let mockDocGet, mockDocSet, mockDocUpdate;
let mockCollectionGet, mockCollectionAdd, mockWhereGet;

jest.mock("../../backend/firebaseAdmin", () => {
    mockVerifyIdToken   = jest.fn();
    mockSetCustomClaims = jest.fn().mockResolvedValue();
    mockDocGet          = jest.fn().mockResolvedValue({ exists: false });
    mockDocSet          = jest.fn().mockResolvedValue();
    mockDocUpdate       = jest.fn().mockResolvedValue();
    mockCollectionGet   = jest.fn();
    mockCollectionAdd   = jest.fn().mockResolvedValue({ id: "new-opp-id" });
    mockWhereGet        = jest.fn();

    const makeCollection = (name) => ({
        get:     () => mockCollectionGet(name),
        add:     (data) => mockCollectionAdd(name, data),
        orderBy: () => ({ get: () => mockCollectionGet(name) }),
        where: (f, op, v) => ({
            get:   () => mockWhereGet(name, f, op, v),
            where: (f2, o2, v2) => ({
                get: () => mockWhereGet(name, `${f}+${f2}`, op, v)
            })
        }),
        doc: (id) => ({
            get:    () => mockDocGet(name, id),
            set:    (d) => mockDocSet(name, id, d),
            update: (d) => mockDocUpdate(name, id, d)
        }),
        limit: () => ({ get: () => mockCollectionGet(name) })
    });

    return {
        admin: {
            auth: () => ({ verifyIdToken: mockVerifyIdToken, setCustomUserClaims: mockSetCustomClaims, getUserByEmail: jest.fn().mockRejectedValue(Object.assign(new Error(), { code: "auth/user-not-found" })) }),
            firestore: { FieldValue: { serverTimestamp: () => "SERVER_TIMESTAMP" } }
        },
        db: { collection: makeCollection }
    };
});

jest.mock("../../backend/userPaths", () => ({
    applicantsCol: jest.fn(() => ({ where: jest.fn(() => ({ limit: jest.fn(() => ({ get: jest.fn().mockResolvedValue({ empty: true }) })) })), get: jest.fn().mockResolvedValue({ forEach: () => {} }) })),
    providersCol:  jest.fn(() => ({ where: jest.fn(() => ({ limit: jest.fn(() => ({ get: jest.fn().mockResolvedValue({ empty: true }) })) })), get: jest.fn().mockResolvedValue({ forEach: () => {} }) })),
    adminsCol:     jest.fn(() => ({ get: jest.fn().mockResolvedValue({ forEach: () => {} }) })),
    applicantRef:  jest.fn((uid) => ({ get: jest.fn().mockResolvedValue({ exists: false }), set: jest.fn().mockResolvedValue(), update: jest.fn().mockResolvedValue() })),
    providerRef:   jest.fn(() => ({ get: jest.fn().mockResolvedValue({ exists: false }), set: jest.fn().mockResolvedValue() })),
    adminRef:      jest.fn(() => ({ get: jest.fn().mockResolvedValue({ exists: false }), set: jest.fn().mockResolvedValue() })),
    lookupUser:    jest.fn().mockResolvedValue({ snap: null, ref: null, role: null })
}));

const app = require("../../backend/app");

beforeEach(() => {
    jest.clearAllMocks();
    mockCollectionAdd.mockResolvedValue({ id: "new-opp-id" });
    mockDocGet.mockResolvedValue({ exists: false });
});

// =============================================================================
// POST /api/opportunities/submit
// =============================================================================
describe("POST /api/opportunities/submit", () => {

    test("✅ Provider can submit an internship — gets in_for_review", async () => {
        mockVerifyIdToken.mockResolvedValue({ uid: "provider-uid", role: "provider" });
        let savedData = {};
        mockCollectionAdd.mockImplementationOnce((name, data) => { savedData = data; return Promise.resolve({ id: "opp-123" }); });

        const res = await request(app)
            .post("/api/opportunities/submit")
            .set("Authorization", "Bearer valid-token")
            .send({ type: "internship", title: "Dev Internship", company: "TechCorp" });

        expect(res.status).toBe(201);
        expect(res.body.status).toBe("in_for_review");
        expect(savedData.status).toBe("in_for_review");
    });

    test("✅ Verified learnership gets auto_approved", async () => {
        mockVerifyIdToken.mockResolvedValue({ uid: "provider-uid", role: "provider" });
        let savedData = {};
        mockCollectionAdd.mockImplementationOnce((name, data) => { savedData = data; return Promise.resolve({ id: "opp-456" }); });
        mockWhereGet.mockResolvedValue({ docs: [] }); // no duplicate

        const res = await request(app)
            .post("/api/opportunities/submit")
            .set("Authorization", "Bearer valid-token")
            .send({ type: "learnership", verificationStatus: "verified", title: "SETA Learnership", saqaId: "SAQA-001" });

        expect(res.status).toBe(201);
        expect(res.body.status).toBe("auto_approved");
    });

    test("✅ Unverified learnership gets in_for_review", async () => {
        mockVerifyIdToken.mockResolvedValue({ uid: "provider-uid", role: "provider" });
        mockWhereGet.mockResolvedValue({ docs: [] });

        const res = await request(app)
            .post("/api/opportunities/submit")
            .set("Authorization", "Bearer valid-token")
            .send({ type: "learnership", verificationStatus: "unverified", saqaId: "SAQA-002", title: "Unverified Learnership" });

        expect(res.status).toBe(201);
        expect(res.body.status).toBe("in_for_review");
    });

    test("✅ Submission includes providerID from token", async () => {
        mockVerifyIdToken.mockResolvedValue({ uid: "provider-uid", role: "provider" });
        let savedData = {};
        mockCollectionAdd.mockImplementationOnce((name, data) => { savedData = data; return Promise.resolve({ id: "opp" }); });

        await request(app)
            .post("/api/opportunities/submit")
            .set("Authorization", "Bearer valid-token")
            .send({ type: "internship", title: "Test" });

        expect(savedData.providerID).toBe("provider-uid");
    });

    test("✅ Submission includes createdAt and updatedAt timestamps", async () => {
        mockVerifyIdToken.mockResolvedValue({ uid: "provider-uid", role: "provider" });
        let savedData = {};
        mockCollectionAdd.mockImplementationOnce((name, data) => { savedData = data; return Promise.resolve({ id: "opp" }); });

        await request(app)
            .post("/api/opportunities/submit")
            .set("Authorization", "Bearer valid-token")
            .send({ type: "internship", title: "Test" });

        expect(savedData.createdAt).toBeDefined();
        expect(savedData.updatedAt).toBeDefined();
    });

    test("✅ Admin can also submit opportunities", async () => {
        mockVerifyIdToken.mockResolvedValue({ uid: "admin-uid", role: "admin" });
        const res = await request(app)
            .post("/api/opportunities/submit")
            .set("Authorization", "Bearer valid-token")
            .send({ type: "internship", title: "Admin Opp" });
        expect(res.status).toBe(201);
    });

    test("❌ Duplicate SAQA qualification rejected — 409", async () => {
        mockVerifyIdToken.mockResolvedValue({ uid: "provider-uid", role: "provider" });
        // Simulate active duplicate found
        mockWhereGet.mockResolvedValue({
            docs: [{ data: () => ({ status: "auto_approved" }) }]
        });

        const res = await request(app)
            .post("/api/opportunities/submit")
            .set("Authorization", "Bearer valid-token")
            .send({ type: "learnership", saqaId: "SAQA-DUP", verificationStatus: "verified", title: "Dup" });

        expect(res.status).toBe(409);
        expect(res.body.error).toBe("You already have an active listing for this qualification.");
    });

    test("✅ Rejected duplicate can be resubmitted — not 409", async () => {
        mockVerifyIdToken.mockResolvedValue({ uid: "provider-uid", role: "provider" });
        // Only rejected listing found — should allow resubmission
        mockWhereGet.mockResolvedValue({
            docs: [{ data: () => ({ status: "rejected_review" }) }]
        });

        const res = await request(app)
            .post("/api/opportunities/submit")
            .set("Authorization", "Bearer valid-token")
            .send({ type: "learnership", saqaId: "SAQA-REJ", verificationStatus: "verified", title: "Resubmit" });

        expect(res.status).toBe(201);
    });

    test("❌ Unauthenticated returns 401", async () => {
        const res = await request(app).post("/api/opportunities/submit").send({ title: "Hack" });
        expect(res.status).toBe(401);
    });

    test("❌ Applicant cannot submit — 403", async () => {
        mockVerifyIdToken.mockResolvedValue({ uid: "applicant-uid", role: "applicant" });
        const res = await request(app)
            .post("/api/opportunities/submit")
            .set("Authorization", "Bearer valid-token")
            .send({ title: "Hack" });
        expect(res.status).toBe(403);
    });

    test("❌ Firestore failure returns 500", async () => {
        mockVerifyIdToken.mockResolvedValue({ uid: "provider-uid", role: "provider" });
        mockCollectionAdd.mockRejectedValue(new Error("Firestore down"));
        const res = await request(app)
            .post("/api/opportunities/submit")
            .set("Authorization", "Bearer valid-token")
            .send({ type: "internship", title: "Test" });
        expect(res.status).toBe(500);
        expect(res.body.error).toBe("Failed to submit opportunity");
    });
});

// =============================================================================
// GET /api/listings — fetches auto_approved + review_accepted
// =============================================================================
describe("GET /api/listings", () => {

    test("✅ Applicant sees live listings from both status buckets", async () => {
        mockVerifyIdToken.mockResolvedValue({ uid: "applicant-uid", role: "applicant" });
        // Two parallel where().get() calls
        mockWhereGet
            .mockResolvedValueOnce({ forEach: (cb) => cb({ id: "opp1", data: () => ({ title: "A", description: "D", stipend: 3000, location: "JHB", company: "Corp", type: "internship" }) }) })
            .mockResolvedValueOnce({ forEach: (cb) => cb({ id: "opp2", data: () => ({ title: "B", description: "E", stipend: 2000, location: "CT",  company: "SA",   type: "learnership" }) }) });

        const res = await request(app).get("/api/listings").set("Authorization", "Bearer valid-token");
        expect(res.status).toBe(200);
        expect(res.body.length).toBe(2);
    });

    test("✅ Provider can also fetch listings", async () => {
        mockVerifyIdToken.mockResolvedValue({ uid: "provider-uid", role: "provider" });
        mockWhereGet.mockResolvedValue({ forEach: () => {} });
        const res = await request(app).get("/api/listings").set("Authorization", "Bearer valid-token");
        expect(res.status).toBe(200);
    });

    test("✅ Returns empty array when no live listings", async () => {
        mockVerifyIdToken.mockResolvedValue({ uid: "applicant-uid", role: "applicant" });
        mockWhereGet.mockResolvedValue({ forEach: () => {} });
        const res = await request(app).get("/api/listings").set("Authorization", "Bearer valid-token");
        expect(res.status).toBe(200);
        expect(res.body).toEqual([]);
    });

    test("✅ Response shape is correct", async () => {
        mockVerifyIdToken.mockResolvedValue({ uid: "applicant-uid", role: "applicant" });
        mockWhereGet
            .mockResolvedValueOnce({ forEach: (cb) => cb({ id: "opp1", data: () => ({ title: "A", description: "D", stipend: 3000, location: "JHB", company: "Corp", type: "internship" }) }) })
            .mockResolvedValueOnce({ forEach: () => {} });
        const res = await request(app).get("/api/listings").set("Authorization", "Bearer valid-token");
        const item = res.body[0];
        expect(item).toHaveProperty("id");
        expect(item).toHaveProperty("title");
        expect(item).toHaveProperty("location");
        expect(item).toHaveProperty("type");
        expect(item).toHaveProperty("price"); // mapped from stipend
    });

    test("❌ Unauthenticated returns 401", async () => {
        const res = await request(app).get("/api/listings");
        expect(res.status).toBe(401);
    });

    test("❌ Firestore failure returns 500", async () => {
        mockVerifyIdToken.mockResolvedValue({ uid: "applicant-uid", role: "applicant" });
        mockWhereGet.mockRejectedValue(new Error("DB error"));
        const res = await request(app).get("/api/listings").set("Authorization", "Bearer valid-token");
        expect(res.status).toBe(500);
    });
});

// =============================================================================
// GET /api/opportunities/:id
// =============================================================================
describe("GET /api/opportunities/:id", () => {

    test("✅ Returns opportunity data for valid ID", async () => {
        mockVerifyIdToken.mockResolvedValue({ uid: "user-uid", role: "applicant" });
        mockDocGet.mockResolvedValue({
            exists: true, id: "opp-1",
            data: () => ({ title: "Software Internship", company: "TechCorp", location: "JHB", type: "internship", stipend: 5000 })
        });
        const res = await request(app).get("/api/opportunities/opp-1").set("Authorization", "Bearer valid-token");
        expect(res.status).toBe(200);
        expect(res.body.title).toBe("Software Internship");
        expect(res.body.id).toBe("opp-1");
    });

    test("❌ 404 for non-existent opportunity", async () => {
        mockVerifyIdToken.mockResolvedValue({ uid: "user-uid", role: "applicant" });
        mockDocGet.mockResolvedValue({ exists: false });
        const res = await request(app).get("/api/opportunities/ghost").set("Authorization", "Bearer valid-token");
        expect(res.status).toBe(404);
        expect(res.body.error).toBe("Opportunity not found");
    });

    test("❌ Unauthenticated returns 401", async () => {
        const res = await request(app).get("/api/opportunities/opp-1");
        expect(res.status).toBe(401);
    });

    test("❌ Firestore failure returns 500", async () => {
        mockVerifyIdToken.mockResolvedValue({ uid: "user-uid", role: "applicant" });
        mockDocGet.mockRejectedValue(new Error("DB error"));
        const res = await request(app).get("/api/opportunities/opp-1").set("Authorization", "Bearer valid-token");
        expect(res.status).toBe(500);
        expect(res.body.error).toBe("Failed to fetch opportunity");
    });
});

// =============================================================================
// POST /validate-application
// =============================================================================
describe("POST /validate-application", () => {
    const { applicantRef } = require("../../backend/userPaths");

    test("✅ Eligible applicant passes NQF check", async () => {
        applicantRef.mockReturnValue({ get: jest.fn().mockResolvedValue({ exists: true, data: () => ({ highestNQFLevel: 7 }) }) });
        mockDocGet.mockResolvedValue({ exists: true, data: () => ({ minimumNQFLevel: 6 }) });

        const res = await request(app).post("/validate-application").send({ userId: "u1", opportunityId: "opp1" });
        expect(res.status).toBe(200);
        expect(res.body.eligible).toBe(true);
    });

    test("❌ Ineligible applicant fails NQF check", async () => {
        applicantRef.mockReturnValue({ get: jest.fn().mockResolvedValue({ exists: true, data: () => ({ highestNQFLevel: 4 }) }) });
        mockDocGet.mockResolvedValue({ exists: true, data: () => ({ minimumNQFLevel: 7 }) });

        const res = await request(app).post("/validate-application").send({ userId: "u1", opportunityId: "opp1" });
        expect(res.status).toBe(200);
        expect(res.body.eligible).toBe(false);
        expect(res.body.message).toContain("NQF Level 7");
    });

    test("❌ Missing userId or opportunityId returns 400", async () => {
        const res = await request(app).post("/validate-application").send({ userId: "u1" });
        expect(res.status).toBe(400);
    });

    test("❌ Applicant not found returns 404", async () => {
        applicantRef.mockReturnValue({ get: jest.fn().mockResolvedValue({ exists: false }) });
        const res = await request(app).post("/validate-application").send({ userId: "ghost", opportunityId: "opp1" });
        expect(res.status).toBe(404);
        expect(res.body.error).toBe("Applicant not found.");
    });

    test("❌ Applicant has no NQF level set returns 400", async () => {
        applicantRef.mockReturnValue({ get: jest.fn().mockResolvedValue({ exists: true, data: () => ({}) }) });
        const res = await request(app).post("/validate-application").send({ userId: "u1", opportunityId: "opp1" });
        expect(res.status).toBe(400);
        expect(res.body.eligible).toBe(false);
    });

    test("❌ Opportunity not found returns 404", async () => {
        applicantRef.mockReturnValue({ get: jest.fn().mockResolvedValue({ exists: true, data: () => ({ highestNQFLevel: 7 }) }) });
        mockDocGet.mockResolvedValue({ exists: false });
        const res = await request(app).post("/validate-application").send({ userId: "u1", opportunityId: "ghost" });
        expect(res.status).toBe(404);
        expect(res.body.error).toBe("Opportunity not found.");
    });
});

// =============================================================================
// GET /nqf-levels
// =============================================================================
describe("GET /nqf-levels", () => {

    test("✅ Returns 10 levels from hardcoded fallback when DB empty", async () => {
        mockCollectionGet.mockRejectedValue(new Error("DB error"));
        const res = await request(app).get("/nqf-levels");
        expect(res.status).toBe(200);
        expect(res.body.levels.length).toBe(10);
    });

    test("✅ Returns live data from Firestore when available", async () => {
        mockCollectionGet.mockResolvedValue({
            forEach: (cb) => {
                [1,2,3,4,5,6,7,8,9,10].forEach(n => cb({ data: () => ({ level: n, name: `NQF${n}`, example: "Ex" }) }));
            }
        });
        const res = await request(app).get("/nqf-levels");
        expect(res.status).toBe(200);
        expect(res.body.levels.length).toBe(10);
    });

    test("✅ NQF level 4 is Matric in fallback", async () => {
        mockCollectionGet.mockRejectedValue(new Error("DB error"));
        const res = await request(app).get("/nqf-levels");
        const matric = res.body.levels.find(l => l.level === 4);
        expect(matric.name).toContain("Matric");
    });

    test("✅ Levels are in ascending order in fallback", async () => {
        mockCollectionGet.mockRejectedValue(new Error("DB error"));
        const res = await request(app).get("/nqf-levels");
        expect(res.body.levels.map(l => l.level)).toEqual([1,2,3,4,5,6,7,8,9,10]);
    });
});
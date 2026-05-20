const request = require("supertest");

let mockVerifyIdToken, mockSetCustomClaims;
let mockUserDocGet, mockListingDocGet, mockAppDocGet, mockAppDocSet, mockWhereGet;

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

jest.mock("../../backend/userPaths", () => ({
    applicantRef:  jest.fn(() => ({ set: jest.fn().mockResolvedValue(), get: jest.fn().mockResolvedValue({ exists: false }) })),
    providerRef:   jest.fn(() => ({ set: jest.fn().mockResolvedValue(), get: jest.fn().mockResolvedValue({ exists: false }) })),
    applicantsCol: jest.fn(() => ({ where: jest.fn(() => ({ limit: jest.fn(() => ({ get: jest.fn().mockResolvedValue({ empty: true }) })) })) })),
    providersCol:  jest.fn(() => ({ where: jest.fn(() => ({ limit: jest.fn(() => ({ get: jest.fn().mockResolvedValue({ empty: true }) })) })) })),
    lookupUser:    jest.fn().mockResolvedValue({ snap: null, ref: null, role: null })
}));

jest.mock("../../backend/firebaseAdmin", () => {
    mockVerifyIdToken   = jest.fn();
    mockSetCustomClaims = jest.fn().mockResolvedValue();
    mockUserDocGet      = jest.fn();
    mockListingDocGet   = jest.fn();
    mockAppDocGet       = jest.fn();
    mockAppDocSet       = jest.fn().mockResolvedValue();
    mockWhereGet        = jest.fn().mockResolvedValue({ empty: true });

    return {
        admin: {
            auth: () => ({ verifyIdToken: mockVerifyIdToken, setCustomUserClaims: mockSetCustomClaims }),
            firestore: { FieldValue: { serverTimestamp: () => "SERVER_TIMESTAMP" } }
        },
        db: {
            collection: (name) => ({
                doc: (_id) => ({
                    get: () => {
                        if (name === "users")         return mockUserDocGet();
                        if (name === "Opportunities") return mockListingDocGet();
                        if (name === "applications")  return mockAppDocGet();
                        return Promise.resolve({ exists: false });
                    },
                    set:    mockAppDocSet,
                    update: jest.fn().mockResolvedValue()
                }),
                where: () => ({
                    where: () => ({ get: mockWhereGet }),
                    get:   mockWhereGet
                }),
                get: jest.fn().mockResolvedValue({ forEach: () => {} }),
                add: jest.fn().mockResolvedValue({ id: "new-id" })
            })
        }
    };
});

jest.mock("nodemailer", () => ({
    createTransport: jest.fn().mockReturnValue({
        verify:   jest.fn((cb) => cb(null, true)),
        sendMail: jest.fn().mockResolvedValue({ messageId: "mock" })
    })
}));

const app = require("../../backend/app");

beforeEach(() => jest.clearAllMocks());

// =============================================================================
// US-03: Applicant applies to a listing
// =============================================================================
describe("US-03: Applicant applies to a listing", () => {

    test("✅ Valid applicant can apply to an existing listing", async () => {
        mockUserDocGet.mockResolvedValue({ exists: true, data: () => ({ role: "applicant" }) });
        mockListingDocGet.mockResolvedValue({ exists: true });
        mockAppDocGet.mockResolvedValue({ exists: false });

        const res = await request(app)
            .post("/applicant/apply")
            .send({ applicantID: "user_001", listingID: "listing_001", status: "pending" });

        expect(res.status).toBe(201);
        expect(res.body.message).toBe("Application submitted");
    });

    test("❌ Missing applicantID returns 400", async () => {
        const res = await request(app).post("/applicant/apply").send({ listingID: "listing_001" });
        expect(res.status).toBe(400);
    });

    test("❌ Missing listingID returns 400", async () => {
        const res = await request(app).post("/applicant/apply").send({ applicantID: "user_001" });
        expect(res.status).toBe(400);
    });

    test("❌ Missing both IDs returns 400", async () => {
        const res = await request(app).post("/applicant/apply").send({ status: "pending" });
        expect(res.status).toBe(400);
    });

    test("❌ Non-existent user returns 400", async () => {
        mockUserDocGet.mockResolvedValue({ exists: false });
        const res = await request(app)
            .post("/applicant/apply")
            .send({ applicantID: "ghost_user", listingID: "listing_001" });
        expect(res.status).toBe(400);
        expect(res.body.error).toBe("User not found");
    });

    test("❌ Non-existent listing returns 404", async () => {
        mockUserDocGet.mockResolvedValue({ exists: true, data: () => ({ role: "applicant" }) });
        mockListingDocGet.mockResolvedValue({ exists: false });
        const res = await request(app)
            .post("/applicant/apply")
            .send({ applicantID: "user_001", listingID: "ghost_listing" });
        expect(res.status).toBe(404);
        expect(res.body.error).toBe("Listing not found");
    });

    test("❌ Duplicate application returns 409", async () => {
        mockUserDocGet.mockResolvedValue({ exists: true, data: () => ({ role: "applicant" }) });
        mockListingDocGet.mockResolvedValue({ exists: true });
        mockAppDocGet.mockResolvedValue({ exists: true });
        const res = await request(app)
            .post("/applicant/apply")
            .send({ applicantID: "user_001", listingID: "listing_001" });
        expect(res.status).toBe(409);
        expect(res.body.error).toBe("You have already applied to this listing");
    });

    test("❌ Firestore write failure returns 500", async () => {
        mockUserDocGet.mockResolvedValue({ exists: true, data: () => ({ role: "applicant" }) });
        mockListingDocGet.mockResolvedValue({ exists: true });
        mockAppDocGet.mockResolvedValue({ exists: false });
        mockAppDocSet.mockRejectedValue(new Error("Firestore write failed"));
        const res = await request(app)
            .post("/applicant/apply")
            .send({ applicantID: "user_001", listingID: "listing_001" });
        expect(res.status).toBe(500);
        expect(res.body.error).toBe("Failed to submit application");
    });
});

// =============================================================================
// US-04: Role-based access control
// =============================================================================
describe("US-04: Role-based access control (access-logic)", () => {
    const { authorize } = require("../../backend/access-logic");

    test("✅ Applicant can access /api/listings",       () => expect(authorize({ role: "applicant" }, "/api/listings")).toBe(true));
    test("✅ Applicant can access /applicant-home",     () => expect(authorize({ role: "applicant" }, "/applicant-home")).toBe(true));
    test("✅ Provider can access /api/listings",        () => expect(authorize({ role: "provider"  }, "/api/listings")).toBe(true));
    test("✅ Provider can access /provider-home",       () => expect(authorize({ role: "provider"  }, "/provider-home")).toBe(true));
    test("✅ Admin can access /admin-dashboard",        () => expect(authorize({ role: "admin"     }, "/admin-dashboard")).toBe(true));
    test("✅ Admin can access /api/listings",           () => expect(authorize({ role: "admin"     }, "/api/listings")).toBe(true));
    test("❌ Applicant denied /create-opportunity",     () => expect(authorize({ role: "applicant" }, "/create-opportunity")).toBe(false));
    test("❌ Applicant denied /api/applicants",         () => expect(authorize({ role: "applicant" }, "/api/applicants")).toBe(false));
    test("❌ Applicant denied /provider-home",          () => expect(authorize({ role: "applicant" }, "/provider-home")).toBe(false));
    test("❌ Applicant denied /admin-dashboard",        () => expect(authorize({ role: "applicant" }, "/admin-dashboard")).toBe(false));
    test("❌ Provider denied /applicant-home",          () => expect(authorize({ role: "provider"  }, "/applicant-home")).toBe(false));
    test("❌ Provider denied /admin-dashboard",         () => expect(authorize({ role: "provider"  }, "/admin-dashboard")).toBe(false));
    test("❌ Admin denied /provider-home",              () => expect(authorize({ role: "admin"     }, "/provider-home")).toBe(false));
    test("❌ Admin denied /applicant-home",             () => expect(authorize({ role: "admin"     }, "/applicant-home")).toBe(false));
    test("❌ Unknown role denied",                      () => expect(authorize({ role: "unknown"   }, "/api/listings")).toBe(false));
    test("❌ Null user denied",                         () => expect(authorize(null, "/api/listings")).toBe(false));
    test("❌ Empty object denied",                      () => expect(authorize({}, "/api/listings")).toBe(false));
});

// =============================================================================
// hasApplied endpoint
// =============================================================================
describe("hasApplied endpoint", () => {

    test("✅ Returns hasApplied: false when no application exists", async () => {
        mockWhereGet.mockResolvedValue({ empty: true });
        const res = await request(app)
            .get("/applicant/hasApplied")
            .query({ applicantID: "user_001", listingID: "listing_001" });
        expect(res.status).toBe(200);
        expect(res.body.hasApplied).toBe(false);
    });

    test("✅ Returns hasApplied: true when application exists", async () => {
        mockWhereGet.mockResolvedValue({ empty: false });
        const res = await request(app)
            .get("/applicant/hasApplied")
            .query({ applicantID: "user_001", listingID: "listing_001" });
        expect(res.status).toBe(200);
        expect(res.body.hasApplied).toBe(true);
    });

    test("❌ Missing params returns 400", async () => {
        const res = await request(app).get("/applicant/hasApplied").query({ applicantID: "user_001" });
        expect(res.status).toBe(400);
    });
});

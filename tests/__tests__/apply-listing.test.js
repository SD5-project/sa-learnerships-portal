const request = require("supertest");

// ─── Mocks ────────────────────────────────────────────────────────────────────
let mockVerifyIdToken;
let mockUserDoc;
let mockListingDoc;
let mockAppDoc;
let mockSetApp;
let mockSetCustomClaims;
let mockDbSet;

jest.mock("../../backend/firebaseAdmin", () => {
    mockVerifyIdToken   = jest.fn();
    mockUserDoc         = jest.fn();
    mockListingDoc      = jest.fn();
    mockAppDoc          = jest.fn();
    mockSetApp          = jest.fn().mockResolvedValue();
    mockSetCustomClaims = jest.fn().mockResolvedValue();
    mockDbSet           = jest.fn().mockResolvedValue();

    return {
        admin: {
            auth: () => ({
                verifyIdToken:       mockVerifyIdToken,
                setCustomUserClaims: mockSetCustomClaims
            })
        },
        db: {
            collection: (name) => ({
                doc: (id) => ({
                    get: async () => {
                        if (name === "users")         return mockUserDoc();
                        if (name === "Opportunities") return mockListingDoc();
                        if (name === "applications")  return mockAppDoc();
                    },
                    set:    mockSetApp,
                    update: jest.fn().mockResolvedValue()
                }),
                where: jest.fn().mockReturnThis(),
                get:   jest.fn().mockResolvedValue({ forEach: () => {} }),
                add:   jest.fn().mockResolvedValue({ id: "new-id" })
            })
        }
    };
});

const app = require("../../backend/app");

beforeEach(() => jest.clearAllMocks());

// =============================================================================
// User Story 3: Applicant applies to a listing
// =============================================================================
describe("US-03: Applicant applies to a listing", () => {

    test("✅ Valid applicant can apply to an existing listing", async () => {
        mockUserDoc.mockResolvedValue({
            exists: true,
            data: () => ({ role: "applicant" })
        });
        mockListingDoc.mockResolvedValue({ exists: true });
        mockAppDoc.mockResolvedValue({ exists: false });

        const res = await request(app)
            .post("/applicant/apply")
            .send({ applicantID: "user_001", listingID: "listing_001", status: "pending" });

        expect(res.status).toBe(201);
        expect(res.body.message).toBe("Application submitted");
    });

    test("❌ Missing applicantID returns 400", async () => {
        const res = await request(app)
            .post("/applicant/apply")
            .send({ listingID: "listing_001" });
        expect(res.status).toBe(400);
    });

    test("❌ Missing listingID returns 400", async () => {
        const res = await request(app)
            .post("/applicant/apply")
            .send({ applicantID: "user_001" });
        expect(res.status).toBe(400);
    });

    test("❌ Missing both IDs returns 400", async () => {
        const res = await request(app)
            .post("/applicant/apply")
            .send({ status: "pending" });
        expect(res.status).toBe(400);
    });

    test("❌ Non-existent user returns 400", async () => {
        mockUserDoc.mockResolvedValue({ exists: false });

        const res = await request(app)
            .post("/applicant/apply")
            .send({ applicantID: "ghost_user", listingID: "listing_001" });

        expect(res.status).toBe(400);
        expect(res.body.error).toBe("User not found");
    });

    test("❌ Non-existent listing returns 404", async () => {
        mockUserDoc.mockResolvedValue({ exists: true, data: () => ({ role: "applicant" }) });
        mockListingDoc.mockResolvedValue({ exists: false });

        const res = await request(app)
            .post("/applicant/apply")
            .send({ applicantID: "user_001", listingID: "ghost_listing" });

        expect(res.status).toBe(404);
        expect(res.body.error).toBe("Listing not found");
    });

    test("❌ Duplicate application returns 409", async () => {
        mockUserDoc.mockResolvedValue({ exists: true, data: () => ({ role: "applicant" }) });
        mockListingDoc.mockResolvedValue({ exists: true });
        
        // The route checks the SPECIFIC doc for existence
        mockAppDoc.mockResolvedValue({ exists: true }); 

        const res = await request(app)
            .post("/applicant/apply")
            .send({ applicantID: "user_001", listingID: "listing_001" });

        expect(res.status).toBe(409);
        expect(res.body.error).toBe("You have already applied to this listing");
    });

    test("❌ Firestore write failure returns 500", async () => {
        mockUserDoc.mockResolvedValue({ exists: true, data: () => ({ role: "applicant" }) });
        mockListingDoc.mockResolvedValue({ exists: true });
        mockAppDoc.mockResolvedValue({ exists: false });
        mockSetApp.mockRejectedValue(new Error("Firestore write failed"));

        const res = await request(app)
            .post("/applicant/apply")
            .send({ applicantID: "user_001", listingID: "listing_001" });

        expect(res.status).toBe(500);
        expect(res.body.error).toBe("Failed to submit application");
    });
});

// =============================================================================
// User Story 4: Role-based access control (matches control-access.test.js spec)
// =============================================================================
describe("US-04: Role-based access control (access-logic)", () => {
    const { authorize } = require("../../backend/access-logic");

    // ── Granted ──────────────────────────────────────────────────────────────
    test("✅ Applicant can access /api/listings", () => {
        expect(authorize({ role: "applicant" }, "/api/listings")).toBe(true);
    });

    test("✅ Applicant can access /applicant-home", () => {
        expect(authorize({ role: "applicant" }, "/applicant-home")).toBe(true);
    });

    test("✅ Provider can access /api/listings", () => {
        expect(authorize({ role: "provider" }, "/api/listings")).toBe(true);
    });

    test("✅ Provider can access /provider-home", () => {
        expect(authorize({ role: "provider" }, "/provider-home")).toBe(true);
    });

    test("✅ Provider can access /create-opportunity", () => {
        expect(authorize({ role: "provider" }, "/create-opportunity")).toBe(true);
    });

    test("✅ Admin can access /admin-dashboard", () => {
        expect(authorize({ role: "admin" }, "/admin-dashboard")).toBe(true);
    });

    test("✅ Admin can access /api/listings", () => {
        expect(authorize({ role: "admin" }, "/api/listings")).toBe(true);
    });

    test("✅ Admin can access /create-opportunity", () => {
        expect(authorize({ role: "admin" }, "/create-opportunity")).toBe(true);
    });

    // ── Denied ───────────────────────────────────────────────────────────────
    test("❌ Applicant cannot access /create-opportunity", () => {
        expect(authorize({ role: "applicant" }, "/create-opportunity")).toBe(false);
    });

    test("❌ Applicant cannot access /api/applicants", () => {
        expect(authorize({ role: "applicant" }, "/api/applicants")).toBe(false);
    });

    test("❌ Applicant cannot access /provider-home", () => {
        expect(authorize({ role: "applicant" }, "/provider-home")).toBe(false);
    });

    test("❌ Applicant cannot access /admin-dashboard", () => {
        expect(authorize({ role: "applicant" }, "/admin-dashboard")).toBe(false);
    });

    test("❌ Provider cannot access /applicant-home", () => {
        expect(authorize({ role: "provider" }, "/applicant-home")).toBe(false);
    });

    test("❌ Provider cannot access /admin-dashboard", () => {
        expect(authorize({ role: "provider" }, "/admin-dashboard")).toBe(false);
    });

    test("❌ Admin cannot access /provider-home", () => {
        expect(authorize({ role: "admin" }, "/provider-home")).toBe(false);
    });

    test("❌ Admin cannot access /applicant-home", () => {
        expect(authorize({ role: "admin" }, "/applicant-home")).toBe(false);
    });

    test("❌ Unknown role is denied everywhere", () => {
        expect(authorize({ role: "unknown" }, "/api/listings")).toBe(false);
        expect(authorize({ role: "unknown" }, "/applicant-home")).toBe(false);
    });

    test("❌ Null user is denied", () => {
        expect(authorize(null, "/api/listings")).toBe(false);
    });

    test("❌ Empty object (no role) is denied", () => {
        expect(authorize({}, "/api/listings")).toBe(false);
    });
});

// =============================================================================
// Check application status endpoint
// =============================================================================
// ... (keep the rest of your file as is)

// =============================================================================
// Check application status endpoint
// =============================================================================
describe("hasApplied endpoint", () => {
    // Import the mocked db inside the describe block to ensure it's available
    const { db } = require("../../backend/firebaseAdmin");

    test("✅ Returns hasApplied: false when no application exists", async () => {
        // We need to force the 'where' chain to return empty: true
        const mockWhere = jest.spyOn(db, 'collection').mockReturnValue({
            where: jest.fn().mockReturnThis(),
            get: jest.fn().mockResolvedValue({ empty: true })
        });

        const res = await request(app)
            .get("/applicant/hasApplied")
            .query({ applicantID: "user_001", listingID: "listing_001" });

        expect(res.status).toBe(200);
        expect(res.body.hasApplied).toBe(false);
        
        mockWhere.mockRestore(); // Clean up
    });

    test("✅ Returns hasApplied: true when application exists", async () => {
        // We need to force the 'where' chain to return empty: false
        const mockWhere = jest.spyOn(db, 'collection').mockReturnValue({
            where: jest.fn().mockReturnThis(),
            get: jest.fn().mockResolvedValue({ empty: false })
        });

        const res = await request(app)
            .get("/applicant/hasApplied")
            .query({ applicantID: "user_001", listingID: "listing_001" });

        expect(res.status).toBe(200);
        expect(res.body.hasApplied).toBe(true);
        
        mockWhere.mockRestore(); // Clean up
    });
});
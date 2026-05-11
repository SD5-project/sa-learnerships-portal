const request = require("supertest");

// ─── Mocks ────────────────────────────────────────────────────────────────────
let mockVerifyIdToken;
let mockSetCustomClaims;
let mockUserDocGet;
let mockOpportunityDocGet;
let mockApplicationsWhereGet;

jest.mock("../../backend/firebaseAdmin", () => {
    mockVerifyIdToken   = jest.fn();
    mockSetCustomClaims = jest.fn().mockResolvedValue();
    mockUserDocGet      = jest.fn();
    mockOpportunityDocGet = jest.fn();
    mockApplicationsWhereGet = jest.fn();

    return {
        admin: {
            auth: () => ({
                verifyIdToken:       mockVerifyIdToken,
                setCustomUserClaims: mockSetCustomClaims,
            }),
        },
        db: {
            collection: (name) => ({
                doc: (_id) => ({
                    get: () => {
                        if (name === "users")         return mockUserDocGet();
                        if (name === "Opportunities") return mockOpportunityDocGet();
                    },
                    set:    jest.fn().mockResolvedValue(),
                    update: jest.fn().mockResolvedValue(),
                }),
                where: (_field, _op, _val) => ({
                    where: (_f, _o, _v) => ({
                        get: mockApplicationsWhereGet,
                    }),
                    get: mockApplicationsWhereGet,
                }),
                get:  jest.fn().mockResolvedValue({ forEach: () => {} }),
                add:  jest.fn().mockResolvedValue({ id: "new-id" }),
            }),
        },
    };
});

const app = require("../../backend/app");

beforeEach(() => jest.clearAllMocks());

// =============================================================================
// User Story: Applicant views their submitted applications
// =============================================================================
describe("GET /api/applications — applicant views their applications", () => {

    test("✅ Returns list of applications for a valid applicant", async () => {
        mockVerifyIdToken.mockResolvedValue({ uid: "user_001", role: "applicant" });

        mockApplicationsWhereGet.mockResolvedValue({
            forEach: (cb) => {
                cb({ id: "app_1", data: () => ({ applicantID: "user_001", listingID: "opp_1", status: "pending",   createdAt: "2026-04-01T10:00:00Z" }) });
                cb({ id: "app_2", data: () => ({ applicantID: "user_001", listingID: "opp_2", status: "accepted",  createdAt: "2026-04-05T10:00:00Z" }) });
                cb({ id: "app_3", data: () => ({ applicantID: "user_001", listingID: "opp_3", status: "rejected",  createdAt: "2026-04-10T10:00:00Z" }) });
            }
        });

        const res = await request(app)
            .get("/api/applications?applicantID=user_001")
            .set("Authorization", "Bearer valid-token");

        expect(res.status).toBe(200);
        expect(res.body.length).toBe(3);
        expect(res.body[0].listingID).toBe("opp_1");
        expect(res.body[1].status).toBe("accepted");
        expect(res.body[2].status).toBe("rejected");
    });

    test("✅ Returns empty array when applicant has no applications", async () => {
        mockVerifyIdToken.mockResolvedValue({ uid: "user_002", role: "applicant" });

        mockApplicationsWhereGet.mockResolvedValue({
            forEach: () => {}
        });

        const res = await request(app)
            .get("/api/applications?applicantID=user_002")
            .set("Authorization", "Bearer valid-token");

        expect(res.status).toBe(200);
        expect(res.body).toEqual([]);
    });

    test("❌ Unauthenticated request returns 401", async () => {
        const res = await request(app).get("/api/applications?applicantID=user_001");
        expect(res.status).toBe(401);
    });

    test("❌ Firestore failure returns 500", async () => {
        mockVerifyIdToken.mockResolvedValue({ uid: "user_001", role: "applicant" });
        mockApplicationsWhereGet.mockRejectedValue(new Error("Firestore error"));

        const res = await request(app)
            .get("/api/applications?applicantID=user_001")
            .set("Authorization", "Bearer valid-token");

        expect(res.status).toBe(500);
        expect(res.body.error).toBe("Failed to fetch applications");
    });
});

// =============================================================================
// GET /api/opportunities/:id — fetch opportunity details for a listing
// =============================================================================
describe("GET /api/opportunities/:id — fetch opportunity by ID", () => {

    test("✅ Returns opportunity data for a valid ID", async () => {
        mockVerifyIdToken.mockResolvedValue({ uid: "user_001", role: "applicant" });

        mockOpportunityDocGet.mockResolvedValue({
            exists: true,
            id: "opp_1",
            data: () => ({
                title:       "Software Internship",
                company:     "TechCorp",
                location:    "Johannesburg",
                type:        "internship",
                stipend:     5000,
                nqfLevel:    7,
                status:      "pending-review",
                createdAt:   "2026-03-01T10:00:00Z"
            })
        });

        const res = await request(app)
            .get("/api/opportunities/opp_1")
            .set("Authorization", "Bearer valid-token");

        expect(res.status).toBe(200);
        expect(res.body.title).toBe("Software Internship");
        expect(res.body.company).toBe("TechCorp");
        expect(res.body.location).toBe("Johannesburg");
    });

    test("❌ Non-existent opportunity returns 404", async () => {
        mockVerifyIdToken.mockResolvedValue({ uid: "user_001", role: "applicant" });

        mockOpportunityDocGet.mockResolvedValue({ exists: false });

        const res = await request(app)
            .get("/api/opportunities/ghost_opp")
            .set("Authorization", "Bearer valid-token");

        expect(res.status).toBe(404);
        expect(res.body.error).toBe("Opportunity not found");
    });

    test("❌ Unauthenticated request returns 401", async () => {
        const res = await request(app).get("/api/opportunities/opp_1");
        expect(res.status).toBe(401);
    });

    test("❌ Firestore failure returns 500", async () => {
        mockVerifyIdToken.mockResolvedValue({ uid: "user_001", role: "applicant" });
        mockOpportunityDocGet.mockRejectedValue(new Error("Firestore error"));

        const res = await request(app)
            .get("/api/opportunities/opp_1")
            .set("Authorization", "Bearer valid-token");

        expect(res.status).toBe(500);
        expect(res.body.error).toBe("Failed to fetch opportunity");
    });
});

// =============================================================================
// Integration: both endpoints together simulate the full page load flow
// =============================================================================
describe("Full flow: applications page load", () => {

    test("✅ Can fetch applications then look up each opportunity", async () => {
        mockVerifyIdToken.mockResolvedValue({ uid: "user_001", role: "applicant" });

        // Step 1 — applications list
        mockApplicationsWhereGet.mockResolvedValue({
            forEach: (cb) => {
                cb({ id: "app_1", data: () => ({ applicantID: "user_001", listingID: "opp_1", status: "pending", createdAt: "2026-04-01T10:00:00Z" }) });
            }
        });

        const appsRes = await request(app)
            .get("/api/applications?applicantID=user_001")
            .set("Authorization", "Bearer valid-token");

        expect(appsRes.status).toBe(200);
        expect(appsRes.body.length).toBe(1);

        const listingID = appsRes.body[0].listingID;
        expect(listingID).toBe("opp_1");

        // Step 2 — opportunity lookup using the listingID
        mockOpportunityDocGet.mockResolvedValue({
            exists: true,
            id: listingID,
            data: () => ({
                title:   "Software Internship",
                company: "TechCorp",
            })
        });

        const oppRes = await request(app)
            .get(`/api/opportunities/${listingID}`)
            .set("Authorization", "Bearer valid-token");

        expect(oppRes.status).toBe(200);
        expect(oppRes.body.title).toBe("Software Internship");
        expect(oppRes.body.company).toBe("TechCorp");
    });
});
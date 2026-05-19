const request = require("supertest");

let mockVerifyIdToken, mockOpportunityDocGet, mockApplicationsWhereGet;

jest.mock("../../backend/helpers", () => ({
    sendMail:  jest.fn().mockResolvedValue(),
    guard:     (route) => (req, res, next) => next(),
    adminOnly: (req, res, next) => next()
}));

jest.mock("../../backend/userPaths", () => ({
    applicantRef:  jest.fn(() => ({ set: jest.fn().mockResolvedValue(), get: jest.fn().mockResolvedValue({ exists: false }) })),
    providerRef:   jest.fn(() => ({ set: jest.fn().mockResolvedValue(), get: jest.fn().mockResolvedValue({ exists: false }) })),
    applicantsCol: jest.fn(),
    providersCol:  jest.fn(),
    lookupUser:    jest.fn().mockResolvedValue({ snap: null, ref: null, role: null })
}));

jest.mock("../../backend/firebaseAdmin", () => {
    mockVerifyIdToken        = jest.fn();
    mockOpportunityDocGet    = jest.fn();
    mockApplicationsWhereGet = jest.fn();

    return {
        admin: {
            auth: () => ({ verifyIdToken: mockVerifyIdToken, setCustomUserClaims: jest.fn().mockResolvedValue() }),
            firestore: { FieldValue: { serverTimestamp: () => "SERVER_TIMESTAMP" } }
        },
        db: {
            collection: (name) => ({
                doc: (_id) => ({
                    get: () => {
                        if (name === "Opportunities") return mockOpportunityDocGet();
                        return Promise.resolve({ exists: false });
                    },
                    set:    jest.fn().mockResolvedValue(),
                    update: jest.fn().mockResolvedValue()
                }),
                where: (_field, _op, _val) => ({
                    where: (_f, _o, _v) => ({ get: mockApplicationsWhereGet }),
                    get:   mockApplicationsWhereGet
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
// GET /api/applications
// =============================================================================
describe("GET /api/applications — applicant views their applications", () => {

    test("✅ Returns list of applications for a valid applicant", async () => {
        mockVerifyIdToken.mockResolvedValue({ uid: "user_001", role: "applicant" });
        mockApplicationsWhereGet.mockResolvedValue({
            forEach: (cb) => {
                cb({ id: "app_1", data: () => ({ applicantID: "user_001", listingID: "opp_1", status: "pending",  createdAt: "2026-04-01T10:00:00Z" }) });
                cb({ id: "app_2", data: () => ({ applicantID: "user_001", listingID: "opp_2", status: "accepted", createdAt: "2026-04-05T10:00:00Z" }) });
                cb({ id: "app_3", data: () => ({ applicantID: "user_001", listingID: "opp_3", status: "rejected", createdAt: "2026-04-10T10:00:00Z" }) });
            }
        });

        const res = await request(app)
            .get("/api/applications?applicantID=user_001")
            .set("Authorization", "Bearer valid-token");

        expect(res.status).toBe(200);
        expect(res.body.length).toBe(3);
        expect(res.body[0].listingID).toBe("opp_1");
        expect(res.body[1].status).toBe("accepted");
    });

    test("✅ Returns empty array when applicant has no applications", async () => {
        mockVerifyIdToken.mockResolvedValue({ uid: "user_002", role: "applicant" });
        mockApplicationsWhereGet.mockResolvedValue({ forEach: () => {} });
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
// GET /api/opportunities/:id
// =============================================================================
describe("GET /api/opportunities/:id", () => {

    test("✅ Returns opportunity data for a valid ID", async () => {
        mockVerifyIdToken.mockResolvedValue({ uid: "user_001", role: "applicant" });
        mockOpportunityDocGet.mockResolvedValue({
            exists: true, id: "opp_1",
            data: () => ({ title: "Software Internship", company: "TechCorp", location: "Johannesburg", type: "internship", stipend: 5000 })
        });

        const res = await request(app)
            .get("/api/opportunities/opp_1")
            .set("Authorization", "Bearer valid-token");

        expect(res.status).toBe(200);
        expect(res.body.title).toBe("Software Internship");
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

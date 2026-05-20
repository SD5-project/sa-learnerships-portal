const request = require("supertest");

// ─── Mocks ────────────────────────────────────────────────────────────────────
let mockGet;
let mockAdd;
let mockVerifyIdToken;
let mockSetCustomClaims;
let mockDocGet;
let mockSet;

jest.mock("../../backend/firebaseAdmin", () => {
    mockGet             = jest.fn();
    mockAdd             = jest.fn();
    mockVerifyIdToken   = jest.fn();
    mockSetCustomClaims = jest.fn().mockResolvedValue();
    mockDocGet          = jest.fn();
    mockSet             = jest.fn().mockResolvedValue();

    return {
        admin: {
            auth: () => ({
                verifyIdToken:       mockVerifyIdToken,
                setCustomUserClaims: mockSetCustomClaims
            })
        },
        db: {
            collection: (name) => ({
                get:   mockGet,
                add:   mockAdd,
                where: () => ({ get: mockGet }),
                orderBy: () => ({get: mockGet }),
                doc: () => ({
                    get:    mockDocGet,
                    set:    mockSet,
                    update: jest.fn().mockResolvedValue()
                })
            })
        }
    };
});

const app = require("../../backend/app");

beforeEach(() => jest.clearAllMocks());

// =============================================================================
// User Story 1: Provider submits a new opportunity
// =============================================================================
describe("US-01: Provider submits a new opportunity", () => {

    test("✅ Provider can submit a valid opportunity", async () => {
        mockVerifyIdToken.mockResolvedValue({ uid: "provider-uid", role: "provider" });
        mockAdd.mockResolvedValue({ id: "new-opp-id" });

        const res = await request(app)
            .post("/api/opportunities/submit")
            .set("Authorization", "Bearer valid-token")
            .send({
                title:       "Software Internship",
                description: "A great internship",
                company:     "TechCorp",
                location:    "Johannesburg",
                type:        "internship",
                stipend:     5000,
                nqfLevel:    7
            });

        expect(res.status).toBe(201);
        expect(res.body.message).toBe("Opportunity submitted successfully");
        expect(res.body.id).toBe("new-opp-id");
    });

    test("✅ Submitted opportunity gets status 'pending-review'", async () => {
        mockVerifyIdToken.mockResolvedValue({ uid: "provider-uid", role: "provider" });

        let savedData = {};
        mockAdd.mockImplementationOnce((data) => {
            savedData = data;
            return Promise.resolve({ id: "opp-123" });
        });

        await request(app)
            .post("/api/opportunities/submit")
            .set("Authorization", "Bearer valid-token")
            .send({ title: "Test Opp", company: "Corp" });

        expect(savedData.status).toBe("pending-review");
        expect(savedData.createdAt).toBeDefined();
    });

    test("❌ Unauthenticated user cannot submit opportunity — returns 401", async () => {
        const res = await request(app)
            .post("/api/opportunities/submit")
            .send({ title: "Hack attempt" });

        expect(res.status).toBe(401);
    });

    test("❌ Applicant cannot submit opportunity — returns 403", async () => {
        mockVerifyIdToken.mockResolvedValue({ uid: "applicant-uid", role: "applicant" });

        const res = await request(app)
            .post("/api/opportunities/submit")
            .set("Authorization", "Bearer valid-token")
            .send({ title: "Hack attempt" });

        expect(res.status).toBe(403);
    });

    test("❌ Firestore failure returns 500", async () => {
        mockVerifyIdToken.mockResolvedValue({ uid: "provider-uid", role: "provider" });
        mockAdd.mockRejectedValue(new Error("Firestore down"));

        const res = await request(app)
            .post("/api/opportunities/submit")
            .set("Authorization", "Bearer valid-token")
            .send({ title: "Test" });

        expect(res.status).toBe(500);
        expect(res.body.error).toBe("Failed to submit opportunity");
    });
});

// =============================================================================
// User Story 2: Applicant browses available listings
// =============================================================================
describe("US-02: Applicant browses listings", () => {

    test("✅ Applicant can fetch all listings", async () => {
        mockVerifyIdToken.mockResolvedValue({ uid: "applicant-uid", role: "applicant" });
        mockGet.mockResolvedValue({
            forEach: (cb) => {
                cb({ id: "opp1", data: () => ({ title: "Internship", description: "Great", stipend: 3000, location: "CT", company: "Corp", type: "internship" }) });
                cb({ id: "opp2", data: () => ({ title: "Learnership", description: "Good", stipend: 2000, location: "JHB", company: "Corp2", type: "learnership" }) });
            }
        });

        const res = await request(app)
            .get("/api/listings")
            .set("Authorization", "Bearer valid-token");

        expect(res.status).toBe(200);
        expect(res.body.length).toBe(2);
        expect(res.body[0].title).toBe("Internship");
    });

    test("✅ Provider can also fetch listings", async () => {
        mockVerifyIdToken.mockResolvedValue({ uid: "provider-uid", role: "provider" });
        mockGet.mockResolvedValue({ forEach: () => {} });

        const res = await request(app)
            .get("/api/listings")
            .set("Authorization", "Bearer valid-token");

        expect(res.status).toBe(200);
    });

    test("✅ Returns empty array when no listings exist", async () => {
        mockVerifyIdToken.mockResolvedValue({ uid: "applicant-uid", role: "applicant" });
        mockGet.mockResolvedValue({ forEach: () => {} });

        const res = await request(app)
            .get("/api/listings")
            .set("Authorization", "Bearer valid-token");

        expect(res.status).toBe(200);
        expect(res.body).toEqual([]);
    });

    test("❌ Unauthenticated user cannot browse listings — returns 401", async () => {
        const res = await request(app).get("/api/listings");
        expect(res.status).toBe(401);
    });

    test("❌ Firestore failure returns 500", async () => {
        mockVerifyIdToken.mockResolvedValue({ uid: "applicant-uid", role: "applicant" });
        mockGet.mockRejectedValue(new Error("Firestore error"));

        const res = await request(app)
            .get("/api/listings")
            .set("Authorization", "Bearer valid-token");

        expect(res.status).toBe(500);
    });
});

// =============================================================================
// User Story 5: Provider views applicants for their listings
// =============================================================================
describe("US-05: Provider views applicants", () => {

    test("✅ Returns empty array when provider has no listings", async () => {
        mockVerifyIdToken.mockResolvedValue({ uid: "provider-uid", role: "provider" });

        // First doc get = provider profile
        mockDocGet.mockResolvedValueOnce({
            exists: true,
            data: () => ({ organization: "TechCorp" })
        });

        // where().get() = empty opportunities
        mockGet.mockResolvedValueOnce({ forEach: () => {} });

        const res = await request(app)
            .get("/api/applicants")
            .set("Authorization", "Bearer valid-token");

        expect(res.status).toBe(200);
        expect(res.body).toEqual([]);
    });

    test("❌ Unauthenticated request returns 401", async () => {
        const res = await request(app).get("/api/applicants");
        expect(res.status).toBe(401);
    });
});

// =============================================================================
// NQF Levels endpoint
// =============================================================================
describe("NQF Levels", () => {

    beforeEach(() => {
    const fakeDocs = [
        { data: () => ({ level: 1, name: "Grade 9" }) },
        { data: () => ({ level: 2, name: "Grade 10" }) },
        { data: () => ({ level: 3, name: "Grade 11" }) },
        { data: () => ({ level: 4, name: "Matric" }) },
        { data: () => ({ level: 5, name: "Higher Certificate" }) },
        { data: () => ({ level: 6, name: "Diploma" }) },
        { data: () => ({ level: 7, name: "Bachelor Degree" }) },
        { data: () => ({ level: 8, name: "Honours" }) },
        { data: () => ({ level: 9, name: "Masters" }) },
        { data: () => ({ level: 10, name: "Doctorate" }) }
    ];

    mockGet.mockResolvedValue({
        forEach: (callback) => {
            fakeDocs.forEach(callback);
        }
    });
});

    test("✅ Returns 10 NQF levels", async () => {
        const res = await request(app).get("/nqf-levels");
        expect(res.status).toBe(200);
        expect(res.body.levels.length).toBe(10);
    });

    test("✅ NQF level 4 is Matric", async () => {
        const res = await request(app).get("/nqf-levels");
        const matric = res.body.levels.find(l => l.level === 4);
        expect(matric.name).toContain("Matric");
    });

    test("✅ NQF levels are in ascending order", async () => {
        const res = await request(app).get("/nqf-levels");
        const levels = res.body.levels.map(l => l.level);
        expect(levels).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    });
});
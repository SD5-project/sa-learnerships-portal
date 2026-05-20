const request = require("supertest");

let mockVerifyIdToken, mockApplicantSet, mockApplicantWhereGet, mockProviderWhereGet;

jest.mock("../../backend/helpers", () => ({
    sendMail:  jest.fn().mockResolvedValue(),
    guard:     (route) => (req, res, next) => next(),
    adminOnly: (req, res, next) => next()
}));

jest.mock("../../backend/firebaseAdmin", () => {
    mockVerifyIdToken = jest.fn();
    return {
        admin: {
            auth: () => ({
                verifyIdToken:       mockVerifyIdToken,
                setCustomUserClaims: jest.fn().mockResolvedValue(),
                getUserByEmail:      jest.fn().mockRejectedValue(Object.assign(new Error("Not found"), { code: "auth/user-not-found" }))
            })
        },
        db: {
            collection: () => ({
                doc: () => ({ get: jest.fn().mockResolvedValue({ exists: false }), set: jest.fn().mockResolvedValue() }),
                where: () => ({ limit: () => ({ get: jest.fn().mockResolvedValue({ empty: true }) }), get: jest.fn().mockResolvedValue({ forEach: () => {} }) }),
                get: jest.fn().mockResolvedValue({ forEach: () => {} })
            })
        }
    };
});

jest.mock("../../backend/userPaths", () => {
    mockApplicantSet      = jest.fn().mockResolvedValue();
    mockApplicantWhereGet = jest.fn().mockResolvedValue({ empty: true });
    mockProviderWhereGet  = jest.fn().mockResolvedValue({ empty: true });

    return {
        applicantRef:  jest.fn(() => ({ set: mockApplicantSet, get: jest.fn().mockResolvedValue({ exists: false }) })),
        providerRef:   jest.fn(() => ({ set: jest.fn().mockResolvedValue(), get: jest.fn().mockResolvedValue({ exists: false }) })),
        applicantsCol: jest.fn(() => ({ where: jest.fn(() => ({ limit: jest.fn(() => ({ get: mockApplicantWhereGet })) })) })),
        providersCol:  jest.fn(() => ({ where: jest.fn(() => ({ limit: jest.fn(() => ({ get: mockProviderWhereGet })) })) })),
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

const AUTH = { Authorization: "Bearer valid-token" };
const makeQuals = (n) => Array.from({ length: n }, (_, i) => ({
    institution: `Inst ${i + 1}`, name: `Qual ${i + 1}`, nqfLevel: "7", dateObtained: "2023-11", subjects: []
}));

beforeEach(() => {
    jest.clearAllMocks();
    mockVerifyIdToken.mockResolvedValue({ uid: "test-uid", role: "applicant" });
    mockApplicantSet.mockResolvedValue();
});

describe("PATCH /api/profile/qualifications — Authentication", () => {

    test("returns 401 when no Authorization header", async () => {
        const res = await request(app).patch("/api/profile/qualifications").send({ qualifications: [] });
        expect(res.status).toBe(401);
    });

    test("returns 401 when token is invalid", async () => {
        mockVerifyIdToken.mockRejectedValueOnce(new Error("Invalid token"));
        const res = await request(app)
            .patch("/api/profile/qualifications")
            .set(AUTH)
            .send({ qualifications: [] });
        expect(res.status).toBe(401);
    });
});

describe("PATCH /api/profile/qualifications — Equivalence Classes", () => {

    test("EC1 — rejects when qualifications is a string", async () => {
        const res = await request(app).patch("/api/profile/qualifications").set(AUTH).send({ qualifications: "not-an-array" });
        expect(res.status).toBe(400);
        expect(res.body.error).toBe("qualifications must be an array");
    });

    test("EC2 — rejects when qualifications is a number", async () => {
        const res = await request(app).patch("/api/profile/qualifications").set(AUTH).send({ qualifications: 5 });
        expect(res.status).toBe(400);
        expect(res.body.error).toBe("qualifications must be an array");
    });

    test("EC3 — rejects when qualifications is a plain object", async () => {
        const res = await request(app).patch("/api/profile/qualifications").set(AUTH).send({ qualifications: { institution: "UJ" } });
        expect(res.status).toBe(400);
        expect(res.body.error).toBe("qualifications must be an array");
    });

    test("EC4 — rejects when qualifications is missing", async () => {
        const res = await request(app).patch("/api/profile/qualifications").set(AUTH).send({});
        expect(res.status).toBe(400);
        expect(res.body.error).toBe("qualifications must be an array");
    });

    test("EC5 — accepts a valid array", async () => {
        const res = await request(app).patch("/api/profile/qualifications").set(AUTH).send({ qualifications: makeQuals(3) });
        expect(res.status).toBe(200);
        expect(res.body.message).toBe("Qualifications updated");
    });
});

describe("PATCH /api/profile/qualifications — Boundary Value Analysis (max 8)", () => {

    test("BVA1 — accepts 0 qualifications (empty array)", async () => {
        const res = await request(app).patch("/api/profile/qualifications").set(AUTH).send({ qualifications: [] });
        expect(res.status).toBe(200);
    });

    test("BVA2 — accepts 1 qualification", async () => {
        const res = await request(app).patch("/api/profile/qualifications").set(AUTH).send({ qualifications: makeQuals(1) });
        expect(res.status).toBe(200);
    });

    test("BVA3 — accepts 7 qualifications", async () => {
        const res = await request(app).patch("/api/profile/qualifications").set(AUTH).send({ qualifications: makeQuals(7) });
        expect(res.status).toBe(200);
    });

    test("BVA4 — accepts exactly 8 qualifications (upper bound)", async () => {
        const res = await request(app).patch("/api/profile/qualifications").set(AUTH).send({ qualifications: makeQuals(8) });
        expect(res.status).toBe(200);
        expect(res.body.message).toBe("Qualifications updated");
    });

    test("BVA5 — rejects 9 qualifications (just above upper bound)", async () => {
        const res = await request(app).patch("/api/profile/qualifications").set(AUTH).send({ qualifications: makeQuals(9) });
        expect(res.status).toBe(400);
        expect(res.body.error).toBe("A maximum of 8 qualifications is allowed");
    });

    test("BVA6 — rejects 100 qualifications", async () => {
        const res = await request(app).patch("/api/profile/qualifications").set(AUTH).send({ qualifications: makeQuals(100) });
        expect(res.status).toBe(400);
        expect(res.body.error).toBe("A maximum of 8 qualifications is allowed");
    });
});

describe("PATCH /api/profile/qualifications — Storage & Error Handling", () => {

    test("saves to applicant subcollection with merge:true", async () => {
        const quals = makeQuals(2);
        await request(app).patch("/api/profile/qualifications").set(AUTH).send({ qualifications: quals });
        expect(mockApplicantSet).toHaveBeenCalledWith(
            expect.objectContaining({ qualifications: quals }),
            { merge: true }
        );
    });

    test("returns 500 when Firestore write fails", async () => {
        mockApplicantSet.mockRejectedValueOnce(new Error("Firestore unavailable"));
        const res = await request(app).patch("/api/profile/qualifications").set(AUTH).send({ qualifications: makeQuals(1) });
        expect(res.status).toBe(500);
        expect(res.body.error).toBe("Failed to update qualifications");
    });

    test("does not call Firestore when input is invalid", async () => {
        await request(app).patch("/api/profile/qualifications").set(AUTH).send({ qualifications: "invalid" });
        expect(mockApplicantSet).not.toHaveBeenCalled();
    });

    test("does not call Firestore when over the 8-qualification limit", async () => {
        await request(app).patch("/api/profile/qualifications").set(AUTH).send({ qualifications: makeQuals(9) });
        expect(mockApplicantSet).not.toHaveBeenCalled();
    });
});

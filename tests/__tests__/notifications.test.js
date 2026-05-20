const request = require("supertest");

let mockVerifyIdToken,
    mockAppDocGet,
    mockAppDocUpdate,
    mockListingDocGet,
    mockNotificationsAdd;

jest.mock("../../backend/helpers", () => ({
    sendMail: jest.fn().mockResolvedValue(),

    guard: (route) => (req, res, next) => next(),

    adminOnly: (req, res, next) => next()
}));

jest.mock("../../backend/userPaths", () => ({
    applicantRef: jest.fn(() => ({
        set: jest.fn().mockResolvedValue(),
        get: jest.fn().mockResolvedValue({ exists: false })
    })),

    providerRef: jest.fn(() => ({
        set: jest.fn().mockResolvedValue(),
        get: jest.fn().mockResolvedValue({ exists: false })
    })),

    applicantsCol: jest.fn(),

    providersCol: jest.fn(),

    lookupUser: jest.fn().mockResolvedValue({
        snap: null,
        ref: null,
        role: null
    })
}));

jest.mock("../../backend/firebaseAdmin", () => {

    mockVerifyIdToken = jest.fn();

    mockAppDocGet = jest.fn();

    mockAppDocUpdate = jest.fn().mockResolvedValue();

    mockListingDocGet = jest.fn();

    mockNotificationsAdd = jest.fn().mockResolvedValue({
        id: "notif-id"
    });

    return {

        admin: {

            auth: () => ({
                verifyIdToken: mockVerifyIdToken
            }),

            firestore: {
                FieldValue: {
                    serverTimestamp: () => "SERVER_TIMESTAMP"
                }
            }
        },

        db: {

            collection: (name) => ({

                doc: (id) => ({

                    get: () => {

                        if (name === "applications") {
                            return mockAppDocGet();
                        }

                        if (name === "Opportunities") {
                            return mockListingDocGet();
                        }

                        return Promise.resolve({
                            exists: false
                        });
                    },

                    update: (data) => mockAppDocUpdate(data)
                }),

                add: (data) => mockNotificationsAdd(data),

                where: () => ({
                    get: jest.fn().mockResolvedValue({
                        forEach: () => {}
                    }),

                    where: () => ({
                        get: jest.fn().mockResolvedValue({
                            forEach: () => {}
                        })
                    })
                }),

                get: jest.fn().mockResolvedValue({
                    forEach: () => {}
                })
            })
        }
    };
});

jest.mock("nodemailer", () => ({
    createTransport: jest.fn().mockReturnValue({

        verify: jest.fn((cb) => cb(null, true)),

        sendMail: jest.fn().mockResolvedValue({
            messageId: "mock"
        })
    })
}));

const app = require("../../backend/app");

beforeEach(() => {

    jest.resetAllMocks();

    mockVerifyIdToken.mockResolvedValue({
        uid: "provider-uid",
        role: "provider"
    });

    mockAppDocUpdate.mockResolvedValue();

    mockNotificationsAdd.mockResolvedValue({
        id: "notif-id"
    });
});

describe("PATCH /api/applicants/:applicationID/status", () => {

    test("returns 400 for invalid status", async () => {

        const res = await request(app)

            .patch("/api/applicants/app789/status")

            .set("Authorization", "Bearer mock-token")

            .send({
                status: "invalid-status-name"
            });

        expect(res.status).toBe(400);

        expect(res.body.error).toBe("Invalid status");
    });

    test("returns 401 when unauthenticated", async () => {

        const res = await request(app)

            .patch("/api/applicants/app789/status")

            .send({
                status: "shortlisted"
            });

        expect(res.status).toBe(401);
    });

    test("returns 403 when applicant tries to update status", async () => {

        mockVerifyIdToken.mockResolvedValue({
            uid: "applicant-uid",
            role: "applicant"
        });

        const res = await request(app)

            .patch("/api/applicants/app789/status")

            .set("Authorization", "Bearer mock-token")

            .send({
                status: "shortlisted"
            });

        expect(res.status).toBe(403);
    });

    test("updates status successfully for provider on own listing", async () => {

        mockVerifyIdToken.mockResolvedValue({
            uid: "provider-uid",
            role: "provider"
        });

        mockAppDocGet.mockResolvedValue({

            exists: true,

            data: () => ({
                listingID: "list123",
                applicantID: "user456",
                status: "shortlisted"
            })
        });

        mockListingDocGet.mockResolvedValue({

            exists: true,

            data: () => ({
                title: "Dev Role",
                providerID: "provider-uid"
            })
        });

        const res = await request(app)

            .patch("/api/applicants/app789/status")

            .set("Authorization", "Bearer mock-token")

            .send({
                status: "accepted"
            });

        expect(res.status).toBe(200);

        expect(res.body.message).toContain("Status updated");
    });

    test("returns 404 when application does not exist", async () => {

        mockAppDocGet.mockResolvedValue({
            exists: false
        });

        const res = await request(app)

            .patch("/api/applicants/ghost-app/status")

            .set("Authorization", "Bearer mock-token")

            .send({
                status: "shortlisted"
            });

        expect(res.status).toBe(404);

        expect(res.body.error).toBe("Application not found");
    });

    test("returns 400 when accepting without prior shortlist", async () => {

        mockAppDocGet.mockResolvedValue({

            exists: true,

            data: () => ({
                listingID: "list123",
                applicantID: "user456",
                status: "pending"
            })
        });

        mockListingDocGet.mockResolvedValue({

            exists: true,

            data: () => ({
                title: "Dev Role",
                providerID: "provider-uid"
            })
        });

        const res = await request(app)

            .patch("/api/applicants/app789/status")

            .set("Authorization", "Bearer mock-token")

            .send({
                status: "accepted"
            });

        expect(res.status).toBe(400);

        expect(res.body.error)
            .toBe("Applicant must be shortlisted before accepting");
    });
});
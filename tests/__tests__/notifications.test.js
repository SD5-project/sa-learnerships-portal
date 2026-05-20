const request = require('supertest');
// MOCK NODEMAILER BEFORE IMPORTING APP
jest.mock("nodemailer", () => ({
    createTransport: jest.fn(() => ({
        verify: jest.fn((cb) => cb(null, true)),
        sendMail: jest.fn().mockResolvedValue(true)
    }))
}));

// MOCK FIREBASE ADMIN
jest.mock("../../backend/firebaseAdmin", () => {

    const getMock = jest.fn();
    const updateMock = jest.fn();

    return {
        admin: {
            auth: () => ({
                verifyIdToken: jest.fn().mockResolvedValue({
                    uid: "admin_001",
                    role: "admin"
                })
            }),
            firestore: {
                FieldValue: {
                    serverTimestamp: jest.fn(() => "mock-timestamp")
                }
            }
        },

        db: {
            collection: jest.fn(() => ({
                doc: jest.fn(() => ({
                    get: getMock,
                    update: updateMock
                }))
            }))
        },

        __mocks__: {
            getMock,
            updateMock
        }
    };
});

const app = require("../../backend/app");

const firebaseAdmin = require("../../backend/firebaseAdmin");

const getMock = firebaseAdmin.__mocks__.getMock;
const updateMock = firebaseAdmin.__mocks__.updateMock;

// Mocking dependencies
jest.mock('../../backend/firebaseAdmin');
jest.mock('nodemailer');

describe("PATCH /api/applicants/:applicationID/status", () => {

    beforeEach(() => {
        jest.clearAllMocks();
    });

    test("should update status successfully and send email", async () => {

        getMock.mockResolvedValue({
            exists: true,
            data: () => ({
                listingID: "list123",
                applicantID: "user456"
            })
        });

        updateMock.mockResolvedValue(true);

        const response = await request(app)
            .patch("/api/applicants/app789/status")
            .set("Authorization", "Bearer valid-token")
            .send({ status: "shortlisted" });

        expect(response.status).toBe(200);
    });

    test("should return 400 for invalid status", async () => {

        getMock.mockResolvedValue({
            exists: true,
            data: () => ({
                listingID: "list123",
                applicantID: "user456"
            })
        });

        const response = await request(app)
            .patch("/api/applicants/app789/status")
            .set("Authorization", "Bearer valid-token")
            .send({ status: "invalid-status-name" });

        expect(response.status).toBe(400);
    });
});
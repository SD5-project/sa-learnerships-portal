jest.mock("nodemailer", () => ({
    createTransport: jest.fn(() => ({
        verify: jest.fn((cb) => cb(null, true)),
        sendMail: jest.fn().mockResolvedValue(true)
    }))
}));

jest.mock("./backend/firebaseAdmin", () => {

    const mockSet = jest.fn();
    const mockGet = jest.fn();
    const mockAdd = jest.fn();
    const mockUpdate = jest.fn();

    const db = {
        collection: jest.fn(() => ({
            doc: jest.fn(() => ({
                get: mockGet,
                set: mockSet,
                update: mockUpdate
            })),
            add: mockAdd,
            where: jest.fn(() => ({
                get: mockGet,
                where: jest.fn(() => ({
                    get: mockGet
                }))
            })),
            orderBy: jest.fn(() => ({
                get: mockGet
            })),
            get: mockGet
        }))
    };

    const admin = {
        auth: jest.fn(() => ({
            setCustomUserClaims: jest.fn(),
            verifyIdToken: jest.fn()
        })),
        firestore: {
            FieldValue: {
                serverTimestamp: jest.fn(() => "mock-timestamp")
            }
        }
    };

    return {
        admin,
        db
    };
});

jest.spyOn(console, "log").mockImplementation(() => {});
jest.spyOn(console, "error").mockImplementation(() => {});
jest.spyOn(console, "warn").mockImplementation(() => {});
/**
 * helpers.test.js
 * Direct unit tests for backend/helpers.js
 * Covers: sendMail, guard middleware, adminOnly middleware
 * These are tested WITHOUT going through app.js so we get real coverage
 * on the helpers.js lines themselves.
 */

// Mock nodemailer BEFORE requiring helpers
let mockSendMail;
jest.mock("nodemailer", () => ({
    createTransport: jest.fn().mockReturnValue({
        verify:   jest.fn((cb) => cb(null, true)),
        sendMail: jest.fn((...args) => mockSendMail(...args))
    })
}));

// Mock access-logic so helpers.js guard() has a predictable authorize()
jest.mock("../../backend/access-logic", () => ({
    authorize: jest.fn((user, route) => {
        if (!user || !user.role) return false;
        if (user.role === "provider" && route === "/create-opportunity") return true;
        if (user.role === "admin")    return true;
        return false;
    })
}));

beforeAll(() => {
    mockSendMail = jest.fn().mockResolvedValue({ messageId: "test-id" });
    // Set env vars so transporter doesn't try real SMTP
    process.env.EMAIL_USER = "test@test.com";
    process.env.EMAIL_PASS = "testpass";
    process.env.EMAIL_HOST = "localhost";
});

const { sendMail, guard, adminOnly } = require("../../backend/helpers");

describe("sendMail()", () => {

    test("✅ Sends email when 'to' is provided", async () => {
        await sendMail("recipient@test.com", "Subject", "<p>Body</p>");
        expect(mockSendMail).toHaveBeenCalledWith(expect.objectContaining({
            to:      "recipient@test.com",
            subject: "Subject",
            html:    "<p>Body</p>"
        }));
    });

    test("✅ Returns early without sending when 'to' is empty", async () => {
        mockSendMail.mockClear();
        await sendMail("", "Subject", "<p>Body</p>");
        expect(mockSendMail).not.toHaveBeenCalled();
    });

    test("✅ Returns early without sending when 'to' is null", async () => {
        mockSendMail.mockClear();
        await sendMail(null, "Subject", "<p>Body</p>");
        expect(mockSendMail).not.toHaveBeenCalled();
    });

    test("✅ Does not throw when email transport fails", async () => {
        mockSendMail.mockRejectedValueOnce(new Error("SMTP error"));
        await expect(sendMail("r@test.com", "Sub", "<p>body</p>")).resolves.not.toThrow();
    });
});

describe("guard() middleware", () => {

    const makeReq  = (user) => ({ user });
    const makeRes  = () => {
        const res = {};
        res.status = jest.fn().mockReturnValue(res);
        res.json   = jest.fn().mockReturnValue(res);
        return res;
    };
    const next = jest.fn();

    beforeEach(() => next.mockClear());

    test("✅ Calls next() when provider has access to route", () => {
        const middleware = guard("/create-opportunity");
        const req = makeReq({ role: "provider" });
        const res = makeRes();
        middleware(req, res, next);
        expect(next).toHaveBeenCalled();
        expect(res.status).not.toHaveBeenCalled();
    });

    test("✅ Calls next() when admin has access to any route", () => {
        const middleware = guard("/any-route");
        const req = makeReq({ role: "admin" });
        const res = makeRes();
        middleware(req, res, next);
        expect(next).toHaveBeenCalled();
    });

    test("❌ Returns 403 when user is null", () => {
        const middleware = guard("/create-opportunity");
        const req = makeReq(null);
        const res = makeRes();
        middleware(req, res, next);
        expect(res.status).toHaveBeenCalledWith(403);
        expect(next).not.toHaveBeenCalled();
    });

    test("❌ Returns 403 when applicant tries to access restricted route", () => {
        const middleware = guard("/create-opportunity");
        const req = makeReq({ role: "applicant" });
        const res = makeRes();
        middleware(req, res, next);
        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.json).toHaveBeenCalledWith({ error: "Forbidden: You do not have access to this route." });
    });

    test("❌ Returns 403 when req.user is undefined", () => {
        const middleware = guard("/create-opportunity");
        const req = {};  // no user property
        const res = makeRes();
        middleware(req, res, next);
        expect(res.status).toHaveBeenCalledWith(403);
    });
});

describe("adminOnly() middleware", () => {

    const makeReq = (user) => ({ user });
    const makeRes = () => {
        const res = {};
        res.status = jest.fn().mockReturnValue(res);
        res.json   = jest.fn().mockReturnValue(res);
        return res;
    };
    const next = jest.fn();

    beforeEach(() => next.mockClear());

    test("✅ Calls next() when user is admin", () => {
        adminOnly(makeReq({ role: "admin" }), makeRes(), next);
        expect(next).toHaveBeenCalled();
    });

    test("❌ Returns 403 when user is provider", () => {
        const res = makeRes();
        adminOnly(makeReq({ role: "provider" }), res, next);
        expect(res.status).toHaveBeenCalledWith(403);
        expect(next).not.toHaveBeenCalled();
    });

    test("❌ Returns 403 when user is applicant", () => {
        const res = makeRes();
        adminOnly(makeReq({ role: "applicant" }), res, next);
        expect(res.status).toHaveBeenCalledWith(403);
    });

    test("❌ Returns 403 when req.user is null", () => {
        const res = makeRes();
        adminOnly(makeReq(null), res, next);
        expect(res.status).toHaveBeenCalledWith(403);
    });

    test("❌ Returns 403 when req.user is undefined", () => {
        const res = makeRes();
        adminOnly({}, res, next);
        expect(res.status).toHaveBeenCalledWith(403);
    });

    test("✅ Response includes correct error message", () => {
        const res = makeRes();
        adminOnly(makeReq({ role: "applicant" }), res, next);
        expect(res.json).toHaveBeenCalledWith({ error: "Forbidden: Admins only." });
    });
});



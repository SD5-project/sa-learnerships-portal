// tests/__tests__/access-logic.coverage.test.js
// ─────────────────────────────────────────────
// This file exists purely to generate real coverage data for access-logic.js.
// It has NO mocks — it runs the actual code directly.

const { authorize } = require("../../backend/access-logic");

describe("access-logic coverage — authorize()", () => {

    // ── Null / missing user ───────────────────────────────────────────────────
    test("null user returns false", () => {
        expect(authorize(null, "/api/listings")).toBe(false);
    });

    test("undefined user returns false", () => {
        expect(authorize(undefined, "/api/listings")).toBe(false);
    });

    test("empty object (no role) returns false", () => {
        expect(authorize({}, "/api/listings")).toBe(false);
    });

    test("unknown role returns false", () => {
        expect(authorize({ role: "hacker" }, "/api/listings")).toBe(false);
    });

    // ── Applicant ─────────────────────────────────────────────────────────────
    test("applicant can access /api/listings", () => {
        expect(authorize({ role: "applicant" }, "/api/listings")).toBe(true);
    });

    test("applicant can access /applicant-home", () => {
        expect(authorize({ role: "applicant" }, "/applicant-home")).toBe(true);
    });

    test("applicant cannot access /admin-dashboard", () => {
        expect(authorize({ role: "applicant" }, "/admin-dashboard")).toBe(false);
    });

    test("applicant cannot access /provider-home", () => {
        expect(authorize({ role: "applicant" }, "/provider-home")).toBe(false);
    });

    test("applicant cannot access /create-opportunity", () => {
        expect(authorize({ role: "applicant" }, "/create-opportunity")).toBe(false);
    });

    test("applicant cannot access /api/applicants", () => {
        expect(authorize({ role: "applicant" }, "/api/applicants")).toBe(false);
    });

    // ── Provider ──────────────────────────────────────────────────────────────
    test("provider can access /api/listings", () => {
        expect(authorize({ role: "provider" }, "/api/listings")).toBe(true);
    });

    test("provider can access /provider-home", () => {
        expect(authorize({ role: "provider" }, "/provider-home")).toBe(true);
    });

    test("provider can access /create-opportunity", () => {
        expect(authorize({ role: "provider" }, "/create-opportunity")).toBe(true);
    });

    test("provider can access /api/applicants", () => {
        expect(authorize({ role: "provider" }, "/api/applicants")).toBe(true);
    });

    test("provider cannot access /admin-dashboard", () => {
        expect(authorize({ role: "provider" }, "/admin-dashboard")).toBe(false);
    });

    test("provider cannot access /applicant-home", () => {
        expect(authorize({ role: "provider" }, "/applicant-home")).toBe(false);
    });

    // ── Admin ─────────────────────────────────────────────────────────────────
    test("admin can access /admin-dashboard", () => {
        expect(authorize({ role: "admin" }, "/admin-dashboard")).toBe(true);
    });

    test("admin can access /api/listings", () => {
        expect(authorize({ role: "admin" }, "/api/listings")).toBe(true);
    });

    test("admin can access /create-opportunity", () => {
        expect(authorize({ role: "admin" }, "/create-opportunity")).toBe(true);
    });

    test("admin can access /api/admin/listings", () => {
        expect(authorize({ role: "admin" }, "/api/admin/listings")).toBe(true);
    });

    test("admin can access /api/admin/users", () => {
        expect(authorize({ role: "admin" }, "/api/admin/users")).toBe(true);
    });

    test("admin cannot access /applicant-home", () => {
        expect(authorize({ role: "admin" }, "/applicant-home")).toBe(false);
    });

    test("admin cannot access /provider-home", () => {
        expect(authorize({ role: "admin" }, "/provider-home")).toBe(false);
    });

    // ── Case insensitivity ────────────────────────────────────────────────────
    test("role is case-insensitive — APPLICANT works", () => {
        expect(authorize({ role: "APPLICANT" }, "/api/listings")).toBe(true);
    });

    test("role is case-insensitive — Admin works", () => {
        expect(authorize({ role: "Admin" }, "/admin-dashboard")).toBe(true);
    });
});
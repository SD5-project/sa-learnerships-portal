/**
 * admin.test.js
 * Tests for routes/admin.js mounted at /api/admin
 * Covers: US-07 listing moderation + US-08 user management
 *
 * Key route changes vs old app.js inline routes:
 *   - status "in_for_review"   (was "pending-review")
 *   - status "review_accepted" (was "approved")
 *   - status "rejected_review" (was "removed")
 *   - suspend/reactivate/delete now use lookupUser (subcollections) not flat users/
 */
const request = require("supertest");

// ─── Helpers mock (must come before app require) ──────────────────────────────
jest.mock("../../backend/helpers", () => ({
    sendMail:  jest.fn().mockResolvedValue(),
    guard:     (route) => (req, res, next) => {
        if (req.user && ["provider","admin"].includes(req.user.role)) return next();
        res.status(403).json({ error: "Forbidden" });
    },
    adminOnly: (req, res, next) => {
        if (req.user && req.user.role === "admin") return next();
        res.status(403).json({ error: "Forbidden: Admins only." });
    }
}));

jest.mock("nodemailer", () => ({
    createTransport: jest.fn().mockReturnValue({
        verify:   jest.fn((cb) => cb(null, true)),
        sendMail: jest.fn().mockResolvedValue({ messageId: "mock" })
    })
}));

jest.mock("cloudinary", () => ({ v2: { config: jest.fn() } }), { virtual: true });
jest.mock("multer-storage-cloudinary", () => ({ CloudinaryStorage: jest.fn(() => ({})) }), { virtual: true });
jest.mock("multer", () => jest.fn(() => ({ single: () => (req, res, next) => next() })), { virtual: true });

// ─── Firebase mock ────────────────────────────────────────────────────────────
let mockVerifyIdToken, mockSetCustomClaims, mockUpdateUser, mockDeleteUser;
let mockDocGet, mockDocUpdate, mockDocDelete, mockDocSet;
let mockCollectionGet, mockCollectionAdd, mockWhereGet;

jest.mock("../../backend/firebaseAdmin", () => {
    mockVerifyIdToken   = jest.fn();
    mockSetCustomClaims = jest.fn().mockResolvedValue();
    mockUpdateUser      = jest.fn().mockResolvedValue();
    mockDeleteUser      = jest.fn().mockResolvedValue();
    mockDocGet          = jest.fn();
    mockDocUpdate       = jest.fn().mockResolvedValue();
    mockDocDelete       = jest.fn().mockResolvedValue();
    mockDocSet          = jest.fn().mockResolvedValue();
    mockCollectionGet   = jest.fn();
    mockCollectionAdd   = jest.fn().mockResolvedValue({ id: "notif-id" });
    mockWhereGet        = jest.fn();

    const makeCollection = (name) => ({
        get:   () => mockCollectionGet(name),
        add:   (data) => mockCollectionAdd(name, data),
        where: (field, op, val) => ({
            get:   () => mockWhereGet(name, field, op, val),
            where: (f2, o2, v2) => ({ get: () => mockWhereGet(name, `${field}+${f2}`, op, val) })
        }),
        orderBy: () => ({ get: () => mockCollectionGet(name) }),
        doc: (id) => ({
            get:    () => mockDocGet(name, id),
            update: (data) => mockDocUpdate(name, id, data),
            delete: () => mockDocDelete(name, id),
            set:    (data, opts) => mockDocSet(name, id, data, opts)
        }),
        limit: () => ({ get: () => mockCollectionGet(name) })
    });

    return {
        admin: {
            auth: () => ({
                verifyIdToken:       mockVerifyIdToken,
                setCustomUserClaims: mockSetCustomClaims,
                updateUser:          mockUpdateUser,
                deleteUser:          mockDeleteUser,
                getUserByEmail:      jest.fn().mockRejectedValue(Object.assign(new Error("Not found"), { code: "auth/user-not-found" }))
            }),
            firestore: { FieldValue: { serverTimestamp: () => "SERVER_TIMESTAMP" } }
        },
        db: { collection: makeCollection }
    };
});

// ─── userPaths mock ───────────────────────────────────────────────────────────
let mockProviderDocGet, mockLookupUser;

jest.mock("../../backend/userPaths", () => {
    mockProviderDocGet = jest.fn();
    mockLookupUser     = jest.fn();
    return {
        applicantsCol: jest.fn(() => ({
            get:   () => mockCollectionGet("applicants"),
            where: jest.fn(() => ({ get: () => mockWhereGet("applicants", "role") }))
        })),
        providersCol: jest.fn(() => ({
            get:   () => mockCollectionGet("providers"),
            where: jest.fn(() => ({ get: () => mockWhereGet("providers", "role") }))
        })),
        adminsCol:    jest.fn(() => ({ get: () => mockCollectionGet("admins") })),
        applicantRef: jest.fn(() => ({ get: jest.fn().mockResolvedValue({ exists: false }), set: jest.fn().mockResolvedValue(), update: jest.fn().mockResolvedValue() })),
        providerRef:  jest.fn(() => ({ get: mockProviderDocGet, set: jest.fn().mockResolvedValue() })),
        adminRef:     jest.fn(() => ({ get: jest.fn().mockResolvedValue({ exists: false }), set: jest.fn().mockResolvedValue() })),
        lookupUser:   (...args) => mockLookupUser(...args)
    };
});

const app = require("../../backend/app");

// ─── Token helpers ────────────────────────────────────────────────────────────
const adminToken     = () => { mockVerifyIdToken.mockResolvedValue({ uid: "admin-uid",     role: "admin"     }); return "Bearer admin-tok"; };
const providerToken  = () => { mockVerifyIdToken.mockResolvedValue({ uid: "provider-uid",  role: "provider"  }); return "Bearer prov-tok";  };
const applicantToken = () => { mockVerifyIdToken.mockResolvedValue({ uid: "applicant-uid", role: "applicant" }); return "Bearer appl-tok";  };

beforeEach(() => {
    jest.resetAllMocks();
    mockCollectionAdd.mockResolvedValue({ id: "notif-id" });
    mockDocUpdate.mockResolvedValue();
    mockDocDelete.mockResolvedValue();
    mockDocSet.mockResolvedValue();
    mockUpdateUser.mockResolvedValue();
    mockDeleteUser.mockResolvedValue();
    mockProviderDocGet.mockResolvedValue({ exists: false, data: () => ({}) });
    mockLookupUser.mockResolvedValue({ snap: null, ref: null, role: null });
});

// =============================================================================
// US-07 — GET /api/admin/listings/pending
// NOTE: routes/admin.js uses status "in_for_review" (not "pending-review")
// =============================================================================
describe("US-07: GET /api/admin/listings/pending", () => {

    test("✅ Admin can fetch pending listings (in_for_review)", async () => {
        mockWhereGet.mockResolvedValue({
            forEach: (cb) => {
                cb({ id: "l1", data: () => ({ title: "Internship", company: "Corp",   type: "internship",  location: "JHB", stipend: 3000, providerID: "p1", createdAt: "2024-01-01", status: "in_for_review" }) });
                cb({ id: "l2", data: () => ({ title: "Learnership", company: "SA Inc", type: "learnership", location: "CT",  stipend: 2000, providerID: "p2", createdAt: "2024-01-02", status: "in_for_review" }) });
            }
        });

        const res = await request(app).get("/api/admin/listings/pending").set("Authorization", adminToken());
        expect(res.status).toBe(200);
        expect(res.body.length).toBe(2);
        expect(res.body[0].title).toBe("Internship");
    });

    test("✅ Returns empty array when no pending listings", async () => {
        mockWhereGet.mockResolvedValue({ forEach: () => {} });
        const res = await request(app).get("/api/admin/listings/pending").set("Authorization", adminToken());
        expect(res.status).toBe(200);
        expect(res.body).toEqual([]);
    });

    test("✅ Response includes all expected fields", async () => {
        mockWhereGet.mockResolvedValue({
            forEach: (cb) => cb({ id: "l1", data: () => ({ title: "T", company: "C", type: "internship", location: "JHB", stipend: 5000, providerID: "p1", createdAt: "2024-01-01", status: "in_for_review" }) })
        });
        const res = await request(app).get("/api/admin/listings/pending").set("Authorization", adminToken());
        expect(res.body[0]).toHaveProperty("id");
        expect(res.body[0]).toHaveProperty("title");
        expect(res.body[0]).toHaveProperty("company");
        expect(res.body[0]).toHaveProperty("status");
        expect(res.body[0]).toHaveProperty("providerID");
    });

    test("❌ Provider cannot access — 403", async () => {
        const res = await request(app).get("/api/admin/listings/pending").set("Authorization", providerToken());
        expect(res.status).toBe(403);
    });

    test("❌ Applicant cannot access — 403", async () => {
        const res = await request(app).get("/api/admin/listings/pending").set("Authorization", applicantToken());
        expect(res.status).toBe(403);
    });

    test("❌ Unauthenticated returns 401", async () => {
        const res = await request(app).get("/api/admin/listings/pending");
        expect(res.status).toBe(401);
    });

    test("❌ Firestore failure returns 500", async () => {
        mockWhereGet.mockRejectedValue(new Error("DB error"));
        const res = await request(app).get("/api/admin/listings/pending").set("Authorization", adminToken());
        expect(res.status).toBe(500);
        expect(res.body.error).toBe("Failed to fetch pending listings");
    });
});

// =============================================================================
// US-07 — GET /api/admin/listings
// =============================================================================
describe("US-07: GET /api/admin/listings", () => {

    test("✅ Admin can fetch all listings regardless of status", async () => {
        mockCollectionGet.mockResolvedValue({
            forEach: (cb) => {
                cb({ id: "l1", data: () => ({ title: "A", company: "Corp", type: "internship",  location: "JHB", stipend: 3000, providerID: "p1", createdAt: "2024-01-01", status: "auto_approved"  }) });
                cb({ id: "l2", data: () => ({ title: "B", company: "SA",   type: "learnership", location: "CT",  stipend: 2000, providerID: "p2", createdAt: "2024-01-02", status: "in_for_review"  }) });
                cb({ id: "l3", data: () => ({ title: "C", company: "Inc",  type: "internship",  location: "PE",  stipend: 1000, providerID: "p3", createdAt: "2024-01-03", status: "rejected_review" }) });
            }
        });

        const res = await request(app).get("/api/admin/listings").set("Authorization", adminToken());
        expect(res.status).toBe(200);
        expect(res.body.length).toBe(3);
    });

    test("✅ Returns empty array when no listings", async () => {
        mockCollectionGet.mockResolvedValue({ forEach: () => {} });
        const res = await request(app).get("/api/admin/listings").set("Authorization", adminToken());
        expect(res.status).toBe(200);
        expect(res.body).toEqual([]);
    });

    test("✅ Defaults missing fields correctly", async () => {
        mockCollectionGet.mockResolvedValue({
            forEach: (cb) => cb({ id: "l1", data: () => ({}) })
        });
        const res = await request(app).get("/api/admin/listings").set("Authorization", adminToken());
        expect(res.body[0].title).toBe("Untitled");
        expect(res.body[0].company).toBe("Unknown");
        expect(res.body[0].status).toBe("unknown");
    });

    test("❌ Provider cannot access — 403", async () => {
        const res = await request(app).get("/api/admin/listings").set("Authorization", providerToken());
        expect(res.status).toBe(403);
    });

    test("❌ Unauthenticated returns 401", async () => {
        const res = await request(app).get("/api/admin/listings");
        expect(res.status).toBe(401);
    });

    test("❌ Firestore failure returns 500", async () => {
        mockCollectionGet.mockRejectedValue(new Error("DB error"));
        const res = await request(app).get("/api/admin/listings").set("Authorization", adminToken());
        expect(res.status).toBe(500);
        expect(res.body.error).toBe("Failed to fetch listings");
    });
});

// =============================================================================
// US-07 — GET /api/admin/listings/rejected
// =============================================================================
describe("US-07: GET /api/admin/listings/rejected", () => {

    test("✅ Admin can fetch rejected listings", async () => {
        mockWhereGet.mockResolvedValue({
            forEach: (cb) => {
                cb({ id: "l1", data: () => ({ title: "Bad Listing", company: "Corp", type: "internship", location: "JHB", providerID: "p1", createdAt: "2024-01-01", removalReason: "Fraudulent", status: "rejected_review" }) });
            }
        });
        const res = await request(app).get("/api/admin/listings/rejected").set("Authorization", adminToken());
        expect(res.status).toBe(200);
        expect(res.body.length).toBe(1);
        expect(res.body[0].removalReason).toBe("Fraudulent");
    });

    test("✅ Returns empty when no rejected listings", async () => {
        mockWhereGet.mockResolvedValue({ forEach: () => {} });
        const res = await request(app).get("/api/admin/listings/rejected").set("Authorization", adminToken());
        expect(res.status).toBe(200);
        expect(res.body).toEqual([]);
    });

    test("❌ Provider cannot access — 403", async () => {
        const res = await request(app).get("/api/admin/listings/rejected").set("Authorization", providerToken());
        expect(res.status).toBe(403);
    });

    test("❌ Unauthenticated returns 401", async () => {
        const res = await request(app).get("/api/admin/listings/rejected");
        expect(res.status).toBe(401);
    });

    test("❌ Firestore failure returns 500", async () => {
        mockWhereGet.mockRejectedValue(new Error("DB error"));
        const res = await request(app).get("/api/admin/listings/rejected").set("Authorization", adminToken());
        expect(res.status).toBe(500);
        expect(res.body.error).toBe("Failed to fetch rejected listings");
    });
});

// =============================================================================
// US-07 — PATCH /api/admin/listings/:id/approve → sets status "review_accepted"
// =============================================================================
describe("US-07: PATCH /api/admin/listings/:id/approve", () => {

    test("✅ Admin can approve a listing — sets status review_accepted", async () => {
        mockDocGet.mockResolvedValue({ exists: true, data: () => ({ title: "Internship", providerID: "p1" }) });
        const res = await request(app)
            .patch("/api/admin/listings/listing-1/approve")
            .set("Authorization", adminToken());
        expect(res.status).toBe(200);
        expect(res.body.message).toBe("Listing accepted");
        expect(res.body.id).toBe("listing-1");
    });

    test("✅ Status is set to review_accepted in Firestore", async () => {
        mockDocGet.mockResolvedValue({ exists: true, data: () => ({ title: "T", providerID: "p1" }) });
        await request(app).patch("/api/admin/listings/listing-1/approve").set("Authorization", adminToken());
        expect(mockDocUpdate).toHaveBeenCalledWith(
            "Opportunities", "listing-1",
            expect.objectContaining({ status: "review_accepted" })
        );
    });

    test("✅ Provider notified via email when providerDoc exists", async () => {
        mockDocGet.mockResolvedValue({ exists: true, data: () => ({ title: "T", providerID: "p1" }) });
        mockProviderDocGet.mockResolvedValue({
            exists: true,
            data:   () => ({ email: "p@test.com", organization: "Org", firstname: "Prov" })
        });
        const { sendMail } = require("../../backend/helpers");
        await request(app).patch("/api/admin/listings/listing-1/approve").set("Authorization", adminToken());
        // Give async notification time to fire
        await new Promise(r => setTimeout(r, 50));
        expect(sendMail).toHaveBeenCalled();
    });

    test("✅ No crash when provider doc does not exist", async () => {
        mockDocGet.mockResolvedValue({ exists: true, data: () => ({ title: "T", providerID: "p1" }) });
        mockProviderDocGet.mockResolvedValue({ exists: false, data: () => ({}) });
        const res = await request(app).patch("/api/admin/listings/listing-1/approve").set("Authorization", adminToken());
        expect(res.status).toBe(200);
    });

    test("✅ No crash when listing has no providerID", async () => {
        mockDocGet.mockResolvedValue({ exists: true, data: () => ({ title: "T" }) });
        const res = await request(app).patch("/api/admin/listings/listing-1/approve").set("Authorization", adminToken());
        expect(res.status).toBe(200);
    });

    test("❌ 404 when listing does not exist", async () => {
        mockDocGet.mockResolvedValue({ exists: false });
        const res = await request(app).patch("/api/admin/listings/ghost/approve").set("Authorization", adminToken());
        expect(res.status).toBe(404);
        expect(res.body.error).toBe("Listing not found");
    });

    test("❌ Provider cannot approve — 403", async () => {
        const res = await request(app).patch("/api/admin/listings/l1/approve").set("Authorization", providerToken());
        expect(res.status).toBe(403);
    });

    test("❌ Unauthenticated returns 401", async () => {
        const res = await request(app).patch("/api/admin/listings/l1/approve");
        expect(res.status).toBe(401);
    });

    test("❌ Firestore failure returns 500", async () => {
        mockDocGet.mockResolvedValue({ exists: true, data: () => ({ title: "T", providerID: "p1" }) });
        mockDocUpdate.mockRejectedValue(new Error("Firestore error"));
        const res = await request(app).patch("/api/admin/listings/l1/approve").set("Authorization", adminToken());
        expect(res.status).toBe(500);
        expect(res.body.error).toBe("Failed to approve listing");
    });
});

// =============================================================================
// US-07 — PATCH /api/admin/listings/:id/remove → sets status "rejected_review"
// =============================================================================
describe("US-07: PATCH /api/admin/listings/:id/remove", () => {

    test("✅ Admin can remove a listing — sets status rejected_review", async () => {
        mockDocGet.mockResolvedValue({ exists: true, data: () => ({ title: "Bad", providerID: "p1" }) });
        const res = await request(app)
            .patch("/api/admin/listings/listing-1/remove")
            .set("Authorization", adminToken())
            .send({ reason: "Fraudulent listing" });
        expect(res.status).toBe(200);
        expect(res.body.message).toBe("Listing rejected");
    });

    test("✅ Status is set to rejected_review in Firestore", async () => {
        mockDocGet.mockResolvedValue({ exists: true, data: () => ({ title: "T", providerID: "p1" }) });
        await request(app)
            .patch("/api/admin/listings/listing-1/remove")
            .set("Authorization", adminToken())
            .send({ reason: "Duplicate" });
        expect(mockDocUpdate).toHaveBeenCalledWith(
            "Opportunities", "listing-1",
            expect.objectContaining({ status: "rejected_review", removalReason: "Duplicate" })
        );
    });

    test("✅ Removal reason is null when not provided", async () => {
        mockDocGet.mockResolvedValue({ exists: true, data: () => ({ title: "T", providerID: "p1" }) });
        await request(app).patch("/api/admin/listings/listing-1/remove").set("Authorization", adminToken());
        expect(mockDocUpdate).toHaveBeenCalledWith(
            "Opportunities", "listing-1",
            expect.objectContaining({ removalReason: null })
        );
    });

    test("✅ Provider notified on removal", async () => {
        mockDocGet.mockResolvedValue({ exists: true, data: () => ({ title: "T", providerID: "p1" }) });
        mockProviderDocGet.mockResolvedValue({
            exists: true,
            data:   () => ({ email: "p@test.com", organization: "Org" })
        });
        const { sendMail } = require("../../backend/helpers");
        await request(app).patch("/api/admin/listings/listing-1/remove").set("Authorization", adminToken()).send({ reason: "Bad" });
        await new Promise(r => setTimeout(r, 50));
        expect(sendMail).toHaveBeenCalled();
    });

    test("❌ 404 when listing does not exist", async () => {
        mockDocGet.mockResolvedValue({ exists: false });
        const res = await request(app).patch("/api/admin/listings/ghost/remove").set("Authorization", adminToken());
        expect(res.status).toBe(404);
    });

    test("❌ Provider cannot remove — 403", async () => {
        const res = await request(app).patch("/api/admin/listings/l1/remove").set("Authorization", providerToken());
        expect(res.status).toBe(403);
    });

    test("❌ Unauthenticated returns 401", async () => {
        const res = await request(app).patch("/api/admin/listings/l1/remove");
        expect(res.status).toBe(401);
    });

    test("❌ Firestore failure returns 500", async () => {
        mockDocGet.mockResolvedValue({ exists: true, data: () => ({ title: "T", providerID: "p1" }) });
        mockDocUpdate.mockRejectedValue(new Error("DB error"));
        const res = await request(app).patch("/api/admin/listings/l1/remove").set("Authorization", adminToken());
        expect(res.status).toBe(500);
        expect(res.body.error).toBe("Failed to remove listing");
    });
});

// =============================================================================
// US-08 — GET /api/admin/users
// =============================================================================
describe("US-08: GET /api/admin/users", () => {

    test("✅ Admin can fetch all users (applicants + providers)", async () => {
        mockCollectionGet
            .mockResolvedValueOnce({ forEach: (cb) => { cb({ id: "a1", data: () => ({ firstname: "Alice", email: "a@t.com", role: "applicant", status: "active", createdAt: "2024-01-01" }) }); } })
            .mockResolvedValueOnce({ forEach: (cb) => { cb({ id: "p1", data: () => ({ organization: "Corp",  email: "p@t.com", role: "provider",  status: "active", createdAt: "2024-01-02" }) }); } });

        const res = await request(app).get("/api/admin/users").set("Authorization", adminToken());
        expect(res.status).toBe(200);
        expect(res.body.users.length).toBe(2);
        expect(res.body.pagination).toBeDefined();
        expect(res.body.pagination.total).toBe(2);
    });

    test("✅ Returns empty when no users exist", async () => {
        mockCollectionGet.mockResolvedValue({ forEach: () => {} });
        const res = await request(app).get("/api/admin/users").set("Authorization", adminToken());
        expect(res.status).toBe(200);
        expect(res.body.users).toEqual([]);
    });

    test("✅ Pagination works — page 1 with limit 1", async () => {
        mockCollectionGet
            .mockResolvedValueOnce({ forEach: (cb) => {
                cb({ id: "a1", data: () => ({ firstname: "A", email: "a@t.com", role: "applicant", status: "active", createdAt: "2024-01-02" }) });
                cb({ id: "a2", data: () => ({ firstname: "B", email: "b@t.com", role: "applicant", status: "active", createdAt: "2024-01-01" }) });
            }})
            .mockResolvedValueOnce({ forEach: () => {} });
        const res = await request(app).get("/api/admin/users?page=1&limit=1").set("Authorization", adminToken());
        expect(res.status).toBe(200);
        expect(res.body.users.length).toBe(1);
        expect(res.body.pagination.totalPages).toBe(2);
    });

    test("✅ Role filter for 'applicant' only queries applicantsCol", async () => {
        mockCollectionGet.mockResolvedValueOnce({ forEach: (cb) => { cb({ id: "a1", data: () => ({ role: "applicant", email: "a@t.com", status: "active" }) }); } });
        const res = await request(app).get("/api/admin/users?role=applicant").set("Authorization", adminToken());
        expect(res.status).toBe(200);
        expect(res.body.users[0].role).toBe("applicant");
    });

    test("✅ Role filter for 'provider' only queries providersCol", async () => {
        mockCollectionGet.mockResolvedValueOnce({ forEach: (cb) => { cb({ id: "p1", data: () => ({ role: "provider", email: "p@t.com", status: "active" }) }); } });
        const res = await request(app).get("/api/admin/users?role=provider").set("Authorization", adminToken());
        expect(res.status).toBe(200);
        expect(res.body.users[0].role).toBe("provider");
    });

    test("✅ Sensitive fields are not exposed", async () => {
        mockCollectionGet
            .mockResolvedValueOnce({ forEach: (cb) => { cb({ id: "a1", data: () => ({ firstname: "A", password: "secret", idNumber: "900101", email: "a@t.com", role: "applicant", status: "active" }) }); } })
            .mockResolvedValueOnce({ forEach: () => {} });
        const res = await request(app).get("/api/admin/users").set("Authorization", adminToken());
        expect(res.body.users[0].password).toBeUndefined();
    });

    test("❌ Provider cannot access — 403", async () => {
        const res = await request(app).get("/api/admin/users").set("Authorization", providerToken());
        expect(res.status).toBe(403);
    });

    test("❌ Unauthenticated returns 401", async () => {
        const res = await request(app).get("/api/admin/users");
        expect(res.status).toBe(401);
    });

    test("❌ Firestore failure returns 500", async () => {
        mockCollectionGet.mockRejectedValue(new Error("DB error"));
        const res = await request(app).get("/api/admin/users").set("Authorization", adminToken());
        expect(res.status).toBe(500);
        expect(res.body.error).toBe("Failed to fetch users");
    });
});

// =============================================================================
// US-08 — PATCH /api/admin/users/:uid/suspend
// =============================================================================
describe("US-08: PATCH /api/admin/users/:uid/suspend", () => {

    test("✅ Admin can suspend a user", async () => {
        const mockRef = { update: (d) => mockDocUpdate("users", "uid-123", d) };
        mockLookupUser.mockResolvedValue({ snap: { exists: true, data: () => ({ role: "applicant", email: "u@t.com", firstname: "User" }) }, ref: mockRef, role: "applicant" });

        const res = await request(app).patch("/api/admin/users/uid-123/suspend").set("Authorization", adminToken());
        expect(res.status).toBe(200);
        expect(res.body.message).toBe("User suspended");
        expect(res.body.uid).toBe("uid-123");
    });

    test("✅ Firebase Auth is disabled on suspend", async () => {
        const mockRef = { update: jest.fn().mockResolvedValue() };
        mockLookupUser.mockResolvedValue({ snap: { exists: true, data: () => ({ role: "applicant" }) }, ref: mockRef, role: "applicant" });
        await request(app).patch("/api/admin/users/uid-123/suspend").set("Authorization", adminToken());
        expect(mockUpdateUser).toHaveBeenCalledWith("uid-123", { disabled: true });
    });

    test("✅ Firestore status is set to suspended", async () => {
        const mockRef = { update: (d) => mockDocUpdate("users", "uid-123", d) };
        mockLookupUser.mockResolvedValue({ snap: { exists: true, data: () => ({ role: "applicant" }) }, ref: mockRef, role: "applicant" });
        await request(app).patch("/api/admin/users/uid-123/suspend").set("Authorization", adminToken());
        expect(mockDocUpdate).toHaveBeenCalledWith("users", "uid-123", expect.objectContaining({ status: "suspended" }));
    });

    test("❌ Admin cannot suspend their own account", async () => {
        mockVerifyIdToken.mockResolvedValue({ uid: "admin-uid", role: "admin" });
        const res = await request(app).patch("/api/admin/users/admin-uid/suspend").set("Authorization", "Bearer admin-tok");
        expect(res.status).toBe(400);
        expect(res.body.error).toBe("Admins cannot suspend their own account");
    });

    test("❌ 404 when user not found", async () => {
        const res = await request(app).patch("/api/admin/users/ghost/suspend").set("Authorization", adminToken());
        expect(res.status).toBe(404);
        expect(res.body.error).toBe("User not found");
    });

    test("❌ Provider cannot suspend — 403", async () => {
        const res = await request(app).patch("/api/admin/users/u1/suspend").set("Authorization", providerToken());
        expect(res.status).toBe(403);
    });

    test("❌ Unauthenticated returns 401", async () => {
        const res = await request(app).patch("/api/admin/users/u1/suspend");
        expect(res.status).toBe(401);
    });

    test("❌ Firebase Auth failure returns 500", async () => {
        const mockRef = { update: jest.fn().mockResolvedValue() };
        mockLookupUser.mockResolvedValue({ snap: { exists: true, data: () => ({ role: "applicant" }) }, ref: mockRef, role: "applicant" });
        mockUpdateUser.mockRejectedValue(new Error("Firebase error"));
        const res = await request(app).patch("/api/admin/users/uid-123/suspend").set("Authorization", adminToken());
        expect(res.status).toBe(500);
        expect(res.body.error).toBe("Failed to suspend user");
    });
});

// =============================================================================
// US-08 — PATCH /api/admin/users/:uid/reactivate
// =============================================================================
describe("US-08: PATCH /api/admin/users/:uid/reactivate", () => {

    test("✅ Admin can reactivate a suspended user", async () => {
        const mockRef = { update: (d) => mockDocUpdate("users", "uid-123", d) };
        mockLookupUser.mockResolvedValue({ snap: { exists: true, data: () => ({ role: "applicant", status: "suspended", email: "u@t.com" }) }, ref: mockRef, role: "applicant" });

        const res = await request(app).patch("/api/admin/users/uid-123/reactivate").set("Authorization", adminToken());
        expect(res.status).toBe(200);
        expect(res.body.message).toBe("User reactivated");
    });

    test("✅ Firebase Auth is re-enabled on reactivation", async () => {
        const mockRef = { update: jest.fn().mockResolvedValue() };
        mockLookupUser.mockResolvedValue({ snap: { exists: true, data: () => ({ role: "applicant" }) }, ref: mockRef, role: "applicant" });
        await request(app).patch("/api/admin/users/uid-123/reactivate").set("Authorization", adminToken());
        expect(mockUpdateUser).toHaveBeenCalledWith("uid-123", { disabled: false });
    });

    test("✅ Firestore status is set to active", async () => {
        const mockRef = { update: (d) => mockDocUpdate("users", "uid-123", d) };
        mockLookupUser.mockResolvedValue({ snap: { exists: true, data: () => ({ role: "applicant" }) }, ref: mockRef, role: "applicant" });
        await request(app).patch("/api/admin/users/uid-123/reactivate").set("Authorization", adminToken());
        expect(mockDocUpdate).toHaveBeenCalledWith("users", "uid-123", expect.objectContaining({ status: "active" }));
    });

    test("❌ 404 when user not found", async () => {
        const res = await request(app).patch("/api/admin/users/ghost/reactivate").set("Authorization", adminToken());
        expect(res.status).toBe(404);
    });

    test("❌ Provider cannot reactivate — 403", async () => {
        const res = await request(app).patch("/api/admin/users/u1/reactivate").set("Authorization", providerToken());
        expect(res.status).toBe(403);
    });

    test("❌ Unauthenticated returns 401", async () => {
        const res = await request(app).patch("/api/admin/users/u1/reactivate");
        expect(res.status).toBe(401);
    });

    test("❌ Firebase failure returns 500", async () => {
        const mockRef = { update: jest.fn().mockResolvedValue() };
        mockLookupUser.mockResolvedValue({ snap: { exists: true, data: () => ({ role: "applicant" }) }, ref: mockRef, role: "applicant" });
        mockUpdateUser.mockRejectedValue(new Error("Firebase error"));
        const res = await request(app).patch("/api/admin/users/uid-123/reactivate").set("Authorization", adminToken());
        expect(res.status).toBe(500);
        expect(res.body.error).toBe("Failed to reactivate user");
    });
});

// =============================================================================
// US-08 — DELETE /api/admin/users/:uid
// =============================================================================
describe("US-08: DELETE /api/admin/users/:uid", () => {

    test("✅ Admin can delete a user", async () => {
        const mockRef = { delete: () => mockDocDelete("users", "uid-del") };
        mockLookupUser.mockResolvedValue({ snap: { exists: true, data: () => ({ role: "applicant" }) }, ref: mockRef, role: "applicant" });

        const res = await request(app).delete("/api/admin/users/uid-del").set("Authorization", adminToken());
        expect(res.status).toBe(200);
        expect(res.body.message).toBe("User deleted");
        expect(res.body.uid).toBe("uid-del");
    });

    test("✅ Firebase Auth deleteUser is called", async () => {
        const mockRef = { delete: () => mockDocDelete("users", "uid-del") };
        mockLookupUser.mockResolvedValue({ snap: { exists: true, data: () => ({ role: "applicant" }) }, ref: mockRef, role: "applicant" });
        await request(app).delete("/api/admin/users/uid-del").set("Authorization", adminToken());
        expect(mockDeleteUser).toHaveBeenCalledWith("uid-del");
    });

    test("✅ Firestore document is deleted", async () => {
        const mockRef = { delete: () => mockDocDelete("users", "uid-del") };
        mockLookupUser.mockResolvedValue({ snap: { exists: true, data: () => ({ role: "applicant" }) }, ref: mockRef, role: "applicant" });
        await request(app).delete("/api/admin/users/uid-del").set("Authorization", adminToken());
        expect(mockDocDelete).toHaveBeenCalledWith("users", "uid-del");
    });

    test("❌ Admin cannot delete their own account", async () => {
        mockVerifyIdToken.mockResolvedValue({ uid: "admin-uid", role: "admin" });
        const res = await request(app).delete("/api/admin/users/admin-uid").set("Authorization", "Bearer admin-tok");
        expect(res.status).toBe(400);
        expect(res.body.error).toBe("Admins cannot delete their own account");
    });

    test("❌ 404 when user does not exist", async () => {
        const res = await request(app).delete("/api/admin/users/ghost").set("Authorization", adminToken());
        expect(res.status).toBe(404);
        expect(res.body.error).toBe("User not found");
    });

    test("❌ Provider cannot delete — 403", async () => {
        const res = await request(app).delete("/api/admin/users/u1").set("Authorization", providerToken());
        expect(res.status).toBe(403);
    });

    test("❌ Applicant cannot delete — 403", async () => {
        const res = await request(app).delete("/api/admin/users/u1").set("Authorization", applicantToken());
        expect(res.status).toBe(403);
    });

    test("❌ Unauthenticated returns 401", async () => {
        const res = await request(app).delete("/api/admin/users/u1");
        expect(res.status).toBe(401);
    });

    test("❌ Firebase deleteUser failure returns 500", async () => {
        const mockRef = { delete: jest.fn().mockResolvedValue() };
        mockLookupUser.mockResolvedValue({ snap: { exists: true, data: () => ({ role: "applicant" }) }, ref: mockRef, role: "applicant" });
        mockDeleteUser.mockRejectedValue(new Error("Firebase delete failed"));
        const res = await request(app).delete("/api/admin/users/uid-del").set("Authorization", adminToken());
        expect(res.status).toBe(500);
        expect(res.body.error).toBe("Failed to delete user");
    });

    test("❌ Firestore delete failure returns 500", async () => {
        const mockRef = { delete: jest.fn().mockRejectedValue(new Error("FS error")) };
        mockLookupUser.mockResolvedValue({ snap: { exists: true, data: () => ({ role: "applicant" }) }, ref: mockRef, role: "applicant" });
        mockDeleteUser.mockResolvedValue();
        const res = await request(app).delete("/api/admin/users/uid-del").set("Authorization", adminToken());
        expect(res.status).toBe(500);
        expect(res.body.error).toBe("Failed to delete user");
    });
});
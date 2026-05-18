const request = require("supertest");

// ─── Hoisted mock variables ───────────────────────────────────────────────────
let mockVerifyIdToken;
let mockSetCustomClaims;
let mockUpdateUser;
let mockDeleteUser;
let mockDocGet;
let mockDocUpdate;
let mockDocDelete;
let mockDocSet;
let mockCollectionGet;
let mockCollectionAdd;
let mockWhereGet;
let mockNotificationsAdd;

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
    mockNotificationsAdd = jest.fn().mockResolvedValue({ id: "notif-id" });

    const makeCollection = (name) => ({
        get:  () => mockCollectionGet(name),
        add:  (data) => mockCollectionAdd(name, data),
        where: (field, op, val) => ({
            get: () => mockWhereGet(name, field, op, val),
            where: (f2, o2, v2) => ({
                get: () => mockWhereGet(name, `${field}+${f2}`, op, val)
            })
        }),
        doc: (id) => ({
            get:    () => mockDocGet(name, id),
            update: (data) => mockDocUpdate(name, id, data),
            delete: () => mockDocDelete(name, id),
            set:    (data) => mockDocSet(name, id, data)
        })
    });

    return {
        admin: {
            auth: () => ({
                verifyIdToken:       mockVerifyIdToken,
                setCustomUserClaims: mockSetCustomClaims,
                updateUser:          mockUpdateUser,
                deleteUser:          mockDeleteUser
            }),
            firestore: {
                FieldValue: { serverTimestamp: () => "SERVER_TIMESTAMP" }
            }
        },
        db: { collection: makeCollection }
    };
});

// Mock nodemailer so no real emails fire
jest.mock("nodemailer", () => ({
    createTransport: jest.fn().mockReturnValue({
        verify:   jest.fn((cb) => cb(null, true)),
        sendMail: jest.fn().mockResolvedValue({ messageId: "test" })
    })
}));

// Mock userPaths so providerRef/lookupUser don't hit real Firestore
let mockProviderDocGet;
let mockLookupUser;
jest.mock("../../backend/userPaths", () => {
    mockProviderDocGet = jest.fn();
    mockLookupUser     = jest.fn();
    return {
        // applicantsCol/providersCol delegate to mockCollectionGet so users-list tests work
        applicantsCol: jest.fn(() => ({
            get:   () => mockCollectionGet("applicants"),
            where: jest.fn(() => ({ get: () => mockWhereGet("applicants", "role") }))
        })),
        providersCol: jest.fn(() => ({
            get:   () => mockCollectionGet("providers"),
            where: jest.fn(() => ({ get: () => mockWhereGet("providers", "role") }))
        })),
        applicantRef: jest.fn(() => ({ get: jest.fn().mockResolvedValue({ exists: false }), set: jest.fn() })),
        // providerRef returns an object with .get() — not a Promise directly
        providerRef:  jest.fn(() => ({ get: mockProviderDocGet })),
        lookupUser:   (...args) => mockLookupUser(...args)
    };
});

const app = require("../../backend/app");

// ─── Token helpers ────────────────────────────────────────────────────────────
const adminToken    = () => { mockVerifyIdToken.mockResolvedValue({ uid: "admin-uid",    role: "admin"    }); return "Bearer admin-tok"; };
const providerToken = () => { mockVerifyIdToken.mockResolvedValue({ uid: "provider-uid", role: "provider" }); return "Bearer prov-tok";  };
const applicantToken= () => { mockVerifyIdToken.mockResolvedValue({ uid: "applicant-uid",role: "applicant"}); return "Bearer appl-tok";  };

beforeEach(() => {
    // resetAllMocks clears both history AND implementations so each test starts clean
    jest.resetAllMocks();
    mockCollectionAdd.mockResolvedValue({ id: "notif-id" });
    mockDocUpdate.mockResolvedValue();
    mockDocDelete.mockResolvedValue();
    mockDocSet.mockResolvedValue();
    mockUpdateUser.mockResolvedValue();
    mockDeleteUser.mockResolvedValue();
    // Default providerRef.get(): returns no provider (no-op notifications)
    mockProviderDocGet.mockResolvedValue({ exists: false, data: () => ({}) });
    // Default lookupUser: user not found
    mockLookupUser.mockResolvedValue({ snap: null, ref: null, role: null });
});

// =============================================================================
// US-07 — LISTING MODERATION
// =============================================================================

describe("US-07: GET /api/admin/listings/pending", () => {

    test("✅ Admin can fetch pending listings", async () => {
        mockWhereGet.mockResolvedValue({
            forEach: (cb) => {
                cb({ id: "l1", data: () => ({ title: "Internship", company: "Corp", type: "internship", location: "JHB", stipend: 3000, providerID: "p1", createdAt: "2024-01-01", status: "pending-review" }) });
                cb({ id: "l2", data: () => ({ title: "Learnership", company: "SA Inc", type: "learnership", location: "CT",  stipend: 2000, providerID: "p2", createdAt: "2024-01-02", status: "pending-review" }) });
            }
        });

        const res = await request(app)
            .get("/api/admin/listings/pending")
            .set("Authorization", adminToken());

        expect(res.status).toBe(200);
        expect(res.body.length).toBe(2);
        expect(res.body[0].status).toBe("pending-review");
    });

    test("✅ Returns empty array when no pending listings", async () => {
        mockWhereGet.mockResolvedValue({ forEach: () => {} });
        const res = await request(app)
            .get("/api/admin/listings/pending")
            .set("Authorization", adminToken());
        expect(res.status).toBe(200);
        expect(res.body).toEqual([]);
    });

    test("❌ Provider cannot access pending listings — 403", async () => {
        const res = await request(app)
            .get("/api/admin/listings/pending")
            .set("Authorization", providerToken());
        expect(res.status).toBe(403);
    });

    test("❌ Applicant cannot access pending listings — 403", async () => {
        const res = await request(app)
            .get("/api/admin/listings/pending")
            .set("Authorization", applicantToken());
        expect(res.status).toBe(403);
    });

    test("❌ Unauthenticated request returns 401", async () => {
        const res = await request(app).get("/api/admin/listings/pending");
        expect(res.status).toBe(401);
    });

    test("❌ Firestore failure returns 500", async () => {
        mockVerifyIdToken.mockResolvedValue({ uid: "admin-uid", role: "admin" });
        mockWhereGet.mockRejectedValue(new Error("Firestore down"));
        const res = await request(app)
            .get("/api/admin/listings/pending")
            .set("Authorization", "Bearer admin-tok");
        expect(res.status).toBe(500);
        expect(res.body.error).toBe("Failed to fetch pending listings");
    });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("US-07: GET /api/admin/listings", () => {

    test("✅ Admin sees all listings regardless of status", async () => {
        mockCollectionGet.mockResolvedValue({
            forEach: (cb) => {
                cb({ id: "l1", data: () => ({ title: "A", company: "X", type: "internship", location: "JHB", stipend: 0, providerID: "p1", createdAt: "2024-01-01", status: "approved"       }) });
                cb({ id: "l2", data: () => ({ title: "B", company: "Y", type: "learnership", location: "CT", stipend: 0, providerID: "p2", createdAt: "2024-01-02", status: "pending-review" }) });
                cb({ id: "l3", data: () => ({ title: "C", company: "Z", type: "apprenticeship", location: "PTA", stipend: 0, providerID: "p3", createdAt: "2024-01-03", status: "removed"   }) });
            }
        });

        const res = await request(app)
            .get("/api/admin/listings")
            .set("Authorization", adminToken());

        expect(res.status).toBe(200);
        expect(res.body.length).toBe(3);
        const statuses = res.body.map(l => l.status);
        expect(statuses).toContain("approved");
        expect(statuses).toContain("pending-review");
        expect(statuses).toContain("removed");
    });

    test("❌ Provider cannot access admin listings — 403", async () => {
        const res = await request(app)
            .get("/api/admin/listings")
            .set("Authorization", providerToken());
        expect(res.status).toBe(403);
    });

    test("❌ Unauthenticated returns 401", async () => {
        const res = await request(app).get("/api/admin/listings");
        expect(res.status).toBe(401);
    });

    test("❌ Firestore failure returns 500", async () => {
        mockVerifyIdToken.mockResolvedValue({ uid: "admin-uid", role: "admin" });
        mockCollectionGet.mockRejectedValue(new Error("DB error"));
        const res = await request(app)
            .get("/api/admin/listings")
            .set("Authorization", "Bearer admin-tok");
        expect(res.status).toBe(500);
        expect(res.body.error).toBe("Failed to fetch listings");
    });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("US-07: PATCH /api/admin/listings/:id/approve", () => {

    const setupListingDoc = (exists = true, data = {}) => {
        mockDocGet.mockResolvedValue({
            exists,
            data: () => ({ title: "Test Listing", providerID: "provider-uid", ...data })
        });
    };

    const setupProviderDoc = () => {
        mockDocGet.mockResolvedValueOnce({ exists: true, data: () => ({ title: "Test Listing", providerID: "provider-uid" }) });
        mockProviderDocGet.mockResolvedValue({ exists: true, data: () => ({ email: "prov@test.com", organization: "Corp SA", firstname: "Sam" }) });
    };

    test("✅ Admin can approve a pending listing", async () => {
        setupProviderDoc();
        const res = await request(app)
            .patch("/api/admin/listings/listing-001/approve")
            .set("Authorization", adminToken());

        expect(res.status).toBe(200);
        expect(res.body.message).toBe("Listing accepted");
        expect(res.body.id).toBe("listing-001");
        expect(mockDocUpdate).toHaveBeenCalledWith("Opportunities", "listing-001",
            expect.objectContaining({ status: "review_accepted" })
        );
    });

    test("✅ Approved status is set atomically in Firestore", async () => {
        setupProviderDoc();
        await request(app)
            .patch("/api/admin/listings/l1/approve")
            .set("Authorization", adminToken());

        const updateCall = mockDocUpdate.mock.calls.find(c => c[0] === "Opportunities");
        expect(updateCall[2].status).toBe("review_accepted");
        expect(updateCall[2].updatedAt).toBeDefined();
    });

    test("✅ Notification is created for provider on approval", async () => {
        setupProviderDoc();
        await request(app)
            .patch("/api/admin/listings/l1/approve")
            .set("Authorization", adminToken());

        expect(mockCollectionAdd).toHaveBeenCalledWith("notifications",
            expect.objectContaining({ recipientId: "provider-uid", status: "unread" })
        );
    });

    test("✅ Listing without providerID still approves (no crash)", async () => {
        mockDocGet.mockResolvedValue({ exists: true, data: () => ({ title: "Orphan Listing" }) }); // no providerID
        const res = await request(app)
            .patch("/api/admin/listings/orphan/approve")
            .set("Authorization", adminToken());
        expect(res.status).toBe(200);
    });

    test("❌ 404 when listing does not exist", async () => {
        mockDocGet.mockResolvedValue({ exists: false });
        const res = await request(app)
            .patch("/api/admin/listings/ghost/approve")
            .set("Authorization", adminToken());
        expect(res.status).toBe(404);
        expect(res.body.error).toBe("Listing not found");
    });

    test("❌ Provider cannot approve listings — 403", async () => {
        const res = await request(app)
            .patch("/api/admin/listings/l1/approve")
            .set("Authorization", providerToken());
        expect(res.status).toBe(403);
    });

    test("❌ Applicant cannot approve listings — 403", async () => {
        const res = await request(app)
            .patch("/api/admin/listings/l1/approve")
            .set("Authorization", applicantToken());
        expect(res.status).toBe(403);
    });

    test("❌ Unauthenticated returns 401", async () => {
        const res = await request(app).patch("/api/admin/listings/l1/approve");
        expect(res.status).toBe(401);
    });

    test("❌ Firestore failure returns 500", async () => {
        mockVerifyIdToken.mockResolvedValue({ uid: "admin-uid", role: "admin" });
        mockDocGet.mockRejectedValue(new Error("Firestore error"));
        const res = await request(app)
            .patch("/api/admin/listings/l1/approve")
            .set("Authorization", "Bearer admin-tok");
        expect(res.status).toBe(500);
        expect(res.body.error).toBe("Failed to approve listing");
    });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("US-07: PATCH /api/admin/listings/:id/remove", () => {

    const setupForRemove = () => {
        mockDocGet.mockResolvedValueOnce({ exists: true, data: () => ({ title: "Remove Me", providerID: "provider-uid" }) });
        mockProviderDocGet.mockResolvedValue({ exists: true, data: () => ({ email: "prov@test.com", organization: "Corp", firstname: "Sam" }) });
    };

    test("✅ Admin can remove a listing", async () => {
        setupForRemove();
        const res = await request(app)
            .patch("/api/admin/listings/l1/remove")
            .set("Authorization", adminToken())
            .send({ reason: "Fraudulent posting" });

        expect(res.status).toBe(200);
        expect(res.body.message).toBe("Listing rejected");
        expect(mockDocUpdate).toHaveBeenCalledWith("Opportunities", "l1",
            expect.objectContaining({ status: "rejected_review", removalReason: "Fraudulent posting" })
        );
    });

    test("✅ Remove without reason sets removalReason to null", async () => {
        setupForRemove();
        await request(app)
            .patch("/api/admin/listings/l1/remove")
            .set("Authorization", adminToken())
            .send({});

        const updateCall = mockDocUpdate.mock.calls.find(c => c[0] === "Opportunities");
        expect(updateCall[2].removalReason).toBeNull();
    });

    test("✅ Provider notified when listing is removed", async () => {
        setupForRemove();
        await request(app)
            .patch("/api/admin/listings/l1/remove")
            .set("Authorization", adminToken());

        expect(mockCollectionAdd).toHaveBeenCalledWith("notifications",
            expect.objectContaining({ recipientId: "provider-uid", status: "unread" })
        );
    });

    test("✅ Remove listing without providerID (no crash)", async () => {
        mockDocGet.mockResolvedValue({ exists: true, data: () => ({ title: "Orphan" }) });
        const res = await request(app)
            .patch("/api/admin/listings/orphan/remove")
            .set("Authorization", adminToken());
        expect(res.status).toBe(200);
    });

    test("❌ 404 when listing does not exist", async () => {
        mockDocGet.mockResolvedValue({ exists: false });
        const res = await request(app)
            .patch("/api/admin/listings/ghost/remove")
            .set("Authorization", adminToken());
        expect(res.status).toBe(404);
        expect(res.body.error).toBe("Listing not found");
    });

    test("❌ Provider cannot remove listings — 403", async () => {
        const res = await request(app)
            .patch("/api/admin/listings/l1/remove")
            .set("Authorization", providerToken());
        expect(res.status).toBe(403);
    });

    test("❌ Unauthenticated returns 401", async () => {
        const res = await request(app).patch("/api/admin/listings/l1/remove");
        expect(res.status).toBe(401);
    });

    test("❌ Firestore failure returns 500", async () => {
        mockVerifyIdToken.mockResolvedValue({ uid: "admin-uid", role: "admin" });
        mockDocGet.mockRejectedValue(new Error("DB error"));
        const res = await request(app)
            .patch("/api/admin/listings/l1/remove")
            .set("Authorization", "Bearer admin-tok");
        expect(res.status).toBe(500);
        expect(res.body.error).toBe("Failed to remove listing");
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Listings visibility: only 'approved' appear in /api/listings
// ─────────────────────────────────────────────────────────────────────────────
describe("US-07: /api/listings only returns approved listings", () => {

    test("✅ Applicant only sees live listings (auto_approved + review_accepted)", async () => {
        mockVerifyIdToken.mockResolvedValue({ uid: "applicant-uid", role: "applicant" });
        // GET /api/listings runs two parallel where().get() calls
        mockWhereGet
            .mockResolvedValueOnce({
                forEach: (cb) => {
                    cb({ id: "l1", data: () => ({ title: "Auto Approved", stipend: 3000, location: "JHB", company: "Corp", type: "internship", status: "auto_approved" }) });
                }
            })
            .mockResolvedValueOnce({ forEach: () => {} });

        const res = await request(app)
            .get("/api/listings")
            .set("Authorization", "Bearer appl-tok");

        expect(res.status).toBe(200);
        expect(res.body.length).toBe(1);
        expect(res.body[0].title).toBe("Auto Approved");
    });

    test("❌ in_for_review listings are NOT visible to applicants", async () => {
        mockVerifyIdToken.mockResolvedValue({ uid: "applicant-uid", role: "applicant" });
        // Both parallel queries return empty — no live listings
        mockWhereGet.mockResolvedValue({ forEach: () => {} });

        const res = await request(app)
            .get("/api/listings")
            .set("Authorization", "Bearer appl-tok");

        expect(res.status).toBe(200);
        expect(res.body).toEqual([]);
    });
});

// =============================================================================
// US-08 — USER ACCOUNT MANAGEMENT
// =============================================================================

describe("US-08: GET /api/admin/users", () => {

    // Helper: applicants snapshot (2 users)
    const applicantsSnapshot = () => ({
        forEach: (cb) => {
            cb({ id: "u1", data: () => ({ firstname: "Alice", lastname: "A", email: "a@test.com", role: "applicant", status: "active",    createdAt: "2024-01-01" }) });
            cb({ id: "u3", data: () => ({ firstname: "Carol", lastname: "C", email: "c@test.com", role: "applicant", status: "suspended", createdAt: "2024-01-03" }) });
        }
    });
    // Helper: providers snapshot (1 user)
    const providersSnapshot = () => ({
        forEach: (cb) => {
            cb({ id: "u2", data: () => ({ firstname: "Bob", lastname: "B", email: "b@test.com", role: "provider", status: "active", createdAt: "2024-01-02" }) });
        }
    });

    const setupUsersListing = () => {
        mockCollectionGet
            .mockResolvedValueOnce(applicantsSnapshot())   // applicantsCol().get()
            .mockResolvedValueOnce(providersSnapshot());    // providersCol().get()
    };

    test("✅ Admin can list all users", async () => {
        setupUsersListing();
        const res = await request(app)
            .get("/api/admin/users")
            .set("Authorization", adminToken());

        expect(res.status).toBe(200);
        expect(res.body.users.length).toBe(3);
        expect(res.body.pagination.total).toBe(3);
    });

    test("✅ No sensitive fields exposed (no password, no raw token)", async () => {
        setupUsersListing();
        const res = await request(app)
            .get("/api/admin/users")
            .set("Authorization", adminToken());

        res.body.users.forEach(u => {
            expect(u).not.toHaveProperty("password");
            expect(u).not.toHaveProperty("token");
            expect(u).not.toHaveProperty("passwordHash");
        });
    });

    test("✅ Response includes expected safe fields", async () => {
        setupUsersListing();
        const res = await request(app)
            .get("/api/admin/users")
            .set("Authorization", adminToken());

        const user = res.body.users[0];
        expect(user).toHaveProperty("uid");
        expect(user).toHaveProperty("email");
        expect(user).toHaveProperty("role");
        expect(user).toHaveProperty("status");
        expect(user).toHaveProperty("createdAt");
    });

    test("✅ Pagination works correctly", async () => {
        // 20 applicants + 5 providers = 25 total
        const bigApplicants = { forEach: (cb) => { for (let i = 0; i < 20; i++) cb({ id: `a${i}`, data: () => ({ firstname: `App${i}`, email: `a${i}@t.com`, role: "applicant", status: "active", createdAt: `2024-01-${String(i+1).padStart(2,"0")}` }) }); } };
        const bigProviders  = { forEach: (cb) => { for (let i = 0; i < 5; i++)  cb({ id: `p${i}`, data: () => ({ firstname: `Prov${i}`, email: `p${i}@t.com`, role: "provider",  status: "active", createdAt: `2024-02-${String(i+1).padStart(2,"0")}` }) }); } };
        mockCollectionGet
            .mockResolvedValueOnce(bigApplicants)
            .mockResolvedValueOnce(bigProviders);

        const res = await request(app)
            .get("/api/admin/users?page=2&limit=10")
            .set("Authorization", adminToken());

        expect(res.status).toBe(200);
        expect(res.body.users.length).toBe(10);
        expect(res.body.pagination.page).toBe(2);
        expect(res.body.pagination.totalPages).toBe(3);
    });

    test("✅ Filter by role=applicant returns only applicants", async () => {
        // When role=applicant, the route only calls applicantsCol().get()
        mockCollectionGet.mockResolvedValueOnce({
            forEach: (cb) => {
                cb({ id: "u1", data: () => ({ firstname: "Alice", email: "a@test.com", role: "applicant", status: "active", createdAt: "2024-01-01" }) });
            }
        });

        const res = await request(app)
            .get("/api/admin/users?role=applicant")
            .set("Authorization", adminToken());

        expect(res.status).toBe(200);
        expect(res.body.users[0].role).toBe("applicant");
    });

    test("✅ Invalid role filter falls back to all users (no where clause)", async () => {
        mockCollectionGet.mockResolvedValue(makeUsersSnapshot());
        const res = await request(app)
            .get("/api/admin/users?role=hacker")
            .set("Authorization", adminToken());
        expect(res.status).toBe(200);
    });

    test("❌ Provider cannot list users — 403", async () => {
        const res = await request(app)
            .get("/api/admin/users")
            .set("Authorization", providerToken());
        expect(res.status).toBe(403);
    });

    test("❌ Applicant cannot list users — 403", async () => {
        const res = await request(app)
            .get("/api/admin/users")
            .set("Authorization", applicantToken());
        expect(res.status).toBe(403);
    });

    test("❌ Unauthenticated returns 401", async () => {
        const res = await request(app).get("/api/admin/users");
        expect(res.status).toBe(401);
    });

    test("❌ Firestore failure returns 500", async () => {
        mockVerifyIdToken.mockResolvedValue({ uid: "admin-uid", role: "admin" });
        mockCollectionGet.mockRejectedValue(new Error("DB down"));
        const res = await request(app)
            .get("/api/admin/users")
            .set("Authorization", "Bearer admin-tok");
        expect(res.status).toBe(500);
        expect(res.body.error).toBe("Failed to fetch users");
    });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("US-08: PATCH /api/admin/users/:uid/suspend", () => {

    test("✅ Admin can suspend a user", async () => {
        const mockRef = { update: (d) => mockDocUpdate("users", "user-to-suspend", d) };
        mockLookupUser.mockResolvedValue({ snap: { exists: true, data: () => ({ role: "applicant", email: "a@test.com" }) }, ref: mockRef, role: "applicant" });

        const res = await request(app)
            .patch("/api/admin/users/user-to-suspend/suspend")
            .set("Authorization", adminToken());

        expect(res.status).toBe(200);
        expect(res.body.message).toBe("User suspended");
        expect(res.body.uid).toBe("user-to-suspend");
    });

    test("✅ Firebase Auth is disabled on suspend", async () => {
        const mockRef = { update: (d) => mockDocUpdate("users", "uid-123", d) };
        mockLookupUser.mockResolvedValue({ snap: { exists: true, data: () => ({ role: "applicant" }) }, ref: mockRef, role: "applicant" });
        await request(app)
            .patch("/api/admin/users/uid-123/suspend")
            .set("Authorization", adminToken());

        expect(mockUpdateUser).toHaveBeenCalledWith("uid-123", { disabled: true });
    });

    test("✅ Firestore status is updated to 'suspended'", async () => {
        const mockRef = { update: (d) => mockDocUpdate("users", "uid-123", d) };
        mockLookupUser.mockResolvedValue({ snap: { exists: true, data: () => ({ role: "applicant" }) }, ref: mockRef, role: "applicant" });
        await request(app)
            .patch("/api/admin/users/uid-123/suspend")
            .set("Authorization", adminToken());

        expect(mockDocUpdate).toHaveBeenCalledWith("users", "uid-123",
            expect.objectContaining({ status: "suspended" })
        );
    });

    test("❌ Admin cannot suspend their own account", async () => {
        mockVerifyIdToken.mockResolvedValue({ uid: "admin-uid", role: "admin" });
        const res = await request(app)
            .patch("/api/admin/users/admin-uid/suspend")
            .set("Authorization", "Bearer admin-tok");

        expect(res.status).toBe(400);
        expect(res.body.error).toBe("Admins cannot suspend their own account");
    });

    test("❌ 404 when user does not exist", async () => {
        // Default mockLookupUser returns null → 404
        const res = await request(app)
            .patch("/api/admin/users/ghost/suspend")
            .set("Authorization", adminToken());
        expect(res.status).toBe(404);
        expect(res.body.error).toBe("User not found");
    });

    test("❌ Provider cannot suspend users — 403", async () => {
        const res = await request(app)
            .patch("/api/admin/users/u1/suspend")
            .set("Authorization", providerToken());
        expect(res.status).toBe(403);
    });

    test("❌ Applicant cannot suspend users — 403", async () => {
        const res = await request(app)
            .patch("/api/admin/users/u1/suspend")
            .set("Authorization", applicantToken());
        expect(res.status).toBe(403);
    });

    test("❌ Unauthenticated returns 401", async () => {
        const res = await request(app).patch("/api/admin/users/u1/suspend");
        expect(res.status).toBe(401);
    });

    test("❌ Firebase Auth failure returns 500", async () => {
        mockVerifyIdToken.mockResolvedValue({ uid: "admin-uid", role: "admin" });
        const mockRef = { update: jest.fn().mockResolvedValue() };
        mockLookupUser.mockResolvedValue({ snap: { exists: true, data: () => ({ role: "applicant" }) }, ref: mockRef, role: "applicant" });
        mockUpdateUser.mockRejectedValue(new Error("Firebase error"));
        const res = await request(app)
            .patch("/api/admin/users/uid-123/suspend")
            .set("Authorization", "Bearer admin-tok");
        expect(res.status).toBe(500);
        expect(res.body.error).toBe("Failed to suspend user");
    });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("US-08: PATCH /api/admin/users/:uid/reactivate", () => {

    test("✅ Admin can reactivate a suspended user", async () => {
        const mockRef = { update: (d) => mockDocUpdate("users", "suspended-uid", d) };
        mockLookupUser.mockResolvedValue({ snap: { exists: true, data: () => ({ role: "applicant", status: "suspended" }) }, ref: mockRef, role: "applicant" });

        const res = await request(app)
            .patch("/api/admin/users/suspended-uid/reactivate")
            .set("Authorization", adminToken());

        expect(res.status).toBe(200);
        expect(res.body.message).toBe("User reactivated");
        expect(res.body.uid).toBe("suspended-uid");
    });

    test("✅ Firebase Auth is re-enabled on reactivation", async () => {
        const mockRef = { update: (d) => mockDocUpdate("users", "uid-123", d) };
        mockLookupUser.mockResolvedValue({ snap: { exists: true, data: () => ({ role: "applicant" }) }, ref: mockRef, role: "applicant" });
        await request(app)
            .patch("/api/admin/users/uid-123/reactivate")
            .set("Authorization", adminToken());

        expect(mockUpdateUser).toHaveBeenCalledWith("uid-123", { disabled: false });
    });

    test("✅ Firestore status is updated to 'active'", async () => {
        const mockRef = { update: (d) => mockDocUpdate("users", "uid-123", d) };
        mockLookupUser.mockResolvedValue({ snap: { exists: true, data: () => ({ role: "applicant" }) }, ref: mockRef, role: "applicant" });
        await request(app)
            .patch("/api/admin/users/uid-123/reactivate")
            .set("Authorization", adminToken());

        expect(mockDocUpdate).toHaveBeenCalledWith("users", "uid-123",
            expect.objectContaining({ status: "active" })
        );
    });

    test("❌ 404 when user does not exist", async () => {
        // Default mockLookupUser returns null → 404
        const res = await request(app)
            .patch("/api/admin/users/ghost/reactivate")
            .set("Authorization", adminToken());
        expect(res.status).toBe(404);
        expect(res.body.error).toBe("User not found");
    });

    test("❌ Provider cannot reactivate users — 403", async () => {
        const res = await request(app)
            .patch("/api/admin/users/u1/reactivate")
            .set("Authorization", providerToken());
        expect(res.status).toBe(403);
    });

    test("❌ Unauthenticated returns 401", async () => {
        const res = await request(app).patch("/api/admin/users/u1/reactivate");
        expect(res.status).toBe(401);
    });

    test("❌ Firebase Auth failure returns 500", async () => {
        mockVerifyIdToken.mockResolvedValue({ uid: "admin-uid", role: "admin" });
        const mockRef = { update: jest.fn().mockResolvedValue() };
        mockLookupUser.mockResolvedValue({ snap: { exists: true, data: () => ({ role: "applicant" }) }, ref: mockRef, role: "applicant" });
        mockUpdateUser.mockRejectedValue(new Error("Firebase error"));
        const res = await request(app)
            .patch("/api/admin/users/uid-123/reactivate")
            .set("Authorization", "Bearer admin-tok");
        expect(res.status).toBe(500);
        expect(res.body.error).toBe("Failed to reactivate user");
    });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("US-08: DELETE /api/admin/users/:uid", () => {

    test("✅ Admin can delete a user", async () => {
        const mockRef = { delete: () => mockDocDelete("users", "user-to-delete") };
        mockLookupUser.mockResolvedValue({ snap: { exists: true, data: () => ({ role: "applicant", email: "del@test.com" }) }, ref: mockRef, role: "applicant" });

        const res = await request(app)
            .delete("/api/admin/users/user-to-delete")
            .set("Authorization", adminToken());

        expect(res.status).toBe(200);
        expect(res.body.message).toBe("User deleted");
        expect(res.body.uid).toBe("user-to-delete");
    });

    test("✅ User is removed from Firebase Auth", async () => {
        const mockRef = { delete: () => mockDocDelete("users", "uid-del") };
        mockLookupUser.mockResolvedValue({ snap: { exists: true, data: () => ({ role: "applicant" }) }, ref: mockRef, role: "applicant" });
        await request(app)
            .delete("/api/admin/users/uid-del")
            .set("Authorization", adminToken());

        expect(mockDeleteUser).toHaveBeenCalledWith("uid-del");
    });

    test("✅ User document is deleted from Firestore", async () => {
        const mockRef = { delete: () => mockDocDelete("users", "uid-del") };
        mockLookupUser.mockResolvedValue({ snap: { exists: true, data: () => ({ role: "applicant" }) }, ref: mockRef, role: "applicant" });
        await request(app)
            .delete("/api/admin/users/uid-del")
            .set("Authorization", adminToken());

        expect(mockDocDelete).toHaveBeenCalledWith("users", "uid-del");
    });

    test("❌ Admin cannot delete their own account", async () => {
        mockVerifyIdToken.mockResolvedValue({ uid: "admin-uid", role: "admin" });
        const res = await request(app)
            .delete("/api/admin/users/admin-uid")
            .set("Authorization", "Bearer admin-tok");

        expect(res.status).toBe(400);
        expect(res.body.error).toBe("Admins cannot delete their own account");
    });

    test("❌ 404 when user does not exist", async () => {
        // Default mockLookupUser returns null → 404
        const res = await request(app)
            .delete("/api/admin/users/ghost")
            .set("Authorization", adminToken());
        expect(res.status).toBe(404);
        expect(res.body.error).toBe("User not found");
    });

    test("❌ Provider cannot delete users — 403", async () => {
        const res = await request(app)
            .delete("/api/admin/users/u1")
            .set("Authorization", providerToken());
        expect(res.status).toBe(403);
    });

    test("❌ Applicant cannot delete users — 403", async () => {
        const res = await request(app)
            .delete("/api/admin/users/u1")
            .set("Authorization", applicantToken());
        expect(res.status).toBe(403);
    });

    test("❌ Unauthenticated returns 401", async () => {
        const res = await request(app).delete("/api/admin/users/u1");
        expect(res.status).toBe(401);
    });

    test("❌ Firebase Auth deleteUser failure returns 500", async () => {
        mockVerifyIdToken.mockResolvedValue({ uid: "admin-uid", role: "admin" });
        const mockRef = { delete: jest.fn().mockResolvedValue() };
        mockLookupUser.mockResolvedValue({ snap: { exists: true, data: () => ({ role: "applicant" }) }, ref: mockRef, role: "applicant" });
        mockDeleteUser.mockRejectedValue(new Error("Firebase delete failed"));
        const res = await request(app)
            .delete("/api/admin/users/uid-del")
            .set("Authorization", "Bearer admin-tok");
        expect(res.status).toBe(500);
        expect(res.body.error).toBe("Failed to delete user");
    });

    test("❌ Firestore delete failure returns 500", async () => {
        mockVerifyIdToken.mockResolvedValue({ uid: "admin-uid", role: "admin" });
        const mockRef = { delete: jest.fn().mockRejectedValue(new Error("Firestore delete failed")) };
        mockLookupUser.mockResolvedValue({ snap: { exists: true, data: () => ({ role: "applicant" }) }, ref: mockRef, role: "applicant" });
        mockDeleteUser.mockResolvedValue();
        mockDocDelete.mockRejectedValue(new Error("Firestore delete failed"));
        const res = await request(app)
            .delete("/api/admin/users/uid-del")
            .set("Authorization", "Bearer admin-tok");
        expect(res.status).toBe(500);
        expect(res.body.error).toBe("Failed to delete user");
    });
});
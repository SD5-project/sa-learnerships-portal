// ─── Role → Allowed Routes ───────────────────────────────────────────────────
const rolePermissions = {
    'applicant': [
         '/applicant-home',
        '/api/listings',  // 
        '/listing-info',

    ],
    'provider': [
        '/api/listings',
        '/provider-home',
        '/create-opportunity',
        '/api/applicants',
        '/api/opportunities/submit'   // ✅ allows provider to submit opportunities
    ],
    'admin': [
        '/api/listings',
        '/admin-dashboard',
        '/create-opportunity',
        '/api/applicants',
        '/api/opportunities/submit',
        '/api/admin/listings', 
        '/api/admin/users'   // ✅ admin can also submit
    ]
};

/**
 * Returns true if the given user's role is allowed to access the given route.
 * @param {{ role: string }} user
 * @param {string} route
 */
function authorize(user, route) {
    if (!user || !user.role) return false;
    const allowed = rolePermissions[user.role.toLowerCase()];
    if (!allowed) return false;
    return allowed.includes(route);
}

module.exports = { authorize };




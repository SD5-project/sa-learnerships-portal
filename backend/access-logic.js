/**
 * access-logic.js
 * Role-based route authorisation.
 *
 * Each role has an explicit allowlist of routes it may access.
 * Routes not in the list are forbidden for that role.
 * The guard() middleware in app.js uses authorize() to enforce this.
 */

/** Maps each role to the set of routes it is permitted to access. */
const rolePermissions = {
    applicant: [
        '/applicant-home',
        '/api/listings',
        '/listing-info',
    ],
    provider: [
        '/api/listings',
        '/provider-home',
        '/create-opportunity',
        '/api/applicants',
        '/api/opportunities/submit',
    ],
    admin: [
        '/api/listings',
        '/admin-dashboard',
        '/api/applicants',
        '/api/opportunities/submit',
        '/create-opportunity',
        '/api/admin/listings',
        '/api/admin/users',
    ]
};

/**
 * Returns true if the user's role is allowed to access the given route.
 *
 * @param {{ role: string }} user  - The authenticated user object (from req.user).
 * @param {string}           route - The route path to check against the allowlist.
 * @returns {boolean}
 */
function authorize(user, route) {
    if (!user || !user.role) return false;

    const allowed = rolePermissions[user.role.toLowerCase()];
    if (!allowed) return false;

    return allowed.includes(route);
}

module.exports = { authorize };

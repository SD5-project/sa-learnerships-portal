// Shared state manager for the multi-step signup flow.
// All pages in the flow read/write through this module.

const KEY = 'sc_signup';

export function getState() {
    try {
        return JSON.parse(sessionStorage.getItem(KEY) || '{}');
    } catch {
        return {};
    }
}

export function setState(partial) {
    const current = getState();
    sessionStorage.setItem(KEY, JSON.stringify({ ...current, ...partial }));
}

export function clearState() {
    sessionStorage.removeItem(KEY);
}

// Redirects to role-select page if no role is set or if the role doesn't match.
export function requireRole(expectedRole) {
    const { role } = getState();
    if (!role || role !== expectedRole) {
        window.location.href = 'signup-role-select.html';
        return false;
    }
    return true;
}

// Redirects to login if there's no authenticated UID in state.
export function requireAuth() {
    const { uid } = getState();
    if (!uid) {
        window.location.href = 'signup-role-select.html';
        return false;
    }
    return true;
}

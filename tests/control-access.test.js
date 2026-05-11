const assert = require('assert');
const { authorize } = require('../backend/access-logic');

// =============================================================================
// Access Control Tests (Mocha)
// These test the authorize() function that guards every route in app.js
// =============================================================================
describe('Access Control Tests', () => {

    // ── Applicant: Granted ────────────────────────────────────────────────────
    it('authorize_applicant_accessToApplicantHomeGranted', () => {
        const user = { role: 'applicant' };
        assert.strictEqual(authorize(user, '/applicant-home'), true);
    });

    it('authorize_applicant_accessToListingsGranted', () => {
        const user = { role: 'applicant' };
        assert.strictEqual(authorize(user, '/api/listings'), true);
    });

    // ── Applicant: Denied ─────────────────────────────────────────────────────
    it('authorize_applicant_accessToAdminDenied', () => {
        const user = { role: 'applicant' };
        assert.strictEqual(authorize(user, '/admin-dashboard'), false);
    });

    it('authorize_applicant_accessToProviderHomeDenied', () => {
        const user = { role: 'applicant' };
        assert.strictEqual(authorize(user, '/provider-home'), false);
    });

    it('authorize_applicant_accessToCreateOpportunityDenied', () => {
        const user = { role: 'applicant' };
        assert.strictEqual(authorize(user, '/create-opportunity'), false);
    });

    it('authorize_applicant_accessToApiApplicantsDenied', () => {
        const user = { role: 'applicant' };
        assert.strictEqual(authorize(user, '/api/applicants'), false);
    });

    // ── Provider: Granted ─────────────────────────────────────────────────────
    it('authorize_provider_accessToProviderHomeGranted', () => {
        const user = { role: 'provider' };
        assert.strictEqual(authorize(user, '/provider-home'), true);
    });

    it('authorize_provider_accessToListingsGranted', () => {
        const user = { role: 'provider' };
        assert.strictEqual(authorize(user, '/api/listings'), true);
    });

    it('authorize_provider_accessToCreateOpportunityGranted', () => {
        const user = { role: 'provider' };
        assert.strictEqual(authorize(user, '/create-opportunity'), true);
    });

    it('authorize_provider_accessToApiApplicantsGranted', () => {
        const user = { role: 'provider' };
        assert.strictEqual(authorize(user, '/api/applicants'), true);
    });

    // ── Provider: Denied ──────────────────────────────────────────────────────
    it('authorize_provider_accessToApplicantHomeDenied', () => {
        const user = { role: 'provider' };
        assert.strictEqual(authorize(user, '/applicant-home'), false);
    });

    it('authorize_provider_accessToAdminDenied', () => {
        const user = { role: 'provider' };
        assert.strictEqual(authorize(user, '/admin-dashboard'), false);
    });

    // ── Admin: Granted ────────────────────────────────────────────────────────
    it('authorize_admin_accessToAdminDashboardGranted', () => {
        const user = { role: 'admin' };
        assert.strictEqual(authorize(user, '/admin-dashboard'), true);
    });

    it('authorize_admin_accessToListingsGranted', () => {
        const user = { role: 'admin' };
        assert.strictEqual(authorize(user, '/api/listings'), true);
    });

    it('authorize_admin_accessToCreateOpportunityGranted', () => {
        const user = { role: 'admin' };
        assert.strictEqual(authorize(user, '/create-opportunity'), true);
    });

    it('authorize_admin_accessToApiOpportunitiesSubmitGranted', () => {
        const user = { role: 'admin' };
        assert.strictEqual(authorize(user, '/api/opportunities/submit'), true);
    });

    // ── Admin: Denied ─────────────────────────────────────────────────────────
    it('authorize_admin_accessToProviderHomeDenied', () => {
        const user = { role: 'admin' };
        assert.strictEqual(authorize(user, '/provider-home'), false);
    });

    it('authorize_admin_accessToApplicantHomeDenied', () => {
        const user = { role: 'admin' };
        assert.strictEqual(authorize(user, '/applicant-home'), false);
    });

    // ── Edge Cases ────────────────────────────────────────────────────────────
    it('authorize_nullUser_denied', () => {
        assert.strictEqual(authorize(null, '/api/listings'), false);
    });

    it('authorize_noRole_denied', () => {
        assert.strictEqual(authorize({}, '/api/listings'), false);
    });

    it('authorize_unknownRole_denied', () => {
        assert.strictEqual(authorize({ role: 'unknown' }, '/api/listings'), false);
    });
});




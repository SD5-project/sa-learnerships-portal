// Mocha test — uses require directly, no mocks needed
const { authorize } = require('../../backend/access-logic');

describe('Access Control Tests', () => {

    it('authorize_applicant_accessToAdminDenied', () => {
        expect(authorize({ role: 'applicant' }, '/admin-dashboard')).toBe(false);
    });

    it('authorize_applicant_accessToProviderDenied', () => {
        expect(authorize({ role: 'applicant' }, '/provider-home')).toBe(false);
    });

    it('authorize_provider_accessToApplicantDenied', () => {
        expect(authorize({ role: 'provider' }, '/applicant-home')).toBe(false);
    });

    it('authorize_provider_accessToAdminDenied', () => {
        expect(authorize({ role: 'provider' }, '/admin-dashboard')).toBe(false);
    });

    it('authorize_admin_accessToProviderPageDenied', () => {
        expect(authorize({ role: 'admin' }, '/provider-home')).toBe(false);
    });

    it('authorize_admin_accessToApplicantPageDenied', () => {
        expect(authorize({ role: 'admin' }, '/applicant-home')).toBe(false);
    });

    it('authorize_admin_accessToAdminDashboardGranted', () => {
        expect(authorize({ role: 'admin' }, '/admin-dashboard')).toBe(true);
    });

    it('authorize_provider_accessToProviderPageGranted', () => {
        expect(authorize({ role: 'provider' }, '/provider-home')).toBe(true);
    });

    it('authorize_applicant_accessToApplicantPageGranted', () => {
        expect(authorize({ role: 'applicant' }, '/applicant-home')).toBe(true);
    });
});

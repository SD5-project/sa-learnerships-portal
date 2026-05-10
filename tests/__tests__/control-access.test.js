const { authorize } = require('../../backend/access-logic');

describe('Access Control Tests', () => {
    
    test('authorize_applicant_accessToAdminDenied', () => {
        const user = { role: 'applicant' };
        const route = '/admin-dashboard';

        const result = authorize(user, route);

        // 2. Change assert.strictEqual to expect().toBe()
        expect(result).toBe(false); 
    });

    test('authorize_applicant_accessToProviderDenied', () => {
        const user = { role: 'applicant' };
        const route = '/provider-home';
        expect(authorize(user, route)).toBe(false); 
    });

    test('authorize_provider_accessToApplicantDenied', () => {
        const user = { role: 'provider' };
        const route = '/applicant-home';
        expect(authorize(user, route)).toBe(false); 
    });
    
    test('authorize_provider_accessToAdminDenied', () => {
        const user = { role: 'provider' };
        const route = '/admin-dashboard';
        expect(authorize(user, route)).toBe(false); 
    });

    test('authorize_admin_accessToProviderPageDenied', () => {
        const user = { role: 'admin' };
        const route = '/provider-home';
        expect(authorize(user, route)).toBe(false); 
    });

    test('authorize_admin_accessToApplicantPageDenied', () => {
        const user = { role: 'admin' };
        const route = '/applicant-home';
        expect(authorize(user, route)).toBe(false); 
    });
    
    test('authorize_admin_accessToAdminDashboardGranted', () => {
        const user = { role: 'admin' };
        expect(authorize(user, '/admin-dashboard')).toBe(true);
    });

    test('authorize_provider_accessToProviderPageGranted', () => {
        const user = { role: 'provider' };
        expect(authorize(user, '/provider-home')).toBe(true);
    });

    test('authorize_applicant_accessToApplicantPageGranted', () => {
        const user = { role: 'applicant' };
        expect(authorize(user, '/applicant-home')).toBe(true);
    });
});
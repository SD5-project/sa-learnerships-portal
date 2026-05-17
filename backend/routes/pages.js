const express = require('express');
const path    = require('path');

const router = express.Router();

// Helper to send an HTML file from the frontend directory
function page(filename) {
    return (req, res) =>
        res.sendFile(path.join(__dirname, '..', '..', 'frontend', filename));
}

// ─── Static Page Routes ───────────────────────────────────────────────────────
router.get(['/signup', '/signup.html'],                    page('signup.html'));
router.get('/signup-role-select',                          page('signup-role-select.html'));
router.get('/applicant-signup-identity',                   page('applicant-signup-identity.html'));
router.get('/applicant-signup-details',                    page('applicant-signup-details.html'));
router.get('/applicant-signup-qualifications',             page('applicant-signup-qualifications.html'));
router.get('/applicant-signup-password',                    page('applicant-signup-password.html'));
router.get('/applicant-signup-cv',                         page('applicant-signup-cv.html'));
router.get('/provider-signup-identity',                    page('provider-signup-identity.html'));
router.get('/provider-signup-password',                    page('provider-signup-password.html'));
router.get('/provider-signup-details',                     page('provider-signup-details.html'));
router.get('/provider-signup-portfolio',                   page('provider-signup-portfolio.html'));
router.get('/provider-signup-dhet',                        page('provider-signup-dhet.html'));
router.get('/provider-signup-dept-learnerships',           page('provider-signup-dept-learnerships.html'));
router.get('/provider-signup-dept-apprenticeships',        page('provider-signup-dept-apprenticeships.html'));
router.get('/provider-signup-dept-internships',            page('provider-signup-dept-internships.html'));
router.get('/listing-info',                                page('listing-info.html'));
router.get('/create-opportunity',                          page('create-opportunity.html'));
router.get('/applicant-home',                              page('applicant-home.html'));
router.get('/applications-page',                           page('applications-page.html'));
router.get('/applicants',                                  page('applicants.html'));
router.get('/admin-dashboard',                             page('admin-dashboard.html'));
router.get('/provider-home',                               page('provider-home.html'));
router.get('/listings',                                    page('listings.html'));
router.get('/',                                            page('index.html'));

module.exports = router;

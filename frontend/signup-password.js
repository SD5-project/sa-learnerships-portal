// Shared password page — used by both applicant and provider signup flows.

import { auth } from './firebase.js';
import {
    EmailAuthProvider,
    linkWithCredential,
    createUserWithEmailAndPassword
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { SignupBuilder } from './SignupBuilder.js';

const builder    = SignupBuilder.load();
const role       = document.body.dataset.role;
const authMethod = builder?.authMethod;

if (!authMethod) {
    window.location.href = `${role}-signup-identity.html`;
    throw new Error('no authMethod in state');
}

const emailField   = document.getElementById('email-field');
const emailEl      = document.getElementById('email');
const passwordEl   = document.getElementById('password');
const confirmEl    = document.getElementById('confirm-password');
const nextBtn      = document.getElementById('next-btn');
const errorBox     = document.getElementById('global-error');
const subheading   = document.getElementById('page-subheading');
const emailErrorEl = document.getElementById('email-error');
const passErrorEl  = document.getElementById('password-error');
const confirmErrEl = document.getElementById('confirm-error');

if (authMethod === 'google') {
    emailField.style.display = 'none';
    subheading.textContent =
        'Your Google account is connected. Create a SkillsConnect password so you can also log in with your email.';
}

function showFieldError(el, msg) { el.textContent = msg; el.classList.add('visible'); }
function clearFieldError(el)     { el.textContent = '';  el.classList.remove('visible'); }

function validateInputs() {
    let valid = true;
    clearFieldError(emailErrorEl);
    clearFieldError(passErrorEl);
    clearFieldError(confirmErrEl);

    const email    = authMethod === 'google' ? builder.email : emailEl.value.trim();
    const password = passwordEl.value;
    const confirm  = confirmEl.value;

    if (authMethod !== 'google' && (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
        showFieldError(emailErrorEl, 'Please enter a valid email address.');
        valid = false;
    }

    if (password.length < 9) {
        showFieldError(passErrorEl, 'Password must be at least 9 characters.');
        valid = false;
    } else if (password === email) {
        showFieldError(passErrorEl, 'Password must not be the same as your email.');
        valid = false;
    }

    if (confirm !== password) {
        showFieldError(confirmErrEl, 'Passwords do not match.');
        valid = false;
    }

    return valid;
}

nextBtn.addEventListener('click', async () => {
    errorBox.classList.remove('visible');
    if (!validateInputs()) return;

    nextBtn.disabled    = true;
    nextBtn.textContent = 'Setting up…';

    // Google users have their email from the identity page; email users type it in.
    const email    = authMethod === 'google' ? builder.email : emailEl.value.trim();
    const password = passwordEl.value;

    try {
        if (authMethod === 'google') {
            const user       = auth.currentUser;
            const credential = EmailAuthProvider.credential(email, password);
            await linkWithCredential(user, credential);
        } else {
            // Check uniqueness before proceeding — also cleans up any ghost accounts.
            const checkRes  = await fetch(`/api/check-email?email=${encodeURIComponent(email)}`);
            const checkData = await checkRes.json();
            if (checkData.exists) {
                errorBox.textContent = 'An account with this email already exists. Please log in instead.';
                errorBox.classList.add('visible');
                nextBtn.disabled    = false;
                nextBtn.textContent = 'Next →';
                return;
            }

            // Defer Firebase account creation to save() — no ghost accounts if they abandon.
            builder.setPassword(email, password);
        }

        window.location.href = role === 'applicant'
            ? 'applicant-signup-details.html'
            : 'provider-signup-details.html';

    } catch (err) {
        console.error('Password setup error:', err);

        const messages = {
            'auth/email-already-in-use':      'An account with this email already exists. Try logging in instead.',
            'auth/credential-already-in-use': 'This email already has a password set. Try logging in.',
            'auth/weak-password':             'Password is too weak. Use at least 9 characters.',
            'auth/invalid-email':             'Please enter a valid email address.',
            'auth/requires-recent-login':     'Session expired. Please start sign-up again.'
        };

        errorBox.textContent = messages[err.code] || 'Something went wrong. Please try again.';
        errorBox.classList.add('visible');
        nextBtn.disabled    = false;
        nextBtn.textContent = 'Next →';
    }
});

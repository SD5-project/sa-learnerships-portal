// Shared password page — used by both applicant and provider signup flows.

import { auth } from './firebase.js';
import {
    EmailAuthProvider,
    linkWithCredential,
    createUserWithEmailAndPassword,
    sendEmailVerification
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

// ── Verification pending UI (shown after sending the verification email) ─────
const verifyPanel = document.createElement('div');
verifyPanel.id = 'verify-panel';
verifyPanel.style.display = 'none';
verifyPanel.innerHTML = `
    <p id="verify-msg" style="margin-bottom:16px;"></p>
    <div class="verify-actions" style="display:flex;flex-direction:column;gap:10px;">
        <button class="btn-next" id="verified-btn" style="width:100%;">I've verified my email →</button>
        <button class="btn-back" id="resend-btn" style="width:100%;text-align:center;">Resend email</button>
    </div>
`;
nextBtn.parentElement.insertAdjacentElement('afterend', verifyPanel);

const verifyMsgEl  = verifyPanel.querySelector('#verify-msg');
const verifiedBtn  = verifyPanel.querySelector('#verified-btn');
const resendBtn    = verifyPanel.querySelector('#resend-btn');

function showVerifyPanel(email) {
    // Hide the form fields and the original Next button row
    document.querySelectorAll('.signup-field, .signup-actions, #page-subheading').forEach(el => {
        el.style.display = 'none';
    });
    verifyMsgEl.textContent =
        `A verification link has been sent to ${email}. Click the link in that email, then press the button below.`;
    verifyPanel.style.display = '';
}

nextBtn.addEventListener('click', async () => {
    errorBox.classList.remove('visible');
    if (!validateInputs()) return;

    nextBtn.disabled    = true;
    nextBtn.textContent = 'Setting up…';

    const email    = authMethod === 'google' ? builder.email : emailEl.value.trim();
    const password = passwordEl.value;

    try {
        if (authMethod === 'google') {
            const user       = auth.currentUser;
            const credential = EmailAuthProvider.credential(email, password);
            await linkWithCredential(user, credential);
            window.location.href = role === 'applicant'
                ? 'applicant-signup-details.html'
                : 'provider-signup-details.html';
            return;
        }

        // Email path — check uniqueness first
        const checkRes  = await fetch(`/api/check-email?email=${encodeURIComponent(email)}`);
        const checkData = await checkRes.json();
        if (checkData.exists) {
            errorBox.textContent = 'An account with this email already exists. Please log in instead.';
            errorBox.classList.add('visible');
            nextBtn.disabled    = false;
            nextBtn.textContent = 'Next →';
            return;
        }

        // Create the Firebase account now so we can send a real verification email
        const credential = await createUserWithEmailAndPassword(auth, email, password);
        const user       = credential.user;
        await sendEmailVerification(user, {
            url: `${window.location.origin}/email-verified`
        });

        // Store uid so subsequent pages know the account is ready
        builder.setIdentity({ uid: user.uid, email, authMethod: 'email' });

        showVerifyPanel(email);

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

// ── "I've verified my email" button ──────────────────────────────────────────
verifiedBtn.addEventListener('click', async () => {
    verifiedBtn.disabled    = true;
    verifiedBtn.textContent = 'Checking…';
    errorBox.classList.remove('visible');

    try {
        await auth.currentUser.reload();
        if (!auth.currentUser.emailVerified) {
            errorBox.textContent = 'Email not verified yet. Please click the link in your inbox, then try again.';
            errorBox.classList.add('visible');
            verifiedBtn.disabled    = false;
            verifiedBtn.textContent = 'I\'ve verified my email →';
            return;
        }
        window.location.href = role === 'applicant'
            ? 'applicant-signup-details.html'
            : 'provider-signup-details.html';
    } catch (err) {
        errorBox.textContent = 'Something went wrong. Please try again.';
        errorBox.classList.add('visible');
        verifiedBtn.disabled    = false;
        verifiedBtn.textContent = 'I\'ve verified my email →';
    }
});

// ── Resend button ─────────────────────────────────────────────────────────────
resendBtn.addEventListener('click', async () => {
    resendBtn.disabled    = true;
    resendBtn.textContent = 'Sending…';
    errorBox.classList.remove('visible');

    try {
        await sendEmailVerification(auth.currentUser);
        resendBtn.textContent = 'Sent!';
        setTimeout(() => {
            resendBtn.disabled    = false;
            resendBtn.textContent = 'Resend email';
        }, 5000);
    } catch (err) {
        errorBox.textContent = 'Could not resend. Please wait a moment and try again.';
        errorBox.classList.add('visible');
        resendBtn.disabled    = false;
        resendBtn.textContent = 'Resend email';
    }
});

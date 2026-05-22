import { auth } from './firebase.js';
import {
    applyActionCode,
    onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { SignupBuilder } from './SignupBuilder.js';

const params  = new URLSearchParams(window.location.search);
const mode    = params.get('mode');
const oobCode = params.get('oobCode');

const headingEl   = document.getElementById('heading');
const messageEl   = document.getElementById('message');
const errorBox    = document.getElementById('global-error');
const actionEl    = document.getElementById('action');
const continueBtn = document.getElementById('continue-btn');

function showContinue() {
    headingEl.textContent = 'Email Verified!';
    messageEl.textContent = 'Your email address has been confirmed.';

    const builder = SignupBuilder.load();
    if (builder?.role) {
        continueBtn.textContent = 'Continue sign-up →';
        continueBtn.onclick = () => {
            window.location.href = builder.role === 'applicant'
                ? 'applicant-signup-details.html'
                : 'provider-signup-details.html';
        };
    } else {
        // Signup state not present — link was opened in a different tab.
        // Verification already happened above; just guide them back.
        messageEl.textContent =
            'Your email has been verified! Go back to your sign-up tab and press ' +
            '"I\'ve verified my email →" to continue.';
        continueBtn.textContent = 'Back to sign-up →';
        continueBtn.onclick = () => { window.location.href = 'signup-role-select.html'; };
    }
    actionEl.style.display = '';
}

function showError(msg) {
    headingEl.textContent = 'Verification Failed';
    messageEl.textContent = '';
    errorBox.textContent  = msg;
    errorBox.classList.add('visible');

    continueBtn.textContent = '← Back to sign-up';
    continueBtn.onclick = () => { window.history.back(); };
    actionEl.style.display = '';
}

async function run() {
    if (mode === 'verifyEmail' && oobCode) {
        // This page is configured as the Firebase action handler.
        // Process the code directly so we control the whole experience.
        try {
            await applyActionCode(auth, oobCode);
            if (auth.currentUser) await auth.currentUser.reload();
            showContinue();
        } catch (err) {
            const messages = {
                'auth/invalid-action-code': 'This link has already been used or has expired. Return to sign-up to request a new one.',
                'auth/expired-action-code': 'This verification link has expired. Return to sign-up to request a new one.',
                'auth/user-disabled':       'This account has been disabled. Please contact support.'
            };
            showError(messages[err.code] || 'Verification failed. Please try again.');
        }
        return;
    }

    // No action code in the URL — arrived via continueUrl after Firebase's default
    // action page already processed the verification. Just confirm the status.
    onAuthStateChanged(auth, async (user) => {
        if (!user) {
            headingEl.textContent = 'Session Expired';
            messageEl.textContent = 'Your session has expired. Please return to your sign-up tab.';
            continueBtn.textContent = 'Back to sign-up →';
            continueBtn.onclick = () => { window.location.href = 'signup-role-select.html'; };
            actionEl.style.display = '';
            return;
        }
        try {
            await user.reload();
            if (auth.currentUser.emailVerified) {
                showContinue();
            } else {
                showError('Email not verified yet. Please return to your sign-up tab and click the link in your inbox.');
            }
        } catch {
            showError('Something went wrong. Please try again.');
        }
    });
}

run();

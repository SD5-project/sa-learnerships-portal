import { auth } from './firebase.js';
import {
    GoogleAuthProvider,
    signInWithPopup,
    signOut
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { SignupBuilder } from './SignupBuilder.js';

if (!SignupBuilder.requireRole('provider')) throw new Error('role check failed');

const builder   = SignupBuilder.load();
const errorBox  = document.getElementById('global-error');
const googleBtn = document.getElementById('google-btn');
const emailBtn  = document.getElementById('email-btn');

function showError(msg) {
    errorBox.textContent = msg;
    errorBox.classList.add('visible');
}

googleBtn.addEventListener('click', async () => {
    googleBtn.disabled = true;
    errorBox.classList.remove('visible');

    try {
        const result      = await signInWithPopup(auth, new GoogleAuthProvider());
        const user        = result.user;
        const tokenResult = await user.getIdTokenResult(true);

        const alreadyRegistered = tokenResult.claims.role ||
            await fetch(`/api/check-email?email=${encodeURIComponent(user.email)}`)
                .then(r => r.json())
                .then(d => d.exists);

        if (alreadyRegistered) {
            await signOut(auth);
            showError('This email is already registered. Please use a different Google account or log in instead.');
            googleBtn.disabled = false;
            return;
        }

        builder.setIdentity({ uid: user.uid, email: user.email, authMethod: 'google' });
        localStorage.setItem('token', await user.getIdToken());
        window.location.href = 'provider-signup-password.html';

    } catch (err) {
        console.error('Google sign-in error:', err);
        showError('Sign-in failed. Please try again.');
        googleBtn.disabled = false;
    }
});

emailBtn.addEventListener('click', () => {
    builder.setIdentity({ authMethod: 'email' });
    window.location.href = 'provider-signup-password.html';
});

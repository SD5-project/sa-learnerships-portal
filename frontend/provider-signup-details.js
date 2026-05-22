import { SignupBuilder } from './SignupBuilder.js';
import { checkPhoneExists } from './api.js';
import { auth } from './firebase.js';

if (!SignupBuilder.requireRole('provider') || !SignupBuilder.requireAuth()) throw new Error('guard failed');

const builder = SignupBuilder.load();

const areaCodes = { '+27': 9, '+1': 10, '+44': 10, '+91': 10, '+61': 9 };

const orgNameEl    = document.getElementById('orgName');
const cityEl       = document.getElementById('city');
const phoneEl      = document.getElementById('phone');
const areaCodeEl   = document.getElementById('areaCode');
const nextBtn      = document.getElementById('next-btn');
const errorBox     = document.getElementById('global-error');
const phoneErrorEl = document.getElementById('phoneError');
const cityErrorEl  = document.getElementById('cityError');

function showFieldError(el, msg) {
    el.textContent = msg;
    el.classList.add('visible');
}

function clearFieldError(el) {
    el.textContent = '';
    el.classList.remove('visible');
}

function validatePhone(value, code) {
    return /^\d+$/.test(value) && value.length === (areaCodes[code] ?? 9);
}

phoneEl.addEventListener('input', () => {
    if (phoneEl.value && !validatePhone(phoneEl.value, areaCodeEl.value)) {
        showFieldError(phoneErrorEl, `Must be exactly ${areaCodes[areaCodeEl.value] ?? 9} digits.`);
    } else {
        clearFieldError(phoneErrorEl);
    }
});

areaCodeEl.addEventListener('change', () => {
    if (phoneEl.value) phoneEl.dispatchEvent(new Event('input'));
});

nextBtn.addEventListener('click', async () => {
    errorBox.classList.remove('visible');
    clearFieldError(phoneErrorEl);

    const orgName  = orgNameEl.value.trim();
    const city     = cityEl.value.trim();
    const phone    = phoneEl.value.trim();
    const areaCode = areaCodeEl.value;

    if (!orgName || !city || !phone) {
        errorBox.textContent = 'Please fill in all fields.';
        errorBox.classList.add('visible');
        return;
    }

    if (!validatePhone(phone, areaCode)) {
        showFieldError(phoneErrorEl, `Must be exactly ${areaCodes[areaCode] ?? 9} digits.`);
        return;
    }

    nextBtn.disabled    = true;
    nextBtn.textContent = 'Checking...';

    const phoneTaken = await checkPhoneExists(areaCode + phone);

    if (phoneTaken) {
        nextBtn.disabled    = false;
        nextBtn.textContent = 'Sign Up →';
        showFieldError(phoneErrorEl, 'An account with this phone number already exists.');
        return;
    }

    nextBtn.textContent = 'Creating account…';

    try {
        builder.setDetails({ organization: orgName, city, phonenumber: areaCode + phone });

        // save() creates the Firebase account (email path) and writes to Firestore atomically.
        const savedUser = await builder.save();

        const freshToken = await savedUser.getIdToken(true); // refresh to pick up new role claim
        localStorage.setItem('token', freshToken);
        window.location.href = '/provider-home';

    } catch (err) {
        console.error('Provider submit error:', err);
        errorBox.textContent = err.message || 'Something went wrong. Please try again.';
        errorBox.classList.add('visible');
        nextBtn.disabled    = false;
        nextBtn.textContent = 'Sign Up →';
    }
});

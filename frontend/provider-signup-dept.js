// Shared JS for all three department detail pages.
// Each page sets data-dept on <body> to identify which department is being configured.

import { requireRole, requireAuth, getState, setState } from './signup-state.js';
import { auth } from './firebase.js';

if (!requireRole('provider') || !requireAuth()) throw new Error('guard failed');

const deptKey   = document.body.dataset.dept;
const areaCodes = { '+27': 9, '+1': 10, '+44': 10, '+91': 10, '+61': 9 };

const phoneEl      = document.getElementById('dept-phone');
const areaCodeEl   = document.getElementById('area-code');
const emailEl      = document.getElementById('dept-email');
const nextBtn      = document.getElementById('next-btn');
const backBtn      = document.getElementById('back-btn');
const errorBox     = document.getElementById('global-error');
const phoneErrorEl = document.getElementById('phone-error');
const emailErrorEl = document.getElementById('email-error');

function showFieldError(el, msg) { el.textContent = msg; el.classList.add('visible'); }
function clearFieldError(el)     { el.textContent = '';  el.classList.remove('visible'); }

function validatePhone(value, code) {
    return /^\d+$/.test(value) && value.length === (areaCodes[code] ?? 9);
}

function validateEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
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

emailEl.addEventListener('input', () => {
    if (emailEl.value && !validateEmail(emailEl.value)) {
        showFieldError(emailErrorEl, 'Please enter a valid email address.');
    } else {
        clearFieldError(emailErrorEl);
    }
});

backBtn.addEventListener('click', () => {
    const { pageSequence = [], pageSequenceIdx = 0 } = getState();
    const prevIdx = pageSequenceIdx - 1;
    setState({ pageSequenceIdx: Math.max(0, prevIdx) });
    window.location.href = prevIdx >= 0
        ? pageSequence[prevIdx]
        : 'provider-signup-portfolio.html';
});

nextBtn.addEventListener('click', async () => {
    errorBox.classList.remove('visible');
    clearFieldError(phoneErrorEl);
    clearFieldError(emailErrorEl);

    const phone    = phoneEl.value.trim();
    const areaCode = areaCodeEl.value;
    const email    = emailEl.value.trim();
    let valid      = true;

    if (!phone) {
        showFieldError(phoneErrorEl, 'Phone number is required.');
        valid = false;
    } else if (!validatePhone(phone, areaCode)) {
        showFieldError(phoneErrorEl, `Must be exactly ${areaCodes[areaCode] ?? 9} digits.`);
        valid = false;
    }

    if (!email) {
        showFieldError(emailErrorEl, 'Email address is required.');
        valid = false;
    } else if (!validateEmail(email)) {
        showFieldError(emailErrorEl, 'Please enter a valid email address.');
        valid = false;
    }

    if (!valid) return;

    // Merge phone + email into the correct department entry.
    const state       = getState();
    const departments = { ...state.departments };
    departments[deptKey] = { ...departments[deptKey], phone: areaCode + phone, email };
    setState({ departments });

    const { pageSequence = [], pageSequenceIdx = 0 } = state;
    const nextIdx  = pageSequenceIdx + 1;
    const nextPage = pageSequence[nextIdx];
    setState({ pageSequenceIdx: nextIdx });

    if (nextPage) {
        window.location.href = nextPage;
    } else {
        await submitProvider();
    }
});

async function submitProvider() {
    nextBtn.disabled    = true;
    nextBtn.textContent = 'Creating account…';

    const state = getState();
    const user  = auth.currentUser;

    if (!user) {
        errorBox.textContent = 'Session expired. Please start again.';
        errorBox.classList.add('visible');
        nextBtn.disabled    = false;
        nextBtn.textContent = 'Next →';
        return;
    }

    try {
        const token = await user.getIdToken();

        const res = await fetch('/signup/provider', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({
                uid:          user.uid,
                organization: state.organization,
                email:        state.email,
                phonenumber:  state.phonenumber,
                departments:  state.departments || {}
            })
        });

        const data = await res.json();

        if (!res.ok) {
            errorBox.textContent = data.error || 'Sign-up failed. Please try again.';
            errorBox.classList.add('visible');
            nextBtn.disabled    = false;
            nextBtn.textContent = 'Next →';
            return;
        }

        await user.getIdToken(true);
        const { clearState } = await import('./signup-state.js');
        clearState();
        window.location.href = '/provider-home';

    } catch (err) {
        console.error('Provider submit error:', err);
        errorBox.textContent = 'Something went wrong. Please try again.';
        errorBox.classList.add('visible');
        nextBtn.disabled    = false;
        nextBtn.textContent = 'Next →';
    }
}

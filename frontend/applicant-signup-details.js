import { SignupBuilder } from './SignupBuilder.js';
import { checkIdNumberExists, checkPhoneExists } from './api.js';

if (!SignupBuilder.requireRole('applicant') || !SignupBuilder.requireAuth()) throw new Error('guard failed');

const builder = SignupBuilder.load();

const areaCodes = { '+27': 9, '+1': 10, '+44': 10, '+91': 10, '+61': 9 };

const firstNameEl  = document.getElementById('firstName');
const lastNameEl   = document.getElementById('lastName');
const idNumberEl   = document.getElementById('idNumber');
const phoneEl      = document.getElementById('phone');
const areaCodeEl   = document.getElementById('areaCode');
const nextBtn      = document.getElementById('next-btn');
const errorBox     = document.getElementById('global-error');
const idErrorEl    = document.getElementById('idError');
const phoneErrorEl = document.getElementById('phoneError');

function showFieldError(el, msg) {
    el.textContent = msg;
    el.classList.add('visible');
}

function clearFieldError(el) {
    el.textContent = '';
    el.classList.remove('visible');
}

function validateSAId(value) {
    return /^\d{13}$/.test(value);
}

function validatePhone(value, code) {
    if (!/^\d+$/.test(value)) return false;
    return value.length === (areaCodes[code] ?? 9);
}

idNumberEl.addEventListener('input', () => {
    if (idNumberEl.value && !validateSAId(idNumberEl.value)) {
        showFieldError(idErrorEl, 'SA ID must be exactly 13 digits.');
    } else {
        clearFieldError(idErrorEl);
    }
});

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
    clearFieldError(idErrorEl);
    clearFieldError(phoneErrorEl);

    const firstName = firstNameEl.value.trim();
    const lastName  = lastNameEl.value.trim();
    const idNumber  = idNumberEl.value.trim();
    const phone     = phoneEl.value.trim();
    const areaCode  = areaCodeEl.value;

    if (!firstName || !lastName || !idNumber || !phone) {
        errorBox.textContent = 'Please fill in all fields.';
        errorBox.classList.add('visible');
        return;
    }

    if (!validateSAId(idNumber)) {
        showFieldError(idErrorEl, 'SA ID must be exactly 13 digits.');
        return;
    }

    if (!validatePhone(phone, areaCode)) {
        showFieldError(phoneErrorEl, `Must be exactly ${areaCodes[areaCode] ?? 9} digits.`);
        return;
    }

    nextBtn.disabled    = true;
    nextBtn.textContent = 'Checking...';

    const [idTaken, phoneTaken] = await Promise.all([
        checkIdNumberExists(idNumber),
        checkPhoneExists(areaCode + phone)
    ]);

    nextBtn.disabled    = false;
    nextBtn.textContent = 'Next →';

    if (idTaken) {
        showFieldError(idErrorEl, 'An account with this ID number already exists.');
        return;
    }

    if (phoneTaken) {
        showFieldError(phoneErrorEl, 'An account with this phone number already exists.');
        return;
    }

    builder.setDetails({
        firstname:   firstName,
        lastname:    lastName,
        idNumber,
        phonenumber: areaCode + phone
    });

    window.location.href = 'applicant-signup-qualifications.html';
});

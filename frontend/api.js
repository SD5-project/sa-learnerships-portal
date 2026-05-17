// Reusable uniqueness-check functions.
// Import only what you need in each page:
//   import { checkEmailExists, checkIdNumberExists, checkPhoneExists } from './api.js';

export async function checkEmailExists(email) {
    const res  = await fetch(`/api/check-email?email=${encodeURIComponent(email.trim())}`);
    const data = await res.json();
    return data.exists;
}

export async function checkIdNumberExists(idNumber) {
    const res  = await fetch(`/api/check-idnumber?idNumber=${encodeURIComponent(idNumber.trim())}`);
    const data = await res.json();
    return data.exists;
}

export async function checkPhoneExists(phone) {
    const res  = await fetch(`/api/check-phone?phone=${encodeURIComponent(phone.trim())}`);
    const data = await res.json();
    return data.exists;
}

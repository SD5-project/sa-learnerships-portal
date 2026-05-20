// SignupBuilder.js
// Builder classes for the multi-step signup flow.
// Each signup page loads the builder, calls its setter for that step,
// then navigates. Only the final page calls save() to write to the database.
//
// Ghost account prevention (email/password path):
//   The Firebase Auth account is NOT created until save() is called.
//   save() creates the account and writes to Firestore in sequence.
//   If Firestore fails, the just-created Firebase account is deleted (rollback).
//   This means an abandoned signup never leaves an orphaned Firebase account.

import { auth } from './firebase.js';
import { createUserWithEmailAndPassword } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';

const KEY = 'sc_signup';

class SignupBuilder {
    constructor() {
        this._data = this._load();
    }

    _load() {
        try { return JSON.parse(sessionStorage.getItem(KEY) || '{}'); }
        catch { return {}; }
    }

    _persist() {
        sessionStorage.setItem(KEY, JSON.stringify(this._data));
    }

    static _raw() {
        try { return JSON.parse(sessionStorage.getItem(KEY) || '{}'); }
        catch { return {}; }
    }

    // Clears any previous session and returns a fresh builder for the given role.
    static start(role) {
        sessionStorage.removeItem(KEY);
        if (role === 'applicant') return new ApplicantSignup();
        if (role === 'provider')  return new ProviderSignup();
        throw new Error(`Unknown role: ${role}`);
    }

    // Returns the right subclass instance based on the stored role.
    static load() {
        const { role } = SignupBuilder._raw();
        if (role === 'applicant') return new ApplicantSignup();
        if (role === 'provider')  return new ProviderSignup();
        return null;
    }

    static requireRole(role) {
        if (SignupBuilder._raw().role !== role) {
            window.location.href = 'signup-role-select.html';
            return false;
        }
        return true;
    }

    static requireAuth() {
        const data = SignupBuilder._raw();
        // Google users have a uid; email users have email + deferred password (no uid yet).
        const authed = data.uid || (data.authMethod === 'email' && data.email && data._password);
        if (!authed) {
            window.location.href = 'signup-role-select.html';
            return false;
        }
        return true;
    }

    // Shared step: called from the identity page after Google or email auth.
    setIdentity({ uid, email, authMethod }) {
        Object.assign(this._data, { uid, email, authMethod });
        this._persist();
        return this;
    }

    // Email/password path: store credentials without creating a Firebase account yet.
    // The account is created atomically inside save() alongside the Firestore write.
    setPassword(email, password) {
        Object.assign(this._data, { email, _password: password });
        this._persist();
        return this;
    }

    // Called from the password page for email users after account creation (legacy / Google link).
    setCredentials({ uid, email }) {
        Object.assign(this._data, { uid, email });
        this._persist();
        return this;
    }

    get uid()        { return this._data.uid; }
    get email()      { return this._data.email; }
    get role()       { return this._data.role; }
    get authMethod() { return this._data.authMethod; }

    clear() {
        sessionStorage.removeItem(KEY);
    }
}

export class ApplicantSignup extends SignupBuilder {
    constructor() {
        super();
        if (!this._data.role) {
            this._data.role = 'applicant';
            this._persist();
        }
    }

    setDetails({ firstname, lastname, idNumber, phonenumber }) {
        Object.assign(this._data, { firstname, lastname, idNumber, phonenumber });
        this._persist();
        return this;
    }

    setQualifications(qualifications) {
        this._data.qualifications = qualifications;
        this._persist();
        return this;
    }

    setCV(cvUrl) {
        this._data.cv = cvUrl;
        this._persist();
        return this;
    }

    async save() {
        let user            = auth.currentUser;
        let createdFirebase = false;

        // Email/password path — account is created on the password page (after email verification).
        // If auth.currentUser is already set, reuse it; otherwise create it now as a fallback.
        if (this._data.authMethod === 'email') {
            if (auth.currentUser) {
                user            = auth.currentUser;
                createdFirebase = true; // mark for rollback if Firestore write fails
            } else {
                try {
                    const credential = await createUserWithEmailAndPassword(
                        auth, this._data.email, this._data._password
                    );
                    user            = credential.user;
                    createdFirebase = true;
                } catch (authErr) {
                    const messages = {
                        'auth/email-already-in-use': 'An account with this email already exists. Please log in instead.',
                        'auth/weak-password':        'Password is too weak. Please go back and choose a stronger one.',
                        'auth/invalid-email':        'Invalid email address.',
                        'auth/network-request-failed': 'Network error. Please check your connection and try again.'
                    };
                    throw new Error(messages[authErr.code] || authErr.message);
                }
            }
        }

        try {
            const token = await user.getIdToken();
            const res   = await fetch('/signup/applicant', {
                method:  'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({
                    uid:            user.uid,
                    firstname:      this._data.firstname,
                    lastname:       this._data.lastname,
                    email:          this._data.email,
                    idNumber:       this._data.idNumber,
                    phonenumber:    this._data.phonenumber,
                    qualifications: this._data.qualifications || [],
                    cv:             this._data.cv || null
                })
            });
            if (!res.ok) {
                const body = await res.json();
                throw new Error(body.error || 'Sign-up failed. Please try again.');
            }
            this.clear();
            return user;
        } catch (err) {
            // Rollback: if we just created the Firebase account and Firestore failed, delete it.
            if (createdFirebase && user) await user.delete();
            if (err.message === 'Failed to fetch') {
                throw new Error('Could not reach the server. Please check your connection and try again.');
            }
            throw err;
        }
    }
}

export class ProviderSignup extends SignupBuilder {
    constructor() {
        super();
        if (!this._data.role) {
            this._data.role = 'provider';
            this._persist();
        }
    }

    setDetails({ organization, city, phonenumber }) {
        Object.assign(this._data, { organization, city, phonenumber });
        this._persist();
        return this;
    }

    async save() {
        let user            = auth.currentUser;
        let createdFirebase = false;

        if (this._data.authMethod === 'email') {
            if (auth.currentUser) {
                user            = auth.currentUser;
                createdFirebase = true;
            } else {
                try {
                    const credential = await createUserWithEmailAndPassword(
                        auth, this._data.email, this._data._password
                    );
                    user            = credential.user;
                    createdFirebase = true;
                } catch (authErr) {
                    const messages = {
                        'auth/email-already-in-use': 'An account with this email already exists. Please log in instead.',
                        'auth/weak-password':        'Password is too weak. Please go back and choose a stronger one.',
                        'auth/invalid-email':        'Invalid email address.',
                        'auth/network-request-failed': 'Network error. Please check your connection and try again.'
                    };
                    throw new Error(messages[authErr.code] || authErr.message);
                }
            }
        }

        try {
            const token = await user.getIdToken();
            const res   = await fetch('/signup/provider', {
                method:  'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({
                    uid:          user.uid,
                    organization: this._data.organization,
                    city:         this._data.city,
                    email:        this._data.email,
                    phonenumber:  this._data.phonenumber
                })
            });
            if (!res.ok) {
                const body = await res.json();
                throw new Error(body.error || 'Sign-up failed. Please try again.');
            }
            this.clear();
            return user;
        } catch (err) {
            if (createdFirebase && user) await user.delete();
            if (err.message === 'Failed to fetch') {
                throw new Error('Could not reach the server. Please check your connection and try again.');
            }
            throw err;
        }
    }
}

export { SignupBuilder };

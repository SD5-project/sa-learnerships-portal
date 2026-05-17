import { auth } from "/firebase.js";
import { signInWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
//loginE-email.js
const form     = document.querySelector("form");
const loginBtn = document.querySelector(".login");

async function handleLogin(e) {
    e && e.preventDefault();

    const emailInput    = document.querySelector("input[name='email']").value.trim();
    const passwordInput = document.querySelector("input[name='password']").value;

    clearError();

    if (!emailInput || !passwordInput) {
        showError("Please enter your email and password.");
        return;
    }

    if (loginBtn) { loginBtn.disabled = true; loginBtn.textContent = "Logging in..."; }

    try {
        const userCredential = await signInWithEmailAndPassword(auth, emailInput, passwordInput);
        const user = userCredential.user;

        // Best-effort token refresh — don't block login if Firebase is slow
        try { await user.getIdToken(true); } catch (_) {}

        const freshToken    = await user.getIdToken();
        const idTokenResult = await user.getIdTokenResult();
        const role          = idTokenResult.claims.role;

        localStorage.setItem("token", freshToken);

        if (role) { redirectByRole(role); return; }

        // Fallback — role claim missing
        try {
            const res = await fetch("/api/user-role?uid=" + user.uid, {
                headers: { "Authorization": "Bearer " + freshToken }
            });
            if (res.ok) {
                const data = await res.json();
                if (data.role) { redirectByRole(data.role); return; }
            }
        } catch (err) {
            console.error("Firestore role lookup error:", err);
        }

        showError("Your account has no role assigned. Please contact support.");

    } catch (error) {
        if (loginBtn) { loginBtn.disabled = false; loginBtn.textContent = "Login"; }
        console.error("Login error:", error.code);

        if (error.code === "auth/user-disabled") {
            // ── SUSPENDED ACCOUNT — most prominent message ──────────────────
            showSuspendedBanner(emailInput);

        } else if (
            error.code === "auth/invalid-credential" ||
            error.code === "auth/user-not-found"     ||
            error.code === "auth/wrong-password"
        ) {
            showError("Incorrect email or password. Please try again.");
        } else if (error.code === "auth/invalid-email") {
            showError("Please enter a valid email address.");
        } else if (error.code === "auth/too-many-requests") {
            showError("Too many failed attempts. Please try again later.");
        } else {
            showError("Login failed: " + error.message);
        }
    }
}

// ── Show a full suspended-account banner ──────────────────────────────────────
function showSuspendedBanner(email) {
    // Remove any existing banner first
    const existing = document.getElementById("suspended-banner");
    if (existing) existing.remove();

    const banner = document.createElement("div");
    banner.id = "suspended-banner";
    banner.style.cssText = `
        background-color: #7f1d1d;
        border: 2px solid #f87171;
        border-radius: 10px;
        padding: 18px 20px;
        margin-top: 16px;
        color: white;
        font-family: serif;
        font-size: 14px;
        line-height: 1.6;
    `;
    banner.innerHTML = `
        <strong style="font-size:15px;">⛔ Account Suspended</strong><br><br>
        Your account (<strong>${email}</strong>) has been suspended by an administrator.<br>
        You will have received an email explaining this decision.<br><br>
        If you believe this is a mistake, please contact support at
        <a href="mailto:skillsconnectsupport@gmail.com"
           style="color:#fca5a5;">skillsconnectsupport@gmail.com</a>.
    `;

    // Insert below the form
    const form = document.querySelector("form");
    if (form) {
        form.appendChild(banner);
    } else {
        document.body.appendChild(banner);
    }
}

// ── Show a simple inline error ────────────────────────────────────────────────
function showError(msg) {
    // Try to find or create an error element inside the form
    let el = document.getElementById("login-error-msg");
    if (!el) {
        el = document.createElement("p");
        el.id = "login-error-msg";
        el.style.cssText = "color:#f87171;font-size:13px;margin:8px 0 0;font-family:serif;";
        const form = document.querySelector("form");
        if (form) form.appendChild(el);
    }
    el.textContent = msg;
}

function clearError() {
    const el     = document.getElementById("login-error-msg");
    const banner = document.getElementById("suspended-banner");
    if (el)     el.textContent = "";
    if (banner) banner.remove();
}

function redirectByRole(role) {
    const r = (role || "").toLowerCase();
    if      (r === "applicant") window.location.href = "/listings";
    else if (r === "provider")  window.location.href = "/provider-home";
    else if (r === "admin")     window.location.href = "/admin-dashboard";
    else showError("Unknown role '" + role + "'. Please contact support.");
}

if (form)     form.addEventListener("submit", handleLogin);
if (loginBtn) loginBtn.addEventListener("click", handleLogin);
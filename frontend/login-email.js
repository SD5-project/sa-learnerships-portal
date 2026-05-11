import { auth } from "/firebase.js";
import { signInWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

// Use type="submit" button OR the single .login button
const form     = document.querySelector("form");
const loginBtn = document.querySelector(".login");

async function handleLogin(e) {
    e && e.preventDefault();

    const emailInput    = document.querySelector("input[name='username']").value.trim();
    const passwordInput = document.querySelector("input[name='password']").value;

    if (!emailInput || !passwordInput) {
        alert("Please enter your email and password.");
        return;
    }

    try {
        // Step 1: Sign in
        const userCredential = await signInWithEmailAndPassword(auth, emailInput, passwordInput);
        const user = userCredential.user;

        // Step 2: Force-refresh so custom claims are up to date
        await user.getIdToken(true);

        // Step 3: Get the fresh token AFTER the refresh
        const freshToken    = await user.getIdToken();
        const idTokenResult = await user.getIdTokenResult();
        const role          = idTokenResult.claims.role;

        // Step 4: Persist token
        localStorage.setItem("token", freshToken);

        console.log("Login OK — uid:", user.uid, "role:", role);

        // Step 5: Redirect by role
        if (role) {
            redirectByRole(role);
            return;
        }

        // Step 6: Fallback — role claim missing, look up Firestore
        
        console.warn("No role claim, falling back to Firestore lookup");
        try {
            const res = await fetch("/api/user-role?uid=" + user.uid, {
                headers: { "Authorization": "Bearer " + freshToken }
            });
            if (res.ok) {
                const data = await res.json();
                if (data.role) {
                    redirectByRole(data.role);
                    return;
                }
            }
        } catch (err) {
            console.error("Firestore role lookup error:", err);
        }

        alert("Your account has no role assigned. Please contact support.");
        
    } catch (error) {
        console.error("Login error:", error.code);
        if (error.code === "auth/invalid-credential" ||
            error.code === "auth/user-not-found"     ||
            error.code === "auth/wrong-password") {
            alert("Incorrect email or password. Please try again.");
        } else if (error.code === "auth/invalid-email") {
            alert("Please enter a valid email address.");
        } else if (error.code === "auth/too-many-requests") {
            alert("Too many failed attempts. Please try again later.");
        } else if (error.code === "auth/user-disabled") {
            alert("This account has been disabled. Please contact support.");
        } else {
            alert("Login failed: " + error.message);
        }
    }
}

function redirectByRole(role) {
    const r = (role || "").toLowerCase();
    if      (r === "applicant") window.location.href = "/listings";
    else if (r === "provider")  window.location.href = "/provider-home";
    else if (r === "admin")     window.location.href = "/admin-dashboard";
    else alert("Unknown role '" + role + "'. Please contact support.");
}

// Attach to both form submit and button click (handles both index.html structures)
if (form)     form.addEventListener("submit", handleLogin);
if (loginBtn) loginBtn.addEventListener("click", handleLogin);
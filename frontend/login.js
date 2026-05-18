import { auth } from "./firebase.js";
import {
    GoogleAuthProvider,
    signInWithPopup,
    EmailAuthProvider,
    reauthenticateWithCredential
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const provider  = new GoogleAuthProvider();
const googleBtn = document.getElementById("google-login-btn");
const errorBox  = document.getElementById("global-error");

// Modal elements
const modal    = document.getElementById("google-password-modal");
const gpmError = document.getElementById("gpm-error");
const gpmPwd   = document.getElementById("gpm-password");
const gpmCancel = document.getElementById("gpm-cancel");
const gpmSubmit = document.getElementById("gpm-submit");

function showError(msg) {
    if (errorBox) {
        errorBox.textContent = msg;
        errorBox.classList.add("visible");
        clearTimeout(errorBox._timer);
        errorBox._timer = setTimeout(() => errorBox.classList.remove("visible"), 4000);
    } else {
        alert(msg);
    }
}

function showModalError(msg) {
    gpmError.textContent = msg;
    gpmError.style.display = msg ? "block" : "none";
}

function promptPassword() {
    return new Promise((resolve, reject) => {
        modal.style.display = "flex";
        gpmError.style.display = "none";
        gpmPwd.value = "";

        function onSubmit() {
            const pwd = gpmPwd.value;
            if (!pwd) {
                showModalError("Please enter your password.");
                return;
            }
            cleanup();
            resolve(pwd);
        }

        function onCancel() {
            cleanup();
            reject(new Error("cancelled"));
        }

        function cleanup() {
            gpmSubmit.removeEventListener("click", onSubmit);
            gpmCancel.removeEventListener("click", onCancel);
            modal.style.display = "none";
        }

        gpmSubmit.addEventListener("click", onSubmit);
        gpmCancel.addEventListener("click", onCancel);
    });
}

googleBtn.addEventListener("click", async (e) => {
    e.preventDefault();
    googleBtn.disabled = true;

    try {
        const result = await signInWithPopup(auth, provider);
        const user   = result.user;

        // Ask user to verify the password they set during sign-up
        let password;
        try {
            password = await promptPassword();
        } catch (err) {
            // User cancelled the modal
            showError("Sign-in cancelled — please try again.");
            googleBtn.disabled = false;
            return;
        }

        try {
            const cred = EmailAuthProvider.credential(user.email, password);
            await reauthenticateWithCredential(user, cred);
        } catch (err) {
            showError(
                err.code === "auth/wrong-password" || err.code === "auth/invalid-credential"
                    ? "Incorrect password. Please try again."
                    : "Password verification failed. Please try again."
            );
            googleBtn.disabled = false;
            return;
        }

        await user.getIdToken(true);
        const idTokenResult = await user.getIdTokenResult();
        let role = idTokenResult.claims.role;

        const token = await user.getIdToken();
        localStorage.setItem("token", token);

        // ── Fallback: fetch role from Firestore if no custom claim ──────────────
        if (!role) {
            try {
                const res = await fetch(`/api/user-role?uid=${user.uid}`, {
                    headers: { "Authorization": `Bearer ${token}` }
                });
                if (res.ok) {
                    const data = await res.json();
                    role = data.role;

                    if (role) {
                        await fetch("/api/set-role-claim", {
                            method:  "POST",
                            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
                            body: JSON.stringify({ uid: user.uid, role })
                        });
                    }
                }
            } catch (err) {
                console.error("Role lookup error:", err);
            }
        }

        if (!role) {
            await user.delete();
            showError("Your previous sign-up was not completed. Please sign up again to create your account.");
            googleBtn.disabled = false;
            return;
        }

        redirectByRole(role);

    } catch (error) {
        if (error.code !== "auth/popup-closed-by-user") {
            console.error("Google Login Error:", error);
            showError("Login failed. Please try again.");
        }
        googleBtn.disabled = false;
    }
});

function redirectByRole(role) {
    const r = role.toLowerCase();
    if (r === "applicant")     window.location.href = "/applicant-home";
    else if (r === "provider") window.location.href = "/provider-home";
    else if (r === "admin")    window.location.href = "/admin-dashboard";
    else                       window.location.href = "/signup.html";
}

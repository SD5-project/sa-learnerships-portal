import { auth } from "./firebase.js";
import { GoogleAuthProvider, signInWithPopup } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
//login.js
const provider  = new GoogleAuthProvider();
const googleBtn = document.getElementById("google-login-btn");

googleBtn.addEventListener("click", async (e) => {
    e.preventDefault();

    try {
        const result = await signInWithPopup(auth, provider);
        const user   = result.user;

        // Force-refresh token to pick up any existing custom claims
        await user.getIdToken(true);
        const idTokenResult = await user.getIdTokenResult();
        let role = idTokenResult.claims.role;

        const token = await user.getIdToken();
        localStorage.setItem("token", token);

        // ── Fallback: fetch role from Firestore if no custom claim ──────────────
        if (!role) {
            console.warn("⚠️ No role claim — checking Firestore...");
            try {
                const res = await fetch(`/api/user-role?uid=${user.uid}`, {
                    headers: { "Authorization": `Bearer ${token}` }
                });
                if (res.ok) {
                    const data = await res.json();
                    role = data.role;

                    // If user exists in Firestore, backfill the custom claim for next time
                    if (role) {
                        await fetch("/api/set-role-claim", {
                            method:  "POST",
                            headers: {
                                "Content-Type":  "application/json",
                                "Authorization": `Bearer ${token}`
                            },
                            body: JSON.stringify({ uid: user.uid, role })
                        });
                        console.log("✅ Custom claim backfilled for:", role);
                    }
                }
            } catch (err) {
                console.error("Role lookup error:", err);
            }
        }

        // New Google user — no Firestore record yet, send them to complete signup
        if (!role) {
            window.location.href = "/signup.html";
            return;
        }

        redirectByRole(role);

    } catch (error) {
        console.error("Google Login Error:", error);
        alert("Login failed: " + error.message);
    }
});

function redirectByRole(role) {
    const r = role.toLowerCase();
    if (r === "applicant")     window.location.href = "/listings";
    else if (r === "provider") window.location.href = "/provider-home";
    else if (r === "admin")    window.location.href = "/admin-dashboard";
    else                       window.location.href = "/signup.html";
}
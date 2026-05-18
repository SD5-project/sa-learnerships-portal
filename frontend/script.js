// ─── Imports (MUST be at top for ES modules) ────────────────────────────────
/*import { auth } from "./firebase.js";
import { 
    createUserWithEmailAndPassword
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

const supabase = createClient(
    "https://yarisyregfxsyqtfpioa.supabase.co",
    "sb_publishable_KMKQv0h1DaqMuthc_Kf-Yg_vJTm3nDI"
);

async function uploadCV(file, uid) {
    try {
        const fileExt = file.name.split('.').pop();
        const fileName = `${uid}.${fileExt}`;

        const { data, error } = await supabase
            .storage
            .from("cvs")
            .upload(fileName, file, {
                upsert: true
            });

        if (error) {
            console.error("❌ Upload error:", error);
            return null;
        }

        const { data: urlData } = supabase
            .storage
            .from("cvs")
            .getPublicUrl(fileName);

        console.log("📦 Upload success:", data);
        console.log("🔗 Public URL:", urlData.publicUrl);

        return urlData.publicUrl;

    } catch (err) {
        console.error("❌ uploadCV crashed:", err);
        return null;
    }
}

// ─── Area Code Configuration ─────────────────────────────────────────────────
const areaCodes = {
    "+27": 9,
    "+1":  10,
    "+44": 10,
    "+91": 10,
    "+61": 9,
};

// ─── Error Display Helpers ───────────────────────────────────────────────────
function showError(spanId, message) {
    const span = document.getElementById(spanId);
    if (span) {
        span.textContent = message;
        span.classList.add("visible");
    }
}

function clearError(spanId) {
    const span = document.getElementById(spanId);
    if (span) {
        span.textContent = "";
        span.classList.remove("visible");
    }
}

// ─── Validation Logic ────────────────────────────────────────────────────────
function validatePassword(password, email, confirmPassword, passwordSpanId, confirmSpanId) {
    let valid = true;

    if (password.length === 0) {
        clearError(passwordSpanId);
    } else if (password.length <= 8) {
        showError(passwordSpanId, "Password must be more than 8 characters.");
        valid = false;
    } else if (password === email && email.length > 0) {
        showError(passwordSpanId, "Password must not be the same as your email.");
        valid = false;
    } else {
        clearError(passwordSpanId);
    }

    if (confirmPassword.length === 0) {
        clearError(confirmSpanId);
    } else if (password !== confirmPassword) {
        showError(confirmSpanId, "Passwords do not match.");
        valid = false;
    } else {
        clearError(confirmSpanId);
    }

    return valid;
}

function validatePhone(phoneValue, areaCode, phoneSpanId) {
    const requiredDigits = areaCodes[areaCode];
    const digits = phoneValue.trim();

    if (digits.length === 0) { clearError(phoneSpanId); return false; }
    if (!/^\d+$/.test(digits)) {
        showError(phoneSpanId, "Phone number must contain digits only.");
        return false;
    }
    if (digits.length !== requiredDigits) {
        showError(phoneSpanId, `Phone number for ${areaCode} must be exactly ${requiredDigits} digits.`);
        return false;
    }
    clearError(phoneSpanId);
    return true;
}

// ─── Dropdown Toggle ─────────────────────────────────────────────────────────
const dropdown        = document.getElementById("role");
const applicantFields = document.getElementById("ApplicantSignUp");
const providerFields  = document.getElementById("ProviderSignUp");

if (dropdown) {
    dropdown.addEventListener("change", () => {
        const selectedValue = dropdown.value;
        if (selectedValue === "Applicant") {
            applicantFields.classList.remove("hidden");
            providerFields.classList.add("hidden");
        } else if (selectedValue === "Provider") {
            providerFields.classList.remove("hidden");
            applicantFields.classList.add("hidden");
        }
    });
}

// ─── Real-Time Listeners: Applicant ──────────────────────────────────────────
const applicantPassword        = document.getElementById("applicantPassword");
const applicantConfirmPassword = document.getElementById("applicantConfirmPassword");
const applicantEmail           = document.getElementById("applicantEmail");
const applicantPhone           = document.getElementById("applicantPhone");
const applicantAreaCode        = document.getElementById("applicantAreaCode");
const applicantCv = document.getElementById("cv");
const cvLabel = document.getElementById("file-name-display");

if(applicantCv && cvLabel){
    applicantCv.addEventListener('change', function () {
        if(this.files && this.files.length > 0){
            cvLabel.textContent = this.files[0].name;
            cvLabel.title = this.file[0].name;
        } else {
            cvLabel.textContent = "No file chosen";
        }
    });
}
if (applicantPassword) {
    applicantPassword.addEventListener("input", () => {
        validatePassword(applicantPassword.value, applicantEmail.value,
            applicantConfirmPassword.value, "applicantPasswordError", "applicantConfirmPasswordError");
    });
    applicantConfirmPassword.addEventListener("input", () => {
        validatePassword(applicantPassword.value, applicantEmail.value,
            applicantConfirmPassword.value, "applicantPasswordError", "applicantConfirmPasswordError");
    });
    applicantEmail.addEventListener("input", () => {
        if (applicantPassword.value.length > 0) {
            validatePassword(applicantPassword.value, applicantEmail.value,
                applicantConfirmPassword.value, "applicantPasswordError", "applicantConfirmPasswordError");
        }
    });
    applicantPhone.addEventListener("input", () => {
        validatePhone(applicantPhone.value, applicantAreaCode.value, "applicantPhoneError");
    });
    applicantAreaCode.addEventListener("change", () => {
        if (applicantPhone.value.length > 0) {
            validatePhone(applicantPhone.value, applicantAreaCode.value, "applicantPhoneError");
        }
    });
}

// ─── Real-Time Listeners: Provider ───────────────────────────────────────────
const providerPassword        = document.getElementById("providerPassword");
const providerConfirmPassword = document.getElementById("providerConfirmPassword");
const providerEmail           = document.getElementById("providerEmail");
const providerPhone           = document.getElementById("providerPhone");
const providerAreaCode        = document.getElementById("providerAreaCode");

if (providerPassword) {
    providerPassword.addEventListener("input", () => {
        validatePassword(providerPassword.value, providerEmail.value,
            providerConfirmPassword.value, "providerPasswordError", "providerConfirmPasswordError");
    });
    providerConfirmPassword.addEventListener("input", () => {
        validatePassword(providerPassword.value, providerEmail.value,
            providerConfirmPassword.value, "providerPasswordError", "providerConfirmPasswordError");
    });
    providerEmail.addEventListener("input", () => {
        if (providerPassword.value.length > 0) {
            validatePassword(providerPassword.value, providerEmail.value,
                providerConfirmPassword.value, "providerPasswordError", "providerConfirmPasswordError");
        }
    });
    providerPhone.addEventListener("input", () => {
        validatePhone(providerPhone.value, providerAreaCode.value, "providerPhoneError");
    });
    providerAreaCode.addEventListener("change", () => {
        if (providerPhone.value.length > 0) {
            validatePhone(providerPhone.value, providerAreaCode.value, "providerPhoneError");
        }
    });
}

// ─── Signup Button Click ──────────────────────────────────────────────────────
const signupBtn = document.getElementById("signup-btn");

if (signupBtn) {
    signupBtn.addEventListener("click", async () => {

        const role = document.getElementById("role").value;

        const email = role === "Applicant"
            ? document.getElementById("applicantEmail").value
            : document.getElementById("providerEmail").value;

        const password = role === "Applicant"
            ? document.getElementById("applicantPassword").value
            : document.getElementById("providerPassword").value;

        const confirmPassword = role === "Applicant"
            ? document.getElementById("applicantConfirmPassword").value
            : document.getElementById("providerConfirmPassword").value;

        if (!email || !password) {
            alert("Please fill in your email and password.");
            return;
        }
        if (password !== confirmPassword) {
            alert("Passwords do not match.");
            return;
        }
        if (password.length <= 8) {
            alert("Password must be more than 8 characters.");
            return;
        }

        const file = document.getElementById("cv")?.files[0];

        let user = auth.currentUser;

        if (!user) {
            try {
                const userCredential = await createUserWithEmailAndPassword(auth, email, password);
                user = userCredential.user;
                console.log("✅ Firebase Auth user created:", user.uid);
            } catch (error) {
                console.error("Firebase Auth Error:", error.code);
                if (error.code === "auth/email-already-in-use") {
                    alert("An account with this email already exists.");
                } else if (error.code === "auth/invalid-email") {
                    alert("Please enter a valid email address.");
                } else if (error.code === "auth/weak-password") {
                    alert("Password is too weak. Use at least 9 characters.");
                } else {
                    alert("Account creation failed: " + error.message);
                }
                return;
            }
        }

        const uid   = user.uid;
        const token = await user.getIdToken();
        localStorage.setItem("token", token);

        console.log("✅ Signing up with real Firebase UID:", uid);

        // ── Build payload ─────────────────────────────────────────────────────────
        let endpoint = "";
        let body;
        let headers = { "Authorization": `Bearer ${token}` };

        if (role === "Applicant") {
            endpoint = "/signup/applicant";

            const formData = new FormData();
            formData.append("uid",         uid);
            formData.append("firstname",   document.getElementById("firstName").value);
            formData.append("lastname",    document.getElementById("lastName").value);
            formData.append("email",       email);
            formData.append("username",    document.getElementById("username").value);
            formData.append("institution", document.getElementById("institution").value);
            formData.append("city",        document.getElementById("city").value);
            formData.append("phonenumber", document.getElementById("applicantAreaCode").value +
                                           document.getElementById("applicantPhone").value);
            if (file) formData.append("cv", file);

            body = formData;
            // ⚠️ No Content-Type header for FormData

        } else if (role === "Provider") {
            endpoint = "/signup/provider";
            headers["Content-Type"] = "application/json";
            body = JSON.stringify({
                uid,
                organization: document.getElementById("org").value,
                email,
                city:         document.getElementById("orgCity").value,
                phonenumber:  document.getElementById("providerAreaCode").value +
                              document.getElementById("providerPhone").value,
                username:     document.getElementById("orgUsername").value
            });
        }

        // ── POST to backend ───────────────────────────────────────────────────────
        try {
            const response = await fetch(endpoint, {
                method: "POST",
                headers,
                body
            });

            const data = await response.json();

            if (response.ok) {
                console.log("✅ Firestore document created for UID:", uid);
                document.getElementById("successConfirm").classList.remove("hidden");

                await new Promise(resolve => setTimeout(resolve, 2000)); 
                await user.getIdToken(true);
                const idTokenResult = await user.getIdTokenResult();
                const userRole = idTokenResult.claims.role;

                console.log("✅ Role assigned:", userRole);

                setTimeout(() => {
                    if (userRole === "applicant")     window.location.href = "/applicant-home";
                    else if (userRole === "provider") window.location.href = "/provider-home";
                    else if (userRole === "admin")    window.location.href = "/admin-dashboard";
                    else alert("Role not assigned. Please contact support.");
                }, 1500);

            } else {
                alert("Signup failed: " + data.error);
            }

        } catch (error) {
            console.error("Signup POST error:", error);
            alert("Could not reach server. Is your backend running?");
        }
    });
}

// ─── Listing Click ────────────────────────────────────────────────────────────
const listings = document.querySelectorAll(".listing");

listings.forEach(listing => {
    listing.addEventListener("click", () => {
        const listingID = listing.dataset.id;
        window.location.href = `/listing-info?listingID=${listingID}`;
    });
});

// ─── Apply Button ─────────────────────────────────────────────────────────────
const applyBtn = document.getElementById("applyListing");


if (applyBtn) {
     // Check on load if user already applied
    const params = new URLSearchParams(window.location.search);
    const listingID = params.get("listingID");
    applyBtn.style.visibility = "hidden";
    auth.onAuthStateChanged(async (user) => {
        if (!user) {
            applyBtn.style.visibility = "visible";return;
        }
        try {
            const response = await fetch(`/applicant/hasApplied?applicantID=${user.uid}&listingID=${listingID}`);
            const data = await response.json();

            if(data.hasApplied){
                applyBtn.remove();
            }else{
                applyBtn.style.visibility = "visible";
            }
        } catch (error) {
            applyBtn.style.visibility = "visible";
        }
        
    });
    applyBtn.addEventListener("click", async () => {
          if (!auth.currentUser) {
            alert("You must be logged in to apply.");
            return;
            }
        try {
            const uid = auth.currentUser.uid;
            const response = await fetch("/applicant/apply", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    applicantID: uid,
                    listingID: listingID,
                    status: "pending"
                })
            });
            const data = await response.json();
            if (response.ok) {
                console.log("Application success");
            } else {
                console.log("Application failed: " + data.error);
            }
        } catch (error) {
            console.log(error);
        }

        alert("Application successful!");
        applyBtn.remove();
    });
}



async function loadApplications(applicantID) {
    try {
        const token = await auth.currentUser.getIdToken();

        const appsResponse = await fetch(`/api/applications?applicantID=${applicantID}`, {
            headers: { Authorization: `Bearer ${token}` }
        });
        const applications = await appsResponse.json();
        console.log(applications);

        const enriched = await Promise.all(
            applications.map(async (app) => {
                 const listingId = app.listingID;

    try {
        const freshToken = await auth.currentUser.getIdToken();
        const oppResponse = await fetch(`/api/opportunities/${listingId}`, {
            headers: { Authorization: `Bearer ${freshToken}` }
        });

        if (!oppResponse.ok) {
            // Opportunity was deleted — return what we have from the application
            return { ...app, title: "Listing no longer available", company: "-" };
        }

        const opportunity = await oppResponse.json();
        const merged = { ...app, ...opportunity };
        console.log("Merged app:", merged.status);
        return { ...opportunity, ...app };

    } catch (error) {
        return { ...app, title: "Listing no longer available", company: "-" };
    }
            })
        );
        console.log("enriched:", enriched);
        displayApplications(enriched);

    } catch (error) {
        console.error("Failed to load applications:", error);
    }
}

// ─── displayApplications ─────────────────────────────────────────────────────
function displayApplications(applications) {
    const tbody = document.getElementById('applications-list');
    if (!tbody) return;
    if (applications.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="4">
                    <div class="empty-state">
                        <div class="icon">📋</div>
                        <p>You have not applied to any positions yet.</p>
                    </div>
                </td>
            </tr>`;
        return;
    }

    tbody.innerHTML = applications.map(app => `
        <tr>
            <td>${app.title || '-'}</td>
            <td>${app.company || '-'}</td>
            <td>${app.createdAt ? new Date(app.createdAt).toLocaleDateString('en-ZA') : '-'}</td>
            <td><span class="status ${app.status || ''}">${app.status || 'unknown'}</span></td>
        </tr>
    `).join('');
}

// ── Auth check ────────────────────────────────────────────────────────────────
auth.onAuthStateChanged((user) => {
    if (user) {
        // Only redirect if we're on the login page
        const isLoginPage = window.location.pathname === '/' || 
                            window.location.pathname.includes('index.html');
        if (isLoginPage) {
            window.location.href = '/applicant-home';
        }
        loadApplications(user.uid);
    }
}); */

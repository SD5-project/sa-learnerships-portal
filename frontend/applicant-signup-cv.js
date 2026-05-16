import { auth } from './firebase.js';
import { SignupBuilder } from './SignupBuilder.js';
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

if (!SignupBuilder.requireRole('applicant') || !SignupBuilder.requireAuth()) throw new Error('guard failed');

const builder = SignupBuilder.load();

const supabase = createClient(
    'https://yarisyregfxsyqtfpioa.supabase.co',
    'sb_publishable_KMKQv0h1DaqMuthc_Kf-Yg_vJTm3nDI'
);

const cvInput    = document.getElementById('cv-input');
const fileNameEl = document.getElementById('file-name');
const submitBtn  = document.getElementById('submit-btn');
const errorBox   = document.getElementById('global-error');
const uploadArea = document.getElementById('upload-area');

cvInput.addEventListener('change', () => {
    const file = cvInput.files[0];
    if (file) {
        fileNameEl.textContent = `Selected: ${file.name}`;
        uploadArea.classList.add('has-file');
    } else {
        fileNameEl.textContent = '';
        uploadArea.classList.remove('has-file');
    }
});

async function uploadCV(file, id) {
    const ext      = file.name.split('.').pop();
    const fileName = `${id}.${ext}`;
    const { error } = await supabase.storage.from('cvs').upload(fileName, file, { upsert: true });
    if (error) throw error;
    const { data } = supabase.storage.from('cvs').getPublicUrl(fileName);
    return data.publicUrl;
}

submitBtn.addEventListener('click', async () => {
    errorBox.classList.remove('visible');
    submitBtn.disabled    = true;
    submitBtn.textContent = 'Creating account…';

    try {
        // Step 1: CV upload (optional — a failed upload does not block signup)
        const file = cvInput.files[0];
        if (file) {
            submitBtn.textContent = 'Uploading CV…';
            try {
                const tempId = builder.uid || builder.email;
                const cvUrl  = await uploadCV(file, tempId);
                builder.setCV(cvUrl);
            } catch (cvErr) {
                console.warn('[signup] CV upload failed, proceeding without CV:', cvErr);
                // Show a soft warning but continue — CV can be added from the profile later.
                errorBox.textContent = 'CV upload failed — your account will be created without it. You can upload your CV from your profile later.';
                errorBox.classList.add('visible');
            }
            submitBtn.textContent = 'Creating account…';
        }

        // Step 2: create Firebase account + write to Firestore
        console.log('[signup] calling save()... authMethod:', builder.authMethod);
        const user = await builder.save();
        console.log('[signup] save() succeeded, uid:', user.uid);

        const freshToken = await user.getIdToken(true); // refresh to pick up new role claim
        localStorage.setItem('token', freshToken);
        window.location.href = '/applicant-home';

    } catch (err) {
        console.error('[signup] error:', err);
        errorBox.textContent = err.message || 'Something went wrong. Please try again.';
        errorBox.classList.add('visible');
        submitBtn.disabled    = false;
        submitBtn.textContent = 'Complete sign-up';
    }
});

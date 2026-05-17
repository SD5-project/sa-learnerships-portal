import { auth } from './firebase.js';
import { SignupBuilder } from './SignupBuilder.js';

if (!SignupBuilder.requireRole('applicant') || !SignupBuilder.requireAuth()) throw new Error('guard failed');

const builder = SignupBuilder.load();

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

submitBtn.addEventListener('click', async () => {
    errorBox.classList.remove('visible');
    submitBtn.disabled    = true;
    submitBtn.textContent = 'Creating account…';

    try {
        // Step 1: create Firebase account + write to Firestore
        console.log('[signup] calling save()... authMethod:', builder.authMethod);
        const user = await builder.save();
        console.log('[signup] save() succeeded, uid:', user.uid);

        const token = await user.getIdToken(true);
        localStorage.setItem('token', token);

        // Step 2: CV upload via Cloudinary (optional)
        const file = cvInput.files[0];
        if (file) {
            submitBtn.textContent = 'Uploading CV…';
            try {
                const formData = new FormData();
                formData.append('cv', file);
                formData.append('uid', user.uid);

                const res = await fetch('/api/upload-cv', {
                    method:  'POST',
                    headers: { 'Authorization': `Bearer ${token}` },
                    body:    formData
                });

                if (!res.ok) throw new Error('Upload failed');
                console.log('[signup] CV uploaded successfully');
            } catch (cvErr) {
                console.warn('[signup] CV upload failed, proceeding without CV:', cvErr);
                errorBox.textContent = 'CV upload failed';
                errorBox.classList.add('visible');
            }
        }


        window.location.href = '/applicant-home';

    } catch (err) {
        console.error('[signup] error:', err);
        errorBox.textContent = err.message || 'Something went wrong. Please try again.';
        errorBox.classList.add('visible');
        submitBtn.disabled    = false;
        submitBtn.textContent = 'Complete sign-up';
    }
});
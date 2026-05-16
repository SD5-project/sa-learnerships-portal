import { SignupBuilder } from './SignupBuilder.js';

if (!SignupBuilder.requireRole('applicant') || !SignupBuilder.requireAuth()) throw new Error('guard failed');

const builder = SignupBuilder.load();

const MAX_QUALS    = 8;
const MAX_SUBJECTS = 20;

const listEl    = document.getElementById('qualification-list');
const addBtn    = document.getElementById('add-qual-btn');
const nextBtn   = document.getElementById('next-btn');
const errorBox  = document.getElementById('global-error');

let qualifications = [];
let nqfLevels      = [];

async function loadNQFLevels() {
    try {
        const res  = await fetch('/nqf-levels');
        const data = await res.json();
        nqfLevels  = data.levels || [];
    } catch {
        nqfLevels = Array.from({ length: 10 }, (_, i) => ({ level: i + 1, name: `NQF Level ${i + 1}` }));
    }
}

function nqfOptionsHtml() {
    return ['<option value="">Select NQF level</option>',
        ...nqfLevels.map(l => `<option value="${l.level}">NQF ${l.level} — ${l.name}</option>`)
    ].join('');
}

function renderSubjects(qualIdx) {
    const qual = qualifications[qualIdx];
    const container = document.getElementById(`subj-list-${qualIdx}`);
    if (!container) return;

    container.innerHTML = qual.subjects.map((s, si) => `
        <div class="subject-row" id="subj-${qualIdx}-${si}">
            <input type="text" placeholder="Subject name" value="${escHtml(s.name)}"
                oninput="updateSubject(${qualIdx}, ${si}, 'name', this.value)">
            <input type="number" placeholder="Mark" min="0" max="100" value="${s.mark ?? ''}"
                oninput="clampMark(this, ${qualIdx}, ${si})">
            <button class="btn-remove-subject" onclick="removeSubject(${qualIdx}, ${si})" title="Remove">✕</button>
        </div>
    `).join('');

    const addSubjBtn = document.getElementById(`add-subj-btn-${qualIdx}`);
    if (addSubjBtn) addSubjBtn.disabled = qual.subjects.length >= MAX_SUBJECTS;
}

function renderQualifications() {
    listEl.innerHTML = qualifications.map((q, i) => `
        <div class="qualification-card" id="qual-card-${i}">
            <div class="qualification-card-header">
                <span class="qualification-number">Qualification ${i + 1}</span>
                <button class="btn-remove-qual" onclick="removeQualification(${i})">Remove</button>
            </div>
            <div class="field-row">
                <div class="signup-field">
                    <label>Institution</label>
                    <input type="text" placeholder="e.g. University of Johannesburg"
                        value="${escHtml(q.institution)}"
                        oninput="updateQual(${i}, 'institution', this.value)">
                </div>
                <div class="signup-field">
                    <label>Qualification name</label>
                    <input type="text" placeholder="e.g. BSc Computer Science"
                        value="${escHtml(q.name)}"
                        oninput="updateQual(${i}, 'name', this.value)">
                </div>
            </div>
            <div class="field-row">
                <div class="signup-field">
                    <label>NQF level</label>
                    <select onchange="updateQual(${i}, 'nqfLevel', this.value)">
                        ${nqfOptionsHtml().replace(
                            `value="${q.nqfLevel}"`,
                            `value="${q.nqfLevel}" selected`
                        )}
                    </select>
                </div>
                <div class="signup-field">
                    <label>Date obtained</label>
                    <input type="month" value="${q.dateObtained}"
                        onchange="updateQual(${i}, 'dateObtained', this.value)">
                </div>
            </div>
            <div class="subjects-section">
                <div class="subjects-heading">Subjects (optional, max ${MAX_SUBJECTS})</div>
                <div id="subj-list-${i}"></div>
                <button class="btn-add-subject" id="add-subj-btn-${i}"
                    onclick="addSubject(${i})">+ Add Subject</button>
            </div>
        </div>
    `).join('');

    qualifications.forEach((_, i) => renderSubjects(i));
    addBtn.disabled = qualifications.length >= MAX_QUALS;
}

function escHtml(str = '') {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

window.clampMark = (input, qi, si) => {
    let val = parseInt(input.value, 10);
    if (input.value === '' || isNaN(val)) { qualifications[qi].subjects[si].mark = ''; return; }
    if (val < 0)   { val = 0;   input.value = 0; }
    if (val > 100) { val = 100; input.value = 100; }
    qualifications[qi].subjects[si].mark = val;
};

window.updateQual    = (i, field, value) => { qualifications[i][field] = value; };
window.removeQualification = i => { qualifications.splice(i, 1); renderQualifications(); };
window.addSubject    = i => {
    if (qualifications[i].subjects.length >= MAX_SUBJECTS) return;
    qualifications[i].subjects.push({ name: '', mark: '' });
    renderSubjects(i);
};
window.updateSubject = (qi, si, field, value) => { qualifications[qi].subjects[si][field] = value; };
window.removeSubject = (qi, si) => { qualifications[qi].subjects.splice(si, 1); renderSubjects(qi); };

addBtn.addEventListener('click', () => {
    if (qualifications.length >= MAX_QUALS) return;
    qualifications.push({ institution: '', name: '', nqfLevel: '', dateObtained: '', subjects: [] });
    renderQualifications();
    listEl.scrollTop = listEl.scrollHeight;
});

nextBtn.addEventListener('click', () => {
    errorBox.classList.remove('visible');
    builder.setQualifications(qualifications);
    window.location.href = 'applicant-signup-cv.html';
});

(async () => {
    await loadNQFLevels();
    renderQualifications();
})();

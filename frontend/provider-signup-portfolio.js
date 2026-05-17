import { requireRole, requireAuth, setState } from './signup-state.js';

if (!requireRole('provider') || !requireAuth()) throw new Error('guard failed');

const errorBox = document.getElementById('global-error');
const nextBtn  = document.getElementById('next-btn');

const types = ['internships', 'apprenticeships', 'learnerships'];

const controls = types.map(id => ({
    id,
    el:  document.getElementById(`chk-${id}`),
    opt: document.getElementById(`opt-${id}`)
}));

controls.forEach(({ el, opt }) => {
    el.addEventListener('change', () => opt.classList.toggle('selected', el.checked));
});

nextBtn.addEventListener('click', () => {
    errorBox.classList.remove('visible');

    const anySelected = controls.some(({ el }) => el.checked);
    if (!anySelected) {
        errorBox.textContent = 'Please select at least one department.';
        errorBox.classList.add('visible');
        return;
    }

    const departments = {};
    controls.forEach(({ id, el }) => {
        if (el.checked) departments[id] = { selected: true };
    });

    // Learnerships and apprenticeships require a DHET number.
    const needsDhet = departments.learnerships || departments.apprenticeships;

    const sequence = [];
    if (needsDhet)                   sequence.push('provider-signup-dhet.html');
    if (departments.learnerships)    sequence.push('provider-signup-dept-learnerships.html');
    if (departments.apprenticeships) sequence.push('provider-signup-dept-apprenticeships.html');
    if (departments.internships)     sequence.push('provider-signup-dept-internships.html');

    setState({ departments, pageSequence: sequence, pageSequenceIdx: 0 });

    window.location.href = sequence[0] || 'provider-signup-complete.html';
});

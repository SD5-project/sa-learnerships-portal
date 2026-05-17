const express = require('express');
const { db }  = require('../firebaseAdmin');

const router = express.Router();

// ─── NQF Levels — fetched from Firestore; falls back to hardcoded list ────────
router.get('/nqf-levels', async (req, res) => {
    try {
        const snapshot = await db.collection("NQFLevels").orderBy("level").get();
        const levels   = [];
        snapshot.forEach(doc => levels.push(doc.data()));

        if (levels.length > 0) {
            return res.json({ levels });
        }
        // Firestore collection empty — use hardcoded fallback
        throw new Error("Empty collection");
    } catch {
        res.json({ levels: [
            { level: 1,  name: "Grade 9",                        example: "ABET Level 4" },
            { level: 2,  name: "Grade 10",                       example: "Elementary Certificate" },
            { level: 3,  name: "Grade 11",                       example: "Intermediate Certificate" },
            { level: 4,  name: "Grade 12 / Matric",              example: "National Senior Certificate" },
            { level: 5,  name: "Higher Certificate",             example: "Short course / HE Certificate" },
            { level: 6,  name: "Diploma / Advanced Certificate", example: "National Diploma" },
            { level: 7,  name: "Bachelor's Degree",              example: "BTech / B-degree" },
            { level: 8,  name: "Honours / Postgrad Diploma",     example: "Honours Degree" },
            { level: 9,  name: "Master's Degree",                example: "MTech / Master's" },
            { level: 10, name: "Doctoral Degree",                example: "DTech / PhD" },
        ]});
    }
});

module.exports = router;

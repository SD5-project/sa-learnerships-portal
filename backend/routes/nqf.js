/**
 * routes/nqf.js
 * Serves the South African National Qualifications Framework (NQF) level data.
 *
 * SA Data Integration requirement: NQF levels are sourced from the NQFLevels
 * Firestore collection, which is seeded from publicly available SAQA data.
 * If the collection is empty or unreachable, a hardcoded fallback list is used
 * so qualification dropdowns always render.
 */

const express = require('express');
const { db }  = require('../firebaseAdmin');

const router = express.Router();

/**
 * GET /nqf-levels
 * Returns an ordered list of all NQF levels with their name and example qualification.
 * Used to populate qualification dropdowns across the app.
 *
 * Response: { levels: [{ level: number, name: string, example: string }] }
 */
router.get('/nqf-levels', async (req, res) => {
    try {
        // Attempt to fetch live data from Firestore, ordered by level number
        const snapshot = await db.collection("NQFLevels").orderBy("level").get();
        const levels   = [];
        snapshot.forEach(doc => levels.push(doc.data()));

        if (levels.length > 0) {
            return res.json({ levels });
        }

        // Collection exists but is empty — fall through to hardcoded fallback
        throw new Error("Empty collection");

    } catch {
        // Firestore unavailable or empty: return hardcoded SAQA-aligned NQF levels
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

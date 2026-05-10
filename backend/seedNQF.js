// backend/seedNQF.js
// ─────────────────────────────────────────────────
// Seeds NQF levels into Firestore from SAQA data
// Source: South African Qualifications Authority
// URL: https://www.saqa.org.za/show.php?id=7107
// Date Accessed: 09 May 2026
// ─────────────────────────────────────────────────
// Run with: npm run seed:nqf

const { db } = require("./firebaseAdmin");

const nqfLevels = [
    {
        level:       1,
        name:        "General Certificate",
        description: "Grade 9 / ABET Level 4",
        example:     "Grade 9",
        source:      "SAQA",
        sourceUrl:   "https://www.saqa.org.za"
    },
    {
        level:       2,
        name:        "General Certificate",
        description: "Grade 10",
        example:     "Grade 10",
        source:      "SAQA",
        sourceUrl:   "https://www.saqa.org.za"
    },
    {
        level:       3,
        name:        "General Certificate",
        description: "Grade 11",
        example:     "Grade 11",
        source:      "SAQA",
        sourceUrl:   "https://www.saqa.org.za"
    },
    {
        level:       4,
        name:        "National Senior Certificate",
        description: "Matric / Grade 12",
        example:     "Matric",
        source:      "SAQA",
        sourceUrl:   "https://www.saqa.org.za"
    },
    {
        level:       5,
        name:        "Higher Certificate",
        description: "Higher Certificate / N4-N6",
        example:     "Higher Certificate",
        source:      "SAQA",
        sourceUrl:   "https://www.saqa.org.za"
    },
    {
        level:       6,
        name:        "Diploma",
        description: "National Diploma / Advanced Certificate",
        example:     "National Diploma",
        source:      "SAQA",
        sourceUrl:   "https://www.saqa.org.za"
    },
    {
        level:       7,
        name:        "Bachelor's Degree",
        description: "3 year Degree / Advanced Diploma",
        example:     "BA / BSc / BCom",
        source:      "SAQA",
        sourceUrl:   "https://www.saqa.org.za"
    },
    {
        level:       8,
        name:        "Honours / Postgraduate Certificate",
        description: "Honours Degree / Postgraduate Certificate",
        example:     "Honours Degree",
        source:      "SAQA",
        sourceUrl:   "https://www.saqa.org.za"
    },
    {
        level:       9,
        name:        "Master's Degree",
        description: "Master's Degree",
        example:     "MA / MSc / MCom",
        source:      "SAQA",
        sourceUrl:   "https://www.saqa.org.za"
    },
    {
        level:       10,
        name:        "Doctoral Degree",
        description: "PhD / Doctoral Degree",
        example:     "PhD",
        source:      "SAQA",
        sourceUrl:   "https://www.saqa.org.za"
    }
];

async function seedNQFLevels() {
    console.log("Seeding NQF levels from SAQA data...");
    console.log("Source: https://www.saqa.org.za");
    console.log("─────────────────────────────────");

    try {
        for (const nqf of nqfLevels) {
            await db.collection("NQFLevels")
                .doc(`level${nqf.level}`)
                .set(nqf);
            console.log(`✓ Added NQF Level ${nqf.level}: ${nqf.name} (${nqf.example})`);
        }
        console.log("─────────────────────────────────");
        console.log("Done! All 10 NQF levels seeded successfully.");
    } catch (error) {
        console.error("Seeding failed:", error.message);
    }

    process.exit(0);
}

seedNQFLevels();
/**
 * build-pay-lookup.mjs
 *
 * Pre-processes raw OPM pay scale JSONs into compact per-year lookup files
 * served from /public/pay-scales/.
 *
 * Input:  src/data/pay-scales/YYYY-general-schedule-pay-rates.json
 * Output: public/pay-scales/YYYY.json   → { "LOC:GRADE:STEP": annual, ... }
 *         public/pay-scales/index.json  → { "years": [2016, ..., 2026] }
 *
 * TO ADD A NEW YEAR:
 *   1. Drop the new JSON file into src/data/pay-scales/
 *      Name it: YYYY-general-schedule-pay-rates.json
 *   2. Run `npm run build` (or `node scripts/build-pay-lookup.mjs` directly)
 *   That's it — this script auto-discovers all files in that folder.
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root       = join(__dirname, '..');
const inputDir   = join(root, 'src/data/pay-scales');
const outputDir  = join(root, 'public/pay-scales');

mkdirSync(outputDir, { recursive: true });

const files = readdirSync(inputDir)
  .filter(f => f.endsWith('.json'))
  .sort();

if (files.length === 0) {
  console.error('No JSON files found in src/data/pay-scales/');
  process.exit(1);
}

const availableYears = [];

for (const fname of files) {
  const year = parseInt(fname.slice(0, 4), 10);

  if (isNaN(year)) {
    console.warn(`Skipping ${fname} — filename must start with a 4-digit year`);
    continue;
  }

  const raw     = JSON.parse(readFileSync(join(inputDir, fname), 'utf8'));
  const rootKey = Object.keys(raw)[0];
  const entries = raw[rootKey];

  if (!Array.isArray(entries)) {
    console.warn(`Skipping ${fname} — unexpected structure (root key: "${rootKey}")`);
    continue;
  }

  // Compact format: "LOCALITY:GRADE:STEP" → annual salary
  const lookup = {};
  let entryCount = 0;

  for (const entry of entries) {
    const { location, grade, steps } = entry;
    if (!location || !grade || !Array.isArray(steps)) continue;

    for (const { step, annual } of steps) {
      lookup[`${location}:${grade}:${step}`] = annual;
      entryCount++;
    }
  }

  writeFileSync(
    join(outputDir, `${year}.json`),
    JSON.stringify(lookup)   // no pretty-print — keep it small
  );

  availableYears.push(year);
  console.log(`✓ ${year}  →  ${entryCount} entries`);
}

// Index file — tells the UI which years are available without fetching each one
writeFileSync(
  join(outputDir, 'index.json'),
  JSON.stringify({ years: availableYears.sort((a, b) => a - b) })
);

console.log(`\n✓ index.json written — ${availableYears.length} years available`);
console.log(`  Output: public/pay-scales/\n`);

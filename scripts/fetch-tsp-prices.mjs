/**
 * fetch-tsp-prices.mjs
 *
 * Downloads the full TSP fund share-price history CSV from tsp.gov and
 * writes it to src/data/tsp/fund-price-history.csv.
 *
 * The write is gated by validation so a bad, truncated, or blocked fetch
 * never clobbers the last known-good file:
 *   - response must be HTTP 200
 *   - header row must contain the core funds (G/F/C/S/I) that have existed
 *     since inception
 *   - row count must not be suspiciously small
 *   - row count must not shrink vs. the file already on disk (history only grows)
 *   - newest date must not go backwards vs. the file already on disk
 *
 * tsp.gov returns 403 for non-browser User-Agents, so one is set explicitly.
 *
 * Usage: node scripts/fetch-tsp-prices.mjs
 */

import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const outputDir = join(root, 'src/data/tsp');
const outputFile = join(outputDir, 'fund-price-history.csv');
const tmpFile = `${outputFile}.tmp`;

const SOURCE_URL = 'https://www.tsp.gov/data/fund-price-history.csv';
const EXPECTED_CORE_FUNDS = ['G Fund', 'F Fund', 'C Fund', 'S Fund', 'I Fund'];
const MIN_EXPECTED_ROWS = 1000;

async function fetchCsv() {
  const res = await fetch(SOURCE_URL, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    },
  });

  if (!res.ok) {
    throw new Error(`Fetch failed: HTTP ${res.status} ${res.statusText}`);
  }

  return res.text();
}

/**
 * Splits raw CSV text into CRLF-normalized lines, dropping blank lines and
 * rows with no date in the first field (tsp.gov's export ends with a
 * trailing comma-only row that has no date and no data in any column).
 */
function parseRows(csvText) {
  return csvText
    .split('\n')
    .map((line) => line.replace(/\r$/, ''))
    .filter((line) => line.trim().length > 0 && !line.startsWith(','));
}

/** Rows are sorted newest-first, so rows[1] is the most recent data row. */
function validate(rows, previousRows) {
  const errors = [];

  const header = (rows[0] ?? '').split(',');
  const missingFunds = EXPECTED_CORE_FUNDS.filter((f) => !header.includes(f));
  if (missingFunds.length > 0) {
    errors.push(`header missing expected fund columns: ${missingFunds.join(', ')}`);
  }

  const dataRowCount = rows.length - 1;
  if (dataRowCount < MIN_EXPECTED_ROWS) {
    errors.push(`only ${dataRowCount} data rows — expected at least ${MIN_EXPECTED_ROWS}`);
  }

  if (previousRows) {
    const prevDataRowCount = previousRows.length - 1;
    if (dataRowCount < prevDataRowCount) {
      errors.push(
        `new file has fewer rows than the one on disk (${dataRowCount} < ${prevDataRowCount})`
      );
    }

    const newestDate = rows[1]?.split(',')[0];
    const prevNewestDate = previousRows[1]?.split(',')[0];
    if (newestDate && prevNewestDate && newestDate < prevNewestDate) {
      errors.push(`newest date went backwards (${newestDate} < ${prevNewestDate})`);
    }
  }

  return errors;
}

async function main() {
  mkdirSync(outputDir, { recursive: true });

  const previousRows = existsSync(outputFile)
    ? parseRows(readFileSync(outputFile, 'utf8'))
    : null;

  const csvText = await fetchCsv();
  const rows = parseRows(csvText);

  const errors = validate(rows, previousRows);
  if (errors.length > 0) {
    console.error('Refusing to update fund-price-history.csv:');
    for (const err of errors) console.error(`  - ${err}`);
    process.exit(1);
  }

  writeFileSync(tmpFile, rows.join('\n') + '\n');
  renameSync(tmpFile, outputFile);

  console.log(`Wrote ${rows.length - 1} data rows to src/data/tsp/fund-price-history.csv`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});

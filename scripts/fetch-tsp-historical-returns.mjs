/**
 * fetch-tsp-historical-returns.mjs
 *
 * Downloads TSP's official monthly rates-of-return summary and extracts
 * the real, published monthly % returns for the five core funds (G, F, C,
 * S, I) from each fund's true inception through 2003-05 — the month that
 * ends exactly at the $10.0000 rebasing anchor that's the oldest row in
 * src/data/tsp/fund-price-history.csv.
 *
 * Why this file exists separately from fund-price-history.csv: that file
 * only goes back to the May 2003 share-price rebasing (when TSP switched
 * bookkeeping systems and reset every fund to $10.00). The funds existed
 * well before that — G since 4/1987, F/C since 1/1988, S/I since 5/2001 —
 * TSP just didn't publish daily share prices for that period, only
 * monthly returns. This script captures that real (not synthetic/proxy)
 * pre-rebasing history at the only resolution TSP actually published it.
 *
 * The cutoff is exactly 2003-05 inclusive: that month's return covers
 * end-of-April-2003 through end-of-May-2003, landing exactly on the
 * $10.00 anchor. fund-price-history.csv's daily data resumes the very
 * next trading day (2003-06-02), so there is no overlap and no gap.
 *
 * This is step 1 (capture the real data) of extending the TSP history
 * further back for Monte Carlo purposes — see GitHub Issue #1. It does
 * NOT yet integrate with fund-price-history.csv or build-tsp-lookup.mjs;
 * that's a separate step once this raw data is validated.
 *
 * Source: the same AJAX endpoint TSP's own /fund-performance/ page uses
 * to render its "Rates of Return" accordion (found via its
 * rates-of-returns.js / ajaxFetch.js, not a documented public API).
 *
 * Usage: node scripts/fetch-tsp-historical-returns.mjs
 */

import { writeFileSync, renameSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const outputDir = join(root, 'src/data/tsp');
const outputFile = join(outputDir, 'monthly-returns-pre2003.csv');
const tmpFile = `${outputFile}.tmp`;

const SOURCE_URL =
  'https://www.tsp.gov/data/getMonthlyReturnsSummary.csv?&Lfunds=1&InvFunds=1&IndexFunds=1&Lifetime=1&Inception=1&Trailing=1';

const FUNDS = ['G Fund', 'F Fund', 'C Fund', 'S Fund', 'I Fund'];

// Inclusive cutoff — see file header comment for why this exact month.
const CUTOFF_YYYYMM = 200305;

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

function main() {
  return fetchCsv().then((csvText) => {
    const lines = csvText.trim().split('\n');
    const header = lines[0].split(',');
    const fundCols = FUNDS.map((f) => {
      const idx = header.indexOf(f);
      if (idx === -1) throw new Error(`Expected column "${f}" not found in source header`);
      return idx;
    });

    // Drop header and the trailing "as of <date>" line; keep only monthly
    // ("m" type) rows at/before the cutoff.
    const rows = lines
      .slice(1, -1)
      .map((l) => l.split(','))
      .filter((r) => r[0] === 'm' && Number(r[1]) <= CUTOFF_YYYYMM);

    if (rows.length < 100) {
      throw new Error(
        `Only ${rows.length} monthly rows at/before ${CUTOFF_YYYYMM} — expected 190+. ` +
          `Source format may have changed; refusing to write.`
      );
    }

    // Sanity check: earliest row per fund should match known real TSP
    // inception months. If TSP's data changes, this catches it loudly
    // rather than silently writing wrong history.
    const expectedEarliest = {
      'G Fund': 198704,
      'F Fund': 198801,
      'C Fund': 198801,
      'S Fund': 200105,
      'I Fund': 200105,
    };
    for (const fund of FUNDS) {
      const col = header.indexOf(fund);
      const withValue = rows.filter((r) => r[col]?.trim() !== '');
      const earliest = withValue.length
        ? Math.min(...withValue.map((r) => Number(r[1])))
        : null;
      if (earliest !== expectedEarliest[fund]) {
        throw new Error(
          `${fund}: expected earliest month ${expectedEarliest[fund]}, got ${earliest}. ` +
            `Refusing to write — verify source data before updating the expected value.`
        );
      }
    }

    // newest-first, to match fund-price-history.csv's convention
    rows.sort((a, b) => Number(b[1]) - Number(a[1]));

    const outHeader = ['Month', ...FUNDS];
    const outLines = [outHeader.join(',')];
    for (const r of rows) {
      const yyyymm = r[1];
      const month = `${yyyymm.slice(0, 4)}-${yyyymm.slice(4, 6)}`;
      const values = fundCols.map((c) => (r[c]?.trim() ? r[c].trim() : ''));
      outLines.push([month, ...values].join(','));
    }

    mkdirSync(outputDir, { recursive: true });
    writeFileSync(tmpFile, outLines.join('\n') + '\n');
    renameSync(tmpFile, outputFile);

    console.log(
      `Wrote ${rows.length} monthly rows (through ${CUTOFF_YYYYMM.toString().slice(0, 4)}-` +
        `${CUTOFF_YYYYMM.toString().slice(4, 6)}) to src/data/tsp/monthly-returns-pre2003.csv`
    );
  });
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});

/**
 * build-tsp-lookup.mjs
 *
 * Pre-processes the raw TSP share-price CSV into JSON views served from
 * /public/tsp/. The CSV is parsed once into an in-memory row set; both
 * views below are derived from that same parse so they can't drift apart.
 *
 * Input:  src/data/tsp/fund-price-history.csv       (fetched daily by fetch-tsp-prices.mjs)
 *         src/data/tsp/monthly-returns-pre2003.csv  (fetched manually/rarely by
 *                                                     fetch-tsp-historical-returns.mjs — see below)
 * Output: public/tsp/<FUND>.json          → { fund, name, inception, asOf, count, prices: [{date, price}, ...] }
 *         public/tsp/monthly-returns.json → sparse monthly returns for the Monte Carlo bootstrap: { dailyDataFrom, months, funds, returns: { <FUND>: [return|null, ...] } }
 *         public/tsp/index.json           → { funds: ["C", "F", "G", "I", "L-Income", ...] }
 *
 * Each fund's `prices` in <FUND>.json only contains dates from that fund's
 * own inception onward (blank cells in the source CSV before a fund existed
 * are dropped). The in-memory daily matrix (every fund aligned to the same
 * full `dates` array, `null` before a fund's inception) is kept only long
 * enough to derive monthly-returns.json below — it used to also be written
 * out as TSP.json for cross-fund correlation, but nothing ever consumed
 * that file once the Monte Carlo engine settled on monthly resampling, so
 * it was dropped rather than keep generating 683KB nothing reads.
 *
 * monthly-returns.json: each fund's return for a calendar month is its last
 * available price that month vs. the prior month's. The most recent
 * calendar month is always dropped — since prices are fetched daily rather
 * than only at month-end, the latest month is still in progress, and
 * treating a partial month as a full month's return would bias the
 * bootstrap sample toward smaller-magnitude moves.
 *
 * PRE-2003 MERGE (GitHub Issue #1, first tier — real data, not synthetic):
 * fund-price-history.csv only goes back to TSP's May 2003 share-price
 * rebasing (every fund reset to $10.0000 that day), so daily-derived
 * returns are only possible from 2003-06 onward. The daily-derived
 * calculation above still produces a "2003-05" entry, but with a `null`
 * return for every fund — there's no 2003-04 daily price to diff against.
 * monthly-returns-pre2003.csv fills that null with TSP's own real
 * published monthly return for May 2003, then extends further back to
 * each of G/F/C/S/I's true inception (1987-04, 1988-01, 1988-01, 2001-05,
 * 2001-05 respectively) — see that script's header for full provenance.
 * L funds get `null` for this whole prepended range; none of them existed
 * before 2005. This does NOT touch <FUND>.json's daily `prices` — the
 * historic price chart intentionally stays at its real daily resolution
 * (2003+) rather than mixing in monthly-resolution points, since the
 * chart's x-axis spaces points by index, not by elapsed time; splicing in
 * sparser pre-2003 points there would visually compress 16 real years into
 * what looks like a few months. Only the Monte Carlo bootstrap (which
 * samples returns statistically, not visually) gets the longer history.
 * `dailyDataFrom` in the output marks the boundary so the UI can disclose
 * the resolution change honestly.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname   = dirname(fileURLToPath(import.meta.url));
const root        = join(__dirname, '..');
const inputFile   = join(root, 'src/data/tsp/fund-price-history.csv');
const pre2003File = join(root, 'src/data/tsp/monthly-returns-pre2003.csv');
const outputDir   = join(root, 'public/tsp');

mkdirSync(outputDir, { recursive: true });

/** "G Fund" → "G", "L Income" → "L-Income", "L 2030" → "L2030" */
function slugify(fundName) {
  if (fundName === 'L Income') return 'L-Income';
  const lMatch = fundName.match(/^L (\d{4})$/);
  if (lMatch) return `L${lMatch[1]}`;
  const coreMatch = fundName.match(/^([A-Z]) Fund$/);
  if (coreMatch) return coreMatch[1];
  return fundName.replace(/\s+/g, '-');
}

const lines = readFileSync(inputFile, 'utf8')
  .split('\n')
  .filter((line) => line.trim().length > 0);

if (lines.length < 2) {
  console.error('src/data/tsp/fund-price-history.csv has no data rows');
  process.exit(1);
}

const header = lines[0].split(',');
const fundNames = header.slice(1);
const fundSlugs = fundNames.map(slugify);

// Source rows are newest-first; walk in reverse to build oldest→newest series.
// Guard against any stray row with no date (tsp.gov's export has been seen
// to end with a trailing comma-only row).
const rows = lines
  .slice(1)
  .reverse()
  .map((line) => line.split(','))
  .filter((fields) => fields[0] !== '');
const dates = rows.map((fields) => fields[0]);

const availableFunds = [];
const matrixPrices = {};

for (let col = 0; col < fundNames.length; col++) {
  const fundName = fundNames[col];
  const slug = fundSlugs[col];

  const prices = [];
  const column = new Array(rows.length);

  rows.forEach((fields, i) => {
    const raw = fields[col + 1];
    const price = raw === undefined || raw === '' ? null : parseFloat(raw);
    column[i] = price;
    if (price !== null) prices.push({ date: fields[0], price });
  });

  if (prices.length === 0) {
    console.warn(`Skipping ${fundName} — no price data`);
    continue;
  }

  matrixPrices[slug] = column;

  const output = {
    fund: slug,
    name: fundName,
    inception: prices[0].date,
    asOf: prices[prices.length - 1].date,
    count: prices.length,
    prices,
  };

  writeFileSync(join(outputDir, `${slug}.json`), JSON.stringify(output));

  availableFunds.push(slug);
  console.log(`✓ ${slug.padEnd(9)} ${output.inception} → ${output.asOf}  (${output.count} rows)`);
}

availableFunds.sort();

writeFileSync(
  join(outputDir, 'index.json'),
  JSON.stringify({ funds: availableFunds })
);
console.log(`\n✓ index.json written — ${availableFunds.length} funds available`);

// --- Monthly returns for Monte Carlo bootstrap resampling ---
// (derived from matrixPrices, the in-memory daily matrix built above)
const monthKeys = [];
const lastRowIndexByMonth = new Map();
for (let i = 0; i < rows.length; i++) {
  const key = dates[i].slice(0, 7); // "YYYY-MM"
  if (!lastRowIndexByMonth.has(key)) monthKeys.push(key);
  lastRowIndexByMonth.set(key, i); // overwritten each hit -> ends up as that month's last row
}

// Drop the most recent (still in-progress) month.
const completeMonthKeys = monthKeys.slice(0, -1);

const monthlyReturns = {};
for (const slug of availableFunds) {
  const column = matrixPrices[slug];
  const monthEndPrices = completeMonthKeys.map((key) => column[lastRowIndexByMonth.get(key)]);

  monthlyReturns[slug] = monthEndPrices.map((price, i) => {
    const prev = i > 0 ? monthEndPrices[i - 1] : null;
    return price === null || prev === null ? null : price / prev - 1;
  });
}

// --- Merge in real pre-2003 monthly returns (see file header) ---
const pre2003Lines = readFileSync(pre2003File, 'utf8')
  .trim()
  .split('\n')
  .filter((line) => line.length > 0);
const pre2003FundNames = pre2003Lines[0].split(',').slice(1); // ["G Fund", "F Fund", ...]
// Source file is newest-first (matches fund-price-history.csv's convention);
// reverse to oldest-first so it can be concatenated directly onto the front
// of the oldest-first arrays built above.
const pre2003Rows = pre2003Lines.slice(1).map((line) => line.split(',')).reverse();
const pre2003Months = pre2003Rows.map((r) => r[0]); // "YYYY-MM", oldest -> newest

// The pre-2003 file's newest month must be exactly the daily-derived series'
// oldest month — that's the seam where the two datasets meet with no gap or
// overlap (see header comment). If fund-price-history.csv's oldest date ever
// changes, this will no longer hold, and merging blindly would silently
// produce a gap or a duplicated/conflicting month — so fail loudly instead.
const seamMonth = pre2003Months[pre2003Months.length - 1];
if (seamMonth !== completeMonthKeys[0]) {
  console.error(
    `Cannot merge monthly-returns-pre2003.csv: its newest month (${seamMonth}) ` +
      `does not match the daily-derived series' oldest month (${completeMonthKeys[0]}). ` +
      `Refusing to merge pre-2003 data into monthly-returns.json.`
  );
  process.exit(1);
}

const pre2003BySlug = {};
pre2003FundNames.forEach((fundName, col) => {
  const slug = slugify(fundName);
  pre2003BySlug[slug] = pre2003Rows.map((r) => {
    const raw = r[col + 1]?.trim();
    return raw ? parseFloat(raw) / 100 : null; // "0.34" (percent) -> 0.0034 (ratio), matching monthlyReturns' units
  });
});

const months = [...pre2003Months.slice(0, -1), ...completeMonthKeys];
const dailyDataFrom = completeMonthKeys[1]; // first month whose return is actually derived from daily prices

const mergedReturns = {};
for (const slug of availableFunds) {
  const pre = pre2003BySlug[slug];
  mergedReturns[slug] = pre
    ? [...pre, ...monthlyReturns[slug].slice(1)] // core fund: real pre-2003 data, then daily-derived from the seam's real value onward
    : [...pre2003Months.slice(0, -1).map(() => null), ...monthlyReturns[slug]]; // L fund: didn't exist yet, null-pad the prepended range
}

writeFileSync(
  join(outputDir, 'monthly-returns.json'),
  JSON.stringify({
    asOf: completeMonthKeys[completeMonthKeys.length - 1],
    dailyDataFrom,
    months,
    funds: availableFunds,
    returns: mergedReturns,
  })
);
console.log(
  `✓ monthly-returns.json written — ${months.length} months (real data from ${months[0]}, ` +
    `daily-derived from ${dailyDataFrom}) × ${availableFunds.length} funds (sparse)`
);

console.log(`  Output: public/tsp/\n`);

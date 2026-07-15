/**
 * build-tsp-lookup.mjs
 *
 * Pre-processes the raw TSP share-price CSV into JSON views served from
 * /public/tsp/. The CSV is parsed once into an in-memory row set; both
 * views below are derived from that same parse so they can't drift apart.
 *
 * Input:  src/data/tsp/fund-price-history.csv  (fetched by fetch-tsp-prices.mjs)
 * Output: public/tsp/<FUND>.json          → { fund, name, inception, asOf, count, prices: [{date, price}, ...] }
 *         public/tsp/TSP.json             → sparse matrix for correlation: { dates, funds, prices: { <FUND>: [price|null, ...] } }
 *         public/tsp/monthly-returns.json → sparse monthly returns for the Monte Carlo bootstrap: { months, funds, returns: { <FUND>: [return|null, ...] } }
 *         public/tsp/index.json           → { funds: ["C", "F", "G", "I", "L-Income", ...] }
 *
 * Each fund's `prices` in <FUND>.json only contains dates from that fund's
 * own inception onward (blank cells in the source CSV before a fund existed
 * are dropped). TSP.json instead keeps every fund aligned to the same full
 * `dates` array, with `null` for dates before a fund's inception, so it can
 * be used to compute cross-fund correlations for portfolio simulation.
 *
 * monthly-returns.json is derived from the same matrix: each fund's return
 * for a calendar month is its last available price that month vs. the prior
 * month's. The most recent calendar month is always dropped — since prices
 * are fetched daily rather than only at month-end, the latest month is
 * still in progress, and treating a partial month as a full month's return
 * would bias the bootstrap sample toward smaller-magnitude moves.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root       = join(__dirname, '..');
const inputFile  = join(root, 'src/data/tsp/fund-price-history.csv');
const outputDir  = join(root, 'public/tsp');

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

writeFileSync(
  join(outputDir, 'TSP.json'),
  JSON.stringify({
    asOf: dates[dates.length - 1],
    count: dates.length,
    funds: availableFunds,
    dates,
    prices: matrixPrices,
  })
);
console.log(`✓ TSP.json written — ${dates.length} dates × ${availableFunds.length} funds (sparse)`);

// --- Monthly returns for Monte Carlo bootstrap resampling ---
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

writeFileSync(
  join(outputDir, 'monthly-returns.json'),
  JSON.stringify({
    asOf: completeMonthKeys[completeMonthKeys.length - 1],
    months: completeMonthKeys,
    funds: availableFunds,
    returns: monthlyReturns,
  })
);
console.log(
  `✓ monthly-returns.json written — ${completeMonthKeys.length} complete months × ${availableFunds.length} funds (sparse)`
);

console.log(`  Output: public/tsp/\n`);

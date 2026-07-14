/**
 * test-high3.mjs
 * Run: node scripts/test-high3.mjs
 *
 * Tests the High-3 calculation logic with concrete scenarios and known expected values.
 * Duplicates the core functions from high3.ts in plain JS to run without a build step.
 */

// ---------------------------------------------------------------------------
// Core functions (mirrors high3.ts exactly)
// ---------------------------------------------------------------------------

function toOPMDay(dateStr) {
  const [year, month, day] = dateStr.split('-').map(Number);
  return year * 360 + (month - 1) * 30 + Math.min(day, 30);
}

function fromOPMDay(opmDay) {
  let year = Math.floor(opmDay / 360);
  let remaining = opmDay % 360;
  if (remaining === 0) { year -= 1; remaining = 360; }
  const month = Math.floor((remaining - 1) / 30) + 1;
  const day = ((remaining - 1) % 30) + 1;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function calculateHigh3(periods) {
  if (!periods || periods.length === 0) return null;

  const segments = periods
    .map(p => ({
      start: toOPMDay(p.startDate),
      end:   toOPMDay(p.endDate),
      annualSalary: p.annualSalary,
      dailyRate:    p.annualSalary / 360,
    }))
    .filter(s => s.end > s.start)
    .sort((a, b) => a.start - b.start);

  if (segments.length === 0) return null;

  const serviceStart      = segments[0].start;
  const serviceEnd        = segments[segments.length - 1].end;
  const totalServiceDays  = serviceEnd - serviceStart;
  const HIGH3_DAYS        = 1080;
  const windowDays        = Math.min(HIGH3_DAYS, totalServiceDays);
  const isPartialPeriod   = totalServiceDays < HIGH3_DAYS;

  const candidates = new Set();
  candidates.add(serviceStart);
  for (const seg of segments) {
    candidates.add(seg.start);
    candidates.add(seg.end - windowDays);
  }

  let bestEarned      = -1;
  let bestWindowStart = serviceStart;
  const minStart      = serviceStart;
  const maxStart      = serviceEnd - windowDays;

  for (const candidate of candidates) {
    if (candidate < minStart || candidate > maxStart) continue;
    const wEnd  = candidate + windowDays;
    let earned  = 0;
    for (const seg of segments) {
      const os = Math.max(seg.start, candidate);
      const oe = Math.min(seg.end,   wEnd);
      if (oe > os) earned += (oe - os) * seg.dailyRate;
    }
    if (earned > bestEarned) { bestEarned = earned; bestWindowStart = candidate; }
  }

  const high3Average = Math.round((bestEarned * 360) / windowDays * 100) / 100;

  const wStart = bestWindowStart;
  const wEnd   = bestWindowStart + windowDays;
  const contributions = [];
  for (const seg of segments) {
    const os = Math.max(seg.start, wStart);
    const oe = Math.min(seg.end,   wEnd);
    if (oe > os) {
      contributions.push({
        startDate: fromOPMDay(os),
        endDate:   fromOPMDay(oe),
        annualSalary: seg.annualSalary,
        opmDays: oe - os,
        dollarContribution: Math.round((oe - os) * seg.dailyRate * 100) / 100,
      });
    }
  }

  return { high3Average, windowStart: fromOPMDay(wStart), windowEnd: fromOPMDay(wEnd),
           contributions, totalServiceOPMDays: totalServiceDays, isPartialPeriod };
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

function assert(label, actual, expected, tolerance = 1) {
  const ok = Math.abs(actual - expected) <= tolerance;
  if (ok) {
    console.log(`  ✅ ${label}: $${actual.toLocaleString()}`);
    passed++;
  } else {
    console.log(`  ❌ ${label}`);
    console.log(`     Expected: $${expected.toLocaleString()}`);
    console.log(`     Got:      $${actual.toLocaleString()}`);
    failed++;
  }
}

function assertStr(label, actual, expected) {
  const ok = actual === expected;
  if (ok) {
    console.log(`  ✅ ${label}: ${actual}`);
    passed++;
  } else {
    console.log(`  ❌ ${label}`);
    console.log(`     Expected: ${expected}`);
    console.log(`     Got:      ${actual}`);
    failed++;
  }
}

// ---------------------------------------------------------------------------
// Test 1: OPM date round-trip
// ---------------------------------------------------------------------------
console.log('\n── Test 1: OPM date arithmetic ─────────────────────────────────');

const dates = ['2022-01-01', '2022-06-15', '2022-12-30', '2023-03-01', '2020-02-28'];
for (const d of dates) {
  const opm = toOPMDay(d);
  const back = fromOPMDay(opm);
  assertStr(`round-trip ${d}`, back, d);
}

// Day 31 → treated as day 30
assertStr('Jan 31 = Jan 30', fromOPMDay(toOPMDay('2022-01-31')), '2022-01-30');

// 36 OPM months = exactly 1080 days
const diff = toOPMDay('2025-01-01') - toOPMDay('2022-01-01');
assert('36 OPM months = 1080 days', diff, 1080, 0);

// ---------------------------------------------------------------------------
// Test 2: Single salary — any 36-month window gives the same result
// ---------------------------------------------------------------------------
console.log('\n── Test 2: Single salary, 4 years ($80,000) ────────────────────');
// Employee at $80,000 from 2020-01-01 to 2024-01-01 (4 years = 1440 OPM days)
// High-3 should be exactly $80,000

const t2 = calculateHigh3([
  { startDate: '2020-01-01', endDate: '2024-01-01', annualSalary: 80000 }
]);
assert('High-3 average', t2.high3Average, 80000);
console.log(`     Window: ${t2.windowStart} → ${t2.windowEnd}`);

// ---------------------------------------------------------------------------
// Test 3: Rising salary — highest window is the LAST 3 years
// ---------------------------------------------------------------------------
console.log('\n── Test 3: Rising salary — should pick last 36 months ──────────');
// 2020-01-01 to 2022-01-01: $70,000  (24 months)
// 2022-01-01 to 2024-01-01: $90,000  (24 months)
// Best window: 2021-01-01 → 2024-01-01
//   12 months @ $70k + 24 months @ $90k
//   = (360×(70000/360) + 720×(90000/360)) / 3
//   = (70000 + 180000) / 3 = $83,333.33

const t3 = calculateHigh3([
  { startDate: '2020-01-01', endDate: '2022-01-01', annualSalary: 70000 },
  { startDate: '2022-01-01', endDate: '2024-01-01', annualSalary: 90000 },
]);
assert('High-3 average', t3.high3Average, 83333, 1);
assertStr('Window start', t3.windowStart, '2021-01-01');
assertStr('Window end',   t3.windowEnd,   '2024-01-01');

// ---------------------------------------------------------------------------
// Test 4: Falling salary — highest window is the FIRST 3 years
// ---------------------------------------------------------------------------
console.log('\n── Test 4: Falling salary — should pick first 36 months ────────');
// 2020-01-01 to 2022-01-01: $90,000  (24 months)
// 2022-01-01 to 2024-01-01: $70,000  (24 months)
// Best window: 2020-01-01 → 2023-01-01
//   24 months @ $90k + 12 months @ $70k
//   = (720×(90000/360) + 360×(70000/360)) / 3
//   = (180000 + 70000) / 3 = $83,333.33

const t4 = calculateHigh3([
  { startDate: '2020-01-01', endDate: '2022-01-01', annualSalary: 90000 },
  { startDate: '2022-01-01', endDate: '2024-01-01', annualSalary: 70000 },
]);
assert('High-3 average', t4.high3Average, 83333, 1);
assertStr('Window start', t4.windowStart, '2020-01-01');
assertStr('Window end',   t4.windowEnd,   '2023-01-01');

// ---------------------------------------------------------------------------
// Test 5: Mid-career spike — window should center on the spike
// ---------------------------------------------------------------------------
console.log('\n── Test 5: Mid-career spike ─────────────────────────────────────');
// 2019-01-01 to 2021-01-01: $70,000  (24 months)
// 2021-01-01 to 2022-01-01: $110,000 (12 months)
// 2022-01-01 to 2024-01-01: $80,000  (24 months)
//
// Window A: 2019-01-01 → 2022-01-01 — 24mo@$70k + 12mo@$110k
//   = (720×70000 + 360×110000) / 360 / 3 = (194444 + 110000) / 3... let me calc properly
//   earned = 720×(70000/360) + 360×(110000/360) = 140000 + 110000 = 250000
//   High-3 = 250000/3 = $83,333
//
// Window B: 2020-01-01 → 2023-01-01 — 12mo@$70k + 12mo@$110k + 12mo@$80k
//   earned = 360×(70000/360) + 360×(110000/360) + 360×(80000/360)
//          = 70000 + 110000 + 80000 = 260000
//   High-3 = 260000/3 = $86,667
//
// Window C: 2021-01-01 → 2024-01-01 — 12mo@$110k + 24mo@$80k
//   earned = 360×(110000/360) + 720×(80000/360) = 110000 + 160000 = 270000
//   High-3 = 270000/3 = $90,000  ← BEST

const t5 = calculateHigh3([
  { startDate: '2019-01-01', endDate: '2021-01-01', annualSalary: 70000  },
  { startDate: '2021-01-01', endDate: '2022-01-01', annualSalary: 110000 },
  { startDate: '2022-01-01', endDate: '2024-01-01', annualSalary: 80000  },
]);
assert('High-3 average', t5.high3Average, 90000, 1);
assertStr('Window start', t5.windowStart, '2021-01-01');
assertStr('Window end',   t5.windowEnd,   '2024-01-01');

// ---------------------------------------------------------------------------
// Test 6: Partial service — less than 36 months
// ---------------------------------------------------------------------------
console.log('\n── Test 6: Partial period — only 18 months of service ───────────');
// 2023-01-01 to 2024-07-01: $85,000 (18 months = 540 OPM days)
// High-3 uses all available days
// High-3 = $85,000

const t6 = calculateHigh3([
  { startDate: '2023-01-01', endDate: '2024-07-01', annualSalary: 85000 }
]);
assert('High-3 average', t6.high3Average, 85000, 1);
assert('isPartialPeriod = true', t6.isPartialPeriod ? 1 : 0, 1, 0);

// ---------------------------------------------------------------------------
// Test 7: Realistic FERS career — multiple promotions
// ---------------------------------------------------------------------------
console.log('\n── Test 7: Realistic career — 4 promotions over 10 years ───────');
// GS-9  Step 1: 2015-06-01 → 2017-06-01  $52,000   (24 months)
// GS-11 Step 1: 2017-06-01 → 2019-06-01  $63,000   (24 months)
// GS-12 Step 1: 2019-06-01 → 2021-06-01  $75,000   (24 months)
// GS-13 Step 1: 2021-06-01 → 2024-06-01  $89,000   (36 months)
// GS-13 Step 4: 2024-06-01 → 2025-06-01  $97,000   (12 months)
//
// Best window should be 2022-06-01 → 2025-06-01 (last 36 months)
// = 24 months @ $89k + 12 months @ $97k
// earned = 720×(89000/360) + 360×(97000/360) = 178000 + 97000 = 275000
// High-3 = 275000/3 = $91,667

const t7 = calculateHigh3([
  { startDate: '2015-06-01', endDate: '2017-06-01', annualSalary: 52000 },
  { startDate: '2017-06-01', endDate: '2019-06-01', annualSalary: 63000 },
  { startDate: '2019-06-01', endDate: '2021-06-01', annualSalary: 75000 },
  { startDate: '2021-06-01', endDate: '2024-06-01', annualSalary: 89000 },
  { startDate: '2024-06-01', endDate: '2025-06-01', annualSalary: 97000 },
]);
assert('High-3 average', t7.high3Average, 91667, 1);
assertStr('Window start', t7.windowStart, '2022-06-01');
assertStr('Window end',   t7.windowEnd,   '2025-06-01');
console.log('  Contributions:');
for (const c of t7.contributions) {
  console.log(`    ${c.startDate} → ${c.endDate}: $${c.annualSalary.toLocaleString()}/yr × ${c.opmDays} days = $${c.dollarContribution.toLocaleString()}`);
}

// ---------------------------------------------------------------------------
// Test 8: Mid-month promotion (proration)
// ---------------------------------------------------------------------------
console.log('\n── Test 8: Mid-month promotion proration ────────────────────────');
// Promoted on June 15, 2022 from $80,000 to $90,000
// Full 3-year window: 2022-01-01 → 2025-01-01
// Jan 1 → Jun 15: toOPMDay("2022-06-15") - toOPMDay("2022-01-01")
//   = (2022×360 + 5×30 + 15) - (2022×360 + 0 + 1) = (727920+150+15) - (727920+1) = 164 days @ $80k
// Jun 15 → Jan 1 2025: 1080 - 164 = 916 days @ $90k
// earned = 164×(80000/360) + 916×(90000/360) = 36444 + 229000 = 265444
// High-3 = 265444 × 360 / 1080 = 88481.33

const t8 = calculateHigh3([
  { startDate: '2022-01-01', endDate: '2022-06-15', annualSalary: 80000 },
  { startDate: '2022-06-15', endDate: '2025-01-01', annualSalary: 90000 },
]);
// Expected: window 2022-01-01 → 2025-01-01
// 164 days @ $80k + 916 days @ $90k
const expected8 = (164 * (80000/360) + 916 * (90000/360)) * 360 / 1080;
assert('High-3 average', t8.high3Average, Math.round(expected8 * 100) / 100, 1);
assertStr('Window start', t8.windowStart, '2022-01-01');

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log(`\n${'─'.repeat(60)}`);
console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
if (failed > 0) {
  console.log('\n⚠️  Fix the failing tests before building the UI.\n');
  process.exit(1);
} else {
  console.log('\n✅  All tests passed — calculation logic is correct.\n');
}

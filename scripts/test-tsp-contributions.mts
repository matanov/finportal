/**
 * test-tsp-contributions.mts
 * Run: npm run test:tsp
 *
 * Checks the TSP contribution rules in src/lib/tspProjection.ts against the
 * IRS limits, importing the real module (Node strips the TypeScript types),
 * so there is no copy of the logic to drift out of date:
 *   - both elections are deducted every paycheck until the personal limit,
 *     so what goes in of each is in proportion to the elections
 *   - regular limit ($24,500, Traditional + Roth combined) filled by
 *     Traditional first, then Roth
 *   - catch-up of $8,000 from 50, $11,250 at 60–63, $8,000 again from 64
 *   - catch-up all Roth when salary is over $150,000 (not at exactly $150,000):
 *     Roth contributions count as the catch-up first, and Traditional is moved
 *     to Roth only for any shortfall
 *   - every elected dollar is either contributed or reported as over the limit
 * and sanity-checks the projection simulation (src/lib/tspSimulation.ts) on
 * the real monthly-returns data: repeatable, percentiles ordered, Traditional
 * + Roth adding up, and G Fund outcomes far tighter than C Fund ones.
 */

import { readFileSync } from "node:fs";
import {
  CONTRIBUTION_LIMITS as L,
  contributionBreakdown,
  projectContributions,
} from "../src/lib/tspProjection.ts";
import { simulateProjection } from "../src/lib/tspSimulation.ts";

const failures: string[] = [];
let checks = 0;
const near = (a: number, b: number) => Math.abs(a - b) < 0.01;
const expect = (cond: boolean, msg: string) => {
  checks++;
  if (!cond) failures.push(msg);
};
const expectedCatchUp = (age: number) =>
  age < 50 ? 0 : age >= 60 && age <= 63 ? L.catchUp60to63 : L.catchUp50;

// --- Matrix of ages x salaries x elections ---------------------------------
const ages = [45, 49, 50, 55, 59, 60, 61, 62, 63, 64, 70];
const salaries = [90_000, L.rothCatchUpWageThreshold, L.rothCatchUpWageThreshold + 1, 200_000];
const elections: [number, number][] = [[40, 0], [0, 40], [30, 10], [10, 30], [5, 0], [12, 3]];

for (const age of ages) {
  for (const salary of salaries) {
    for (const [trad, roth] of elections) {
      const tag = `age ${age}, salary ${salary}, ${trad}% Traditional + ${roth}% Roth`;
      const b = contributionBreakdown({ salary, mode: "percent", traditional: trad, roth, age });
      const requested = (salary * (trad + roth)) / 100;
      const regular = b.regularTraditional + b.regularRoth;
      const catchUp = b.catchUpTraditional + b.catchUpRoth;
      const rothShare = roth / (trad + roth);
      const contributed = Math.min(requested, L.elective + expectedCatchUp(age));
      const tradIn = contributed * (1 - rothShare);
      const rothIn = contributed * rothShare;

      expect(near(b.catchUpLimit, expectedCatchUp(age)), `${tag}: catch-up limit ${b.catchUpLimit}`);
      expect(near(regular, Math.min(requested, L.elective)), `${tag}: regular ${regular}`);
      expect(
        near(catchUp, Math.min(Math.max(requested - L.elective, 0), expectedCatchUp(age))),
        `${tag}: catch-up ${catchUp}`,
      );
      expect(near(regular + catchUp + b.notContributed, requested), `${tag}: dollars not conserved`);

      const mustBeRoth = age >= 50 && salary > L.rothCatchUpWageThreshold;
      expect(b.rothCatchUpRequired === mustBeRoth, `${tag}: rothCatchUpRequired=${b.rothCatchUpRequired}`);
      const moved = mustBeRoth ? Math.max(0, catchUp - rothIn) : 0;
      expect(near(b.traditionalRedirectedToRoth, moved), `${tag}: moved ${b.traditionalRedirectedToRoth}, expected ${moved}`);
      expect(
        near(b.regularTraditional + b.catchUpTraditional, tradIn - moved),
        `${tag}: Traditional total ${b.regularTraditional + b.catchUpTraditional}`,
      );
      expect(near(b.regularRoth + b.catchUpRoth, rothIn + moved), `${tag}: Roth total ${b.regularRoth + b.catchUpRoth}`);
      if (mustBeRoth) {
        expect(near(b.catchUpTraditional, 0), `${tag}: Traditional catch-up despite Roth rule`);
      } else {
        expect(near(b.regularTraditional, Math.min(tradIn, L.elective)), `${tag}: Traditional should fill regular first`);
      }
    }
  }
}

// --- Specific cases -----------------------------------------------------------
const byType = (i: Parameters<typeof contributionBreakdown>[0]) => {
  const b = contributionBreakdown(i);
  return [b.regularTraditional + b.catchUpTraditional, b.regularRoth + b.catchUpRoth];
};
const cases: [string, Parameters<typeof contributionBreakdown>[0], number, number][] = [
  // Over $150,000: $24,500 Traditional + catch-up as Roth stays as elected
  ["51, $190k, $24,500 T + $8,000 R", { salary: 190_000, mode: "dollars", traditional: 24_500, roth: 8_000, age: 51 }, 24_500, 8_000],
  // Over $150,000, all Traditional: the catch-up goes in as Roth automatically
  ["51, $190k, $32,500 T only", { salary: 190_000, mode: "dollars", traditional: 32_500, roth: 0, age: 51 }, 24_500, 8_000],
  // Roth short of the catch-up: Traditional covers the rest, moved to Roth
  ["51, $190k, $30,000 T + $2,500 R", { salary: 190_000, mode: "dollars", traditional: 30_000, roth: 2_500, age: 51 }, 24_500, 8_000],
  ["61, $190k, $24,500 T + $11,250 R", { salary: 190_000, mode: "dollars", traditional: 24_500, roth: 11_250, age: 61 }, 24_500, 11_250],
  // $150,000 or less: elections kept as they are
  ["55, $100k, $24,500 T + $8,000 R", { salary: 100_000, mode: "dollars", traditional: 24_500, roth: 8_000, age: 55 }, 24_500, 8_000],
  // Under 50 the $24,500 is Traditional + Roth combined, and payroll deducts both each paycheck
  ["45, $100k, $24,500 T + $5,000 R", { salary: 100_000, mode: "dollars", traditional: 24_500, roth: 5_000, age: 45 }, 24_500 * 24_500 / 29_500, 24_500 * 5_000 / 29_500],
];
for (const [label, input, t, r] of cases) {
  const [gotT, gotR] = byType(input);
  expect(near(gotT, t) && near(gotR, r), `${label}: got T ${Math.round(gotT)} R ${Math.round(gotR)}, expected T ${Math.round(t)} R ${Math.round(r)}`);
}

// --- Year by year: 49 → 65 on $200,000, all Traditional ---------------------
const rows = projectContributions(
  { salary: 200_000, mode: "percent", traditional: 20, roth: 0, age: 49 },
  { traditional: 0, roth: 0 },
  17,
);
for (const r of rows) {
  const age = r.age as number;
  expect(near(r.employeeTraditional, L.elective), `yearly age ${age}: Traditional ${r.employeeTraditional}`);
  expect(near(r.employeeRoth, expectedCatchUp(age)), `yearly age ${age}: Roth ${r.employeeRoth}`);
}

// --- Dollar mode with no salary: Roth test can't run, and says so -----------
const noSalary = contributionBreakdown({ salary: 0, mode: "dollars", traditional: 35_000, roth: 0, age: 61 });
expect(noSalary.rothCatchUpUnknown, "no salary at 61 should flag rothCatchUpUnknown");
expect(!noSalary.rothCatchUpRequired, "no salary should not claim the Roth rule applies");

// --- Projection simulation (real TSP monthly returns) ---------------------
const monthlyReturns = JSON.parse(
  readFileSync(new URL("../public/tsp/monthly-returns.json", import.meta.url), "utf8"),
);
const simYears = projectContributions(
  { salary: 100_000, mode: "percent", traditional: 10, roth: 5, age: 40 },
  { traditional: 80_000, roth: 20_000 },
  20,
);
const simArgs = {
  monthlyReturns,
  holdings: [
    { id: "h1", fund: "C", amount: 80_000, roth: false },
    { id: "h2", fund: "C", amount: 20_000, roth: true },
  ],
  allocation: [
    { id: "a1", fund: "C", percent: 60 },
    { id: "a2", fund: "G", percent: 40 },
  ],
  years: simYears,
};
const sim = simulateProjection(simArgs);
expect(simulateProjection(simArgs).average.total === sim.average.total, "simulation should be repeatable");
expect(sim.bands.length === 21 && sim.contributed.length === 21, "one band per year plus today");
expect(near(sim.contributed[0], 100_000), "contributed starts at today's balance");
expect(
  near(sim.contributed[20], 100_000 + simYears.reduce((t, r) => t + r.total, 0)),
  "contributed ends at balance plus all contributions",
);
for (const b of sim.bands) expect(b.p10 <= b.p25 && b.p25 <= b.p50 && b.p50 <= b.p75 && b.p75 <= b.p90, "percentiles ordered");
for (const sc of [sim.below, sim.average, sim.above]) {
  expect(near(sc.traditional + sc.roth, sc.total), "scenario Traditional + Roth = total");
}
expect(sim.below.total <= sim.average.total && sim.average.total <= sim.above.total, "scenarios ordered");
// All-G money barely varies; all-C money varies a lot
const spread = (fund: string) => {
  const r = simulateProjection({
    monthlyReturns,
    holdings: [{ id: "h", fund, amount: 100_000, roth: false }],
    allocation: [{ id: "a", fund, percent: 100 }],
    years: projectContributions({ salary: 0, mode: "percent", traditional: 0, roth: 0, age: 40 }, { traditional: 100_000, roth: 0 }, 20),
  });
  return r.above.total / r.below.total;
};
expect(spread("G") < 1.1, `G Fund 20-year spread should be narrow, got ${spread("G").toFixed(2)}`);
expect(spread("C") > 1.5, `C Fund 20-year spread should be wide, got ${spread("C").toFixed(2)}`);

// --- Report -----------------------------------------------------------------
if (failures.length) {
  console.error(`${failures.length} of ${checks} checks failed:`);
  for (const f of failures.slice(0, 30)) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`All ${checks} TSP contribution and projection checks passed.`);

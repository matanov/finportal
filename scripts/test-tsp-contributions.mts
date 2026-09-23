/**
 * test-tsp-contributions.mts
 * Run: npm run test:tsp
 *
 * Checks the TSP contribution rules in src/lib/tspProjection.ts against the
 * IRS limits, importing the real module (Node strips the TypeScript types),
 * so there is no copy of the logic to drift out of date:
 *   - regular limit shared by Traditional + Roth, split per the elections
 *   - catch-up of $8,000 from 50, $11,250 at 60–63, $8,000 again from 64
 *   - catch-up all Roth when salary is over $150,000 (not at exactly $150,000),
 *     including spillover from a Traditional election
 *   - otherwise catch-up follows the elections
 *   - every elected dollar is either contributed or reported as over the limit
 */

import {
  CONTRIBUTION_LIMITS as L,
  contributionBreakdown,
  projectContributions,
} from "../src/lib/tspProjection.ts";

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

      expect(near(b.catchUpLimit, expectedCatchUp(age)), `${tag}: catch-up limit ${b.catchUpLimit}`);
      expect(near(regular, Math.min(requested, L.elective)), `${tag}: regular ${regular}`);
      expect(
        near(catchUp, Math.min(Math.max(requested - L.elective, 0), expectedCatchUp(age))),
        `${tag}: catch-up ${catchUp}`,
      );
      expect(near(regular + catchUp + b.notContributed, requested), `${tag}: dollars not conserved`);
      if (regular > 0) expect(near(b.regularRoth / regular, rothShare), `${tag}: regular split`);

      const mustBeRoth = age >= 50 && salary > L.rothCatchUpWageThreshold;
      expect(b.rothCatchUpRequired === mustBeRoth, `${tag}: rothCatchUpRequired=${b.rothCatchUpRequired}`);
      if (mustBeRoth) {
        expect(near(b.catchUpTraditional, 0), `${tag}: Traditional catch-up despite Roth rule`);
        expect(
          near(b.traditionalRedirectedToRoth, catchUp * (1 - rothShare)),
          `${tag}: redirected ${b.traditionalRedirectedToRoth}`,
        );
      } else if (catchUp > 0) {
        expect(near(b.catchUpRoth / catchUp, rothShare), `${tag}: catch-up split should follow elections`);
        expect(near(b.traditionalRedirectedToRoth, 0), `${tag}: redirected when not required`);
      }
    }
  }
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

// --- Report -----------------------------------------------------------------
if (failures.length) {
  console.error(`${failures.length} of ${checks} checks failed:`);
  for (const f of failures.slice(0, 30)) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`All ${checks} TSP contribution checks passed.`);

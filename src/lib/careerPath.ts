/**
 * careerPath.ts
 *
 * Simulates a GS career year by year: promotions on a fixed schedule,
 * within-grade step increases in between, and the two-step promotion rule.
 *
 * Simplifications (fine for an illustrative chart, not for pay audits):
 *   - Every pay change takes effect at the start of the calendar year, so a
 *     year's salary is that January's table rate.
 *   - Step waiting periods follow 5 CFR 531.405: 1 year at steps 1-3,
 *     2 years at steps 4-6, 3 years at steps 7-9.
 *   - A promotion restarts the step waiting period.
 *   - Promotion pay follows the two-step rule (5 CFR 531.214): take the
 *     rate two steps above the current step in the old grade, then land on
 *     the lowest step of the new grade that meets or beats it. Above step 10
 *     each missing step adds one step-9-to-10 increment. It is applied to
 *     the locality rates for the promotion year.
 */

import { lookupSalary } from "./payLookup";

export interface Promotion {
  /** First calendar year at the new grade */
  year: number;
  grade: number;
}

export interface CareerYear {
  year: number;
  grade: number;
  step: number;
  salary: number;
}

/** Years to wait at each step before the next within-grade increase */
const STEP_WAIT_YEARS: Record<number, number> = {
  1: 1, 2: 1, 3: 1,
  4: 2, 5: 2, 6: 2,
  7: 3, 8: 3, 9: 3,
};

/**
 * GS-9 in 2011 to GS-14 by 2026, roughly three years in each grade.
 * GS-10 is skipped, as on most two-grade-interval career ladders.
 */
export const TYPICAL_CAREER: Promotion[] = [
  { year: 2011, grade: 9 },
  { year: 2014, grade: 11 },
  { year: 2017, grade: 12 },
  { year: 2020, grade: 13 },
  { year: 2023, grade: 14 },
];

/**
 * Walks the career from the first promotion's year through `lastYear` in
 * one locality. Returns null if any year's pay rate is missing.
 */
export async function simulateCareer(
  plan: Promotion[],
  locality: string,
  lastYear: number,
): Promise<CareerYear[] | null> {
  const promotions = new Map(plan.map((p) => [p.year, p.grade]));
  const out: CareerYear[] = [];

  let grade = 0;
  let step = 1;
  let yearsAtStep = 0;

  for (let year = plan[0].year; year <= lastYear; year++) {
    const pay = (g: number, s: number) => lookupSalary(year, locality, g, s);

    const newGrade = promotions.get(year);
    if (newGrade != null) {
      if (grade > 0) {
        const target = await twoStepTarget(pay, grade, step);
        if (target == null) return null;
        let landed: number | null = null;
        for (let s = 1; s <= 10 && landed == null; s++) {
          const rate = await pay(newGrade, s);
          if (rate != null && rate >= target) landed = s;
        }
        step = landed ?? 10;
      }
      grade = newGrade;
      yearsAtStep = 0;
    } else if (step < 10) {
      yearsAtStep++;
      if (yearsAtStep >= STEP_WAIT_YEARS[step]) {
        step++;
        yearsAtStep = 0;
      }
    }

    const salary = await pay(grade, step);
    if (salary == null) return null;
    out.push({ year, grade, step, salary });
  }

  return out;
}

async function twoStepTarget(
  pay: (g: number, s: number) => Promise<number | null>,
  grade: number,
  step: number,
): Promise<number | null> {
  if (step + 2 <= 10) return pay(grade, step + 2);
  const [s9, s10] = await Promise.all([pay(grade, 9), pay(grade, 10)]);
  if (s9 == null || s10 == null) return null;
  return s10 + (step + 2 - 10) * (s10 - s9);
}

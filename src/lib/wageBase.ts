/**
 * wageBase.ts
 *
 * Social Security contribution and benefit base ("wage base") by year, and
 * helpers for comparing a GS salary series against it.
 *
 * Source: SSA, Contribution and Benefit Base — ssa.gov/OACT/COLA/cbb.html.
 * Add the new year each October when SSA announces it alongside the COLA.
 */

export const WAGE_BASE: Record<number, number> = {
  2011: 106_800,
  2012: 110_100,
  2013: 113_700,
  2014: 117_000,
  2015: 118_500,
  2016: 118_500,
  2017: 127_200,
  2018: 128_400,
  2019: 132_900,
  2020: 137_700,
  2021: 142_800,
  2022: 147_000,
  2023: 160_200,
  2024: 168_600,
  2025: 176_100,
  2026: 184_500,
};

export interface SalaryPoint {
  year: number;
  salary: number;
}

export interface WageBaseComparisonRow {
  year: number;
  salary: number;
  wageBase: number;
  /** salary ÷ wage base, e.g. 0.42 = salary is 42% of the wage base */
  ratio: number;
}

export interface WageBaseComparison {
  rows: WageBaseComparisonRow[];
  firstYear: number;
  lastYear: number;
  /** Compound annual growth rate of the salary over firstYear→lastYear */
  salaryCagr: number;
  /** Compound annual growth rate of the wage base over the same span */
  wageBaseCagr: number;
  firstRatio: number;
  lastRatio: number;
}

function cagr(start: number, end: number, years: number): number {
  return years > 0 ? Math.pow(end / start, 1 / years) - 1 : 0;
}

/**
 * Pairs each salary year with that year's wage base. Years without a wage
 * base on file are dropped. Returns null if fewer than two years overlap.
 */
export function compareToWageBase(
  salaries: SalaryPoint[],
): WageBaseComparison | null {
  const rows = salaries
    .filter((s) => WAGE_BASE[s.year] != null)
    .sort((a, b) => a.year - b.year)
    .map((s) => ({
      year: s.year,
      salary: s.salary,
      wageBase: WAGE_BASE[s.year],
      ratio: s.salary / WAGE_BASE[s.year],
    }));

  if (rows.length < 2) return null;

  const first = rows[0];
  const last = rows[rows.length - 1];
  const span = last.year - first.year;

  return {
    rows,
    firstYear: first.year,
    lastYear: last.year,
    salaryCagr: cagr(first.salary, last.salary, span),
    wageBaseCagr: cagr(first.wageBase, last.wageBase, span),
    firstRatio: first.ratio,
    lastRatio: last.ratio,
  };
}

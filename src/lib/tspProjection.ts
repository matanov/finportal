/**
 * tspProjection.ts
 *
 * Inputs for the TSP Projection Calculator: what the person holds today
 * (fund, dollar amount, Traditional or Roth) and how future contributions
 * are allocated across funds (percentages that must add to 100%), plus the
 * projection horizon.
 *
 * Only input handling and validation live here so far. The projection
 * itself (contributions, agency match, growth) is still to be built on top
 * of these types.
 */

export interface HoldingRow {
  id: string;
  fund: string;
  /** Current balance in dollars */
  amount: number;
  /** true = Roth balance, false = Traditional */
  roth: boolean;
}

export interface AllocationRow {
  id: string;
  fund: string;
  /** Share of future contributions, 0–100 */
  percent: number;
}

export const HORIZON_OPTIONS = [5, 10, 15, 20, 25, 30, 35, 40];
export const DEFAULT_HORIZON = 20;
export const DEFAULT_FUND = "C";

/**
 * IRS limits on employee TSP contributions for one tax year. Update each
 * November when the IRS announces the next year's figures; the TSP mirrors
 * them at https://www.tsp.gov/making-contributions/contribution-limits/.
 */
export const CONTRIBUTION_LIMITS = {
  year: 2026,
  /** Elective deferral limit: Traditional + Roth employee contributions combined */
  elective: 24_500,
  /** Extra catch-up allowed from the year you turn 50 */
  catchUp50: 8_000,
  /** Higher catch-up for the years you turn 60 through 63 (replaces the age-50 amount) */
  catchUp60to63: 11_250,
  /** Prior-year FICA wages above which catch-up contributions must be Roth */
  rothCatchUpWageThreshold: 150_000,
  source: "https://www.tsp.gov/making-contributions/contribution-limits/",
} as const;

/**
 * Most an employee of this age can contribute this year: the elective limit
 * plus the catch-up they qualify for. Catch-up eligibility goes by the age
 * reached by the end of the year, so "age" here means age this year.
 */
export function employeeLimit(age: number | null): { limit: number; catchUp: number } {
  const { elective, catchUp50, catchUp60to63 } = CONTRIBUTION_LIMITS;
  const catchUp =
    age == null || age < 50 ? 0 : age >= 60 && age <= 63 ? catchUp60to63 : catchUp50;
  return { limit: elective + catchUp, catchUp };
}

/** Employee contributions for a year at a flat percent of salary */
export function annualContribution(salary: number, percent: number): number {
  return (Math.max(0, salary || 0) * Math.max(0, percent || 0)) / 100;
}

/** Used until /tsp/index.json loads, or if it can't be fetched */
export const FALLBACK_FUNDS = [
  "G", "F", "C", "S", "I",
  "L-Income", "L2030", "L2035", "L2040", "L2045", "L2050", "L2055", "L2060", "L2065", "L2070", "L2075",
];

const CORE_FUNDS = ["G", "F", "C", "S", "I"];

export function fundLabel(slug: string): string {
  if (slug === "L-Income") return "L Income";
  const m = slug.match(/^L(\d{4})$/);
  if (m) return `L ${m[1]}`;
  return `${slug} Fund`;
}

/** Core funds in TSP order (G, F, C, S, I), then lifecycle funds by target year */
export function orderFunds(funds: string[]): string[] {
  const core = CORE_FUNDS.filter((f) => funds.includes(f));
  const lifecycle = funds
    .filter((f) => f.startsWith("L"))
    .sort((a, b) => {
      const ay = a === "L-Income" ? -1 : parseInt(a.slice(1), 10);
      const by = b === "L-Income" ? -1 : parseInt(b.slice(1), 10);
      return ay - by;
    });
  return [...core, ...lifecycle];
}

let nextId = 0;
export function newId(prefix: string): string {
  nextId += 1;
  return `${prefix}-${nextId}`;
}

export interface HoldingsSummary {
  total: number;
  traditional: number;
  roth: number;
  /** Combined Traditional + Roth balance per fund */
  byFund: Record<string, number>;
}

export function summarizeHoldings(rows: HoldingRow[]): HoldingsSummary {
  const summary: HoldingsSummary = { total: 0, traditional: 0, roth: 0, byFund: {} };
  for (const row of rows) {
    const amount = Math.max(0, row.amount || 0);
    if (amount === 0) continue;
    summary.total += amount;
    if (row.roth) summary.roth += amount;
    else summary.traditional += amount;
    summary.byFund[row.fund] = (summary.byFund[row.fund] ?? 0) + amount;
  }
  return summary;
}

export interface AllocationCheck {
  /** Sum of all rows' percentages */
  total: number;
  /** Exactly 100% (to within rounding) */
  isComplete: boolean;
  /** Funds listed on more than one row */
  duplicates: string[];
}

export function checkAllocation(rows: AllocationRow[]): AllocationCheck {
  const total = rows.reduce((sum, r) => sum + Math.max(0, r.percent || 0), 0);
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const r of rows) {
    if (seen.has(r.fund)) duplicates.add(r.fund);
    seen.add(r.fund);
  }
  return {
    total,
    isComplete: Math.abs(total - 100) < 0.005,
    duplicates: [...duplicates],
  };
}

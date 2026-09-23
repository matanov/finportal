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

export const PAY_PERIODS = 26;

/** FERS agency contributions: automatic 1% of basic pay, plus matching on the first 5% the employee puts in */
const AGENCY_AUTOMATIC_PCT = 1;

/** Agency matching for an employee contribution of `pct`% of pay: dollar for dollar on the first 3%, 50 cents on the next 2% */
function matchPct(pct: number): number {
  return Math.min(pct, 3) + 0.5 * Math.min(Math.max(pct - 3, 0), 2);
}

export type ContributionMode = "percent" | "dollars";

export interface ContributionInput {
  salary: number;
  /** Whether the two elections below are percents of pay or dollars per year */
  mode: ContributionMode;
  /** Traditional election: percent of each paycheck (0–100) or dollars per year, spread over the pay periods */
  traditional: number;
  /** Roth election, in the same units as `traditional` */
  roth: number;
  age: number | null;
}

export interface ContributionBreakdown {
  /** What the election would put in over a full year with no limit */
  requested: number;
  /** The employee's own limit this year (elective + any catch-up) */
  limit: number;
  catchUpLimit: number;
  regularTraditional: number;
  regularRoth: number;
  catchUpTraditional: number;
  catchUpRoth: number;
  /** Elected but not contributed because the limit was reached */
  notContributed: number;
  /** Catch-up has to be Roth: salary (standing in for last year's wages) is over the threshold */
  rothCatchUpRequired: boolean;
  /** Catch-up applies but no salary was entered, so the Roth catch-up test can't be run */
  rothCatchUpUnknown: boolean;
  /** Part of the Traditional election that went in as Roth catch-up because of that rule */
  traditionalRedirectedToRoth: number;
  agencyAutomatic: number;
  agencyMatch: number;
  /** Matching lost in pay periods after contributions stopped */
  matchLost: number;
  /** Pay period (1–26) in which contributions were first cut off, or null if never */
  limitReachedPeriod: number | null;
  employeeTotal: number;
  agencyTotal: number;
  total: number;
}

/**
 * Where a year of contributions goes, worked out pay period by pay period
 * the way the TSP applies an election:
 *   1. Each paycheck's Traditional and Roth elections fill the regular
 *      (elective) limit first, in proportion to the two elections.
 *   2. Once that's full, they spill over into catch-up for employees 50 or
 *      older, up to their catch-up limit, keeping their type — except that
 *      when salary is above the Roth catch-up wage threshold all catch-up
 *      goes in as Roth, including what was elected as Traditional.
 *   3. Anything beyond the employee's limit isn't contributed.
 * Agency money is always Traditional: the automatic 1% every pay period,
 * plus matching based on what the employee actually put in that period, so
 * hitting the limit early in the year also stops the match.
 */
export function contributionBreakdown(input: ContributionInput): ContributionBreakdown {
  const salary = Math.max(0, input.salary || 0);
  const pay = salary / PAY_PERIODS;
  const perPeriodOf = (v: number) =>
    input.mode === "percent" ? (pay * Math.max(0, v || 0)) / 100 : Math.max(0, v || 0) / PAY_PERIODS;
  const tradPerPeriod = perPeriodOf(input.traditional);
  const rothPerPeriod = perPeriodOf(input.roth);
  const perPeriod = tradPerPeriod + rothPerPeriod;
  const rothShare = perPeriod > 0 ? rothPerPeriod / perPeriod : 0;

  const { elective, rothCatchUpWageThreshold } = CONTRIBUTION_LIMITS;
  const { limit, catchUp: catchUpLimit } = employeeLimit(input.age);
  const rothCatchUpRequired = catchUpLimit > 0 && salary > rothCatchUpWageThreshold;

  const out: ContributionBreakdown = {
    requested: perPeriod * PAY_PERIODS,
    limit,
    catchUpLimit,
    regularTraditional: 0,
    regularRoth: 0,
    catchUpTraditional: 0,
    catchUpRoth: 0,
    notContributed: 0,
    rothCatchUpRequired,
    rothCatchUpUnknown: catchUpLimit > 0 && salary === 0,
    traditionalRedirectedToRoth: 0,
    agencyAutomatic: 0,
    agencyMatch: 0,
    matchLost: 0,
    limitReachedPeriod: null,
    employeeTotal: 0,
    agencyTotal: 0,
    total: 0,
  };

  let regularSoFar = 0;
  let catchUpSoFar = 0;
  for (let period = 1; period <= PAY_PERIODS; period++) {
    const regular = Math.min(perPeriod, Math.max(0, elective - regularSoFar));
    const catchUp = Math.min(perPeriod - regular, Math.max(0, catchUpLimit - catchUpSoFar));
    const cut = perPeriod - regular - catchUp;
    regularSoFar += regular;
    catchUpSoFar += catchUp;

    out.regularRoth += regular * rothShare;
    out.regularTraditional += regular * (1 - rothShare);
    if (rothCatchUpRequired) {
      out.catchUpRoth += catchUp;
      out.traditionalRedirectedToRoth += catchUp * (1 - rothShare);
    } else {
      out.catchUpRoth += catchUp * rothShare;
      out.catchUpTraditional += catchUp * (1 - rothShare);
    }
    out.notContributed += cut;
    if (cut > 0.005 && out.limitReachedPeriod == null) out.limitReachedPeriod = period;

    if (pay > 0) {
      out.agencyAutomatic += (pay * AGENCY_AUTOMATIC_PCT) / 100;
      const actual = (pay * matchPct(((regular + catchUp) / pay) * 100)) / 100;
      const elected = (pay * matchPct((perPeriod / pay) * 100)) / 100;
      out.agencyMatch += actual;
      out.matchLost += elected - actual;
    }
  }

  out.employeeTotal = out.regularTraditional + out.regularRoth + out.catchUpTraditional + out.catchUpRoth;
  out.agencyTotal = out.agencyAutomatic + out.agencyMatch;
  out.total = out.employeeTotal + out.agencyTotal;
  return out;
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

export interface ContributionYear {
  year: number;
  /** Age during this year, or null if no age was entered */
  age: number | null;
  catchUpEligible: boolean;
  /** Employee money that lands in the Traditional balance (regular + catch-up) */
  employeeTraditional: number;
  /** Employee money that lands in the Roth balance (regular + catch-up) */
  employeeRoth: number;
  /** Automatic 1% plus matching, always Traditional */
  agency: number;
  total: number;
  /** Starting balances plus every contribution so far, with no investment growth */
  cumulativeTraditional: number;
  cumulativeRoth: number;
}

/**
 * Contributions year by year over the horizon, before any investment
 * growth. Each year re-runs contributionBreakdown() at that year's age, so
 * catch-up starts at 50 and steps up at 60–63 on its own. Salary and the
 * IRS limits are held at today's values for now.
 */
export function projectContributions(
  input: ContributionInput,
  start: { traditional: number; roth: number },
  years: number,
  firstYear: number = CONTRIBUTION_LIMITS.year,
): ContributionYear[] {
  const rows: ContributionYear[] = [];
  let cumTrad = start.traditional;
  let cumRoth = start.roth;
  for (let i = 0; i < years; i++) {
    const age = input.age == null ? null : input.age + i;
    const b = contributionBreakdown({ ...input, age });
    const employeeTraditional = b.regularTraditional + b.catchUpTraditional;
    const employeeRoth = b.regularRoth + b.catchUpRoth;
    cumTrad += employeeTraditional + b.agencyTotal;
    cumRoth += employeeRoth;
    rows.push({
      year: firstYear + i,
      age,
      catchUpEligible: b.catchUpLimit > 0,
      employeeTraditional,
      employeeRoth,
      agency: b.agencyTotal,
      total: b.total,
      cumulativeTraditional: cumTrad,
      cumulativeRoth: cumRoth,
    });
  }
  return rows;
}

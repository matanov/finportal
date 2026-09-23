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
 * Where a year of contributions goes.
 *
 * Timing is worked out pay period by pay period: every paycheck deducts both
 * elections until the employee's personal limit (regular + any catch-up) is
 * reached, then contributions stop for the rest of the year. That sets how
 * much of each election actually goes in and when the agency match stops.
 *
 * The split into buckets is then made over the whole year:
 *   1. Traditional fills the regular (elective) limit first, then Roth.
 *   2. Anything above the regular limit is catch-up (ages 50+ only).
 *   3. When catch-up must be Roth (salary above the Roth catch-up wage
 *      threshold), the employee's Roth contributions count as the catch-up
 *      first; only if they fall short is the rest of the catch-up taken from
 *      Traditional and moved to Roth. So electing $24,500 Traditional plus
 *      the catch-up amount as Roth keeps both as elected, and electing
 *      everything as Traditional puts the catch-up in as Roth automatically.
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

  // Pass 1, pay period by pay period: how much of each election goes in before the limit stops it.
  let contributedSoFar = 0;
  let tradIn = 0;
  let rothIn = 0;
  for (let period = 1; period <= PAY_PERIODS; period++) {
    const contributed = Math.min(perPeriod, Math.max(0, limit - contributedSoFar));
    const cut = perPeriod - contributed;
    contributedSoFar += contributed;
    tradIn += contributed * (1 - rothShare);
    rothIn += contributed * rothShare;
    out.notContributed += cut;
    if (cut > 0.005 && out.limitReachedPeriod == null) out.limitReachedPeriod = period;

    if (pay > 0) {
      out.agencyAutomatic += (pay * AGENCY_AUTOMATIC_PCT) / 100;
      const actual = (pay * matchPct((contributed / pay) * 100)) / 100;
      const elected = (pay * matchPct((perPeriod / pay) * 100)) / 100;
      out.agencyMatch += actual;
      out.matchLost += elected - actual;
    }
  }

  // Pass 2, over the year: sort what went in into regular and catch-up, Traditional first.
  const catchUp = Math.max(0, tradIn + rothIn - elective);
  if (rothCatchUpRequired) {
    // Roth contributions cover the catch-up first; Traditional is moved only for any shortfall.
    const moved = Math.max(0, catchUp - rothIn);
    out.traditionalRedirectedToRoth = moved;
    out.regularTraditional = tradIn - moved;
    out.regularRoth = rothIn + moved - catchUp;
    out.catchUpRoth = catchUp;
  } else {
    out.regularTraditional = Math.min(tradIn, elective);
    out.regularRoth = Math.min(rothIn, elective - out.regularTraditional);
    out.catchUpTraditional = tradIn - out.regularTraditional;
    out.catchUpRoth = rothIn - out.regularRoth;
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
  /** At or past the retirement age: no contributions this year */
  retired: boolean;
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
 *
 * With a retirement age, contributions (employee and agency) stop from the
 * year the person reaches it; the rows continue with zeros so the balance
 * can keep growing to the end of the horizon.
 */
export function projectContributions(
  input: ContributionInput,
  start: { traditional: number; roth: number },
  years: number,
  firstYear: number = CONTRIBUTION_LIMITS.year,
  retireAge: number | null = null,
): ContributionYear[] {
  const rows: ContributionYear[] = [];
  let cumTrad = start.traditional;
  let cumRoth = start.roth;
  for (let i = 0; i < years; i++) {
    const age = input.age == null ? null : input.age + i;
    const retired = age != null && retireAge != null && age >= retireAge;
    if (retired) {
      rows.push({
        year: firstYear + i,
        age,
        catchUpEligible: false,
        retired,
        employeeTraditional: 0,
        employeeRoth: 0,
        agency: 0,
        total: 0,
        cumulativeTraditional: cumTrad,
        cumulativeRoth: cumRoth,
      });
      continue;
    }
    const b = contributionBreakdown({ ...input, age });
    const employeeTraditional = b.regularTraditional + b.catchUpTraditional;
    const employeeRoth = b.regularRoth + b.catchUpRoth;
    cumTrad += employeeTraditional + b.agencyTotal;
    cumRoth += employeeRoth;
    rows.push({
      year: firstYear + i,
      age,
      catchUpEligible: b.catchUpLimit > 0,
      retired,
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

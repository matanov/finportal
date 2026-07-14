/**
 * high3.ts
 *
 * OPM-compliant High-3 Average Salary Calculator.
 *
 * Rules implemented per OPM CSRS/FERS Handbook Chapter 50:
 *  - 360-day year, 30-day month (each day = 1/360 of annual salary)
 *  - Day 31 treated as day 30; partial months are prorated
 *  - The HIGH-3 is the HIGHEST average over any 36 consecutive months (1080 OPM days)
 *  - Only basic pay counts (GS grade + step + locality; no OT, bonuses, awards)
 *  - LWOP > 6 months/year excluded — caller must omit those periods from input
 *  - If total creditable service < 36 months, all available months are used
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** One continuous period at the same grade, step, and locality. */
export interface ServicePeriod {
  /** Inclusive start date  YYYY-MM-DD */
  startDate: string;
  /** Exclusive end date    YYYY-MM-DD  (i.e. the first day NOT in this period) */
  endDate: string;
  /** Annual basic pay for this period (from GS pay table) */
  annualSalary: number;
  /** Optional metadata — stored but not used in calculation */
  grade?: number;
  step?: number;
  locality?: string;
  year?: number;
}

/** The contribution of one service period to the best 36-month window. */
export interface PeriodContribution {
  startDate: string;
  endDate: string;
  annualSalary: number;
  /** Number of OPM days this period falls within the High-3 window */
  opmDays: number;
  /** Dollar contribution to the total: opmDays × (annualSalary / 360) */
  dollarContribution: number;
}

export interface High3Result {
  /** The High-3 average annual salary (rounded to nearest cent) */
  high3Average: number;
  /** Start of the best 36-month window (OPM date string) */
  windowStart: string;
  /** End of the best 36-month window (OPM date string) */
  windowEnd: string;
  /** Breakdown by pay period within the window */
  contributions: PeriodContribution[];
  /** Total OPM days of creditable service provided */
  totalServiceOPMDays: number;
  /** True if the employee had < 36 months of service (partial High-3) */
  isPartialPeriod: boolean;
}

// ---------------------------------------------------------------------------
// OPM 360-day date arithmetic
// ---------------------------------------------------------------------------

/**
 * Convert a YYYY-MM-DD string to an OPM day number.
 * Formula: year × 360 + (month − 1) × 30 + min(day, 30)
 *
 * Day 31 → 30 (OPM rule).
 * February is NOT special — OPM does not adjust for short months.
 */
export function toOPMDay(dateStr: string): number {
  const [year, month, day] = dateStr.split("-").map(Number);
  return year * 360 + (month - 1) * 30 + Math.min(day, 30);
}

/**
 * Convert an OPM day number back to a YYYY-MM-DD string.
 * Inverse of toOPMDay.
 */
export function fromOPMDay(opmDay: number): string {
  let year = Math.floor(opmDay / 360);
  let remaining = opmDay % 360;

  // remaining = 0 means Dec 30 of the previous year
  if (remaining === 0) {
    year -= 1;
    remaining = 360;
  }

  const month = Math.floor((remaining - 1) / 30) + 1;
  const day = ((remaining - 1) % 30) + 1;

  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * OPM days between two date strings (end exclusive).
 */
export function opmDaysBetween(startStr: string, endStr: string): number {
  return toOPMDay(endStr) - toOPMDay(startStr);
}

/**
 * Add N OPM days to a date string and return the result as YYYY-MM-DD.
 */
export function addOPMDays(dateStr: string, days: number): string {
  return fromOPMDay(toOPMDay(dateStr) + days);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Flat numeric segment used internally for sliding-window calculation */
interface Segment {
  start: number; // OPM day (inclusive)
  end: number; // OPM day (exclusive)
  annualSalary: number;
  dailyRate: number; // annualSalary / 360
}

function buildSegments(periods: ServicePeriod[]): Segment[] {
  return periods
    .map((p) => ({
      start: toOPMDay(p.startDate),
      end: toOPMDay(p.endDate),
      annualSalary: p.annualSalary,
      dailyRate: p.annualSalary / 360,
    }))
    .filter((s) => s.end > s.start) // drop zero-length periods
    .sort((a, b) => a.start - b.start);
}

/**
 * Calculate the total dollars earned inside [wStart, wStart + windowDays)
 * across all segments.
 */
function earnedInWindow(
  segments: Segment[],
  wStart: number,
  windowDays: number,
): number {
  const wEnd = wStart + windowDays;
  let total = 0;

  for (const seg of segments) {
    const overlapStart = Math.max(seg.start, wStart);
    const overlapEnd = Math.min(seg.end, wEnd);
    if (overlapEnd > overlapStart) {
      total += (overlapEnd - overlapStart) * seg.dailyRate;
    }
  }

  return total;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Calculate the OPM High-3 Average Salary.
 *
 * The algorithm tries every window start that could possibly produce the
 * maximum average — these are exactly the points where salary changes
 * (segment boundaries). This is O(n²) on the number of pay periods,
 * which is fine for typical federal careers (< 50 periods).
 *
 * @param periods  - Array of service periods. Must not overlap.
 *                   LWOP gaps should simply be absent from this array.
 * @returns High3Result, or null if no valid periods are provided.
 */
export function calculateHigh3(periods: ServicePeriod[]): High3Result | null {
  if (!periods || periods.length === 0) return null;

  const segments = buildSegments(periods);
  if (segments.length === 0) return null;

  const serviceStart = segments[0].start;
  const serviceEnd = segments[segments.length - 1].end;
  const totalServiceOPMDays = serviceEnd - serviceStart;

  // OPM High-3 window = 36 months × 30 days = 1080 OPM days
  const HIGH3_DAYS = 1080;
  const windowDays = Math.min(HIGH3_DAYS, totalServiceOPMDays);
  const isPartialPeriod = totalServiceOPMDays < HIGH3_DAYS;

  // Candidate window start points:
  // The optimal window always starts at a segment boundary or the earliest
  // possible start. Checking all boundaries is sufficient and efficient.
  const candidates = new Set<number>();
  candidates.add(serviceStart);
  for (const seg of segments) {
    // Window starting just as this segment begins
    candidates.add(seg.start);
    // Window ending just as this segment ends (start = segEnd - windowDays)
    candidates.add(seg.end - windowDays);
  }

  let bestEarned = -1;
  let bestWindowStart = serviceStart;

  const minStart = serviceStart;
  const maxStart = serviceEnd - windowDays;

  for (const candidate of candidates) {
    if (candidate < minStart || candidate > maxStart) continue;

    const earned = earnedInWindow(segments, candidate, windowDays);
    if (earned > bestEarned) {
      bestEarned = earned;
      bestWindowStart = candidate;
    }
  }

  // High-3 average = total dollars earned ÷ (window days ÷ 360)
  //                = bestEarned × 360 ÷ windowDays
  // When windowDays = 1080: high3 = bestEarned / 3
  const high3Average =
    Math.round(((bestEarned * 360) / windowDays) * 100) / 100;

  // Build contribution breakdown for the winning window
  const wStart = bestWindowStart;
  const wEnd = bestWindowStart + windowDays;

  const contributions: PeriodContribution[] = [];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const overlapStart = Math.max(seg.start, wStart);
    const overlapEnd = Math.min(seg.end, wEnd);
    if (overlapEnd > overlapStart) {
      const opmDays = overlapEnd - overlapStart;
      contributions.push({
        startDate: fromOPMDay(overlapStart),
        endDate: fromOPMDay(overlapEnd),
        annualSalary: seg.annualSalary,
        opmDays,
        dollarContribution: Math.round(opmDays * seg.dailyRate * 100) / 100,
      });
    }
  }

  return {
    high3Average,
    windowStart: fromOPMDay(wStart),
    windowEnd: fromOPMDay(wEnd),
    contributions,
    totalServiceOPMDays,
    isPartialPeriod,
  };
}

// ---------------------------------------------------------------------------
// Convenience: build ServicePeriods from grade/step/locality history
// ---------------------------------------------------------------------------

import { lookupSalary, prefetchYears } from "./payLookup";

export interface CareerStep {
  /** Date this grade/step/locality became effective (YYYY-MM-DD) */
  effectiveDate: string;
  grade: number;
  step: number;
  /** Locality code, e.g. "DCB", "GS" (rest-of-US) */
  locality: string;
  /** The pay year to use for lookup (usually the calendar year of effectiveDate) */
  payYear: number;
}

/**
 * Convert a career history (list of grade/step changes) into ServicePeriods
 * ready for calculateHigh3().
 *
 * Fetches only the pay years actually used in the career history.
 * Parallel prefetch ensures a single network round-trip per unique year.
 *
 * @param steps          - Ordered list of career steps (sorted by effectiveDate)
 * @param separationDate - First day NOT in federal service (exclusive end date)
 * @returns Array of ServicePeriod, or an object with an error string
 */
export async function careerStepsToServicePeriods(
  steps: CareerStep[],
  separationDate: string,
): Promise<ServicePeriod[] | { error: string }> {
  if (!steps || steps.length === 0)
    return { error: "No career steps provided." };

  const sorted = [...steps].sort(
    (a, b) => toOPMDay(a.effectiveDate) - toOPMDay(b.effectiveDate),
  );

  // Prefetch all unique years in parallel — one network round-trip total
  const uniqueYears = [...new Set(sorted.map((s) => s.payYear))];
  await prefetchYears(uniqueYears);

  const periods: ServicePeriod[] = [];

  for (let i = 0; i < sorted.length; i++) {
    const step = sorted[i];
    const endDate =
      i < sorted.length - 1 ? sorted[i + 1].effectiveDate : separationDate;

    // Cache is warm after prefetchYears — this await resolves instantly
    const salary = await lookupSalary(
      step.payYear,
      step.locality,
      step.grade,
      step.step,
    );
    if (salary === null) {
      return {
        error: `No salary found for year=${step.payYear}, locality=${step.locality}, grade=${step.grade}, step=${step.step}`,
      };
    }

    periods.push({
      startDate: step.effectiveDate,
      endDate,
      annualSalary: salary,
      grade: step.grade,
      step: step.step,
      locality: step.locality,
      year: step.payYear,
    });
  }

  return periods;
}

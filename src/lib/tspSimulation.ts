/**
 * tspSimulation.ts
 *
 * Monte Carlo projection for the TSP Projection Calculator: today's balances
 * (by fund, Traditional or Roth) plus each year's contributions, grown by
 * resampling real historical TSP months.
 *
 * Engine: the same historical monthly-block bootstrap as the TSP Monte Carlo
 * tool. Each simulated month draws one random month from history and applies
 * that SAME month's return to every fund at once, so cross-fund correlation
 * (stocks falling together, the G Fund staying steady) comes from the data
 * rather than an assumed model. Only months where every fund involved has a
 * real price are eligible, so adding a young fund narrows the history used.
 *
 * Assumptions (shown to the user under the chart):
 *   - Existing balances stay in the funds they're in; no rebalancing.
 *   - Each year's contributions (from projectContributions) arrive in 12 equal
 *     monthly amounts, split across funds by the future allocation.
 *   - Traditional and Roth money in the same fund earn the same return.
 *   - Nominal (future) dollars, no fees beyond those already reflected in TSP
 *     share prices, no withdrawals. inTodaysDollars() converts a result to
 *     today's dollars for display.
 *
 * "Below average", "average" and "above average" are the 25th, 50th and 75th
 * percentiles of the simulated outcomes: 1 in 4 trials ended below the first,
 * half below the second, 3 in 4 below the third.
 */

import { splitHolding, type AllocationRow, type ContributionYear, type HoldingRow } from "./tspProjection.ts";

export interface MonthlyReturns {
  asOf: string;
  months: string[];
  funds: string[];
  /** Monthly return per fund, aligned with `months`; null before the fund existed */
  returns: Record<string, (number | null)[]>;
}

export interface Percentiles {
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
}

export interface Scenario {
  total: number;
  traditional: number;
  roth: number;
}

export interface SimulationResult {
  trials: number;
  /** Historical months eligible for resampling, and the span they cover */
  poolSize: number;
  poolStart: string | null;
  poolEnd: string | null;
  /** Balance percentiles at the end of each year, index 0 = today */
  bands: Percentiles[];
  /** Starting balance plus contributions so far (no growth), same indexing */
  contributed: number[];
  /** End-of-horizon outcomes; Traditional/Roth split taken from the trial at that percentile */
  below: Scenario;
  average: Scenario;
  above: Scenario;
}

export const TRIALS = 2000;

/** Small, fast, seedable PRNG so the same inputs always give the same chart */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

/** Future allocation as weights summing to 1; falls back to the first fund if nothing is allocated */
function allocationWeights(allocation: AllocationRow[]): Map<string, number> {
  const weights = new Map<string, number>();
  const total = allocation.reduce((sum, r) => sum + Math.max(0, r.percent || 0), 0);
  if (total <= 0) {
    if (allocation[0]) weights.set(allocation[0].fund, 1);
    return weights;
  }
  for (const r of allocation) {
    const pct = Math.max(0, r.percent || 0);
    if (pct > 0) weights.set(r.fund, (weights.get(r.fund) ?? 0) + pct / total);
  }
  return weights;
}

export function simulateProjection({
  monthlyReturns,
  holdings,
  allocation,
  years,
  trials = TRIALS,
  seed = 1,
}: {
  monthlyReturns: MonthlyReturns;
  holdings: HoldingRow[];
  allocation: AllocationRow[];
  /** One row per projected year, from projectContributions() */
  years: ContributionYear[];
  trials?: number;
  seed?: number;
}): SimulationResult {
  const weights = allocationWeights(allocation);
  const contributes = years.some((y) => y.total > 0);

  // Funds in play: anything held today, plus allocation funds if money will flow into them.
  const funds = new Set<string>();
  for (const h of holdings) if ((h.amount || 0) > 0) funds.add(h.fund);
  if (contributes) for (const f of weights.keys()) funds.add(f);
  const fundList = [...funds].filter((f) => monthlyReturns.returns[f]);
  const fi = new Map(fundList.map((f, i) => [f, i]));
  const n = fundList.length;

  const pool: number[] = [];
  for (let i = 0; i < monthlyReturns.months.length; i++) {
    if (fundList.every((f) => monthlyReturns.returns[f][i] != null)) pool.push(i);
  }

  // Starting balances per fund, Traditional and Roth kept apart.
  const startTrad = new Float64Array(n);
  const startRoth = new Float64Array(n);
  for (const h of holdings) {
    const i = fi.get(h.fund);
    if (i == null || !(h.amount > 0)) continue;
    const split = splitHolding(h);
    startTrad[i] += split.traditional;
    startRoth[i] += split.roth;
  }
  const startTotal = startTrad.reduce((a, b) => a + b, 0) + startRoth.reduce((a, b) => a + b, 0);

  // Monthly contribution per fund for each year.
  const w = new Float64Array(n);
  for (const [f, weight] of weights) {
    const i = fi.get(f);
    if (i != null) w[i] = weight;
  }

  const contributed = [startTotal];
  for (const y of years) contributed.push(contributed[contributed.length - 1] + y.total);

  // Returns laid out month-major for a tight inner loop.
  const R = pool.map((m) => fundList.map((f) => monthlyReturns.returns[f][m] as number));

  const nYears = years.length;
  const totals: Float64Array[] = Array.from({ length: nYears + 1 }, () => new Float64Array(trials));
  const endTrad = new Float64Array(trials);
  const endRoth = new Float64Array(trials);
  const rand = mulberry32(seed);
  const trad = new Float64Array(n);
  const roth = new Float64Array(n);

  for (let t = 0; t < trials; t++) {
    trad.set(startTrad);
    roth.set(startRoth);
    totals[0][t] = startTotal;
    for (let y = 0; y < nYears; y++) {
      const monthTrad = (years[y].employeeTraditional + years[y].agency) / 12;
      const monthRoth = years[y].employeeRoth / 12;
      for (let m = 0; m < 12; m++) {
        if (R.length > 0) {
          const r = R[Math.floor(rand() * R.length)];
          for (let i = 0; i < n; i++) {
            trad[i] *= 1 + r[i];
            roth[i] *= 1 + r[i];
          }
        }
        // Contributions land at the end of the month, after that month's return.
        for (let i = 0; i < n; i++) {
          trad[i] += monthTrad * w[i];
          roth[i] += monthRoth * w[i];
        }
      }
      let sum = 0;
      for (let i = 0; i < n; i++) sum += trad[i] + roth[i];
      totals[y + 1][t] = sum;
    }
    let st = 0;
    let sr = 0;
    for (let i = 0; i < n; i++) {
      st += trad[i];
      sr += roth[i];
    }
    endTrad[t] = st;
    endRoth[t] = sr;
  }

  const bands: Percentiles[] = totals.map((row) => {
    const sorted = Array.from(row).sort((a, b) => a - b);
    return {
      p10: percentile(sorted, 10),
      p25: percentile(sorted, 25),
      p50: percentile(sorted, 50),
      p75: percentile(sorted, 75),
      p90: percentile(sorted, 90),
    };
  });

  // For each scenario, report the trial sitting at that rank so Traditional + Roth add up to the total.
  const order = Array.from({ length: trials }, (_, i) => i).sort((a, b) => totals[nYears][a] - totals[nYears][b]);
  const scenarioAt = (p: number): Scenario => {
    const t = order[Math.round((p / 100) * (trials - 1))];
    return { total: totals[nYears][t], traditional: endTrad[t], roth: endRoth[t] };
  };

  return {
    trials,
    poolSize: pool.length,
    poolStart: pool.length ? monthlyReturns.months[pool[0]] : null,
    poolEnd: pool.length ? monthlyReturns.months[pool[pool.length - 1]] : null,
    bands,
    contributed,
    below: scenarioAt(25),
    average: scenarioAt(50),
    above: scenarioAt(75),
  };
}

/**
 * The same result expressed in today's dollars: every value at year i is
 * divided by (1 + inflation)^i. The simulation itself runs in future
 * (nominal) dollars; this only changes how the numbers are shown.
 */
export function inTodaysDollars(result: SimulationResult, inflationPct: number): SimulationResult {
  const rate = Math.max(-0.99, (inflationPct || 0) / 100);
  const factor = (i: number) => (1 + rate) ** i;
  const n = result.bands.length - 1;
  const scale = (s: Scenario): Scenario => ({
    total: s.total / factor(n),
    traditional: s.traditional / factor(n),
    roth: s.roth / factor(n),
  });
  return {
    ...result,
    bands: result.bands.map((b, i) => ({
      p10: b.p10 / factor(i),
      p25: b.p25 / factor(i),
      p50: b.p50 / factor(i),
      p75: b.p75 / factor(i),
      p90: b.p90 / factor(i),
    })),
    contributed: result.contributed.map((v, i) => v / factor(i)),
    below: scale(result.below),
    average: scale(result.average),
    above: scale(result.above),
  };
}

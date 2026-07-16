/**
 * TspMonteCarlo.tsx
 *
 * TSP Monte Carlo Projection — enter today's per-fund balances, pick a
 * horizon, and see a range of simulated future outcomes. Traditional/Roth
 * is a single overall % split applied to the simulated total for display
 * only (it doesn't affect the simulation itself — same funds grow the same
 * way regardless of tax treatment).
 *
 * Engine: historical monthly-block bootstrap. Each simulated month draws
 * one random historical month and applies that SAME month's return to every
 * held fund at once — never independently per fund — so real cross-fund
 * correlation (funds crashing together, G fund staying flat) comes from the
 * data itself rather than an assumed covariance model. No contributions or
 * withdrawals are modeled; this only grows what's entered today.
 */

import { useEffect, useMemo, useState } from "react";

// ---------------------------------------------------------------------------
// Types + constants
// ---------------------------------------------------------------------------

type MonthlyReturns = {
  asOf: string;
  months: string[];
  funds: string[];
  returns: Record<string, (number | null)[]>;
};

type Balances = Record<string, number>;

const CORE_FUNDS = ["G", "F", "C", "S", "I"];
const TRIALS = 2000;
const MIN_POOL_MONTHS = 24;

const BAND_COLOR = "#2a78d6"; // single-hue uncertainty band — this is one series, not multiple identities
const REFERENCE_COLOR = "#898781";

function fundLabel(slug: string): string {
  if (slug === "L-Income") return "L Income";
  const m = slug.match(/^L(\d{4})$/);
  if (m) return `L ${m[1]}`;
  return `${slug} Fund`;
}

function sortFunds(funds: string[]): { core: string[]; lifecycle: string[] } {
  const core = CORE_FUNDS.filter((f) => funds.includes(f));
  const lifecycle = funds
    .filter((f) => f.startsWith("L"))
    .sort((a, b) => {
      const ay = a === "L-Income" ? -1 : parseInt(a.slice(1), 10);
      const by = b === "L-Income" ? -1 : parseInt(b.slice(1), 10);
      return ay - by;
    });
  return { core, lifecycle };
}

const fmtMoney = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

// ---------------------------------------------------------------------------
// Engine (pure functions — no React)
// ---------------------------------------------------------------------------

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 1) return sorted[0];
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  const frac = idx - lo;
  return sorted[lo] + (sorted[hi] - sorted[lo]) * frac;
}

type SimResult = {
  poolSize: number;
  years: number[];
  bands: { p10: number; p25: number; p50: number; p75: number; p90: number }[];
  reference: number[];
};

function runSimulation({
  monthlyReturns,
  totalByFund,
  heldFunds,
  horizonYears,
  customAnnualRate,
}: {
  monthlyReturns: MonthlyReturns;
  totalByFund: Record<string, number>;
  heldFunds: string[];
  horizonYears: number;
  customAnnualRate: number | null;
}): SimResult {
  const poolIndices: number[] = [];
  for (let i = 0; i < monthlyReturns.months.length; i++) {
    if (heldFunds.every((f) => monthlyReturns.returns[f][i] !== null)) poolIndices.push(i);
  }

  const totalMonths = horizonYears * 12;
  const startTotal = heldFunds.reduce((sum, f) => sum + totalByFund[f], 0);

  // checkpoints[y] = every trial's total balance at year y (y = 0..horizonYears)
  const checkpoints: number[][] = Array.from({ length: horizonYears + 1 }, () => []);

  if (poolIndices.length > 0) {
    for (let t = 0; t < TRIALS; t++) {
      const bal: Record<string, number> = {};
      for (const f of heldFunds) bal[f] = totalByFund[f];
      checkpoints[0].push(startTotal);

      for (let m = 1; m <= totalMonths; m++) {
        const idx = poolIndices[Math.floor(Math.random() * poolIndices.length)];
        for (const f of heldFunds) bal[f] *= 1 + (monthlyReturns.returns[f][idx] as number);
        if (m % 12 === 0) {
          checkpoints[m / 12].push(heldFunds.reduce((sum, f) => sum + bal[f], 0));
        }
      }
    }
  }

  const bands = checkpoints.map((yearValues) => {
    const sorted = [...yearValues].sort((a, b) => a - b);
    return {
      p10: percentile(sorted, 10),
      p25: percentile(sorted, 25),
      p50: percentile(sorted, 50),
      p75: percentile(sorted, 75),
      p90: percentile(sorted, 90),
    };
  });

  // Reference line: deterministic compounding, no randomness.
  // - custom rate: simple fixed annual compounding at the user's assumed rate.
  // - default: each fund's mean monthly return over the SAME resampling pool,
  //   compounded every month identically. Because this compounds the simple
  //   average return rather than the geometric (volatility-adjusted) one, it
  //   reads a bit optimistic vs. the median band — that gap is real and is
  //   exactly what "volatility drag" / sequence-of-returns risk looks like.
  let reference: number[];
  if (customAnnualRate !== null) {
    reference = Array.from({ length: horizonYears + 1 }, (_, y) => startTotal * (1 + customAnnualRate) ** y);
  } else if (poolIndices.length > 0) {
    const meanReturn: Record<string, number> = {};
    for (const f of heldFunds) {
      const vals = poolIndices.map((i) => monthlyReturns.returns[f][i] as number);
      meanReturn[f] = vals.reduce((a, b) => a + b, 0) / vals.length;
    }
    const bal: Record<string, number> = {};
    for (const f of heldFunds) bal[f] = totalByFund[f];
    reference = [startTotal];
    for (let m = 1; m <= totalMonths; m++) {
      for (const f of heldFunds) bal[f] *= 1 + meanReturn[f];
      if (m % 12 === 0) reference.push(heldFunds.reduce((sum, f) => sum + bal[f], 0));
    }
  } else {
    reference = Array.from({ length: horizonYears + 1 }, () => startTotal);
  }

  return {
    poolSize: poolIndices.length,
    years: Array.from({ length: horizonYears + 1 }, (_, y) => y),
    bands,
    reference,
  };
}

// ---------------------------------------------------------------------------
// Fan chart — single-hue uncertainty bands + median + reference line
// ---------------------------------------------------------------------------

function niceNumber(range: number, round: boolean): number {
  const exponent = Math.floor(Math.log10(range));
  const fraction = range / 10 ** exponent;
  let niceFraction: number;
  if (round) {
    niceFraction = fraction < 1.5 ? 1 : fraction < 3 ? 2 : fraction < 7 ? 5 : 10;
  } else {
    niceFraction = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
  }
  return niceFraction * 10 ** exponent;
}

function niceTicks(min: number, max: number, count = 5): number[] {
  if (min === max) {
    min = 0;
    max = max || 1;
  }
  const range = niceNumber(max - min, false);
  const step = niceNumber(range / (count - 1), true);
  const niceMin = Math.floor(min / step) * step;
  const niceMax = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = niceMin; v <= niceMax + step * 0.5; v += step) ticks.push(Math.round(v));
  return ticks;
}

function FanChart({ result }: { result: SimResult }) {
  const width = 800;
  const height = 340;
  const padding = { top: 20, right: 16, bottom: 32, left: 72 };
  const plotW = width - padding.left - padding.right;
  const plotH = height - padding.top - padding.bottom;

  const allValues = [
    ...result.bands.flatMap((b) => [b.p10, b.p90]),
    ...result.reference,
  ];
  const rawMin = Math.min(0, ...allValues);
  const rawMax = Math.max(...allValues, 1);
  const ticks = niceTicks(rawMin, rawMax);
  const yMin = ticks[0];
  const yMax = ticks[ticks.length - 1];
  const yRange = yMax - yMin || 1;

  const x = (year: number) =>
    result.years.length > 1 ? padding.left + (year / result.years[result.years.length - 1]) * plotW : padding.left;
  const y = (v: number) => padding.top + plotH - ((v - yMin) / yRange) * plotH;

  const areaPath = (upper: (b: SimResult["bands"][number]) => number, lower: (b: SimResult["bands"][number]) => number) => {
    const top = result.years.map((yr, i) => `${x(yr)},${y(upper(result.bands[i]))}`);
    const bottom = result.years
      .map((yr, i) => `${x(yr)},${y(lower(result.bands[i]))}`)
      .reverse();
    return `M ${top.join(" L ")} L ${bottom.join(" L ")} Z`;
  };

  const linePath = (values: number[]) => values.map((v, i) => `${x(result.years[i])},${y(v)}`).join(" ");

  return (
    <svg viewBox={`0 0 ${width} ${height}`} style={{ width: "100%", height: "auto", display: "block" }}>
      {ticks.map((t) => (
        <g key={t}>
          <line
            x1={padding.left}
            x2={width - padding.right}
            y1={y(t)}
            y2={y(t)}
            stroke={t === 0 ? "#c3c2b7" : "#e1e0d9"}
            strokeWidth={1}
          />
          <text x={padding.left - 8} y={y(t)} textAnchor="end" dominantBaseline="middle" fontSize="11" fill="#898781">
            {fmtMoney(t)}
          </text>
        </g>
      ))}

      {result.years.length > 1 && (
        <>
          <text x={padding.left} y={height - 8} fontSize="11" fill="#898781">
            Year 0
          </text>
          <text x={width - padding.right} y={height - 8} textAnchor="end" fontSize="11" fill="#898781">
            Year {result.years[result.years.length - 1]}
          </text>
        </>
      )}

      {/* 10th-90th band */}
      <path d={areaPath((b) => b.p90, (b) => b.p10)} fill={BAND_COLOR} fillOpacity={0.12} />
      {/* 25th-75th band */}
      <path d={areaPath((b) => b.p75, (b) => b.p25)} fill={BAND_COLOR} fillOpacity={0.25} />

      {/* Reference line (deterministic, no randomness) */}
      <polyline
        points={linePath(result.reference)}
        fill="none"
        stroke={REFERENCE_COLOR}
        strokeWidth={2}
        strokeDasharray="5 4"
        strokeLinecap="round"
      />

      {/* Median */}
      <polyline
        points={linePath(result.bands.map((b) => b.p50))}
        fill="none"
        stroke={BAND_COLOR}
        strokeWidth={2.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Small shared controls
// ---------------------------------------------------------------------------

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: "0.75rem", padding: "1.25rem", ...style }}>
      {children}
    </div>
  );
}

function CardTitle({ children }: { children: React.ReactNode }) {
  return <div style={{ fontWeight: 700, color: "#1e293b", marginBottom: "1rem" }}>{children}</div>;
}

function MoneyInput({
  id,
  ariaLabel,
  value,
  onChange,
}: {
  id: string;
  ariaLabel: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <input
      id={id}
      aria-label={ariaLabel}
      type="number"
      min={0}
      step={100}
      value={value === 0 ? "" : value}
      placeholder="0"
      onChange={(e) => onChange(e.target.value === "" ? 0 : Math.max(0, Number(e.target.value)))}
      style={{
        width: "100%",
        padding: "0.4rem 0.5rem",
        border: "1px solid #e2e8f0",
        borderRadius: "0.375rem",
        fontSize: "0.85rem",
        color: "#1e293b",
        boxSizing: "border-box",
      }}
    />
  );
}

function FundRow({ slug, value, onChange }: { slug: string; value: number; onChange: (v: number) => void }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
      <label htmlFor={`bal-${slug}`} style={{ flex: 1, fontSize: "0.85rem", color: "#1e293b" }}>
        {fundLabel(slug)}
      </label>
      <div style={{ width: "130px", flexShrink: 0 }}>
        <MoneyInput id={`bal-${slug}`} ariaLabel={`${fundLabel(slug)} balance`} value={value} onChange={onChange} />
      </div>
    </div>
  );
}

/** Delays adopting a new value until it's been stable for delayMs — keeps
 * typing responsive while deferring expensive downstream work (the Monte
 * Carlo run) until the user pauses. `depsKey` should be a stable primitive
 * (e.g. JSON.stringify(value)) since `value` itself is a fresh reference
 * every render. */
function useDebouncedValue<T>(value: T, delayMs: number, depsKey: string): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const handle = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depsKey, delayMs]);
  return debounced;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function TspMonteCarlo() {
  const [monthlyReturns, setMonthlyReturns] = useState<MonthlyReturns | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [balances, setBalances] = useState<Balances>({});
  // Raw text the user is typing, decoupled from the clamped numeric value —
  // clamping on every keystroke fought typing (clearing the field snapped it
  // straight back to the min, so the next digit landed after a stray "1").
  const [horizonInput, setHorizonInput] = useState("20");
  const [useCustomRate, setUseCustomRate] = useState(false);
  const [customRateInput, setCustomRateInput] = useState("6");
  // Single overall Traditional/Roth split (not per-fund) — it's only used to
  // divide the simulated total for display, so one number covers it.
  const [tradPctInput, setTradPctInput] = useState("100");

  const horizonYears = Math.min(50, Math.max(1, parseInt(horizonInput, 10) || 1));
  const customRatePct = Number(customRateInput) || 0;
  const tradPct = Math.min(100, Math.max(0, Number(tradPctInput) || 0));

  useEffect(() => {
    let cancelled = false;
    fetch("/tsp/monthly-returns.json")
      .then((r) => r.json())
      .then((data: MonthlyReturns) => {
        if (!cancelled) setMonthlyReturns(data);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function setBalance(fund: string, value: number) {
    setBalances((prev) => ({ ...prev, [fund]: value }));
  }

  const heldFunds = Object.keys(balances).filter((f) => balances[f] > 0);
  const startTotal = heldFunds.reduce((sum, f) => sum + balances[f], 0);
  const tradRatio = tradPct / 100;

  // The simulation (2,000 trials) is too expensive to re-run synchronously on
  // every keystroke — that was stalling typing in the balance/horizon/rate
  // inputs. Debounce the trigger so it only re-runs ~350ms after the user
  // pauses; the chart/table just hold their last render in the meantime.
  // (% Traditional is a pure display-time split of the result, not part of
  // the simulation itself, so it's deliberately left out of this key.)
  const simKey = JSON.stringify({ balances, heldFunds, horizonYears, useCustomRate, customRatePct });
  const debouncedSimKey = useDebouncedValue(simKey, 350, simKey);
  const isPending = simKey !== debouncedSimKey;

  const result = useMemo(() => {
    if (!monthlyReturns || heldFunds.length === 0) return null;
    return runSimulation({
      monthlyReturns,
      totalByFund: balances,
      heldFunds,
      horizonYears,
      customAnnualRate: useCustomRate ? customRatePct / 100 : null,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthlyReturns, debouncedSimKey]);

  const { core, lifecycle } = monthlyReturns ? sortFunds(monthlyReturns.funds) : { core: [], lifecycle: [] };

  // Derived from `result` (the debounced simulation output), never from the
  // live `horizonYears` — the two can briefly disagree while a recompute is
  // pending, and indexing result.bands with an out-of-range live year was
  // throwing (undefined.p50) and blanking the whole page.
  const checkpointYears = useMemo(() => {
    if (!result) return [];
    const maxYear = result.years[result.years.length - 1];
    if (maxYear <= 10) return Array.from({ length: maxYear + 1 }, (_, y) => y);
    const ys = [0];
    for (let y = 5; y < maxYear; y += 5) ys.push(y);
    ys.push(maxYear);
    return ys;
  }, [result]);

  return (
    <div style={{ fontFamily: "Inter, system-ui, sans-serif", maxWidth: "980px", margin: "0 auto", padding: "1.5rem" }}>
      <div style={{ marginBottom: "2rem" }}>
        <h1 style={{ fontSize: "1.75rem", fontWeight: 800, color: "#0F2244", marginBottom: "0.5rem" }}>
          TSP Monte Carlo Projection
        </h1>
        <p style={{ color: "#64748b", lineHeight: 1.6 }}>
          Enter today's balances and see a range of simulated future outcomes, built by resampling real historical
          months across your held funds together — not one fund at a time. Assumes no future contributions or
          withdrawals.
        </p>
      </div>

      {loadError && (
        <Card style={{ marginBottom: "1.5rem", background: "#fef2f2", borderColor: "#fca5a5", color: "#dc2626" }}>
          Couldn't load TSP historical data. Try refreshing the page.
        </Card>
      )}

      {/* Balances */}
      <Card style={{ marginBottom: "1.5rem" }}>
        <CardTitle>Current Balances</CardTitle>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gridAutoFlow: "column",
            gridTemplateRows: `repeat(${Math.ceil([...core, ...lifecycle].length / 2)}, auto)`,
            columnGap: "2rem",
            rowGap: "0.6rem",
          }}
        >
          {[...core, ...lifecycle].map((slug) => (
            <FundRow key={slug} slug={slug} value={balances[slug] ?? 0} onChange={(v) => setBalance(slug, v)} />
          ))}
        </div>

        <div
          style={{
            marginTop: "1.25rem",
            paddingTop: "1rem",
            borderTop: "1px solid #f1f5f9",
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: "1.5rem",
          }}
        >
          <div>
            <label htmlFor="trad-pct" style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: "#64748b", marginBottom: "0.25rem" }}>
              % Traditional
            </label>
            <div style={{ display: "flex", alignItems: "center", gap: "0.3rem" }}>
              <input
                id="trad-pct"
                type="number"
                min={0}
                max={100}
                value={tradPctInput}
                onChange={(e) => setTradPctInput(e.target.value)}
                onBlur={() => setTradPctInput(String(tradPct))}
                style={{ width: "70px", padding: "0.4rem 0.5rem", border: "1px solid #e2e8f0", borderRadius: "0.375rem", fontSize: "0.85rem" }}
              />
              <span style={{ fontSize: "0.85rem", color: "#64748b" }}>%</span>
            </div>
          </div>

          <div style={{ fontSize: "0.85rem", color: "#52514e" }}>
            Total: <strong style={{ color: "#0F2244" }}>{fmtMoney(startTotal)}</strong>
            {startTotal > 0 && (
              <span style={{ color: "#94a3b8" }}>
                {" "}
                ({fmtMoney(startTotal * tradRatio)} Traditional / {fmtMoney(startTotal * (1 - tradRatio))} Roth)
              </span>
            )}
          </div>
        </div>
      </Card>

      {/* Options */}
      <Card style={{ marginBottom: "1.5rem" }}>
        <CardTitle>Options</CardTitle>
        <div style={{ display: "flex", gap: "2rem", flexWrap: "wrap", alignItems: "flex-end" }}>
          <div>
            <label htmlFor="horizon-years" style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: "#64748b", marginBottom: "0.25rem" }}>
              Horizon (years)
            </label>
            <input
              id="horizon-years"
              type="number"
              min={1}
              max={50}
              value={horizonInput}
              onChange={(e) => setHorizonInput(e.target.value)}
              onBlur={() => setHorizonInput(String(horizonYears))}
              style={{ width: "90px", padding: "0.4rem 0.5rem", border: "1px solid #e2e8f0", borderRadius: "0.375rem", fontSize: "0.85rem" }}
            />
          </div>
          <div>
            <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.85rem", color: "#1e293b", cursor: "pointer" }}>
              <input type="checkbox" checked={useCustomRate} onChange={(e) => setUseCustomRate(e.target.checked)} />
              Use my own assumed annual return instead of the historical reference
            </label>
            {useCustomRate && (
              <div style={{ marginTop: "0.4rem" }}>
                <input
                  id="custom-rate"
                  type="number"
                  step={0.1}
                  value={customRateInput}
                  onChange={(e) => setCustomRateInput(e.target.value)}
                  onBlur={() => setCustomRateInput(String(customRatePct))}
                  style={{ width: "80px", padding: "0.4rem 0.5rem", border: "1px solid #e2e8f0", borderRadius: "0.375rem", fontSize: "0.85rem" }}
                />
                <label htmlFor="custom-rate" style={{ marginLeft: "0.4rem", fontSize: "0.85rem", color: "#64748b" }}>
                  % per year
                </label>
              </div>
            )}
          </div>
        </div>
      </Card>

      {/* Results */}
      <Card style={{ marginBottom: "1.5rem", opacity: isPending ? 0.6 : 1, transition: "opacity 150ms" }}>
        <CardTitle>Projected Balance Range</CardTitle>

        {heldFunds.length === 0 ? (
          <div style={{ color: "#94a3b8", padding: "2rem 0", textAlign: "center" }}>
            Enter at least one fund balance to see a projection.
          </div>
        ) : result ? (
          <>
            {result.poolSize < MIN_POOL_MONTHS && (
              <div
                style={{
                  marginBottom: "1rem",
                  padding: "0.75rem 1rem",
                  background: "#fffbeb",
                  border: "1px solid #fde68a",
                  borderRadius: "0.5rem",
                  fontSize: "0.8rem",
                  color: "#92400e",
                }}
              >
                Only {result.poolSize} months of shared history are available across the funds you selected — likely
                because one of them (a newer Lifecycle fund) hasn't existed long. Results with this little data
                should be treated as rough at best.
              </div>
            )}

            <div style={{ display: "flex", flexWrap: "wrap", gap: "1.25rem", marginBottom: "1rem", fontSize: "0.8rem" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                <span style={{ width: 14, height: 10, background: BAND_COLOR, opacity: 0.25, display: "inline-block" }} />
                <span style={{ color: "#52514e" }}>50% of outcomes (25th–75th percentile)</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                <span style={{ width: 14, height: 10, background: BAND_COLOR, opacity: 0.12, display: "inline-block" }} />
                <span style={{ color: "#52514e" }}>80% of outcomes (10th–90th percentile)</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                <span style={{ width: 14, height: 2, background: BAND_COLOR, display: "inline-block" }} />
                <span style={{ color: "#52514e" }}>Median</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                <span style={{ width: 14, height: 0, borderTop: `2px dashed ${REFERENCE_COLOR}`, display: "inline-block" }} />
                <span style={{ color: "#52514e" }}>
                  {useCustomRate ? `Reference (${customRatePct}%/yr)` : "Reference (historical average, no volatility)"}
                </span>
              </div>
            </div>

            <FanChart result={result} />

            <div style={{ overflowX: "auto", marginTop: "1.5rem" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
                <thead>
                  <tr style={{ borderBottom: "2px solid #e2e8f0" }}>
                    <th style={{ textAlign: "left", padding: "0.4rem 0.5rem", color: "#64748b" }}>Year</th>
                    <th style={{ textAlign: "right", padding: "0.4rem 0.5rem", color: "#64748b" }}>10th pct</th>
                    <th style={{ textAlign: "right", padding: "0.4rem 0.5rem", color: "#64748b" }}>25th pct</th>
                    <th style={{ textAlign: "right", padding: "0.4rem 0.5rem", color: "#64748b" }}>Median</th>
                    <th style={{ textAlign: "right", padding: "0.4rem 0.5rem", color: "#64748b" }}>75th pct</th>
                    <th style={{ textAlign: "right", padding: "0.4rem 0.5rem", color: "#64748b" }}>90th pct</th>
                  </tr>
                </thead>
                <tbody>
                  {checkpointYears.map((yr) => {
                    const b = result.bands[yr];
                    return (
                      <tr key={yr} style={{ borderBottom: "1px solid #f1f5f9" }}>
                        <td style={{ padding: "0.4rem 0.5rem", color: "#1e293b" }}>{yr}</td>
                        <td style={{ padding: "0.4rem 0.5rem", textAlign: "right", color: "#52514e" }}>{fmtMoney(b.p10)}</td>
                        <td style={{ padding: "0.4rem 0.5rem", textAlign: "right", color: "#52514e" }}>{fmtMoney(b.p25)}</td>
                        <td style={{ padding: "0.4rem 0.5rem", textAlign: "right", fontWeight: 600, color: "#0F2244" }}>
                          {fmtMoney(b.p50)}
                        </td>
                        <td style={{ padding: "0.4rem 0.5rem", textAlign: "right", color: "#52514e" }}>{fmtMoney(b.p75)}</td>
                        <td style={{ padding: "0.4rem 0.5rem", textAlign: "right", color: "#52514e" }}>{fmtMoney(b.p90)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {startTotal > 0 && (
              <div style={{ marginTop: "1rem", fontSize: "0.8rem", color: "#94a3b8" }}>
                At the median outcome in year {result.years[result.years.length - 1]}, roughly{" "}
                {fmtMoney(result.bands[result.bands.length - 1].p50 * tradRatio)} would be Traditional and{" "}
                {fmtMoney(result.bands[result.bands.length - 1].p50 * (1 - tradRatio))} Roth, applying today's balance
                ratio.
              </div>
            )}
          </>
        ) : (
          <div style={{ color: "#94a3b8", padding: "2rem 0", textAlign: "center" }}>Loading historical data…</div>
        )}
      </Card>

      <div
        style={{
          marginTop: "1.5rem",
          padding: "1rem 1.25rem",
          background: "#fff",
          border: "1px solid #e2e8f0",
          borderRadius: "0.75rem",
          fontSize: "0.8rem",
          color: "#94a3b8",
          lineHeight: 1.6,
        }}
      >
        <strong style={{ color: "#64748b" }}>Reading the chart:</strong> each simulation is one possible future built
        by resampling real historical months. The median (50th percentile) is the middle simulated outcome — half of
        the {TRIALS.toLocaleString()} simulations ended higher, half lower. The narrow band covers the middle 50% of
        outcomes (25th–75th percentile); the wide band covers the middle 80% (10th–90th percentile). Real results
        could still fall outside every band shown.
      </div>

      <div
        style={{
          marginTop: "1rem",
          padding: "1rem 1.25rem",
          background: "#fff",
          border: "1px solid #e2e8f0",
          borderRadius: "0.75rem",
          fontSize: "0.8rem",
          color: "#94a3b8",
          lineHeight: 1.6,
        }}
      >
        <strong style={{ color: "#64748b" }}>Disclaimer:</strong> This tool simulates {TRIALS.toLocaleString()} possible
        futures by resampling actual historical monthly returns since May 2003 — it is not a prediction. It does not
        model future contributions, withdrawals, taxes, or fees. Past performance does not guarantee future results.
      </div>
    </div>
  );
}

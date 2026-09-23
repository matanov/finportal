/**
 * WageBaseComparison.tsx
 *
 * Plots a GS salary (grade, step, locality — same pickers as the Salary
 * History Lookup) against the Social Security wage base, year by year.
 *
 * Default view is a log scale, where equal percentage growth draws parallel
 * lines: if the salary line runs parallel to the wage base, that salary is
 * keeping up with national wage growth; if the gap widens, it is falling
 * behind.
 */

import { useEffect, useRef, useState } from "react";
import localityData from "../data/localitycode-localityarea.json";
import { FIRST_PAY_YEAR, LAST_PAY_YEAR, lookupSalary } from "../lib/payLookup";
import {
  compareToWageBase,
  type SalaryPoint,
  type WageBaseComparison as Comparison,
} from "../lib/wageBase";
import ErrorBoundary from "./ErrorBoundary";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LOCALITY_OPTIONS = Object.entries(localityData as Record<string, string>)
  .sort((a, b) => a[1].localeCompare(b[1]))
  .map(([code, name]) => ({ code, name }));

const GRADES = Array.from({ length: 15 }, (_, i) => i + 1);
const STEPS = Array.from({ length: 10 }, (_, i) => i + 1);
const YEARS = Array.from(
  { length: LAST_PAY_YEAR - FIRST_PAY_YEAR + 1 },
  (_, i) => FIRST_PAY_YEAR + i,
);

const SALARY_COLOR = "#C9A035";
const WAGE_BASE_COLOR = "#2A7D9C";

/** Largest gap between the two annual growth rates still called "keeping pace" (0.1 pt) */
const PACE_TOLERANCE = 0.001;

type Scale = "log" | "linear";
type LookupState = "loading" | "done" | "error";

const fmtMoney = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);

const fmtAxis = (n: number) => (n === 0 ? "$0" : `$${Math.round(n / 1000)}k`);
const fmtPct = (n: number, digits = 2) => `${(n * 100).toFixed(digits)}%`;

// ---------------------------------------------------------------------------
// Small shared controls
// ---------------------------------------------------------------------------

function Label({
  htmlFor,
  children,
}: {
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <label
      htmlFor={htmlFor}
      style={{
        display: "block",
        fontSize: "0.75rem",
        fontWeight: 600,
        textTransform: "uppercase",
        letterSpacing: "0.05em",
        color: "#64748b",
        marginBottom: "0.25rem",
      }}
    >
      {children}
    </label>
  );
}

function Select({
  id,
  value,
  onChange,
  children,
}: {
  id?: string;
  value: string | number;
  onChange: (v: string) => void;
  children: React.ReactNode;
}) {
  return (
    <select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{
        width: "100%",
        padding: "0.5rem 0.6rem",
        border: "1px solid #e2e8f0",
        borderRadius: "0.375rem",
        fontSize: "0.9rem",
        background: "#fff",
        color: "#1e293b",
        cursor: "pointer",
      }}
    >
      {children}
    </select>
  );
}

function ScaleToggle({
  scale,
  onChange,
}: {
  scale: Scale;
  onChange: (s: Scale) => void;
}) {
  const options: { value: Scale; label: string }[] = [
    { value: "log", label: "Growth (log)" },
    { value: "linear", label: "Dollars" },
  ];
  return (
    <div
      role="group"
      aria-label="Chart scale"
      style={{
        display: "inline-flex",
        border: "1px solid #e2e8f0",
        borderRadius: "0.375rem",
        overflow: "hidden",
      }}
    >
      {options.map((o) => {
        const active = o.value === scale;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(o.value)}
            style={{
              padding: "0.35rem 0.75rem",
              fontSize: "0.8rem",
              fontWeight: 600,
              border: "none",
              cursor: "pointer",
              background: active ? "#0F2244" : "#fff",
              color: active ? "#fff" : "#64748b",
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Chart — dependency-free inline SVG, two lines
// ---------------------------------------------------------------------------

/** Round-number dollar ticks that read well on either scale */
const TICK_CANDIDATES = [
  10_000, 15_000, 20_000, 25_000, 30_000, 40_000, 50_000, 60_000, 75_000,
  100_000, 125_000, 150_000, 175_000, 200_000, 250_000, 300_000,
];

function pickTicks(min: number, max: number, count = 5): number[] {
  const inRange = TICK_CANDIDATES.filter((t) => t >= min && t <= max);
  if (inRange.length <= count) return inRange;
  const stride = Math.ceil(inRange.length / count);
  return inRange.filter((_, i) => i % stride === 0);
}

/** Evenly spaced ticks from $0 for the dollar view */
function linearTicks(max: number, count = 5): number[] {
  const step =
    [10_000, 20_000, 25_000, 50_000, 100_000].find((s) => max / s <= count) ??
    100_000;
  return Array.from({ length: Math.floor(max / step) + 1 }, (_, i) => i * step);
}

/** Tracks an element's rendered width so the SVG can draw at 1:1 scale */
function useWidth<T extends HTMLElement>(fallback: number) {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) =>
      setWidth(Math.round(entry.contentRect.width)),
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

function ComparisonChart({
  comparison,
  scale,
}: {
  comparison: Comparison;
  scale: Scale;
}) {
  const { rows } = comparison;
  const [containerRef, containerWidth] = useWidth<HTMLDivElement>(720);

  // Draw at the container's real width so text stays legible on phones.
  const width = Math.max(containerWidth, 280);
  const compact = width < 480;
  const height = compact ? 240 : 300;
  const padding = { top: 20, right: compact ? 76 : 90, bottom: 30, left: 48 };
  const plotW = width - padding.left - padding.right;
  const plotH = height - padding.top - padding.bottom;

  const values = rows.flatMap((r) => [r.salary, r.wageBase]);
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);

  // Log scale pads multiplicatively; linear starts at $0 so dollar gaps read honestly.
  const lo = scale === "log" ? rawMin / 1.15 : 0;
  const hi = rawMax * 1.08;
  const t = (v: number) =>
    scale === "log"
      ? (Math.log(v) - Math.log(lo)) / (Math.log(hi) - Math.log(lo))
      : (v - lo) / (hi - lo);

  const firstYear = rows[0].year;
  const lastYear = rows[rows.length - 1].year;
  const x = (year: number) =>
    padding.left + ((year - firstYear) / (lastYear - firstYear || 1)) * plotW;
  const y = (v: number) => padding.top + plotH - t(v) * plotH;

  const ticks = scale === "log" ? pickTicks(lo, hi) : linearTicks(hi);

  const salaryPts = rows.map((r) => `${x(r.year)},${y(r.salary)}`).join(" ");
  const basePts = rows.map((r) => `${x(r.year)},${y(r.wageBase)}`).join(" ");
  const last = rows[rows.length - 1];

  // Keep the two end labels from colliding when the lines finish close together.
  let salaryLabelY = y(last.salary);
  let baseLabelY = y(last.wageBase);
  if (Math.abs(salaryLabelY - baseLabelY) < 14) {
    const mid = (salaryLabelY + baseLabelY) / 2;
    const up = salaryLabelY < baseLabelY;
    salaryLabelY = mid + (up ? -7 : 7);
    baseLabelY = mid + (up ? 7 : -7);
  }

  const yearLabelEvery = compact ? 5 : rows.length > 8 ? 2 : 1;

  return (
    <div ref={containerRef}>
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        style={{ display: "block", maxWidth: "100%" }}
        role="img"
        aria-label="GS salary compared with the Social Security wage base by year"
      >
        {/* Gridlines + y-axis labels */}
        {ticks.map((v) => (
          <g key={v}>
            <line
              x1={padding.left}
              x2={width - padding.right}
              y1={y(v)}
              y2={y(v)}
              stroke="#e2e8f0"
              strokeWidth={1}
            />
            <text
              x={padding.left - 8}
              y={y(v)}
              textAnchor="end"
              dominantBaseline="middle"
              fontSize="11"
              fill="#94a3b8"
            >
              {fmtAxis(v)}
            </text>
          </g>
        ))}

        {/* Year labels */}
        {rows.map((r, i) => {
          if (i % yearLabelEvery !== 0 && i !== rows.length - 1) return null;
          return (
            <text
              key={r.year}
              x={x(r.year)}
              y={height - 8}
              textAnchor="middle"
              fontSize="11"
              fill="#94a3b8"
            >
              {r.year}
            </text>
          );
        })}

        {/* Lines */}
        <polyline
          points={basePts}
          fill="none"
          stroke={WAGE_BASE_COLOR}
          strokeWidth={2.5}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <polyline
          points={salaryPts}
          fill="none"
          stroke={SALARY_COLOR}
          strokeWidth={2.5}
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/* Points with hover titles */}
        {rows.map((r) => (
          <g key={r.year}>
            <circle cx={x(r.year)} cy={y(r.wageBase)} r={3} fill={WAGE_BASE_COLOR}>
              <title>
                {r.year} wage base: {fmtMoney(r.wageBase)}
              </title>
            </circle>
            <circle cx={x(r.year)} cy={y(r.salary)} r={3} fill={SALARY_COLOR}>
              <title>
                {r.year} salary: {fmtMoney(r.salary)} ({fmtPct(r.ratio, 1)} of wage base)
              </title>
            </circle>
          </g>
        ))}

        {/* Direct end labels */}
        <text
          x={x(last.year) + 8}
          y={baseLabelY}
          dominantBaseline="middle"
          fontSize="12"
          fontWeight={600}
          fill={WAGE_BASE_COLOR}
        >
          Wage base
        </text>
        <text
          x={x(last.year) + 8}
          y={salaryLabelY}
          dominantBaseline="middle"
          fontSize="12"
          fontWeight={600}
          fill={SALARY_COLOR}
        >
          GS salary
        </text>
      </svg>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

function Verdict({ comparison }: { comparison: Comparison }) {
  const { salaryCagr, wageBaseCagr, firstYear, lastYear, firstRatio, lastRatio } =
    comparison;
  const gap = salaryCagr - wageBaseCagr;
  const verdict =
    Math.abs(gap) <= PACE_TOLERANCE
      ? { text: "Keeping pace", color: "#0F2244", bg: "#f1f5f9" }
      : gap > 0
        ? { text: "Outpacing the wage base", color: "#166534", bg: "#f0fdf4" }
        : { text: "Falling behind the wage base", color: "#991b1b", bg: "#fef2f2" };

  const stat = (label: string, value: string) => (
    <div>
      <div
        style={{
          fontSize: "0.7rem",
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          color: "#64748b",
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: "1.15rem",
          fontWeight: 700,
          color: "#0F2244",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </div>
    </div>
  );

  return (
    <div style={{ marginTop: "1rem" }}>
      <div
        style={{
          display: "inline-block",
          background: verdict.bg,
          color: verdict.color,
          fontWeight: 700,
          fontSize: "0.85rem",
          padding: "0.3rem 0.75rem",
          borderRadius: "999px",
          marginBottom: "0.75rem",
        }}
      >
        {verdict.text}
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
          gap: "1rem",
        }}
      >
        {stat("Salary growth / yr", fmtPct(salaryCagr))}
        {stat("Wage base growth / yr", fmtPct(wageBaseCagr))}
        {stat(`% of wage base, ${firstYear}`, fmtPct(firstRatio, 1))}
        {stat(`% of wage base, ${lastYear}`, fmtPct(lastRatio, 1))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function WageBaseComparison() {
  return (
    <ErrorBoundary name="GS Salary vs. Wage Base">
      <WageBaseComparisonInner />
    </ErrorBoundary>
  );
}

function WageBaseComparisonInner() {
  const [locality, setLocality] = useState("DCB");
  const [grade, setGrade] = useState(12);
  const [step, setStep] = useState(1);
  const [scale, setScale] = useState<Scale>("log");
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [state, setState] = useState<LookupState>("loading");

  useEffect(() => {
    let cancelled = false;
    setState("loading");

    (async () => {
      const results = await Promise.all(
        YEARS.map(async (year) => {
          try {
            const salary = await lookupSalary(year, locality, grade, step);
            return salary != null ? { year, salary } : null;
          } catch {
            return null;
          }
        }),
      );

      if (cancelled) return;

      const found = results.filter((r): r is SalaryPoint => r !== null);
      const result = compareToWageBase(found);
      setComparison(result);
      setState(result ? "done" : "error");
    })();

    return () => {
      cancelled = true;
    };
  }, [locality, grade, step]);

  const localityName =
    (localityData as Record<string, string>)[locality] ?? locality;

  return (
    <div style={{ fontFamily: "Inter, system-ui, sans-serif" }}>
      {/* Controls */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "1rem",
          marginBottom: "1rem",
        }}
      >
        <div style={{ flex: "1 1 260px", minWidth: 0 }}>
          <Label htmlFor="wb-locality">Locality Area</Label>
          <Select id="wb-locality" value={locality} onChange={setLocality}>
            {LOCALITY_OPTIONS.map(({ code, name }) => (
              <option key={code} value={code}>
                {code} — {name}
              </option>
            ))}
          </Select>
        </div>
        <div style={{ flex: "1 1 90px" }}>
          <Label htmlFor="wb-grade">Grade</Label>
          <Select id="wb-grade" value={grade} onChange={(v) => setGrade(Number(v))}>
            {GRADES.map((g) => (
              <option key={g} value={g}>
                GS-{g}
              </option>
            ))}
          </Select>
        </div>
        <div style={{ flex: "1 1 90px" }}>
          <Label htmlFor="wb-step">Step</Label>
          <Select id="wb-step" value={step} onChange={(v) => setStep(Number(v))}>
            {STEPS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {state === "loading" && (
        <div style={{ color: "#94a3b8", padding: "2rem 0", textAlign: "center" }}>
          Loading pay data…
        </div>
      )}

      {state === "error" && (
        <div
          style={{
            background: "#fef2f2",
            border: "1px solid #fca5a5",
            borderRadius: "0.5rem",
            padding: "0.75rem 1rem",
            color: "#dc2626",
            fontSize: "0.875rem",
          }}
        >
          Not enough pay data for GS-{grade} Step {step} in {localityName} to
          compare.
        </div>
      )}

      {state === "done" && comparison && (
        <>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "0.75rem",
              marginBottom: "0.5rem",
            }}
          >
            <div style={{ fontWeight: 700, color: "#1e293b", fontSize: "0.95rem" }}>
              GS-{grade} Step {step}, {localityName} vs. Social Security wage base
            </div>
            <ScaleToggle scale={scale} onChange={setScale} />
          </div>
          <ComparisonChart comparison={comparison} scale={scale} />
          <p style={{ fontSize: "0.8rem", color: "#64748b", margin: "0.25rem 0 0" }}>
            {scale === "log"
              ? "Log scale: equal percentage growth draws parallel lines. A widening gap means the salary is falling behind national wage growth."
              : "Dollar scale: shows the actual gap in dollars. Use the growth view to compare rates of increase."}
          </p>
          <Verdict comparison={comparison} />
        </>
      )}
    </div>
  );
}

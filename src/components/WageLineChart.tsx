/**
 * WageLineChart.tsx
 *
 * Dependency-free inline SVG line chart for salary-vs-wage-base views, plus
 * the Growth (log) / Dollars scale toggle that goes with it. Shared by
 * WageBaseComparison and CareerWageChart.
 *
 * On the log scale, equal percentage growth draws parallel lines, so two
 * series that grow at the same rate stay the same distance apart.
 */

import { useEffect, useRef, useState } from "react";

export type Scale = "log" | "linear";

export interface ChartPoint {
  year: number;
  value: number;
  /** Extra hover text, e.g. "GS-12 Step 3" */
  note?: string;
}

export interface ChartSeries {
  label: string;
  color: string;
  points: ChartPoint[];
}

export const fmtMoney = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);

export const fmtPct = (n: number, digits = 2) => `${(n * 100).toFixed(digits)}%`;

const fmtAxis = (n: number) => (n === 0 ? "$0" : `$${Math.round(n / 1000)}k`);

// ---------------------------------------------------------------------------
// Scale toggle
// ---------------------------------------------------------------------------

export function ScaleToggle({
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

export function ScaleNote({ scale }: { scale: Scale }) {
  return (
    <p style={{ fontSize: "0.8rem", color: "#64748b", margin: "0.25rem 0 0" }}>
      {scale === "log"
        ? "Log scale: equal percentage growth draws parallel lines. A widening gap means the salary is falling behind national wage growth."
        : "Dollar scale: shows the actual gap in dollars. Use the growth view to compare rates of increase."}
    </p>
  );
}

// ---------------------------------------------------------------------------
// Chart
// ---------------------------------------------------------------------------

/**
 * Round-number dollar ticks for the log view, roundest first: each tier is
 * added only if the whole tier still fits within `count` ticks.
 */
const LOG_TICK_TIERS = [
  [10_000, 25_000, 50_000, 100_000, 200_000],
  [75_000, 150_000, 300_000],
  [20_000, 30_000, 40_000, 60_000, 125_000, 175_000, 250_000],
];

function logTicks(min: number, max: number, count = 5): number[] {
  const ticks: number[] = [];
  for (const tier of LOG_TICK_TIERS) {
    const add = tier.filter((t) => t >= min && t <= max);
    if (ticks.length > 0 && ticks.length + add.length > count) break;
    ticks.push(...add);
  }
  return ticks.sort((a, b) => a - b);
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

/** Spreads end-of-line labels apart so none sit closer than `gap` px. */
function spreadLabels(ys: number[], gap: number): number[] {
  const order = ys.map((y, i) => ({ y, i })).sort((a, b) => a.y - b.y);
  for (let k = 1; k < order.length; k++) {
    if (order[k].y - order[k - 1].y < gap) order[k].y = order[k - 1].y + gap;
  }
  const out = [...ys];
  for (const o of order) out[o.i] = o.y;
  return out;
}

export function WageLineChart({
  series,
  scale,
  ariaLabel,
}: {
  series: ChartSeries[];
  scale: Scale;
  ariaLabel: string;
}) {
  const [containerRef, containerWidth] = useWidth<HTMLDivElement>(720);

  // Draw at the container's real width so text stays legible on phones.
  const width = Math.max(containerWidth, 280);
  const compact = width < 480;
  const height = compact ? 240 : 300;
  const labelWidth = Math.max(...series.map((s) => s.label.length)) * 7 + 12;
  const padding = { top: 20, right: labelWidth, bottom: 30, left: 48 };
  const plotW = width - padding.left - padding.right;
  const plotH = height - padding.top - padding.bottom;

  const allPoints = series.flatMap((s) => s.points);
  const values = allPoints.map((p) => p.value);
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);

  // Log scale pads multiplicatively; linear starts at $0 so dollar gaps read honestly.
  const lo = scale === "log" ? rawMin / 1.15 : 0;
  const hi = rawMax * 1.08;
  const t = (v: number) =>
    scale === "log"
      ? (Math.log(v) - Math.log(lo)) / (Math.log(hi) - Math.log(lo))
      : (v - lo) / (hi - lo);

  const years = [...new Set(allPoints.map((p) => p.year))].sort((a, b) => a - b);
  const firstYear = years[0];
  const lastYear = years[years.length - 1];
  const x = (year: number) =>
    padding.left + ((year - firstYear) / (lastYear - firstYear || 1)) * plotW;
  const y = (v: number) => padding.top + plotH - t(v) * plotH;

  const ticks = scale === "log" ? logTicks(lo, hi) : linearTicks(hi);
  const yearLabelEvery = compact ? 5 : years.length > 8 ? 2 : 1;

  const lastPoints = series.map((s) => s.points[s.points.length - 1]);
  const labelYs = spreadLabels(
    lastPoints.map((p) => y(p.value)),
    14,
  );

  return (
    <div ref={containerRef}>
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        style={{ display: "block", maxWidth: "100%" }}
        role="img"
        aria-label={ariaLabel}
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
        {years.map((yr, i) => {
          if (i % yearLabelEvery !== 0 && i !== years.length - 1) return null;
          return (
            <text
              key={yr}
              x={x(yr)}
              y={height - 8}
              textAnchor="middle"
              fontSize="11"
              fill="#94a3b8"
            >
              {yr}
            </text>
          );
        })}

        {/* Lines */}
        {series.map((s) => (
          <polyline
            key={s.label}
            points={s.points.map((p) => `${x(p.year)},${y(p.value)}`).join(" ")}
            fill="none"
            stroke={s.color}
            strokeWidth={2.5}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}

        {/* Points with hover titles */}
        {series.map((s) =>
          s.points.map((p) => (
            <circle
              key={`${s.label}-${p.year}`}
              cx={x(p.year)}
              cy={y(p.value)}
              r={3}
              fill={s.color}
            >
              <title>
                {p.year} {s.label}: {fmtMoney(p.value)}
                {p.note ? ` (${p.note})` : ""}
              </title>
            </circle>
          )),
        )}

        {/* Direct end labels */}
        {series.map((s, i) => (
          <text
            key={s.label}
            x={x(lastPoints[i].year) + 8}
            y={labelYs[i]}
            dominantBaseline="middle"
            fontSize="12"
            fontWeight={600}
            fill={s.color}
          >
            {s.label}
          </text>
        ))}
      </svg>
    </div>
  );
}

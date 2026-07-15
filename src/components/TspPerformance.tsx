/**
 * TspPerformance.tsx
 *
 * TSP Fund Performance — pick funds via checkboxes and a date range, see
 * indexed % performance over time on a shared chart.
 *
 * Funds are indexed to % change from the first in-range price rather than
 * plotted as raw share prices — G Fund ($20) and C Fund ($121) aren't
 * comparable on one axis otherwise.
 */

import { useEffect, useMemo, useRef, useState } from "react";

// ---------------------------------------------------------------------------
// Data types + constants
// ---------------------------------------------------------------------------

type FundPrice = { date: string; price: number };
type FundData = {
  fund: string;
  name: string;
  inception: string;
  asOf: string;
  count: number;
  prices: FundPrice[];
};

const MIN_DATE = "2003-05-31";
const CORE_FUNDS = ["G", "F", "C", "S", "I"];
const DEFAULT_SELECTED = ["G", "F", "C", "S", "I"];
const MAX_SERIES = 8;
const TODAY = new Date().toISOString().slice(0, 10);

// Categorical palette — fixed order, validated for line charts (adjacent
// pairlist) against the site's white card surface. Never reassign an
// already-plotted fund's color, never cycle past slot 8.
const CATEGORICAL_COLORS = [
  "#2a78d6", // blue
  "#008300", // green
  "#e87ba4", // magenta
  "#eda100", // yellow
  "#1baf7a", // aqua
  "#eb6834", // orange
  "#4a3aa7", // violet
  "#e34948", // red
];
// Slots below 3:1 contrast on white — relief required (always paired with
// visible text labels + the table view, never color-alone identity).
const LOW_CONTRAST_SLOTS = new Set([2, 3, 4]);

const GOOD = "#16a34a";
const BAD = "#dc2626";

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

/** Index of the last entry with date <= target in a date-ascending array. */
function floorIndex<T extends { date: string }>(arr: T[], target: string): number {
  let lo = 0,
    hi = arr.length - 1,
    result = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid].date <= target) {
      result = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return result;
}

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
    min -= 1;
    max += 1;
  }
  const range = niceNumber(max - min, false);
  const step = niceNumber(range / (count - 1), true);
  const niceMin = Math.floor(min / step) * step;
  const niceMax = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = niceMin; v <= niceMax + step * 0.5; v += step) {
    ticks.push(Math.round(v * 100) / 100);
  }
  return ticks;
}

const fmtPct = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
const fmtPrice = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(n);
const fmtDate = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });

// ---------------------------------------------------------------------------
// Small shared controls (same look as SalaryLookup.tsx)
// ---------------------------------------------------------------------------

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid #e2e8f0",
        borderRadius: "0.75rem",
        padding: "1.25rem",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function CardTitle({ children }: { children: React.ReactNode }) {
  return <div style={{ fontWeight: 700, color: "#1e293b", marginBottom: "1rem" }}>{children}</div>;
}

// ---------------------------------------------------------------------------
// Chart
// ---------------------------------------------------------------------------

type Series = {
  slug: string;
  label: string;
  color: string;
  lowContrast: boolean;
  points: { date: string; pct: number }[];
  startDate: string;
  startPrice: number;
  endDate: string;
  endPrice: number;
};

function PerformanceChart({
  series,
  referenceDates,
}: {
  series: Series[];
  referenceDates: string[];
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const width = 800;
  const height = 340;
  const padding = { top: 20, right: 16, bottom: 32, left: 56 };
  const plotW = width - padding.left - padding.right;
  const plotH = height - padding.top - padding.bottom;

  const dateIndex = useMemo(() => {
    const m = new Map<string, number>();
    referenceDates.forEach((d, i) => m.set(d, i));
    return m;
  }, [referenceDates]);

  const allPct = series.flatMap((s) => s.points.map((p) => p.pct));
  const rawMin = allPct.length ? Math.min(...allPct, 0) : -1;
  const rawMax = allPct.length ? Math.max(...allPct, 0) : 1;
  const ticks = niceTicks(rawMin, rawMax);
  const yMin = ticks[0];
  const yMax = ticks[ticks.length - 1];
  const yRange = yMax - yMin || 1;

  const x = (i: number) =>
    referenceDates.length > 1 ? padding.left + (i / (referenceDates.length - 1)) * plotW : padding.left;
  const y = (v: number) => padding.top + plotH - ((v - yMin) / yRange) * plotH;

  function handleMove(e: React.PointerEvent<SVGRectElement>) {
    const svg = svgRef.current;
    if (!svg || referenceDates.length === 0) return;
    const rect = svg.getBoundingClientRect();
    const scaleX = width / rect.width;
    const xUser = (e.clientX - rect.left) * scaleX;
    const clamped = Math.min(Math.max(xUser, padding.left), width - padding.right);
    const frac = plotW > 0 ? (clamped - padding.left) / plotW : 0;
    const idx = Math.round(frac * (referenceDates.length - 1));
    setHoverIdx(Math.min(Math.max(idx, 0), referenceDates.length - 1));
  }

  const hoverDate = hoverIdx !== null ? referenceDates[hoverIdx] : null;
  const showDirectLabels = series.length <= 4 && series.length > 0;

  return (
    <div style={{ position: "relative" }}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        style={{ width: "100%", height: "auto", display: "block" }}
      >
        {/* Gridlines + y-axis labels */}
        {ticks.map((t) => {
          const gy = y(t);
          const isZero = t === 0;
          return (
            <g key={t}>
              <line
                x1={padding.left}
                x2={width - padding.right}
                y1={gy}
                y2={gy}
                stroke={isZero ? "#c3c2b7" : "#e1e0d9"}
                strokeWidth={1}
              />
              <text x={padding.left - 8} y={gy} textAnchor="end" dominantBaseline="middle" fontSize="11" fill="#898781">
                {t}%
              </text>
            </g>
          );
        })}

        {/* Date labels (start / end) */}
        {referenceDates.length > 0 && (
          <>
            <text x={padding.left} y={height - 8} textAnchor="start" fontSize="11" fill="#898781">
              {fmtDate(referenceDates[0])}
            </text>
            <text x={width - padding.right} y={height - 8} textAnchor="end" fontSize="11" fill="#898781">
              {fmtDate(referenceDates[referenceDates.length - 1])}
            </text>
          </>
        )}

        {/* Series lines */}
        {series.map((s) => {
          const pts = s.points
            .filter((p) => dateIndex.has(p.date))
            .map((p) => `${x(dateIndex.get(p.date)!)},${y(p.pct)}`)
            .join(" ");
          return (
            <polyline
              key={s.slug}
              points={pts}
              fill="none"
              stroke={s.color}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          );
        })}

        {/* End-of-line direct labels — only when the chart is uncrowded */}
        {showDirectLabels &&
          series.map((s) => {
            const last = s.points[s.points.length - 1];
            if (!last || !dateIndex.has(last.date)) return null;
            const lx = x(dateIndex.get(last.date)!);
            const ly = y(last.pct);
            return (
              <g key={s.slug}>
                <circle cx={lx} cy={ly} r={4} fill={s.color} stroke="#fff" strokeWidth={2} />
                <text x={lx + 6} y={ly} dominantBaseline="middle" fontSize="11" fontWeight={600} fill="#52514e">
                  {s.label} {fmtPct(last.pct)}
                </text>
              </g>
            );
          })}

        {/* Crosshair */}
        {hoverIdx !== null && (
          <line
            x1={x(hoverIdx)}
            x2={x(hoverIdx)}
            y1={padding.top}
            y2={height - padding.bottom}
            stroke="#c3c2b7"
            strokeWidth={1}
          />
        )}
        {hoverIdx !== null &&
          series.map((s) => {
            const idx = floorIndex(s.points, referenceDates[hoverIdx]);
            if (idx === -1) return null;
            const p = s.points[idx];
            return (
              <circle
                key={s.slug}
                cx={x(hoverIdx)}
                cy={y(p.pct)}
                r={4}
                fill={s.color}
                stroke="#fff"
                strokeWidth={2}
              />
            );
          })}

        {/* Hover hit area */}
        <rect
          x={padding.left}
          y={padding.top}
          width={plotW}
          height={plotH}
          fill="transparent"
          onPointerMove={handleMove}
          onPointerLeave={() => setHoverIdx(null)}
        />
      </svg>

      {/* Tooltip */}
      {hoverDate && (
        <div
          style={{
            position: "absolute",
            top: 4,
            left: `${Math.min(Math.max((x(hoverIdx!) / width) * 100, 12), 88)}%`,
            transform: "translateX(-50%)",
            background: "#0b0b0b",
            color: "#fff",
            borderRadius: "0.5rem",
            padding: "0.5rem 0.65rem",
            fontSize: "0.75rem",
            pointerEvents: "none",
            whiteSpace: "nowrap",
            boxShadow: "0 4px 12px rgba(0,0,0,0.25)",
            zIndex: 10,
          }}
        >
          <div style={{ color: "#c3c2b7", marginBottom: "0.25rem" }}>{fmtDate(hoverDate)}</div>
          {series.map((s) => {
            const idx = floorIndex(s.points, hoverDate);
            return (
              <div key={s.slug} style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                <span style={{ width: 10, height: 2, background: s.color, display: "inline-block" }} />
                <span style={{ color: "#c3c2b7" }}>{s.label}</span>
                <strong style={{ marginLeft: "auto" }}>{idx === -1 ? "—" : fmtPct(s.points[idx].pct)}</strong>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function TspPerformance() {
  const [availableFunds, setAvailableFunds] = useState<string[] | null>(null);
  const [selected, setSelected] = useState<string[]>(DEFAULT_SELECTED);
  const [fundCache, setFundCache] = useState<Record<string, FundData>>({});
  const [loadError, setLoadError] = useState(false);
  const [start, setStart] = useState(MIN_DATE);
  const [end, setEnd] = useState("");
  const [capMessage, setCapMessage] = useState<string | null>(null);

  const colorSlots = useRef<Map<string, number>>(new Map());
  const nextSlot = useRef(0);

  // Load the fund index once.
  useEffect(() => {
    let cancelled = false;
    fetch("/tsp/index.json")
      .then((r) => r.json())
      .then((data: { funds: string[] }) => {
        if (cancelled) return;
        setAvailableFunds(data.funds);
        // Pre-assign color slots for the default selection, in a fixed order.
        for (const slug of DEFAULT_SELECTED) {
          if (data.funds.includes(slug) && !colorSlots.current.has(slug) && nextSlot.current < MAX_SERIES) {
            colorSlots.current.set(slug, nextSlot.current++);
          }
        }
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Fetch data for any selected fund not already cached.
  useEffect(() => {
    const toFetch = selected.filter((slug) => !fundCache[slug]);
    if (toFetch.length === 0) return;
    let cancelled = false;
    Promise.all(
      toFetch.map((slug) =>
        fetch(`/tsp/${slug}.json`)
          .then((r) => r.json())
          .then((data: FundData) => [slug, data] as const)
          .catch(() => [slug, null] as const),
      ),
    ).then((results) => {
      if (cancelled) return;
      setFundCache((prev) => {
        const next = { ...prev };
        for (const [slug, data] of results) if (data) next[slug] = data;
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [selected, fundCache]);

  function toggleFund(slug: string, checked: boolean) {
    if (checked) {
      const hasSlot = colorSlots.current.has(slug);
      if (!hasSlot && nextSlot.current >= MAX_SERIES) {
        setCapMessage(`Comparing ${MAX_SERIES} funds at once is the limit — uncheck one to add another.`);
        return;
      }
      if (!hasSlot) colorSlots.current.set(slug, nextSlot.current++);
      setCapMessage(null);
      setSelected((prev) => [...prev, slug]);
    } else {
      setSelected((prev) => prev.filter((s) => s !== slug));
    }
  }

  function handleStartChange(v: string) {
    setStart(v < MIN_DATE ? MIN_DATE : v);
  }

  const effectiveEnd = end || TODAY;

  // Build indexed % series for every selected + loaded fund within range.
  const series: Series[] = useMemo(() => {
    const out: Series[] = [];
    for (const slug of selected) {
      const data = fundCache[slug];
      if (!data) continue;
      const inRange = data.prices.filter((p) => p.date >= start && p.date <= effectiveEnd);
      if (inRange.length < 2) continue;
      const baseline = inRange[0].price;
      const slot = colorSlots.current.get(slug) ?? 0;
      out.push({
        slug,
        label: fundLabel(slug),
        color: CATEGORICAL_COLORS[slot % CATEGORICAL_COLORS.length],
        lowContrast: LOW_CONTRAST_SLOTS.has(slot),
        points: inRange.map((p) => ({ date: p.date, pct: ((p.price - baseline) / baseline) * 100 })),
        startDate: inRange[0].date,
        startPrice: inRange[0].price,
        endDate: inRange[inRange.length - 1].date,
        endPrice: inRange[inRange.length - 1].price,
      });
    }
    return out;
  }, [selected, fundCache, start, effectiveEnd]);

  const skippedFunds = selected.filter((slug) => {
    const data = fundCache[slug];
    if (!data) return false;
    return !series.some((s) => s.slug === slug);
  });

  const referenceDates = useMemo(() => {
    let longest: Series | null = null;
    for (const s of series) {
      if (!longest || s.points.length > longest.points.length) longest = s;
    }
    return longest ? longest.points.map((p) => p.date) : [];
  }, [series]);

  const { core, lifecycle } = availableFunds ? sortFunds(availableFunds) : { core: [], lifecycle: [] };

  function FundCheckbox({ slug }: { slug: string }) {
    const checked = selected.includes(slug);
    const slot = colorSlots.current.get(slug);
    const swatchColor = checked && slot !== undefined ? CATEGORICAL_COLORS[slot % CATEGORICAL_COLORS.length] : "transparent";
    return (
      <label
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "0.4rem",
          padding: "0.3rem 0.6rem",
          border: "1px solid #e2e8f0",
          borderRadius: "999px",
          fontSize: "0.8rem",
          color: "#1e293b",
          cursor: "pointer",
          userSelect: "none",
          background: checked ? "#f8fafc" : "#fff",
        }}
      >
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => toggleFund(slug, e.target.checked)}
          style={{ accentColor: swatchColor === "transparent" ? undefined : swatchColor }}
        />
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: "999px",
            background: swatchColor,
            border: swatchColor === "transparent" ? "1px solid #cbd5e1" : "none",
          }}
        />
        {fundLabel(slug)}
      </label>
    );
  }

  return (
    <div style={{ fontFamily: "Inter, system-ui, sans-serif", maxWidth: "980px", margin: "0 auto", padding: "1.5rem" }}>
      {/* Header */}
      <div style={{ marginBottom: "2rem" }}>
        <h1 style={{ fontSize: "1.75rem", fontWeight: 800, color: "#0F2244", marginBottom: "0.5rem" }}>
          TSP Fund Performance
        </h1>
        <p style={{ color: "#64748b", lineHeight: 1.6 }}>
          Select funds and a date range to compare their performance, indexed to percent change from the start of
          the range. Data starts {fmtDate(MIN_DATE)}.
        </p>
      </div>

      {loadError && (
        <Card style={{ marginBottom: "1.5rem", background: "#fef2f2", borderColor: "#fca5a5", color: "#dc2626" }}>
          Couldn't load TSP fund data. Try refreshing the page.
        </Card>
      )}

      {/* Controls */}
      <Card style={{ marginBottom: "1.5rem" }}>
        <CardTitle>Funds</CardTitle>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginBottom: "1rem" }}>
          {core.map((slug) => (
            <FundCheckbox key={slug} slug={slug} />
          ))}
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
          {lifecycle.map((slug) => (
            <FundCheckbox key={slug} slug={slug} />
          ))}
        </div>
        {capMessage && (
          <div style={{ marginTop: "0.75rem", fontSize: "0.8rem", color: "#dc2626" }}>{capMessage}</div>
        )}

        <div style={{ marginTop: "1.25rem", display: "flex", gap: "1rem", flexWrap: "wrap", alignItems: "flex-end" }}>
          <div>
            <label htmlFor="tsp-start-date" style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: "#64748b", marginBottom: "0.25rem" }}>
              Start date
            </label>
            <input
              id="tsp-start-date"
              type="date"
              value={start}
              min={MIN_DATE}
              max={TODAY}
              onChange={(e) => handleStartChange(e.target.value)}
              style={{ padding: "0.4rem 0.6rem", border: "1px solid #e2e8f0", borderRadius: "0.375rem", fontSize: "0.85rem" }}
            />
          </div>
          <div>
            <label htmlFor="tsp-end-date" style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: "#64748b", marginBottom: "0.25rem" }}>
              End date
            </label>
            <input
              id="tsp-end-date"
              type="date"
              value={end}
              min={MIN_DATE}
              max={TODAY}
              placeholder={TODAY}
              onChange={(e) => setEnd(e.target.value)}
              style={{ padding: "0.4rem 0.6rem", border: "1px solid #e2e8f0", borderRadius: "0.375rem", fontSize: "0.85rem" }}
            />
          </div>
          {end && end < start && (
            <div style={{ fontSize: "0.8rem", color: "#dc2626" }}>End date must be on or after the start date.</div>
          )}
        </div>
      </Card>

      {/* Chart */}
      <Card style={{ marginBottom: "1.5rem" }}>
        <CardTitle>Performance since {fmtDate(start)}</CardTitle>

        {series.length === 0 ? (
          <div style={{ color: "#94a3b8", padding: "2rem 0", textAlign: "center" }}>
            {selected.length === 0 ? "Select at least one fund to see its performance." : "Loading…"}
          </div>
        ) : (
          <>
            {/* Legend */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem 1.25rem", marginBottom: "1rem" }}>
              {series.map((s) => (
                <div key={s.slug} style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.8rem" }}>
                  <span style={{ width: 14, height: 2, background: s.color, display: "inline-block" }} />
                  <span style={{ color: "#52514e" }}>{s.label}</span>
                  <strong style={{ color: s.endPrice >= s.startPrice ? GOOD : BAD }}>
                    {fmtPct(((s.endPrice - s.startPrice) / s.startPrice) * 100)}
                  </strong>
                </div>
              ))}
            </div>

            <PerformanceChart series={series} referenceDates={referenceDates} />
          </>
        )}

        {skippedFunds.length > 0 && (
          <div style={{ marginTop: "1rem", fontSize: "0.8rem", color: "#94a3b8" }}>
            {skippedFunds.map((slug) => {
              const data = fundCache[slug];
              return (
                <div key={slug}>
                  {fundLabel(slug)} has no data in this range (available from {fmtDate(data.inception)}).
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* Table view — accessibility fallback for the chart */}
      {series.length > 0 && (
        <Card style={{ marginBottom: "1.5rem" }}>
          <CardTitle>Fund Details</CardTitle>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9rem" }}>
              <thead>
                <tr style={{ borderBottom: "2px solid #e2e8f0" }}>
                  <th style={{ textAlign: "left", padding: "0.5rem", color: "#64748b" }}>Fund</th>
                  <th style={{ textAlign: "right", padding: "0.5rem", color: "#64748b" }}>Start</th>
                  <th style={{ textAlign: "right", padding: "0.5rem", color: "#64748b" }}>Start Price</th>
                  <th style={{ textAlign: "right", padding: "0.5rem", color: "#64748b" }}>End</th>
                  <th style={{ textAlign: "right", padding: "0.5rem", color: "#64748b" }}>End Price</th>
                  <th style={{ textAlign: "right", padding: "0.5rem", color: "#64748b" }}>Change</th>
                </tr>
              </thead>
              <tbody>
                {series.map((s) => {
                  const change = ((s.endPrice - s.startPrice) / s.startPrice) * 100;
                  return (
                    <tr key={s.slug} style={{ borderBottom: "1px solid #f1f5f9" }}>
                      <td style={{ padding: "0.5rem", color: "#1e293b", display: "flex", alignItems: "center", gap: "0.4rem" }}>
                        <span style={{ width: 10, height: 10, borderRadius: "999px", background: s.color, display: "inline-block" }} />
                        {s.label}
                      </td>
                      <td style={{ padding: "0.5rem", textAlign: "right", color: "#52514e" }}>{fmtDate(s.startDate)}</td>
                      <td style={{ padding: "0.5rem", textAlign: "right", color: "#52514e" }}>{fmtPrice(s.startPrice)}</td>
                      <td style={{ padding: "0.5rem", textAlign: "right", color: "#52514e" }}>{fmtDate(s.endDate)}</td>
                      <td style={{ padding: "0.5rem", textAlign: "right", color: "#52514e" }}>{fmtPrice(s.endPrice)}</td>
                      <td style={{ padding: "0.5rem", textAlign: "right", fontWeight: 600, color: change >= 0 ? GOOD : BAD }}>
                        {fmtPct(change)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Disclaimer */}
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
        <strong style={{ color: "#64748b" }}>Disclaimer:</strong> Share price data is sourced from TSP.gov's published
        fund price history. Past performance does not guarantee future results.
      </div>
    </div>
  );
}

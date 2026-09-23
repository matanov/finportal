/**
 * ProjectionChart.tsx
 *
 * Fan chart for the TSP Projection Calculator. One hue for the simulated
 * balance (a 10th–90th percentile band, a darker 25th–75th band, and lines
 * for below average / average / above average), plus a dashed neutral line
 * for the money actually put in, so the gap between them is the growth.
 *
 * Hovering (or dragging on touch) shows a crosshair and the values for that
 * year. A collapsible table repeats the same numbers for screen readers and
 * anyone who prefers figures to a picture.
 */

import { useEffect, useRef, useState } from "react";
import type { SimulationResult } from "../lib/tspSimulation";

const BAND = "#2a78d6";
const NEUTRAL = "#898781";
const INK = "#1e293b";
const MUTED = "#64748b";
const GRID = "#e2e8f0";

const fmtMoney = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

/** $1.2M / $850k style for axis labels */
const fmtShort = (n: number) =>
  n >= 1_000_000
    ? `$${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`
    : n >= 1_000
      ? `$${Math.round(n / 1_000)}k`
      : `$${Math.round(n)}`;

function niceStep(range: number, count: number): number {
  const raw = range / count;
  const mag = 10 ** Math.floor(Math.log10(raw || 1));
  const f = raw / mag;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * mag;
}

function useWidth<T extends HTMLElement>(fallback: number) {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

export default function ProjectionChart({
  result,
  firstYear,
  startAge,
}: {
  result: SimulationResult;
  /** Calendar year of index 0 (today); index i is January of firstYear + i */
  firstYear: number;
  startAge: number | null;
}) {
  const [containerRef, containerWidth] = useWidth<HTMLDivElement>(760);
  const [hover, setHover] = useState<number | null>(null);

  const { bands, contributed } = result;
  const n = bands.length - 1;
  const width = Math.max(containerWidth, 280);
  const compact = width < 520;
  const height = compact ? 260 : 320;
  const labelW = compact ? 64 : 104;
  const pad = { top: 16, right: labelW, bottom: 28, left: compact ? 44 : 56 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  const max = Math.max(...bands.map((b) => b.p90), ...contributed, 1);
  const step = niceStep(max, compact ? 4 : 5);
  const yMax = Math.ceil(max / step) * step;
  const ticks = Array.from({ length: Math.round(yMax / step) + 1 }, (_, i) => i * step);

  const x = (i: number) => pad.left + (n > 0 ? (i / n) * plotW : 0);
  const y = (v: number) => pad.top + plotH - (v / yMax) * plotH;
  const line = (vals: number[]) => vals.map((v, i) => `${x(i)},${y(v)}`).join(" ");
  const area = (hi: number[], lo: number[]) =>
    `M ${hi.map((v, i) => `${x(i)},${y(v)}`).join(" L ")} L ${lo
      .map((v, i) => `${x(i)},${y(v)}`)
      .reverse()
      .join(" L ")} Z`;

  const p10 = bands.map((b) => b.p10);
  const p25 = bands.map((b) => b.p25);
  const p50 = bands.map((b) => b.p50);
  const p75 = bands.map((b) => b.p75);
  const p90 = bands.map((b) => b.p90);

  // End labels, nudged apart so they never overlap.
  const labels = [
    { text: compact ? "Above" : "Above average", v: p75[n], strong: false, color: INK },
    { text: "Average", v: p50[n], strong: true, color: INK },
    { text: compact ? "Below" : "Below average", v: p25[n], strong: false, color: INK },
    { text: compact ? "Put in" : "You put in", v: contributed[n], strong: false, color: MUTED },
  ]
    .map((l) => ({ ...l, y: y(l.v) }))
    .sort((a, b) => a.y - b.y);
  for (let i = 1; i < labels.length; i++) {
    if (labels[i].y - labels[i - 1].y < 14) labels[i].y = labels[i - 1].y + 14;
  }

  const yearEvery = n <= 10 ? (compact ? 2 : 1) : n <= 20 ? 5 : 10;
  const xTicks = Array.from({ length: n + 1 }, (_, i) => i).filter((i) => i % yearEvery === 0 || i === n);

  const onPointer = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * width;
    const i = Math.round(((px - pad.left) / plotW) * n);
    setHover(i >= 0 && i <= n ? i : null);
  };

  const h = hover;
  const ageAt = (i: number) => (startAge == null ? null : startAge + i);
  const tooltipLeft = h == null ? 0 : Math.min(Math.max(x(h) + 12, 0), width - 210);

  return (
    <div>
      {/* Legend */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "0.4rem 1.1rem",
          fontSize: "0.78rem",
          color: MUTED,
          marginBottom: "0.5rem",
        }}
      >
        <span style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem" }}>
          <svg width="22" height="10" aria-hidden="true">
            <line x1="1" y1="5" x2="21" y2="5" stroke={BAND} strokeWidth="2.5" strokeLinecap="round" />
          </svg>
          Average (median)
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem" }}>
          <svg width="22" height="10" aria-hidden="true">
            <rect x="1" y="0" width="20" height="10" rx="2" fill={BAND} fillOpacity="0.28" />
          </svg>
          Below to above average (middle half)
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem" }}>
          <svg width="22" height="10" aria-hidden="true">
            <rect x="1" y="0" width="20" height="10" rx="2" fill={BAND} fillOpacity="0.12" />
          </svg>
          8 in 10 outcomes
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem" }}>
          <svg width="22" height="10" aria-hidden="true">
            <line x1="1" y1="5" x2="21" y2="5" stroke={NEUTRAL} strokeWidth="2" strokeDasharray="4 3" />
          </svg>
          What you put in
        </span>
      </div>

      <div ref={containerRef} style={{ position: "relative" }}>
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          style={{ display: "block", maxWidth: "100%", touchAction: "pan-y" }}
          role="img"
          aria-label={`Projected TSP balance over ${n} years: average ${fmtMoney(p50[n])}, below average ${fmtMoney(
            p25[n],
          )}, above average ${fmtMoney(p75[n])}, against ${fmtMoney(contributed[n])} put in.`}
          onPointerMove={onPointer}
          onPointerDown={onPointer}
          onPointerLeave={() => setHover(null)}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.left} x2={pad.left + plotW} y1={y(t)} y2={y(t)} stroke={GRID} strokeWidth={1} />
              <text x={pad.left - 6} y={y(t)} textAnchor="end" dominantBaseline="middle" fontSize="11" fill={MUTED}>
                {fmtShort(t)}
              </text>
            </g>
          ))}
          {xTicks.map((i) => (
            <text key={i} x={x(i)} y={height - 8} textAnchor="middle" fontSize="11" fill={MUTED}>
              {firstYear + i}
            </text>
          ))}

          <path d={area(p90, p10)} fill={BAND} fillOpacity={0.12} />
          <path d={area(p75, p25)} fill={BAND} fillOpacity={0.22} />
          <polyline points={line(p75)} fill="none" stroke={BAND} strokeWidth={1.25} strokeOpacity={0.7} />
          <polyline points={line(p25)} fill="none" stroke={BAND} strokeWidth={1.25} strokeOpacity={0.7} />
          <polyline
            points={line(contributed)}
            fill="none"
            stroke={NEUTRAL}
            strokeWidth={2}
            strokeDasharray="5 4"
            strokeLinecap="round"
          />
          <polyline
            points={line(p50)}
            fill="none"
            stroke={BAND}
            strokeWidth={2.5}
            strokeLinejoin="round"
            strokeLinecap="round"
          />

          {labels.map((l) => (
            <text
              key={l.text}
              x={pad.left + plotW + 8}
              y={l.y}
              dominantBaseline="middle"
              fontSize="11.5"
              fontWeight={l.strong ? 700 : 500}
              fill={l.color}
            >
              {l.text}
            </text>
          ))}

          {h != null && (
            <g pointerEvents="none">
              <line x1={x(h)} x2={x(h)} y1={pad.top} y2={pad.top + plotH} stroke={MUTED} strokeWidth={1} />
              {[p75[h], p50[h], p25[h]].map((v, k) => (
                <circle key={k} cx={x(h)} cy={y(v)} r={k === 1 ? 4.5 : 3.5} fill={BAND} stroke="#fff" strokeWidth={2} />
              ))}
              <circle cx={x(h)} cy={y(contributed[h])} r={3.5} fill={NEUTRAL} stroke="#fff" strokeWidth={2} />
            </g>
          )}
        </svg>

        {h != null && (
          <div
            role="status"
            style={{
              position: "absolute",
              top: 8,
              left: tooltipLeft,
              width: 200,
              pointerEvents: "none",
              background: "#fff",
              border: "1px solid #e2e8f0",
              borderRadius: "0.5rem",
              boxShadow: "0 4px 12px rgba(15,34,68,0.12)",
              padding: "0.5rem 0.65rem",
              fontSize: "0.78rem",
              color: INK,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            <div style={{ fontWeight: 700, marginBottom: "0.25rem" }}>
              {h === 0 ? "Today" : `Jan ${firstYear + h}`}
              {ageAt(h) != null && <span style={{ color: MUTED, fontWeight: 500 }}> · age {ageAt(h)}</span>}
            </div>
            {[
              ["Above average", p75[h]],
              ["Average", p50[h]],
              ["Below average", p25[h]],
              ["You put in", contributed[h]],
            ].map(([label, v]) => (
              <div key={label as string} style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem" }}>
                <span style={{ color: MUTED }}>{label}</span>
                <span style={{ fontWeight: label === "Average" ? 700 : 500 }}>{fmtMoney(v as number)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Same numbers as a table */}
      <details style={{ marginTop: "0.6rem" }}>
        <summary style={{ cursor: "pointer", fontSize: "0.85rem", fontWeight: 600, color: "#2A7D9C" }}>
          Show the numbers
        </summary>
        <div style={{ overflowX: "auto", marginTop: "0.6rem" }}>
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: "0.82rem",
              color: INK,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            <thead>
              <tr>
                {["Year", "Age", "You put in", "Below average", "Average", "Above average"].map((hd, i) => (
                  <th
                    key={hd}
                    style={{
                      textAlign: i < 2 ? "left" : "right",
                      padding: "0.4rem 0.45rem",
                      borderBottom: "2px solid #e2e8f0",
                      color: MUTED,
                      fontSize: "0.7rem",
                      textTransform: "uppercase",
                      letterSpacing: "0.04em",
                    }}
                  >
                    {hd}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {bands.map((b, i) => (
                <tr key={i}>
                  <td style={{ padding: "0.35rem 0.45rem", borderBottom: "1px solid #f1f5f9" }}>
                    {i === 0 ? "Today" : `Jan ${firstYear + i}`}
                  </td>
                  <td style={{ padding: "0.35rem 0.45rem", borderBottom: "1px solid #f1f5f9" }}>{ageAt(i) ?? "—"}</td>
                  {[contributed[i], b.p25, b.p50, b.p75].map((v, k) => (
                    <td
                      key={k}
                      style={{
                        padding: "0.35rem 0.45rem",
                        borderBottom: "1px solid #f1f5f9",
                        textAlign: "right",
                        fontWeight: k === 2 ? 700 : 400,
                      }}
                    >
                      {fmtMoney(v)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

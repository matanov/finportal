/**
 * SalaryLookup.tsx
 *
 * GS Salary History Lookup — pick a grade, step, and locality area and see
 * every year of available pay data, plus a growth chart.
 */

import { useEffect, useState } from "react";
import localityData from "../data/localitycode-localityarea.json";
import { FIRST_PAY_YEAR, LAST_PAY_YEAR, lookupSalary } from "../lib/payLookup";

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

type YearSalary = { year: number; salary: number };
type LookupState = "loading" | "done" | "error";

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

// ---------------------------------------------------------------------------
// Growth chart — dependency-free inline SVG line chart
// ---------------------------------------------------------------------------

function GrowthChart({ data }: { data: YearSalary[] }) {
  if (data.length < 2) return null;

  const width = 720;
  const height = 260;
  const padding = { top: 20, right: 20, bottom: 30, left: 70 };
  const plotW = width - padding.left - padding.right;
  const plotH = height - padding.top - padding.bottom;

  const salaries = data.map((d) => d.salary);
  const min = Math.min(...salaries);
  const max = Math.max(...salaries);
  const range = max - min || 1;

  const x = (i: number) => padding.left + (i / (data.length - 1)) * plotW;
  const y = (v: number) =>
    padding.top + plotH - ((v - min) / range) * plotH;

  const linePoints = data.map((d, i) => `${x(i)},${y(d.salary)}`).join(" ");
  const fmt = (n: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    }).format(n);

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      style={{ width: "100%", height: "auto" }}
    >
      {/* Gridlines + axis labels */}
      {[0, 0.5, 1].map((t) => {
        const v = min + t * range;
        const gy = y(v);
        return (
          <g key={t}>
            <line
              x1={padding.left}
              x2={width - padding.right}
              y1={gy}
              y2={gy}
              stroke="#e2e8f0"
              strokeWidth={1}
            />
            <text
              x={padding.left - 10}
              y={gy}
              textAnchor="end"
              dominantBaseline="middle"
              fontSize="11"
              fill="#94a3b8"
            >
              {fmt(v)}
            </text>
          </g>
        );
      })}

      {/* Year labels */}
      {data.map((d, i) => {
        if (data.length > 8 && i % 2 !== 0 && i !== data.length - 1) return null;
        return (
          <text
            key={d.year}
            x={x(i)}
            y={height - 8}
            textAnchor="middle"
            fontSize="11"
            fill="#94a3b8"
          >
            {d.year}
          </text>
        );
      })}

      {/* Line */}
      <polyline
        points={linePoints}
        fill="none"
        stroke="#C9A035"
        strokeWidth={2.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />

      {/* Points */}
      {data.map((d, i) => (
        <circle key={d.year} cx={x(i)} cy={y(d.salary)} r={3.5} fill="#0F2244">
          <title>
            {d.year}: {fmt(d.salary)}
          </title>
        </circle>
      ))}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function SalaryLookup() {
  const [locality, setLocality] = useState("DCB");
  const [grade, setGrade] = useState(7);
  const [step, setStep] = useState(1);
  const [rows, setRows] = useState<YearSalary[]>([]);
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

      const found = results.filter((r): r is YearSalary => r !== null);
      setRows(found);
      setState(found.length > 0 ? "done" : "error");
    })();

    return () => {
      cancelled = true;
    };
  }, [locality, grade, step]);

  const fmt = (n: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    }).format(n);

  const localityName =
    (localityData as Record<string, string>)[locality] ?? locality;

  return (
    <div
      style={{
        fontFamily: "Inter, system-ui, sans-serif",
        maxWidth: "900px",
        margin: "0 auto",
        padding: "1.5rem",
      }}
    >
      {/* Header */}
      <div style={{ marginBottom: "2rem" }}>
        <h1
          style={{
            fontSize: "1.75rem",
            fontWeight: 800,
            color: "#0F2244",
            marginBottom: "0.5rem",
          }}
        >
          GS Salary History Lookup
        </h1>
        <p style={{ color: "#64748b", lineHeight: 1.6 }}>
          Pick a grade, step, and locality area to see every year of
          available pay data and how the salary has grown over time.
        </p>
      </div>

      {/* Controls */}
      <div
        style={{
          background: "#fff",
          border: "1px solid #e2e8f0",
          borderRadius: "0.75rem",
          padding: "1.25rem",
          marginBottom: "1.5rem",
          display: "grid",
          gridTemplateColumns: "1fr 90px 90px",
          gap: "1rem",
        }}
      >
        <div>
          <Label htmlFor="locality-area">Locality Area</Label>
          <Select id="locality-area" value={locality} onChange={setLocality}>
            {LOCALITY_OPTIONS.map(({ code, name }) => (
              <option key={code} value={code}>
                {code} — {name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="grade">Grade</Label>
          <Select id="grade" value={grade} onChange={(v) => setGrade(Number(v))}>
            {GRADES.map((g) => (
              <option key={g} value={g}>
                GS-{g}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="step">Step</Label>
          <Select id="step" value={step} onChange={(v) => setStep(Number(v))}>
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
          No pay data found for GS-{grade} Step {step} in {localityName}.
        </div>
      )}

      {state === "done" && (
        <>
          {/* Growth chart */}
          <div
            style={{
              background: "#fff",
              border: "1px solid #e2e8f0",
              borderRadius: "0.75rem",
              padding: "1.25rem",
              marginBottom: "1.5rem",
            }}
          >
            <div style={{ fontWeight: 700, color: "#1e293b", marginBottom: "1rem" }}>
              Salary Growth — GS-{grade} Step {step}, {localityName}
            </div>
            <GrowthChart data={rows} />
          </div>

          {/* Table */}
          <div
            style={{
              background: "#fff",
              border: "1px solid #e2e8f0",
              borderRadius: "0.75rem",
              padding: "1.25rem",
            }}
          >
            <div style={{ fontWeight: 700, color: "#1e293b", marginBottom: "1rem" }}>
              Year-by-Year Salary
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9rem" }}>
              <thead>
                <tr style={{ borderBottom: "2px solid #e2e8f0" }}>
                  <th style={{ textAlign: "left", padding: "0.5rem", color: "#64748b" }}>
                    Year
                  </th>
                  <th style={{ textAlign: "right", padding: "0.5rem", color: "#64748b" }}>
                    Annual Salary
                  </th>
                  <th style={{ textAlign: "right", padding: "0.5rem", color: "#64748b" }}>
                    YoY Change
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const prev = i > 0 ? rows[i - 1].salary : null;
                  const change = prev ? ((r.salary - prev) / prev) * 100 : null;
                  return (
                    <tr key={r.year} style={{ borderBottom: "1px solid #f1f5f9" }}>
                      <td style={{ padding: "0.5rem", color: "#1e293b" }}>{r.year}</td>
                      <td
                        style={{
                          padding: "0.5rem",
                          textAlign: "right",
                          fontWeight: 600,
                          color: "#0F2244",
                        }}
                      >
                        {fmt(r.salary)}
                      </td>
                      <td
                        style={{
                          padding: "0.5rem",
                          textAlign: "right",
                          color: change == null ? "#94a3b8" : change >= 0 ? "#16a34a" : "#dc2626",
                        }}
                      >
                        {change == null ? "—" : `${change >= 0 ? "+" : ""}${change.toFixed(1)}%`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
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
        <strong style={{ color: "#64748b" }}>Disclaimer:</strong> Pay data is
        sourced from published OPM General Schedule pay tables. Always verify
        current rates with your agency HR office or OPM directly.
      </div>
    </div>
  );
}

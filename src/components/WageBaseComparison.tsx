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

import { useEffect, useState } from "react";
import localityData from "../data/localitycode-localityarea.json";
import { FIRST_PAY_YEAR, LAST_PAY_YEAR, lookupSalary } from "../lib/payLookup";
import {
  compareToWageBase,
  type SalaryPoint,
  type WageBaseComparison as Comparison,
} from "../lib/wageBase";
import ErrorBoundary from "./ErrorBoundary";
import {
  ScaleNote,
  ScaleToggle,
  WageLineChart,
  fmtPct,
  type Scale,
} from "./WageLineChart";

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
          <WageLineChart
            scale={scale}
            ariaLabel="GS salary compared with the Social Security wage base by year"
            series={[
              {
                label: "Wage base",
                color: WAGE_BASE_COLOR,
                points: comparison.rows.map((r) => ({ year: r.year, value: r.wageBase })),
              },
              {
                label: "GS salary",
                color: SALARY_COLOR,
                points: comparison.rows.map((r) => ({
                  year: r.year,
                  value: r.salary,
                  note: `${fmtPct(r.ratio, 1)} of wage base`,
                })),
              },
            ]}
          />
          <ScaleNote scale={scale} />
          <Verdict comparison={comparison} />
        </>
      )}
    </div>
  );
}

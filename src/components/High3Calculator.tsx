/**
 * High3Calculator.tsx
 *
 * Interactive OPM-compliant High-3 Average Salary Calculator.
 * Fetches only the pay years needed for the user's career history.
 */

import { useState, useCallback, useEffect } from "react";
import { careerStepsToServicePeriods, calculateHigh3 } from "../lib/high3";
import type { CareerStep, High3Result } from "../lib/high3";
import localityData from "../data/localitycode-localityarea.json";
import { FIRST_PAY_YEAR, LAST_PAY_YEAR } from "../lib/payLookup";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LOCALITY_OPTIONS = Object.entries(localityData as Record<string, string>)
  .sort((a, b) => a[1].localeCompare(b[1]))
  .map(([code, name]) => ({ code, name }));

const GRADES = Array.from({ length: 15 }, (_, i) => i + 1);
const STEPS = Array.from({ length: 10 }, (_, i) => i + 1);

/** Today's date in YYYY-MM-DD local time — used as separation date fallback */
function todayLocalISO(): string {
  const d = new Date();
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
  ].join("-");
}

const DEFAULT_STEP: CareerStep = {
  effectiveDate: "",
  grade: 7,
  step: 1,
  locality: "DCB",
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type CalcState = "idle" | "loading" | "done" | "error";

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function Label({ children }: { children: React.ReactNode }) {
  return (
    <label
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
  value,
  onChange,
  children,
  style,
}: {
  value: string | number;
  onChange: (v: string) => void;
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <select
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
        ...style,
      }}
    >
      {children}
    </select>
  );
}

function Input({
  type = "text",
  value,
  onChange,
  placeholder,
  style,
}: {
  type?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  style?: React.CSSProperties;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      style={{
        width: "100%",
        padding: "0.5rem 0.6rem",
        border: "1px solid #e2e8f0",
        borderRadius: "0.375rem",
        fontSize: "0.9rem",
        color: "#1e293b",
        boxSizing: "border-box",
        ...style,
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// Career row
// ---------------------------------------------------------------------------

function CareerRow({
  step,
  index,
  total,
  onChange,
  onRemove,
}: {
  step: CareerStep;
  index: number;
  total: number;
  onChange: (index: number, updated: CareerStep) => void;
  onRemove: (index: number) => void;
}) {
  const set = (field: keyof CareerStep) => (val: string) =>
    onChange(index, {
      ...step,
      [field]: ["grade", "step"].includes(field) ? Number(val) : val,
    });

  // Auto-derive pay year from effective date so user never has to enter it
  const derivedYear = step.effectiveDate
    ? Math.min(
        Math.max(
          parseInt(step.effectiveDate.split("-")[0], 10),
          FIRST_PAY_YEAR,
        ),
        LAST_PAY_YEAR,
      )
    : null;

  const missingDate = !step.effectiveDate;

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "200px 80px 70px 1fr 36px",
        gap: "0.5rem",
        alignItems: "end",
        padding: "0.75rem",
        background: index % 2 === 0 ? "#f8fafc" : "#fff",
        borderRadius: "0.5rem",
        border: `1px solid ${missingDate ? "#fca5a5" : "#e2e8f0"}`,
      }}
    >
      {/* Effective Date — pay year auto-derived from this */}
      <div>
        <Label>Effective Date</Label>
        <Input
          type="date"
          value={step.effectiveDate}
          onChange={set("effectiveDate")}
          style={{ borderColor: missingDate ? "#fca5a5" : undefined }}
        />
        {derivedYear ? (
          <div
            style={{
              fontSize: "0.7rem",
              color: "#94a3b8",
              marginTop: "0.2rem",
            }}
          >
            Using {derivedYear} pay table
          </div>
        ) : (
          <div
            style={{
              fontSize: "0.7rem",
              color: "#ef4444",
              marginTop: "0.2rem",
            }}
          >
            Date required
          </div>
        )}
      </div>

      {/* Grade */}
      <div>
        <Label>Grade</Label>
        <Select value={step.grade} onChange={set("grade")}>
          {GRADES.map((g) => (
            <option key={g} value={g}>
              GS-{g}
            </option>
          ))}
        </Select>
      </div>

      {/* Step */}
      <div>
        <Label>Step</Label>
        <Select value={step.step} onChange={set("step")}>
          {STEPS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
      </div>

      {/* Locality */}
      <div>
        <Label>Locality Area</Label>
        <Select value={step.locality} onChange={set("locality")}>
          {LOCALITY_OPTIONS.map(({ code, name }) => (
            <option key={code} value={code}>
              {code} — {name}
            </option>
          ))}
        </Select>
      </div>

      {/* Remove button */}
      <div style={{ display: "flex", alignItems: "flex-end" }}>
        <button
          onClick={() => onRemove(index)}
          disabled={total <= 1}
          title="Remove this period"
          style={{
            width: "36px",
            height: "36px",
            border: "1px solid #fca5a5",
            borderRadius: "0.375rem",
            background: total <= 1 ? "#f1f5f9" : "#fff5f5",
            color: total <= 1 ? "#94a3b8" : "#ef4444",
            cursor: total <= 1 ? "not-allowed" : "pointer",
            fontSize: "1.1rem",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          ×
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Results panel
// ---------------------------------------------------------------------------

function ResultsPanel({ result }: { result: High3Result }) {
  const fmt = (n: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    }).format(n);

  const fmtDecimal = (n: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
    }).format(n);

  return (
    <div style={{ marginTop: "2rem" }}>
      {/* High-3 headline */}
      <div
        style={{
          background: "linear-gradient(135deg, #0F2244 0%, #1a3a6b 100%)",
          borderRadius: "0.75rem",
          padding: "2rem",
          textAlign: "center",
          marginBottom: "1.5rem",
        }}
      >
        {result.isPartialPeriod && (
          <div
            style={{
              background: "#C9A035",
              color: "#000",
              fontSize: "0.75rem",
              fontWeight: 700,
              padding: "0.25rem 0.75rem",
              borderRadius: "999px",
              display: "inline-block",
              marginBottom: "0.75rem",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
            }}
          >
            Partial Period — Less than 36 Months of Service
          </div>
        )}
        <div
          style={{
            color: "#94a3b8",
            fontSize: "0.875rem",
            marginBottom: "0.5rem",
            textTransform: "uppercase",
            letterSpacing: "0.1em",
          }}
        >
          High-3 Average Salary
        </div>
        <div
          style={{
            color: "#C9A035",
            fontSize: "3rem",
            fontWeight: 700,
            lineHeight: 1,
          }}
        >
          {fmt(result.high3Average)}
        </div>
        <div
          style={{
            color: "#cbd5e1",
            fontSize: "0.875rem",
            marginTop: "0.75rem",
          }}
        >
          Best 36-month window: {result.windowStart} → {result.windowEnd}
        </div>
      </div>

      {/* FERS Annuity estimate */}
      <div
        style={{
          background: "#f0fdf4",
          border: "1px solid #bbf7d0",
          borderRadius: "0.75rem",
          padding: "1.25rem",
          marginBottom: "1.5rem",
        }}
      >
        <div
          style={{ fontWeight: 700, color: "#166534", marginBottom: "0.75rem" }}
        >
          FERS Basic Annuity Estimates (based on this High-3)
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "0.75rem",
          }}
        >
          {[10, 15, 20, 25, 30, 35].map((yrs) => {
            const multiplier = yrs >= 20 ? 0.011 : 0.01;
            const annuity = result.high3Average * multiplier * yrs;
            return (
              <div
                key={yrs}
                style={{
                  background: "#fff",
                  borderRadius: "0.5rem",
                  padding: "0.75rem",
                  border: "1px solid #d1fae5",
                }}
              >
                <div
                  style={{
                    fontSize: "0.75rem",
                    color: "#6b7280",
                    marginBottom: "0.25rem",
                  }}
                >
                  {yrs} years × {yrs >= 20 ? "1.1%" : "1%"} multiplier
                </div>
                <div
                  style={{
                    fontSize: "1.1rem",
                    fontWeight: 700,
                    color: "#166534",
                  }}
                >
                  {fmt(annuity)}/yr
                </div>
                <div style={{ fontSize: "0.8rem", color: "#9ca3af" }}>
                  {fmt(annuity / 12)}/mo
                </div>
              </div>
            );
          })}
        </div>
        <div
          style={{
            fontSize: "0.75rem",
            color: "#6b7280",
            marginTop: "0.75rem",
          }}
        >
          * 1.1% multiplier applies if you retire at age 62+ with 20+ years of
          service. These are gross estimates before taxes and deductions.
        </div>
      </div>

      {/* Period breakdown */}
      <div
        style={{
          background: "#fff",
          border: "1px solid #e2e8f0",
          borderRadius: "0.75rem",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            padding: "1rem 1.25rem",
            borderBottom: "1px solid #e2e8f0",
            fontWeight: 700,
            color: "#1e293b",
          }}
        >
          Period Breakdown — Inside High-3 Window
        </div>
        <div style={{ overflowX: "auto" }}>
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: "0.875rem",
            }}
          >
            <thead>
              <tr style={{ background: "#f8fafc" }}>
                {[
                  "Period Start",
                  "Period End",
                  "Annual Salary",
                  "OPM Days",
                  "Dollar Contribution",
                ].map((h) => (
                  <th
                    key={h}
                    style={{
                      padding: "0.6rem 1rem",
                      textAlign: "left",
                      fontWeight: 600,
                      color: "#64748b",
                      fontSize: "0.75rem",
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                      borderBottom: "1px solid #e2e8f0",
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {result.contributions.map((c, i) => (
                <tr key={i} style={{ borderBottom: "1px solid #f1f5f9" }}>
                  <td style={{ padding: "0.6rem 1rem", color: "#334155" }}>
                    {c.startDate}
                  </td>
                  <td style={{ padding: "0.6rem 1rem", color: "#334155" }}>
                    {c.endDate}
                  </td>
                  <td
                    style={{
                      padding: "0.6rem 1rem",
                      fontWeight: 600,
                      color: "#0F2244",
                    }}
                  >
                    {fmt(c.annualSalary)}
                  </td>
                  <td style={{ padding: "0.6rem 1rem", color: "#334155" }}>
                    {c.opmDays}
                  </td>
                  <td
                    style={{
                      padding: "0.6rem 1rem",
                      fontWeight: 600,
                      color: "#2A7D9C",
                    }}
                  >
                    {fmtDecimal(c.dollarContribution)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr
                style={{
                  background: "#f8fafc",
                  borderTop: "2px solid #e2e8f0",
                }}
              >
                <td
                  colSpan={3}
                  style={{
                    padding: "0.6rem 1rem",
                    fontWeight: 700,
                    color: "#1e293b",
                  }}
                >
                  Total
                </td>
                <td style={{ padding: "0.6rem 1rem", fontWeight: 700 }}>
                  {result.contributions.reduce((s, c) => s + c.opmDays, 0)}
                </td>
                <td
                  style={{
                    padding: "0.6rem 1rem",
                    fontWeight: 700,
                    color: "#0F2244",
                  }}
                >
                  {fmtDecimal(
                    result.contributions.reduce(
                      (s, c) => s + c.dollarContribution,
                      0,
                    ),
                  )}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function High3Calculator() {
  const [steps, setSteps] = useState<CareerStep[]>([{ ...DEFAULT_STEP }]);
  const [separationDate, setSeparationDate] = useState("");

  // Populate the date input after hydration so the browser shows the real value
  useEffect(() => {
    setSeparationDate((prev) => prev || todayLocalISO());
  }, []);

  // Always have a valid date — fall back to today if the field is empty
  const effectiveSeparationDate = separationDate || todayLocalISO();
  const [state, setState] = useState<CalcState>("idle");
  const [result, setResult] = useState<High3Result | null>(null);
  const [error, setError] = useState("");

  const updateStep = useCallback((index: number, updated: CareerStep) => {
    setSteps((prev) => prev.map((s, i) => (i === index ? updated : s)));
  }, []);

  const addStep = useCallback(() => {
    setSteps((prev) => {
      const last = prev[prev.length - 1];
      return [
        ...prev,
        { ...last, effectiveDate: "", step: Math.min(last.step + 1, 10) },
      ];
    });
  }, []);

  const removeStep = useCallback((index: number) => {
    setSteps((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const validate = (): string | null => {
    for (let i = 0; i < steps.length; i++) {
      if (!steps[i].effectiveDate)
        return `Row ${i + 1}: effective date is required.`;
    }

    // Sort rows by date for the remaining checks
    const sorted = [...steps].sort((a, b) =>
      a.effectiveDate.localeCompare(b.effectiveDate),
    );

    // Check for duplicate dates
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].effectiveDate === sorted[i - 1].effectiveDate)
        return `Two rows share the same effective date (${sorted[i].effectiveDate}). Each row must have a unique date.`;
    }

    // Effective dates must be before separation date
    if (sorted[0].effectiveDate >= effectiveSeparationDate)
      return `Your first effective date (${sorted[0].effectiveDate}) must be before the separation date (${effectiveSeparationDate}).`;

    if (sorted[sorted.length - 1].effectiveDate >= effectiveSeparationDate)
      return `Effective date ${sorted[sorted.length - 1].effectiveDate} is on or after the separation date.`;

    return null;
  };

  const calculate = async () => {
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    setState("loading");
    setError("");
    setResult(null);

    try {
      const periods = await careerStepsToServicePeriods(
        steps,
        effectiveSeparationDate,
      );
      if ("error" in periods) {
        setError(periods.error);
        setState("error");
        return;
      }

      const high3Result = calculateHigh3(periods);
      if (!high3Result) {
        setError("Could not calculate High-3. Please check your entries.");
        setState("error");
        return;
      }

      setResult(high3Result);
      setState("done");
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "An unexpected error occurred.",
      );
      setState("error");
    }
  };

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
          FERS High-3 Average Salary Calculator
        </h1>
        <p style={{ color: "#64748b", lineHeight: 1.6 }}>
          Enter each period where your GS grade, step, or locality changed.
          We'll find the highest 36-month window using OPM's 360-day year rule.
        </p>
      </div>

      {/* Separation date */}
      <div
        style={{
          background: "#fff",
          border: "1px solid #e2e8f0",
          borderRadius: "0.75rem",
          padding: "1.25rem",
          marginBottom: "1rem",
        }}
      >
        <div style={{ maxWidth: "260px" }}>
          <Label>Separation Date (or today if still employed)</Label>
          <Input
            type="date"
            value={separationDate}
            onChange={setSeparationDate}
            placeholder={todayLocalISO()}
          />
          <div
            style={{
              fontSize: "0.75rem",
              color: "#94a3b8",
              marginTop: "0.3rem",
            }}
          >
            Defaults to today if left blank
          </div>
        </div>
      </div>

      {/* Career history rows */}
      <div
        style={{
          background: "#fff",
          border: "1px solid #e2e8f0",
          borderRadius: "0.75rem",
          padding: "1.25rem",
          marginBottom: "1rem",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "1rem",
          }}
        >
          <div>
            <div style={{ fontWeight: 700, color: "#1e293b" }}>
              Career History
            </div>
            <div
              style={{
                fontSize: "0.8rem",
                color: "#94a3b8",
                marginTop: "0.2rem",
              }}
            >
              Add a row for each time your grade, step, or locality changed
            </div>
          </div>
          <button
            onClick={addStep}
            style={{
              padding: "0.5rem 1rem",
              background: "#0F2244",
              color: "#fff",
              border: "none",
              borderRadius: "0.375rem",
              fontWeight: 600,
              fontSize: "0.875rem",
              cursor: "pointer",
            }}
          >
            + Add Period
          </button>
        </div>

        <div
          style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}
        >
          {steps.map((step, i) => (
            <CareerRow
              key={i}
              step={step}
              index={i}
              total={steps.length}
              onChange={updateStep}
              onRemove={removeStep}
            />
          ))}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div
          style={{
            background: "#fef2f2",
            border: "1px solid #fca5a5",
            borderRadius: "0.5rem",
            padding: "0.75rem 1rem",
            color: "#dc2626",
            marginBottom: "1rem",
            fontSize: "0.875rem",
          }}
        >
          {error}
        </div>
      )}

      {/* Calculate button */}
      <button
        onClick={calculate}
        disabled={state === "loading"}
        style={{
          width: "100%",
          padding: "0.875rem",
          background: state === "loading" ? "#64748b" : "#C9A035",
          color: "#fff",
          border: "none",
          borderRadius: "0.5rem",
          fontWeight: 700,
          fontSize: "1rem",
          cursor: state === "loading" ? "not-allowed" : "pointer",
          transition: "background 0.2s",
        }}
      >
        {state === "loading" ? "Calculating..." : "Calculate My High-3"}
      </button>

      {/* Results */}
      {state === "done" && result && <ResultsPanel result={result} />}
    </div>
  );
}

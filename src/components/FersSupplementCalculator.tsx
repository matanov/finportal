/**
 * FersSupplementCalculator.tsx
 *
 * Estimates the FERS Special Retirement Supplement — the bridge payment
 * that approximates Social Security between MRA/immediate retirement and
 * age 62, when SS eligibility actually begins.
 */

import { useState } from "react";
import { calculateFersSupplement } from "../lib/fersSupplement";
import type { FersSupplementResult } from "../lib/fersSupplement";
import ErrorBoundary from "./ErrorBoundary";

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

function Input({
  id,
  type = "text",
  value,
  onChange,
  placeholder,
  min,
  step,
}: {
  id?: string;
  type?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  min?: number;
  step?: number;
}) {
  return (
    <input
      id={id}
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      min={min}
      step={step}
      style={{
        width: "100%",
        padding: "0.5rem 0.6rem",
        border: "1px solid #e2e8f0",
        borderRadius: "0.375rem",
        fontSize: "0.9rem",
        color: "#1e293b",
        boxSizing: "border-box",
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// Results panel
// ---------------------------------------------------------------------------

function ResultsPanel({
  result,
  yearsOfFersCivilianService,
}: {
  result: FersSupplementResult;
  yearsOfFersCivilianService: number;
}) {
  const fmt = (n: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 2,
    }).format(n);

  return (
    <div style={{ marginTop: "2rem" }}>
      <div
        style={{
          background: "linear-gradient(135deg, #0F2244 0%, #1a3a6b 100%)",
          borderRadius: "0.75rem",
          padding: "2rem",
          textAlign: "center",
          marginBottom: "1.5rem",
        }}
      >
        <div
          style={{
            color: "#94a3b8",
            fontSize: "0.875rem",
            marginBottom: "0.5rem",
            textTransform: "uppercase",
            letterSpacing: "0.1em",
          }}
        >
          Estimated Monthly FERS Supplement
        </div>
        <div
          style={{
            color: "#C9A035",
            fontSize: "3rem",
            fontWeight: 700,
            lineHeight: 1,
          }}
        >
          {fmt(result.monthlySupplement)}
        </div>
        <div
          style={{
            color: "#cbd5e1",
            fontSize: "0.875rem",
            marginTop: "0.75rem",
          }}
        >
          {fmt(result.annualSupplement)}/yr · {yearsOfFersCivilianService}{" "}
          civilian years ÷ 40 = {(result.serviceRatio * 100).toFixed(1)}% of
          your Social Security estimate
        </div>
      </div>

      <div
        style={{
          background: "#fff",
          border: "1px solid #e2e8f0",
          borderRadius: "0.75rem",
          padding: "1.25rem",
          fontSize: "0.85rem",
          color: "#475569",
          lineHeight: 1.7,
        }}
      >
        <strong style={{ color: "#1e293b" }}>Keep in mind:</strong> the
        supplement stops the month you turn 62, regardless of when you
        actually file for Social Security. It is also subject to the SSA
        earnings test — if you have wage income from work after retirement
        above the annual exempt amount, OPM withholds $1 of supplement for
        every $2 you earn over the limit. It is not payable to MRA+10
        (postponed) or deferred retirees, generally only to those retiring
        on an immediate, unreduced annuity.
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function FersSupplementCalculator() {
  return (
    <ErrorBoundary name="FERS Supplement Estimator">
      <FersSupplementCalculatorInner />
    </ErrorBoundary>
  );
}

function FersSupplementCalculatorInner() {
  const [ssEstimate, setSsEstimate] = useState("");
  const [years, setYears] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState<FersSupplementResult | null>(null);

  const calculate = () => {
    const ssValue = Number(ssEstimate);
    const yearsValue = Number(years);

    if (!ssEstimate || Number.isNaN(ssValue) || ssValue < 0) {
      setError("Enter a valid monthly Social Security estimate.");
      setResult(null);
      return;
    }
    if (!years || Number.isNaN(yearsValue) || yearsValue < 0) {
      setError("Enter a valid number of years of FERS civilian service.");
      setResult(null);
      return;
    }
    if (yearsValue > 40) {
      setError(
        "Years of FERS civilian service can't exceed 40 for this calculation.",
      );
      setResult(null);
      return;
    }

    setError("");
    setResult(
      calculateFersSupplement({
        monthlySocialSecurityEstimate: ssValue,
        yearsOfFersCivilianService: yearsValue,
      }),
    );
  };

  return (
    <div
      style={{
        fontFamily: "Inter, system-ui, sans-serif",
        maxWidth: "700px",
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
          FERS Special Retirement Supplement Estimator
        </h1>
        <p style={{ color: "#64748b", lineHeight: 1.6 }}>
          The supplement approximates the portion of Social Security you
          earned while under FERS, paid as a bridge from your retirement date
          until age 62.
        </p>
      </div>

      {/* Military buyback callout */}
      <div
        style={{
          background: "#fffbeb",
          border: "1px solid #fde68a",
          borderRadius: "0.75rem",
          padding: "1rem 1.25rem",
          marginBottom: "1.5rem",
          fontSize: "0.875rem",
          color: "#92400e",
          lineHeight: 1.6,
        }}
      >
        <strong>Military buyback does not count here.</strong> Even if you
        paid a military deposit and had those years credited toward your
        basic FERS annuity, OPM excludes bought-back military service from
        the years used to compute the supplement. Enter only your actual
        civilian FERS-creditable years below.
      </div>

      {/* Inputs */}
      <div
        style={{
          background: "#fff",
          border: "1px solid #e2e8f0",
          borderRadius: "0.75rem",
          padding: "1.25rem",
          marginBottom: "1rem",
          display: "grid",
          gap: "1rem",
        }}
      >
        <div>
          <Label htmlFor="ss-estimate">
            Estimated Social Security Benefit at Age 62 ($/month)
          </Label>
          <Input
            id="ss-estimate"
            type="number"
            min={0}
            step={1}
            value={ssEstimate}
            onChange={setSsEstimate}
            placeholder="e.g. 1800"
          />
          <div
            style={{ fontSize: "0.75rem", color: "#94a3b8", marginTop: "0.3rem" }}
          >
            From your Social Security Statement at ssa.gov/myaccount — use the
            age-62 estimate, not your full retirement age estimate.
          </div>
        </div>

        <div>
          <Label htmlFor="fers-years">
            Years of FERS Civilian Service (excludes military buyback)
          </Label>
          <Input
            id="fers-years"
            type="number"
            min={0}
            step={0.1}
            value={years}
            onChange={setYears}
            placeholder="e.g. 22.5"
          />
          <div
            style={{ fontSize: "0.75rem", color: "#94a3b8", marginTop: "0.3rem" }}
          >
            Total civilian time under FERS, in years — you can use a decimal
            for partial years (e.g. 22 years 6 months = 22.5).
          </div>
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
        style={{
          width: "100%",
          padding: "0.875rem",
          background: "#C9A035",
          color: "#fff",
          border: "none",
          borderRadius: "0.5rem",
          fontWeight: 700,
          fontSize: "1rem",
          cursor: "pointer",
        }}
      >
        Calculate My Supplement
      </button>

      {/* Results */}
      {result && (
        <ResultsPanel result={result} yearsOfFersCivilianService={Number(years)} />
      )}
    </div>
  );
}

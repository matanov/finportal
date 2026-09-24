/**
 * FersAnnuityCalculator.tsx
 *
 * FERS Basic Annuity Calculator: the basic annuity formula, immediate-
 * retirement eligibility, and the spousal survivor benefit election. Takes
 * High-3 as a direct dollar entry (with a link to the High-3 tool to compute
 * it) rather than embedding that tool's own career-history form.
 *
 * Scope: immediate retirement only (62+5, 60+20, MRA+30 for regular
 * employees; 50+20 or any age+25 for law enforcement/firefighter/ATC).
 * MRA+10, deferred, and disability retirement are not modeled — see
 * src/lib/fersAnnuity.ts and Issue #3 for what's deferred and why.
 */

import { useState } from "react";
import {
  estimateFersAnnuity,
  type EligibilityPath,
  type FersAnnuityResult,
  type RetirementCategory,
  type SurvivorElection,
} from "../lib/fersAnnuity";
import ErrorBoundary from "./ErrorBoundary";

// ---------------------------------------------------------------------------
// Small shared controls (matches FersSupplementCalculator.tsx)
// ---------------------------------------------------------------------------

function Label({ htmlFor, children }: { htmlFor?: string; children: React.ReactNode }) {
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

function SegmentedToggle<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            style={{
              padding: "0.5rem 0.9rem",
              borderRadius: "0.375rem",
              border: active ? "1px solid #C9A035" : "1px solid #e2e8f0",
              background: active ? "#fffbeb" : "#fff",
              color: active ? "#92400e" : "#475569",
              fontWeight: active ? 700 : 500,
              fontSize: "0.85rem",
              cursor: "pointer",
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

const PATH_LABEL: Record<EligibilityPath, string> = {
  "62+5": "Age 62 with 5 years of service",
  "60+20": "Age 60 with 20 years of service",
  "mra+30": "Your Minimum Retirement Age with 30 years of service",
  "specialProvision-50+20": "Age 50 with 20 years of covered service",
  "specialProvision-any+25": "Any age with 25 years of covered service",
};

// ---------------------------------------------------------------------------
// Results panel
// ---------------------------------------------------------------------------

function ResultsPanel({ result }: { result: FersAnnuityResult }) {
  const fmt = (n: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

  const { eligibility, annuity, survivor } = result;

  return (
    <div style={{ marginTop: "2rem" }}>
      {eligibility.eligible ? (
        <div
          style={{
            background: "#f0fdf4",
            border: "1px solid #bbf7d0",
            borderRadius: "0.5rem",
            padding: "0.75rem 1rem",
            marginBottom: "1.25rem",
            fontSize: "0.85rem",
            color: "#166534",
          }}
        >
          <strong>Eligible for an immediate, unreduced annuity</strong> — via{" "}
          {PATH_LABEL[eligibility.path as EligibilityPath]}.
        </div>
      ) : (
        <div
          style={{
            background: "#fffbeb",
            border: "1px solid #fde68a",
            borderRadius: "0.5rem",
            padding: "0.75rem 1rem",
            marginBottom: "1.25rem",
            fontSize: "0.85rem",
            color: "#92400e",
            lineHeight: 1.6,
          }}
        >
          <strong>Not eligible for an immediate, unreduced annuity under this calculator's rules.</strong>{" "}
          {eligibility.note} The amount below is the formula result only — it is not what you'd actually
          receive.
        </div>
      )}

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
          Basic Annuity, Before Survivor Election
        </div>
        <div style={{ color: "#C9A035", fontSize: "3rem", fontWeight: 700, lineHeight: 1 }}>
          {fmt(annuity.grossAnnualAnnuity)}/yr
        </div>
        <div style={{ color: "#cbd5e1", fontSize: "0.875rem", marginTop: "0.75rem" }}>
          {fmt(annuity.grossMonthlyAnnuity)}/mo · {annuity.multiplierNote}
        </div>
      </div>

      {survivor.election !== "none" && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
            gap: "1rem",
            marginBottom: "1.5rem",
          }}
        >
          <div
            style={{
              background: "#fff",
              border: "1px solid #e2e8f0",
              borderRadius: "0.75rem",
              padding: "1.25rem",
            }}
          >
            <div style={{ fontSize: "0.75rem", color: "#6b7280", marginBottom: "0.35rem" }}>
              Your annuity after the {(survivor.reductionPct * 100).toFixed(0)}% survivor reduction
            </div>
            <div style={{ fontSize: "1.4rem", fontWeight: 700, color: "#0F2244" }}>
              {fmt(survivor.netAnnualAnnuity)}/yr
            </div>
            <div style={{ fontSize: "0.8rem", color: "#9ca3af" }}>{fmt(survivor.netMonthlyAnnuity)}/mo</div>
          </div>
          <div
            style={{
              background: "#fff",
              border: "1px solid #e2e8f0",
              borderRadius: "0.75rem",
              padding: "1.25rem",
            }}
          >
            <div style={{ fontSize: "0.75rem", color: "#6b7280", marginBottom: "0.35rem" }}>
              Your spouse's future survivor benefit
            </div>
            <div style={{ fontSize: "1.4rem", fontWeight: 700, color: "#0F2244" }}>
              {fmt(survivor.survivorAnnualBenefit)}/yr
            </div>
            <div style={{ fontSize: "0.8rem", color: "#9ca3af" }}>{fmt(survivor.survivorMonthlyBenefit)}/mo</div>
          </div>
        </div>
      )}

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
        <strong style={{ color: "#1e293b" }}>Keep in mind:</strong> this covers immediate retirement only —
        62 with 5 years, 60 with 20, or your Minimum Retirement Age with 30 (or, for law enforcement,
        firefighters and air traffic controllers, age 50 with 20 years of covered service or any age with
        25). MRA+10, deferred, and disability retirement work differently and aren't modeled here. The
        survivor reduction and benefit are both a share of this unreduced annuity, per OPM's FERS rules.
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function FersAnnuityCalculator() {
  return (
    <ErrorBoundary name="FERS Basic Annuity Calculator">
      <FersAnnuityCalculatorInner />
    </ErrorBoundary>
  );
}

function FersAnnuityCalculatorInner() {
  const [highThree, setHighThree] = useState("");
  const [years, setYears] = useState("");
  const [ageAtRetirement, setAgeAtRetirement] = useState("");
  const [birthYear, setBirthYear] = useState("");
  const [category, setCategory] = useState<RetirementCategory>("regular");
  const [survivorElection, setSurvivorElection] = useState<SurvivorElection>("full");
  const [error, setError] = useState("");
  const [result, setResult] = useState<FersAnnuityResult | null>(null);

  const calculate = () => {
    const highThreeValue = Number(highThree);
    const yearsValue = Number(years);
    const ageValue = Number(ageAtRetirement);
    const birthYearValue = Number(birthYear);

    if (!highThree || Number.isNaN(highThreeValue) || highThreeValue < 0) {
      setError("Enter a valid High-3 average salary.");
      setResult(null);
      return;
    }
    if (!years || Number.isNaN(yearsValue) || yearsValue < 0 || yearsValue > 60) {
      setError("Enter a valid number of years of service (0–60).");
      setResult(null);
      return;
    }
    if (!ageAtRetirement || Number.isNaN(ageValue) || ageValue < 0 || ageValue > 100) {
      setError("Enter a valid age at retirement.");
      setResult(null);
      return;
    }
    if (!birthYear || Number.isNaN(birthYearValue) || birthYearValue < 1900 || birthYearValue > 2100) {
      setError("Enter a valid birth year.");
      setResult(null);
      return;
    }

    setError("");
    setResult(
      estimateFersAnnuity({
        highThree: highThreeValue,
        yearsOfService: yearsValue,
        ageAtRetirement: ageValue,
        birthYear: birthYearValue,
        category,
        survivorElection,
      }),
    );
  };

  return (
    <div style={{ fontFamily: "Inter, system-ui, sans-serif", maxWidth: "700px", margin: "0 auto", padding: "1.5rem" }}>
      {/* Header */}
      <div style={{ marginBottom: "2rem" }}>
        <h1 style={{ fontSize: "1.75rem", fontWeight: 800, color: "#0F2244", marginBottom: "0.5rem" }}>
          FERS Basic Annuity Calculator
        </h1>
        <p style={{ color: "#64748b", lineHeight: 1.6 }}>
          Estimate your full FERS basic annuity from your High-3 average salary, your years of service, and a
          survivor benefit election — for an immediate, unreduced retirement.
        </p>
      </div>

      {/* High-3 callout */}
      <div
        style={{
          background: "#eff6ff",
          border: "1px solid #bfdbfe",
          borderRadius: "0.75rem",
          padding: "1rem 1.25rem",
          marginBottom: "1.5rem",
          fontSize: "0.875rem",
          color: "#1e40af",
          lineHeight: 1.6,
        }}
      >
        Don't know your High-3? Use the{" "}
        <a href="/calculator/high-3" style={{ color: "#1e40af", fontWeight: 600 }}>
          High-3 Average Salary Calculator
        </a>{" "}
        first, then bring that number back here.
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
          <Label htmlFor="high-three">High-3 Average Salary ($/year)</Label>
          <Input id="high-three" type="number" min={0} step={100} value={highThree} onChange={setHighThree} placeholder="e.g. 110000" />
        </div>

        <div>
          <Label htmlFor="years-of-service">
            {category === "specialProvision" ? "Years of Covered LEO/Firefighter/ATC Service" : "Years of Creditable Service"}
          </Label>
          <Input id="years-of-service" type="number" min={0} step={0.1} value={years} onChange={setYears} placeholder="e.g. 30" />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
          <div>
            <Label htmlFor="age-at-retirement">Age at Retirement</Label>
            <Input id="age-at-retirement" type="number" min={0} step={0.1} value={ageAtRetirement} onChange={setAgeAtRetirement} placeholder="e.g. 62" />
          </div>
          <div>
            <Label htmlFor="birth-year">Birth Year</Label>
            <Input id="birth-year" type="number" min={1900} step={1} value={birthYear} onChange={setBirthYear} placeholder="e.g. 1968" />
            <div style={{ fontSize: "0.75rem", color: "#94a3b8", marginTop: "0.3rem" }}>
              Used only to look up your Minimum Retirement Age.
            </div>
          </div>
        </div>

        <div>
          <Label>Retirement Category</Label>
          <SegmentedToggle
            value={category}
            onChange={setCategory}
            options={[
              { value: "regular", label: "Regular FERS" },
              { value: "specialProvision", label: "Law Enforcement / Firefighter / ATC" },
            ]}
          />
        </div>

        <div>
          <Label>Survivor Benefit Election</Label>
          <SegmentedToggle
            value={survivorElection}
            onChange={setSurvivorElection}
            options={[
              { value: "full", label: "Full (50%, −10%)" },
              { value: "partial", label: "Partial (25%, −5%)" },
              { value: "none", label: "None" },
            ]}
          />
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
        Calculate My Annuity
      </button>

      {/* Results */}
      {result && <ResultsPanel result={result} />}
    </div>
  );
}

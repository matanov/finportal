/**
 * FersAnnuityCalculator.tsx
 *
 * FERS Basic Annuity Calculator: the basic annuity formula, immediate-
 * retirement eligibility (including MRA+10 and postponing it), and the
 * spousal survivor benefit election. Takes High-3 as a direct dollar entry
 * (with a link to the High-3 tool to compute it) rather than embedding that
 * tool's own career-history form.
 *
 * Scope: immediate retirement (62+5, 60+20, MRA+30 and MRA+10 for regular
 * employees; 50+20 or any age+25 for law enforcement/firefighter/ATC). The
 * "Start annuity at age" input appears only when the inputs are an MRA+10
 * case. Deferred and disability retirement are not modeled — see
 * src/lib/fersAnnuity.ts and Issue #3.
 */

import { useState } from "react";
import {
  checkImmediateEligibility,
  estimateFersAnnuity,
  MRA10_LATEST_START_AGE,
  mra10StartAgeOptions,
  mraLabel,
  applySurvivorElection,
  type EligibilityPath,
  type FersAnnuityInput,
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
  "mra+10": "Your Minimum Retirement Age with 10 years of service (MRA+10)",
  veraOrDsr: "VERA or discontinued service retirement: age 50 with 20 years of service, or any age with 25",
  "specialProvision-50+20": "Age 50 with 20 years of covered service",
  "specialProvision-any+25": "Any age with 25 years of covered service",
};

const BANNER_TONES = {
  green: { background: "#f0fdf4", border: "1px solid #bbf7d0", color: "#166534" },
  blue: { background: "#eff6ff", border: "1px solid #bfdbfe", color: "#1e40af" },
  amber: { background: "#fffbeb", border: "1px solid #fde68a", color: "#92400e" },
};

function Banner({ tone, children }: { tone: keyof typeof BANNER_TONES; children: React.ReactNode }) {
  return (
    <div
      style={{
        ...BANNER_TONES[tone],
        borderRadius: "0.5rem",
        padding: "0.75rem 1rem",
        marginBottom: "1.25rem",
        fontSize: "0.85rem",
        lineHeight: 1.6,
      }}
    >
      {children}
    </div>
  );
}

/** 57 -> "57", 57.5 -> "57.5", 56.3333 -> "56.33" */
function fmtAge(age: number): string {
  return Number.isInteger(age) ? String(age) : age.toFixed(2).replace(/0+$/, "");
}

const fmtPct = (fraction: number) => `${+(fraction * 100).toFixed(2)}%`;

/** The global CSS reset strips list bullets, so the remarks lists put them back */
const REMARKS_LIST: React.CSSProperties = {
  margin: "0.4rem 0 0",
  paddingLeft: "1.1rem",
  listStyle: "disc",
  display: "grid",
  gap: "0.3rem",
};

// ---------------------------------------------------------------------------
// Results panel
// ---------------------------------------------------------------------------

function ResultsPanel({ result, input }: { result: FersAnnuityResult; input: FersAnnuityInput }) {
  const fmt = (n: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

  const { eligibility, annuity, ageReduction, survivor } = result;
  const reduced = ageReduction !== null && ageReduction.pct > 0;

  // MRA+10: what each possible start age would pay, after the survivor election
  const startOptions = ageReduction
    ? mra10StartAgeOptions(annuity.grossAnnualAnnuity, input.yearsOfService, input.ageAtRetirement).map((o) => ({
        ...o,
        net: applySurvivorElection(o.annualAnnuity, input.survivorElection).netAnnualAnnuity,
      }))
    : [];

  return (
    <div style={{ marginTop: "2rem" }}>
      {!eligibility.eligible ? (
        <Banner tone="amber">
          <strong>Not eligible for an immediate annuity.</strong> {eligibility.note} The amount below is the
          formula result only — it is not what you'd actually receive.
        </Banner>
      ) : ageReduction ? (
        <Banner tone="blue">
          <strong>Eligible under MRA+10</strong> — an immediate annuity, reduced 5/12 of 1% for each full month
          you're under 62 when it starts.{" "}
          {ageReduction.waived
            ? `Starting at ${fmtAge(ageReduction.startAge)} with 20+ years of service, the reduction is waived.`
            : ageReduction.fullMonthsUnder62 === 0
              ? "Starting at 62, there's no reduction."
              : `Starting at ${fmtAge(ageReduction.startAge)}, it's reduced ${fmtPct(ageReduction.pct)} (${ageReduction.fullMonthsUnder62} full months under 62).`}
        </Banner>
      ) : (
        <Banner tone="green">
          <strong>Eligible for an immediate, unreduced annuity</strong> — via{" "}
          {PATH_LABEL[eligibility.path as EligibilityPath]}.{eligibility.note && ` ${eligibility.note}`}
        </Banner>
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
          {fmt(result.annualAnnuityAfterAgeReduction)}/yr
        </div>
        <div style={{ color: "#cbd5e1", fontSize: "0.875rem", marginTop: "0.75rem" }}>
          {fmt(result.monthlyAnnuityAfterAgeReduction)}/mo · {annuity.multiplierNote}
          {reduced &&
            ` · ${fmtPct(ageReduction.pct)} MRA+10 reduction taken off the ${fmt(annuity.grossAnnualAnnuity)} formula amount`}
          {ageReduction && ` · starts at ${fmtAge(ageReduction.startAge)}`}
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

      {ageReduction && (
        <div
          style={{
            background: "#fff",
            border: "1px solid #e2e8f0",
            borderRadius: "0.75rem",
            overflow: "hidden",
            marginBottom: "1.5rem",
          }}
        >
          <div style={{ padding: "1rem 1.25rem", borderBottom: "1px solid #e2e8f0" }}>
            <div style={{ fontWeight: 700, color: "#1e293b" }}>If you postpone your annuity</div>
            <div style={{ fontSize: "0.8rem", color: "#64748b", marginTop: "0.25rem" }}>
              {input.yearsOfService >= 20
                ? "With 20+ years, starting at 60 or later removes the reduction entirely."
                : "With under 20 years, the reduction shrinks 5% for each year you wait and ends at 62."}
            </div>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
              <thead>
                <tr style={{ background: "#f8fafc" }}>
                  {["Annuity starts at", "Reduction", "You'd receive", "Per month"].map((h) => (
                    <th
                      key={h}
                      style={{
                        padding: "0.55rem 1rem",
                        textAlign: "left",
                        fontWeight: 600,
                        color: "#64748b",
                        fontSize: "0.72rem",
                        textTransform: "uppercase",
                        letterSpacing: "0.05em",
                        borderBottom: "1px solid #e2e8f0",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {startOptions.map((o) => {
                  const chosen = Math.abs(o.startAge - ageReduction.startAge) < 1e-9;
                  return (
                    <tr
                      key={o.startAge}
                      style={{ borderBottom: "1px solid #f1f5f9", background: chosen ? "#eff6ff" : undefined }}
                    >
                      <td style={{ padding: "0.55rem 1rem", color: "#334155", whiteSpace: "nowrap" }}>
                        {fmtAge(o.startAge)}
                        {o.startAge === input.ageAtRetirement && " (right away)"}
                        {chosen && <strong style={{ color: "#1e40af" }}> ← your choice</strong>}
                      </td>
                      <td style={{ padding: "0.55rem 1rem", color: "#334155" }}>
                        {o.reduction.waived ? "None (20+ years)" : o.reduction.pct > 0 ? fmtPct(o.reduction.pct) : "None"}
                      </td>
                      <td style={{ padding: "0.55rem 1rem", fontWeight: 600, color: "#0F2244" }}>{fmt(o.net)}/yr</td>
                      <td style={{ padding: "0.55rem 1rem", color: "#64748b" }}>{fmt(o.net / 12)}/mo</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div style={{ padding: "0.75rem 1.25rem", fontSize: "0.75rem", color: "#64748b", lineHeight: 1.6 }}>
            Amounts are yearly for life, after your survivor election. "62" stands for the latest start OPM allows,
            2 days before your 62nd birthday. Nothing is paid between retiring and the start date.
          </div>
        </div>
      )}

      {ageReduction && (
        <div
          style={{
            background: "#fff",
            border: "1px solid #e2e8f0",
            borderRadius: "0.75rem",
            padding: "1.25rem",
            fontSize: "0.85rem",
            color: "#475569",
            lineHeight: 1.7,
            marginBottom: "1rem",
          }}
        >
          <strong style={{ color: "#1e293b" }}>About MRA+10:</strong>
          <ul style={REMARKS_LIST}>
            <li>
              The reduction is figured when the annuity starts and stays with it for life. It doesn't go away at 62.
            </li>
            <li>
              If you postpone, you can pick your Federal Employees Health Benefits (FEHB) and life insurance (FEGLI)
              back up when the annuity starts, as long as you had them for the 5 years before you left.
            </li>
            <li>
              MRA+10 retirees don't get the FERS Special Retirement Supplement, even if they postpone (5 U.S.C. 8421).
            </li>
            <li>
              Postponing doesn't earn the 1.1% rate. That rate depends on being 62 when you leave federal service, not
              on when the annuity starts.
            </li>
            <li>
              Both the survivor reduction and your spouse's benefit are figured on the age-reduced annuity.
            </li>
          </ul>
        </div>
      )}

      {eligibility.path === "veraOrDsr" && (
        <div
          style={{
            background: "#fff",
            border: "1px solid #e2e8f0",
            borderRadius: "0.75rem",
            padding: "1.25rem",
            fontSize: "0.85rem",
            color: "#475569",
            lineHeight: 1.7,
            marginBottom: "1rem",
          }}
        >
          <strong style={{ color: "#1e293b" }}>About VERA and discontinued service retirement:</strong>
          <ul style={REMARKS_LIST}>
            <li>The annuity isn't reduced for age, however young you are when you retire.</li>
            <li>
              The FERS Special Retirement Supplement starts only once you reach your Minimum Retirement Age of{" "}
              {mraLabel(eligibility.mra)} (5 U.S.C. 8421(a)(2)).
            </li>
            <li>
              VERA is available only when your agency makes an OPM-approved offer that covers your position.
              Discontinued service retirement applies when you're separated involuntarily and not for cause. Turning
              down a reasonable offer of another job in your agency, within your commuting area and no more than 2
              grades lower, rules it out (5 U.S.C. 8414(b)(2)).
            </li>
            <li>Any separation incentive payment (VSIP) that comes with the offer isn't included here.</li>
          </ul>
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
        <strong style={{ color: "#1e293b" }}>Keep in mind:</strong> this covers immediate retirement: 62 with 5
        years, 60 with 20, or your Minimum Retirement Age with 30, or with 10 (MRA+10, reduced unless you postpone).
        With a VERA offer or an involuntary separation (discontinued service), you can also retire at 50 with 20
        years or at any age with 25, unreduced. Law enforcement officers, firefighters and air traffic controllers
        can retire at 50 with 20 years of covered service, or at any age with 25. Deferred and disability
        retirement work differently and aren't modeled here. The survivor reduction and benefit are both a share
        of the annuity before the survivor election, after any MRA+10 reduction.
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
  const [startAge, setStartAge] = useState("");
  const [veraOrDsr, setVeraOrDsr] = useState(false);
  const [error, setError] = useState("");
  const [calculated, setCalculated] = useState<{ input: FersAnnuityInput; result: FersAnnuityResult } | null>(null);

  // The VERA/DSR box only applies to regular FERS; special provision has its own 50+20 / any+25 rules
  const veraOrDsrApplies = category === "regular" && veraOrDsr;

  // Show "Start annuity at age" only while the inputs describe an MRA+10 case (VERA/DSR can take it off MRA+10)
  const isMra10 =
    years !== "" &&
    ageAtRetirement !== "" &&
    birthYear !== "" &&
    checkImmediateEligibility({
      yearsOfService: Number(years),
      ageAtRetirement: Number(ageAtRetirement),
      birthYear: Number(birthYear),
      category,
      veraOrDsr: veraOrDsrApplies,
    }).path === "mra+10";

  const calculate = () => {
    const highThreeValue = Number(highThree);
    const yearsValue = Number(years);
    const ageValue = Number(ageAtRetirement);
    const birthYearValue = Number(birthYear);
    const startAgeValue = Number(startAge);

    const fail = (message: string) => {
      setError(message);
      setCalculated(null);
    };

    if (!highThree || Number.isNaN(highThreeValue) || highThreeValue < 0) {
      return fail("Enter a valid High-3 average salary.");
    }
    if (!years || Number.isNaN(yearsValue) || yearsValue < 0 || yearsValue > 60) {
      return fail("Enter a valid number of years of service (0–60).");
    }
    if (!ageAtRetirement || Number.isNaN(ageValue) || ageValue < 0 || ageValue > 100) {
      return fail("Enter a valid age at retirement.");
    }
    if (!birthYear || Number.isNaN(birthYearValue) || birthYearValue < 1900 || birthYearValue > 2100) {
      return fail("Enter a valid birth year.");
    }
    if (isMra10 && startAge !== "") {
      if (Number.isNaN(startAgeValue) || startAgeValue < ageValue) {
        return fail("The annuity can't start before you retire. Leave the start age blank to start right away.");
      }
      if (startAgeValue > MRA10_LATEST_START_AGE) {
        return fail("A postponed MRA+10 annuity has to start by 62. Starting at 62 already has no reduction.");
      }
    }

    const input: FersAnnuityInput = {
      highThree: highThreeValue,
      yearsOfService: yearsValue,
      ageAtRetirement: ageValue,
      birthYear: birthYearValue,
      category,
      survivorElection,
      veraOrDsr: veraOrDsrApplies,
      annuityStartAge: isMra10 && startAge !== "" ? startAgeValue : undefined,
    };
    setError("");
    setCalculated({ input, result: estimateFersAnnuity(input) });
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
          survivor benefit election, for an immediate retirement. That includes MRA+10 and postponing it.
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
          {category === "regular" && (
            <label
              htmlFor="vera-dsr"
              style={{ display: "flex", gap: "0.6rem", alignItems: "flex-start", marginTop: "0.9rem", cursor: "pointer" }}
            >
              <input
                id="vera-dsr"
                type="checkbox"
                checked={veraOrDsr}
                onChange={(e) => setVeraOrDsr(e.target.checked)}
                style={{ marginTop: "0.2rem", width: "1rem", height: "1rem", accentColor: "#C9A035", flexShrink: 0 }}
              />
              <span>
                <span style={{ display: "block", fontSize: "0.875rem", fontWeight: 600, color: "#1e293b" }}>
                  VERA or discontinued service retirement
                </span>
                <span style={{ display: "block", fontSize: "0.75rem", color: "#94a3b8", marginTop: "0.2rem", lineHeight: 1.5 }}>
                  Check this if your agency offered you VERA (Voluntary Early Retirement), or you're being separated
                  involuntarily and not for cause, for example in a reduction in force. Either lets you retire at 50
                  with 20 years of service, or at any age with 25, with no reduction for age.
                </span>
              </span>
            </label>
          )}
        </div>

        {isMra10 && (
          <div
            style={{
              background: "#eff6ff",
              border: "1px solid #bfdbfe",
              borderRadius: "0.5rem",
              padding: "0.9rem 1rem",
            }}
          >
            <Label htmlFor="start-age">Start Annuity at Age (optional)</Label>
            <Input
              id="start-age"
              type="number"
              min={Number(ageAtRetirement) || 0}
              step={0.1}
              value={startAge}
              onChange={setStartAge}
              placeholder={`Right away (${ageAtRetirement})`}
            />
            <div style={{ fontSize: "0.75rem", color: "#1e40af", marginTop: "0.4rem", lineHeight: 1.5 }}>
              This is an MRA+10 retirement, reduced 5% a year for each year you're under 62 when the annuity
              starts. You can postpone the start to shrink the reduction or remove it: at 62, or at 60 if you have
              20+ years. Leave this blank to start right away.
            </div>
          </div>
        )}

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
      {calculated && <ResultsPanel result={calculated.result} input={calculated.input} />}
    </div>
  );
}

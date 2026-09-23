/**
 * TspProjection.tsx
 *
 * TSP Projection Calculator: inputs only so far.
 *   - Current balances: one row per fund holding (fund, amount, Roth or
 *     Traditional), starting with a single C Fund row; "+ Add fund" adds more.
 *   - Contributions: current age, salary, and separate Traditional and Roth
 *     elections (as the TSP takes them), each a percent of salary or a
 *     dollar amount per year, with the current IRS limits alongside.
 *   - Where your contributions go: a year of contributions split into
 *     regular / catch-up / agency, Traditional vs Roth, with anything over
 *     the limit and any agency match lost by hitting it early.
 *   - Contributions over the horizon: starting balances plus each year's
 *     contributions at that year's age, before any investment growth.
 *   - Projected balance: a Monte Carlo run over real TSP monthly returns
 *     (src/lib/tspSimulation.ts), shown as below average / average / above
 *     average (25th / 50th / 75th percentile) outcomes and a fan chart.
 *   - Future allocation: how new contributions are split across funds, one
 *     row per fund, which must add up to 100%.
 *   - Projection horizon: a fixed list of year spans.
 * The projection itself is still to come; the right-hand panel summarizes
 * the inputs in the meantime.
 */

import { useEffect, useMemo, useState } from "react";
import ErrorBoundary from "./ErrorBoundary";
import ProjectionChart from "./ProjectionChart";
import { simulateProjection, type MonthlyReturns, type Scenario } from "../lib/tspSimulation";
import {
  CONTRIBUTION_LIMITS,
  DEFAULT_FUND,
  DEFAULT_HORIZON,
  FALLBACK_FUNDS,
  HORIZON_OPTIONS,
  checkAllocation,
  contributionBreakdown,
  employeeLimit,
  fundLabel,
  newId,
  orderFunds,
  projectContributions,
  summarizeHoldings,
  type AllocationRow,
  type ContributionMode,
  type ContributionYear,
  type HoldingRow,
} from "../lib/tspProjection";

const fmtMoney = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);

/** "2005-08" -> "Aug 2005" */
const fmtMonth = (yyyyMm: string | null) => {
  if (!yyyyMm) return "—";
  const [y, m] = yyyyMm.split("-");
  return `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(m) - 1]} ${y}`;
};

const fmtPct = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(1)}%`;

// ---------------------------------------------------------------------------
// Small shared controls
// ---------------------------------------------------------------------------

const CONTROL_HEIGHT = "2.25rem";

const inputStyle: React.CSSProperties = {
  width: "100%",
  height: CONTROL_HEIGHT,
  padding: "0.45rem 0.55rem",
  border: "1px solid #e2e8f0",
  borderRadius: "0.375rem",
  fontSize: "0.9rem",
  background: "#fff",
  color: "#1e293b",
  boxSizing: "border-box",
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: "0.7rem",
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  color: "#64748b",
  marginBottom: "0.25rem",
};

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

function CardTitle({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <div style={{ marginBottom: "1rem" }}>
      <div style={{ fontWeight: 700, color: "#1e293b" }}>{children}</div>
      {hint && <div style={{ fontSize: "0.85rem", color: "#64748b", marginTop: "0.2rem" }}>{hint}</div>}
    </div>
  );
}

function FundSelect({
  id,
  funds,
  value,
  onChange,
}: {
  id: string;
  funds: string[];
  value: string;
  onChange: (fund: string) => void;
}) {
  return (
    <select id={id} value={value} onChange={(e) => onChange(e.target.value)} style={{ ...inputStyle, cursor: "pointer" }}>
      {funds.map((f) => (
        <option key={f} value={f}>
          {fundLabel(f)}
        </option>
      ))}
    </select>
  );
}

function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      style={{
        width: CONTROL_HEIGHT,
        height: CONTROL_HEIGHT,
        flexShrink: 0,
        border: "1px solid #e2e8f0",
        borderRadius: "0.375rem",
        background: "#fff",
        color: "#94a3b8",
        fontSize: "1.1rem",
        lineHeight: 1,
        cursor: "pointer",
      }}
    >
      ×
    </button>
  );
}

function AddButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        marginTop: "0.75rem",
        padding: "0.45rem 0.9rem",
        border: "1px dashed #94a3b8",
        borderRadius: "0.375rem",
        background: "#f8fafc",
        color: "#2A7D9C",
        fontSize: "0.85rem",
        fontWeight: 600,
        cursor: "pointer",
      }}
    >
      + {children}
    </button>
  );
}

function PercentInput({
  id,
  value,
  onChange,
}: {
  id: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div style={{ position: "relative" }}>
      <input
        id={id}
        type="number"
        inputMode="numeric"
        min={0}
        max={100}
        step={1}
        placeholder="0"
        value={value === 0 ? "" : value}
        onChange={(e) =>
          onChange(e.target.value === "" ? 0 : Math.min(100, Math.max(0, Math.round(Number(e.target.value)))))
        }
        style={{ ...inputStyle, paddingRight: "1.6rem" }}
      />
      <span
        aria-hidden="true"
        style={{
          position: "absolute",
          right: "0.6rem",
          top: "50%",
          transform: "translateY(-50%)",
          color: "#94a3b8",
          fontSize: "0.85rem",
        }}
      >
        %
      </span>
    </div>
  );
}

function DollarInput({
  id,
  value,
  onChange,
}: {
  id: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <input
      id={id}
      type="number"
      inputMode="decimal"
      min={0}
      step={500}
      placeholder="0"
      value={value === 0 ? "" : value}
      onChange={(e) => onChange(e.target.value === "" ? 0 : Math.max(0, Number(e.target.value)))}
      style={inputStyle}
    />
  );
}

function ModeToggle({ mode, onChange }: { mode: ContributionMode; onChange: (m: ContributionMode) => void }) {
  const options: { value: ContributionMode; label: string }[] = [
    { value: "percent", label: "% of salary" },
    { value: "dollars", label: "$ per year" },
  ];
  return (
    <div
      role="group"
      aria-label="Contribute as"
      style={{ display: "inline-flex", border: "1px solid #e2e8f0", borderRadius: "0.375rem", overflow: "hidden" }}
    >
      {options.map((o) => {
        const active = o.value === mode;
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

/** Row layout shared by both lists: wraps onto two lines on narrow screens */
function Row({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "flex-end",
        gap: "0.6rem",
        padding: "0.6rem 0",
        borderBottom: "1px solid #f1f5f9",
      }}
    >
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Contribution breakdown table
// ---------------------------------------------------------------------------

function BreakdownTable({
  breakdown: b,
  age,
}: {
  breakdown: ReturnType<typeof contributionBreakdown>;
  age: number | null;
}) {
  const th: React.CSSProperties = {
    padding: "0.45rem 0.5rem",
    textAlign: "left",
    fontSize: "0.7rem",
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    color: "#64748b",
    borderBottom: "2px solid #e2e8f0",
  };
  const td: React.CSSProperties = { padding: "0.45rem 0.5rem", borderBottom: "1px solid #f1f5f9", verticalAlign: "top" };
  const num: React.CSSProperties = { ...td, textAlign: "right", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" };
  const sub: React.CSSProperties = { display: "block", fontSize: "0.75rem", color: "#94a3b8" };
  const tax = (roth: boolean) => (
    <span
      style={{
        display: "inline-block",
        padding: "0.05rem 0.45rem",
        borderRadius: "999px",
        fontSize: "0.72rem",
        fontWeight: 600,
        background: roth ? "#ecfdf5" : "#eff6ff",
        color: roth ? "#047857" : "#1d4ed8",
      }}
    >
      {roth ? "Roth" : "Traditional"}
    </span>
  );

  const catchUpNote =
    b.catchUpLimit === 0
      ? age == null
        ? "Enter your age to check catch-up eligibility"
        : "Available from age 50"
      : b.rothCatchUpRequired
        ? `Must be Roth: salary over ${fmtMoney(CONTRIBUTION_LIMITS.rothCatchUpWageThreshold)}`
        : b.rothCatchUpUnknown
          ? `Enter your salary: catch-up must be Roth above ${fmtMoney(CONTRIBUTION_LIMITS.rothCatchUpWageThreshold)}`
        : "Above the regular limit";

  /** Pay-period and monthly columns, plus the same figures stacked under the yearly amount on narrow screens */
  const amountCells = (amount: number, style?: React.CSSProperties) => (
    <>
      <td className="bd-split-col" style={{ ...num, color: "#64748b", ...style }}>
        {fmtMoney(amount / 26)}
      </td>
      <td className="bd-split-col" style={{ ...num, color: "#64748b", ...style }}>
        {fmtMoney(amount / 12)}
      </td>
      <td style={{ ...num, ...style }}>
        {fmtMoney(amount)}
        <span className="bd-split-inline" style={sub}>
          {fmtMoney(amount / 26)}/pay
        </span>
        <span className="bd-split-inline" style={sub}>
          {fmtMoney(amount / 12)}/mo
        </span>
      </td>
    </>
  );

  const rows: { label: string; note: string; roth: boolean | null; limit: string; amount: number; muted?: boolean }[] = [
    { label: "Regular", note: "Your election", roth: false, limit: fmtMoney(CONTRIBUTION_LIMITS.elective), amount: b.regularTraditional },
    { label: "Regular", note: "Your election", roth: true, limit: "shared", amount: b.regularRoth },
    { label: "Catch-up", note: catchUpNote, roth: false, limit: b.catchUpLimit ? fmtMoney(b.catchUpLimit) : "—", amount: b.catchUpTraditional },
    { label: "Catch-up", note: catchUpNote, roth: true, limit: b.catchUpLimit ? "shared" : "—", amount: b.catchUpRoth },
    { label: "Agency automatic", note: "1% of pay, even if you contribute nothing", roth: false, limit: "—", amount: b.agencyAutomatic },
    { label: "Agency match", note: "Up to 4% of pay, on what you put in", roth: false, limit: "—", amount: b.agencyMatch },
  ];

  return (
    <div style={{ overflowX: "auto", containerType: "inline-size" }}>
      {/* When the table is narrow, the pay-period/month columns and then the Limit column
          fold into small lines under the yearly amount and the row label. */}
      <style>{`
        .bd-limit-inline, .bd-split-inline { display: none !important; }
        @container (max-width: 640px) {
          .bd-split-col { display: none; }
          .bd-split-inline { display: block !important; }
        }
        @container (max-width: 480px) {
          .bd-limit-col { display: none; }
          .bd-limit-inline { display: block !important; }
          .bd-table th, .bd-table td { padding-left: 0.25rem !important; padding-right: 0.25rem !important; }
        }
      `}</style>
      <table
        className="bd-table"
        style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem", color: "#1e293b" }}
      >
        <thead>
          <tr>
            <th style={th}>Contribution</th>
            <th style={th}>Tax treatment</th>
            <th className="bd-limit-col" style={{ ...th, textAlign: "right" }}>
              Limit
            </th>
            <th className="bd-split-col" style={{ ...th, textAlign: "right" }}>
              Per pay period
            </th>
            <th className="bd-split-col" style={{ ...th, textAlign: "right" }}>
              Per month
            </th>
            <th style={{ ...th, textAlign: "right" }}>Per year</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} style={{ opacity: r.amount < 0.5 ? 0.55 : 1 }}>
              <td style={td}>
                {r.label}
                <span style={sub}>{r.note}</span>
                {r.limit !== "—" && r.limit !== "shared" && (
                  <span className="bd-limit-inline" style={sub}>
                    Limit {r.limit}
                  </span>
                )}
              </td>
              <td style={td}>{r.roth != null && tax(r.roth)}</td>
              <td className="bd-limit-col" style={{ ...num, color: "#64748b" }}>
                {r.limit}
              </td>
              {amountCells(r.amount)}
            </tr>
          ))}
          {b.notContributed > 0.5 && (
            <tr>
              <td style={{ ...td, color: "#92400e" }}>
                Over your limit
                <span style={sub}>Elected but not contributed</span>
                <span className="bd-limit-inline" style={sub}>
                  Your limit {fmtMoney(b.limit)}
                </span>
              </td>
              <td style={td} />
              <td className="bd-limit-col" style={{ ...num, color: "#64748b" }}>
                {fmtMoney(b.limit)}
              </td>
              {amountCells(b.notContributed, { color: "#92400e" })}
            </tr>
          )}
        </tbody>
        <tfoot>
          {/* Election totals: the Regular / Catch-up rows above split by limit, these add them back up by type */}
          <tr style={{ background: "#f8fafc" }}>
            <td style={{ ...td, fontWeight: 600 }}>
              Your Traditional total
              <span style={sub}>Regular + catch-up</span>
            </td>
            <td style={td}>{tax(false)}</td>
            <td className="bd-limit-col" style={num} />
            {amountCells(b.regularTraditional + b.catchUpTraditional, { fontWeight: 600 })}
          </tr>
          <tr style={{ background: "#f8fafc" }}>
            <td style={{ ...td, fontWeight: 600 }}>
              Your Roth total
              <span style={sub}>Regular + catch-up</span>
            </td>
            <td style={td}>{tax(true)}</td>
            <td className="bd-limit-col" style={num} />
            {amountCells(b.regularRoth + b.catchUpRoth, { fontWeight: 600 })}
          </tr>
          <tr>
            <td style={{ ...td, fontWeight: 700 }} colSpan={2}>
              Total going in
              <span style={sub}>
                Traditional {fmtMoney(b.regularTraditional + b.catchUpTraditional + b.agencyTotal)} · Roth{" "}
                {fmtMoney(b.regularRoth + b.catchUpRoth)}
              </span>
            </td>
            <td className="bd-limit-col" style={num} />
            {amountCells(b.total, { fontWeight: 700 })}
          </tr>
        </tfoot>
      </table>
      <div style={{ marginTop: "0.5rem", fontSize: "0.75rem", color: "#94a3b8" }}>
        Per pay period and per month are the yearly amount divided by 26 and 12. If you hit your limit early,
        actual paychecks are higher until then and zero after.
      </div>
      <details style={{ marginTop: "0.75rem", fontSize: "0.8rem", color: "#475569", lineHeight: 1.6 }}>
        <summary style={{ cursor: "pointer", fontWeight: 600, color: "#2A7D9C" }}>How this table works</summary>
        <ul style={{ margin: "0.4rem 0 0", paddingLeft: "1.1rem", listStyle: "disc" }}>
          <li>
            Payroll takes both of your elections from every paycheck until you reach your limit for the year (
            {fmtMoney(CONTRIBUTION_LIMITS.elective)}, plus catch-up if you're 50 or older). Then contributions, and
            the agency match, stop for the rest of the year.
          </li>
          <li>
            Under 50, the {fmtMoney(CONTRIBUTION_LIMITS.elective)} limit is Traditional and Roth combined. Electing
            {" "}{fmtMoney(CONTRIBUTION_LIMITS.elective)} Traditional plus some Roth goes over it, so both stop early and
            you end up with less than {fmtMoney(CONTRIBUTION_LIMITS.elective)} Traditional.
          </li>
          <li>
            Over the year, your Traditional contributions fill the regular {fmtMoney(CONTRIBUTION_LIMITS.elective)}{" "}
            limit first, then Roth. Anything above {fmtMoney(CONTRIBUTION_LIMITS.elective)} is catch-up (age 50+).
            The <strong>Regular</strong> and <strong>Catch-up</strong> rows show which limit money counts against;
            your totals by type are in the <strong>Your Traditional total</strong> and{" "}
            <strong>Your Roth total</strong> lines.
          </li>
          <li>
            If catch-up must be Roth (age 50+ and salary over{" "}
            {fmtMoney(CONTRIBUTION_LIMITS.rothCatchUpWageThreshold)}), your Roth contributions count as the catch-up
            first. Only if they fall short is the rest taken from Traditional and put in as Roth. So{" "}
            {fmtMoney(CONTRIBUTION_LIMITS.elective)} Traditional plus your catch-up amount as Roth stays as elected,
            and electing it all as Traditional puts the catch-up in as Roth automatically.
          </li>
          <li>Agency contributions, automatic and matching, always go in as Traditional.</li>
        </ul>
      </details>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Year-by-year contributions table
// ---------------------------------------------------------------------------

function ContributionsOverTime({
  rows,
  start,
}: {
  rows: ContributionYear[];
  start: { traditional: number; roth: number };
}) {
  const th: React.CSSProperties = {
    padding: "0.45rem 0.5rem",
    textAlign: "right",
    fontSize: "0.7rem",
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    color: "#64748b",
    borderBottom: "2px solid #e2e8f0",
    verticalAlign: "bottom",
  };
  const td: React.CSSProperties = {
    padding: "0.4rem 0.5rem",
    borderBottom: "1px solid #f1f5f9",
    textAlign: "right",
    whiteSpace: "nowrap",
    fontVariantNumeric: "tabular-nums",
    verticalAlign: "top",
  };
  const sub: React.CSSProperties = { display: "block", fontSize: "0.72rem", color: "#94a3b8" };
  const sum = (f: (r: ContributionYear) => number) => rows.reduce((t, r) => t + f(r), 0);
  const last = rows[rows.length - 1];

  return (
    <div style={{ overflowX: "auto", containerType: "inline-size" }}>
      {/* When narrow, the Traditional / Roth / Agency columns fold under "Added" and the running total */}
      <style>{`
        .ot-inline { display: none !important; }
        @container (max-width: 600px) {
          .ot-col { display: none; }
          .ot-inline { display: block !important; }
          .ot-table th, .ot-table td { padding-left: 0.3rem !important; padding-right: 0.3rem !important; }
          .ot-split { display: block; }
          .ot-sep { display: none; }
        }
      `}</style>
      <table
        className="ot-table"
        style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem", color: "#1e293b" }}
      >
        <thead>
          <tr>
            <th style={{ ...th, textAlign: "left" }}>Year</th>
            <th style={{ ...th, textAlign: "left" }}>Age</th>
            <th className="ot-col" style={th}>
              You: Traditional
            </th>
            <th className="ot-col" style={th}>
              You: Roth
            </th>
            <th className="ot-col" style={th}>
              Agency
            </th>
            <th style={th}>Added</th>
            <th style={th}>Running total</th>
          </tr>
        </thead>
        <tbody>
          <tr style={{ background: "#f8fafc" }}>
            <td style={{ ...td, textAlign: "left", fontWeight: 600 }} colSpan={2}>
              Starting balance
            </td>
            <td className="ot-col" style={td} colSpan={3} />
            <td style={td} />
            <td style={{ ...td, fontWeight: 600 }}>
              {fmtMoney(start.traditional + start.roth)}
              <span style={sub}>
                <span className="ot-split">T {fmtMoney(start.traditional)}</span>
                <span className="ot-sep"> · </span>
                <span className="ot-split">R {fmtMoney(start.roth)}</span>
              </span>
            </td>
          </tr>
          {rows.map((r) => (
            <tr key={r.year}>
              <td style={{ ...td, textAlign: "left" }}>{r.year}</td>
              <td style={{ ...td, textAlign: "left" }}>
                {r.age ?? "—"}
                {r.catchUpEligible && (
                  <span style={{ ...sub, color: "#047857" }}>catch-up</span>
                )}
              </td>
              <td className="ot-col" style={td}>
                {fmtMoney(r.employeeTraditional)}
              </td>
              <td className="ot-col" style={td}>
                {fmtMoney(r.employeeRoth)}
              </td>
              <td className="ot-col" style={td}>
                {fmtMoney(r.agency)}
              </td>
              <td style={td}>
                {fmtMoney(r.total)}
                <span className="ot-inline" style={sub}>
                  T {fmtMoney(r.employeeTraditional + r.agency)}
                </span>
                <span className="ot-inline" style={sub}>
                  R {fmtMoney(r.employeeRoth)}
                </span>
              </td>
              <td style={td}>
                {fmtMoney(r.cumulativeTraditional + r.cumulativeRoth)}
                <span style={sub}>
                  <span className="ot-split">T {fmtMoney(r.cumulativeTraditional)}</span>
                  <span className="ot-sep"> · </span>
                  <span className="ot-split">R {fmtMoney(r.cumulativeRoth)}</span>
                </span>
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td style={{ ...td, textAlign: "left", fontWeight: 700 }} colSpan={2}>
              {rows.length}-year total
            </td>
            <td className="ot-col" style={{ ...td, fontWeight: 700 }}>
              {fmtMoney(sum((r) => r.employeeTraditional))}
            </td>
            <td className="ot-col" style={{ ...td, fontWeight: 700 }}>
              {fmtMoney(sum((r) => r.employeeRoth))}
            </td>
            <td className="ot-col" style={{ ...td, fontWeight: 700 }}>
              {fmtMoney(sum((r) => r.agency))}
            </td>
            <td style={{ ...td, fontWeight: 700 }}>{fmtMoney(sum((r) => r.total))}</td>
            <td style={{ ...td, fontWeight: 700 }}>
              {last ? fmtMoney(last.cumulativeTraditional + last.cumulativeRoth) : "—"}
            </td>
          </tr>
        </tfoot>
      </table>
      <div style={{ marginTop: "0.5rem", fontSize: "0.75rem", color: "#94a3b8", lineHeight: 1.5 }}>
        T = Traditional (your Traditional contributions plus all agency money), R = Roth. Running total is starting
        balance plus contributions only, with no investment growth. Salary and the {CONTRIBUTION_LIMITS.year} limits
        are held flat every year; age moves up one each year, so catch-up starts at 50 and rises at 60 to 63. "You:
        Traditional" and "You: Roth" are your totals by type after limits, including any catch-up that had to go in
        as Roth (see "How this table works" under the one-year breakdown).
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Projection: scenario tiles
// ---------------------------------------------------------------------------

function ScenarioTiles({
  below,
  average,
  above,
  contributed,
}: {
  below: Scenario;
  average: Scenario;
  above: Scenario;
  contributed: number;
}) {
  const tiles: { label: string; hint: string; s: Scenario; main?: boolean }[] = [
    { label: "Below average", hint: "1 in 4 outcomes were lower", s: below },
    { label: "Average", hint: "Half of outcomes were lower", s: average, main: true },
    { label: "Above average", hint: "1 in 4 outcomes were higher", s: above },
  ];
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
        gap: "0.75rem",
        marginBottom: "1.25rem",
      }}
    >
      {tiles.map(({ label, hint, s, main }) => (
        <div
          key={label}
          style={{
            border: main ? "2px solid #2a78d6" : "1px solid #e2e8f0",
            borderRadius: "0.6rem",
            padding: "0.8rem 0.9rem",
            background: main ? "#f5f9fe" : "#fff",
          }}
        >
          <div
            style={{
              fontSize: "0.72rem",
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              color: "#64748b",
            }}
          >
            {label}
          </div>
          <div
            style={{
              fontSize: main ? "1.6rem" : "1.35rem",
              fontWeight: 800,
              color: "#0F2244",
              fontVariantNumeric: "tabular-nums",
              margin: "0.15rem 0",
            }}
          >
            {fmtMoney(s.total)}
          </div>
          <div style={{ fontSize: "0.78rem", color: "#475569", lineHeight: 1.55, fontVariantNumeric: "tabular-nums" }}>
            Traditional {fmtMoney(s.traditional)}
            <br />
            Roth {fmtMoney(s.roth)}
            <br />
            Growth {fmtMoney(s.total - contributed)}
          </div>
          <div style={{ fontSize: "0.72rem", color: "#94a3b8", marginTop: "0.3rem" }}>{hint}</div>
        </div>
      ))}
    </div>
  );
}

/** Adopts a new value only after it has been stable for delayMs, so the simulation doesn't rerun on every keystroke */
function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const handle = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(handle);
  }, [value, delayMs]);
  return debounced;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function TspProjection() {
  return (
    <ErrorBoundary name="TSP Projection Calculator">
      <TspProjectionInner />
    </ErrorBoundary>
  );
}

/** First fund in `funds` not already used by a row, else the default */
function nextFund(funds: string[], used: string[]): string {
  return funds.find((f) => !used.includes(f)) ?? DEFAULT_FUND;
}

function TspProjectionInner() {
  const [funds, setFunds] = useState<string[]>(orderFunds(FALLBACK_FUNDS));
  const [holdings, setHoldings] = useState<HoldingRow[]>([
    // Fixed ids for the starting rows so server and client render the same markup
    { id: "h-0", fund: DEFAULT_FUND, amount: 0, roth: false },
  ]);
  const [allocation, setAllocation] = useState<AllocationRow[]>([
    { id: "a-0", fund: DEFAULT_FUND, percent: 100 },
  ]);
  const [horizon, setHorizon] = useState(DEFAULT_HORIZON);
  const [yearsOpen, setYearsOpen] = useState(false);
  const [age, setAge] = useState<number | null>(null);
  const [salary, setSalary] = useState(0);
  // Most FERS employees contribute 5%, the level that earns the full agency match.
  // Traditional and Roth elections, kept separately per mode so switching % / $ doesn't lose either.
  // Most FERS employees contribute 5%, the level that earns the full agency match.
  const [tradPct, setTradPct] = useState(5);
  const [rothPct, setRothPct] = useState(0);
  const [tradDollars, setTradDollars] = useState(0);
  const [rothDollars, setRothDollars] = useState(0);
  const [contribMode, setContribMode] = useState<ContributionMode>("percent");

  // The live fund list (new L funds appear over time); the fallback covers
  // the first render and any fetch failure.
  useEffect(() => {
    let cancelled = false;
    fetch("/tsp/index.json")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data: { funds: string[] }) => {
        if (!cancelled && data.funds?.length) setFunds(orderFunds(data.funds));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const summary = summarizeHoldings(holdings);
  const { limit: myLimit, catchUp } = employeeLimit(age);
  const contributionInput = {
    salary,
    mode: contribMode,
    traditional: contribMode === "percent" ? tradPct : tradDollars,
    roth: contribMode === "percent" ? rothPct : rothDollars,
    age,
  };
  const breakdown = contributionBreakdown(contributionInput);
  const overLimit = breakdown.notContributed > 0.5;
  const startBalances = { traditional: summary.traditional, roth: summary.roth };
  const yearRows = projectContributions(contributionInput, startBalances, horizon);

  // --- projection ------------------------------------------------------------
  const [monthlyReturns, setMonthlyReturns] = useState<MonthlyReturns | null>(null);
  const [returnsError, setReturnsError] = useState(false);
  useEffect(() => {
    let cancelled = false;
    fetch("/tsp/monthly-returns.json")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data: MonthlyReturns) => {
        if (!cancelled) setMonthlyReturns(data);
      })
      .catch(() => {
        if (!cancelled) setReturnsError(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // The simulation takes ~100ms at 40 years, so rerun it only once typing pauses.
  const simKey = JSON.stringify({ holdings, allocation, yearRows });
  const debouncedKey = useDebounced(simKey, 300);
  const simPending = simKey !== debouncedKey;
  const hasMoney = summary.total > 0 || yearRows.some((r) => r.total > 0);
  const projection = useMemo(() => {
    if (!monthlyReturns || !hasMoney) return null;
    const { holdings: h, allocation: a, yearRows: y } = JSON.parse(debouncedKey);
    return simulateProjection({ monthlyReturns, holdings: h, allocation: a, years: y });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthlyReturns, debouncedKey]);
  const endYear = CONTRIBUTION_LIMITS.year + horizon;
  // Highest whole percent that stays within the limit all year, so the match isn't cut off early
  const spreadPct = salary > 0 ? Math.floor((myLimit / salary) * 100) : 0;
  const allocCheck = checkAllocation(allocation);

  // --- holdings ------------------------------------------------------------
  const updateHolding = (id: string, patch: Partial<HoldingRow>) =>
    setHoldings((rows) => rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const addHolding = () =>
    setHoldings((rows) => [
      ...rows,
      { id: newId("h"), fund: nextFund(funds, rows.map((r) => r.fund)), amount: 0, roth: false },
    ]);
  const removeHolding = (id: string) => setHoldings((rows) => rows.filter((r) => r.id !== id));

  // --- allocation ----------------------------------------------------------
  const updateAllocation = (id: string, patch: Partial<AllocationRow>) =>
    setAllocation((rows) => rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const addAllocation = () =>
    setAllocation((rows) => {
      const remaining = Math.max(0, 100 - checkAllocation(rows).total);
      return [
        ...rows,
        { id: newId("a"), fund: nextFund(funds, rows.map((r) => r.fund)), percent: remaining },
      ];
    });
  const removeAllocation = (id: string) => setAllocation((rows) => rows.filter((r) => r.id !== id));

  const remaining = 100 - allocCheck.total;
  const allocStatus = allocCheck.isComplete
    ? { text: "Adds up to 100%", color: "#166534", bg: "#f0fdf4" }
    : remaining > 0
      ? { text: `${fmtPct(allocCheck.total)} allocated, ${fmtPct(remaining)} left`, color: "#92400e", bg: "#fffbeb" }
      : { text: `${fmtPct(allocCheck.total)} allocated, ${fmtPct(-remaining)} over`, color: "#991b1b", bg: "#fef2f2" };

  return (
    <div style={{ fontFamily: "Inter, system-ui, sans-serif", maxWidth: "980px", margin: "0 auto", padding: "1.5rem" }}>
      <div style={{ marginBottom: "2rem" }}>
        <h1 style={{ fontSize: "1.75rem", fontWeight: 800, color: "#0F2244", marginBottom: "0.5rem" }}>
          TSP Projection Calculator
        </h1>
        <p style={{ color: "#64748b", lineHeight: 1.6 }}>
          Enter what you hold in the TSP today and how you want future contributions split across funds, then pick
          how far ahead to project.
        </p>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 420px), 1fr))",
          gap: "1.5rem",
          alignItems: "start",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
          {/* Current balances */}
          <Card>
            <CardTitle hint="One row per fund. Tick Roth for Roth balances; add a second row for the same fund if you hold both.">
              Current balances
            </CardTitle>
            {holdings.map((row, i) => (
              <Row key={row.id}>
                <div style={{ flex: "1 1 150px" }}>
                  <label htmlFor={`${row.id}-fund`} style={labelStyle}>
                    Fund
                  </label>
                  <FundSelect
                    id={`${row.id}-fund`}
                    funds={funds}
                    value={row.fund}
                    onChange={(fund) => updateHolding(row.id, { fund })}
                  />
                </div>
                <div style={{ flex: "1 1 130px" }}>
                  <label htmlFor={`${row.id}-amount`} style={labelStyle}>
                    Amount ($)
                  </label>
                  <input
                    id={`${row.id}-amount`}
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step={100}
                    placeholder="0"
                    value={row.amount === 0 ? "" : row.amount}
                    onChange={(e) =>
                      updateHolding(row.id, {
                        amount: e.target.value === "" ? 0 : Math.max(0, Number(e.target.value)),
                      })
                    }
                    style={inputStyle}
                  />
                </div>
                <label
                  htmlFor={`${row.id}-roth`}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.35rem",
                    height: CONTROL_HEIGHT,
                    fontSize: "0.85rem",
                    color: "#1e293b",
                    cursor: "pointer",
                  }}
                >
                  <input
                    id={`${row.id}-roth`}
                    type="checkbox"
                    checked={row.roth}
                    onChange={(e) => updateHolding(row.id, { roth: e.target.checked })}
                  />
                  Roth
                </label>
                {holdings.length > 1 ? (
                  <RemoveButton label={`Remove balance row ${i + 1}`} onClick={() => removeHolding(row.id)} />
                ) : (
                  <span style={{ width: CONTROL_HEIGHT }} aria-hidden="true" />
                )}
              </Row>
            ))}
            <AddButton onClick={addHolding}>Add fund</AddButton>
          </Card>

          {/* Contributions */}
          <Card>
            <CardTitle hint="Your own contributions, as a percent of salary or a dollar amount per year.">Contributions</CardTitle>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.6rem", alignItems: "flex-end" }}>
              <div style={{ flex: "0 1 90px" }}>
                <label htmlFor="age" style={labelStyle}>
                  Current age
                </label>
                <input
                  id="age"
                  type="number"
                  inputMode="numeric"
                  min={16}
                  max={100}
                  step={1}
                  placeholder="—"
                  value={age ?? ""}
                  onChange={(e) =>
                    setAge(e.target.value === "" ? null : Math.min(100, Math.max(0, Math.round(Number(e.target.value)))))
                  }
                  style={inputStyle}
                />
              </div>
              <div style={{ flex: "1 1 180px" }}>
                <label htmlFor="salary" style={labelStyle}>
                  Annual salary ($)
                </label>
                <input
                  id="salary"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step={1000}
                  placeholder="0"
                  value={salary === 0 ? "" : salary}
                  onChange={(e) => setSalary(e.target.value === "" ? 0 : Math.max(0, Number(e.target.value)))}
                  style={inputStyle}
                />
              </div>
            </div>
            <div style={{ marginTop: "0.9rem" }}>
              <span style={labelStyle}>Contribute as</span>
              <ModeToggle mode={contribMode} onChange={setContribMode} />
            </div>
            <div
              style={{ display: "flex", flexWrap: "wrap", gap: "0.6rem", alignItems: "flex-end", marginTop: "0.75rem" }}
            >
              <div style={{ flex: "1 1 140px" }}>
                <label htmlFor="contrib-trad" style={labelStyle}>
                  Traditional {contribMode === "percent" ? "(%)" : "($ per year)"}
                </label>
                {contribMode === "percent" ? (
                  <PercentInput id="contrib-trad" value={tradPct} onChange={setTradPct} />
                ) : (
                  <DollarInput id="contrib-trad" value={tradDollars} onChange={setTradDollars} />
                )}
              </div>
              <div style={{ flex: "1 1 140px" }}>
                <label htmlFor="contrib-roth" style={labelStyle}>
                  Roth {contribMode === "percent" ? "(%)" : "($ per year)"}
                </label>
                {contribMode === "percent" ? (
                  <PercentInput id="contrib-roth" value={rothPct} onChange={setRothPct} />
                ) : (
                  <DollarInput id="contrib-roth" value={rothDollars} onChange={setRothDollars} />
                )}
              </div>
            </div>
            <div style={{ marginTop: "0.5rem", fontSize: "0.8rem", color: "#64748b", lineHeight: 1.5 }}>
              {contribMode === "percent"
                ? `Total ${tradPct + rothPct}% of salary${salary > 0 ? `, ${fmtMoney(breakdown.requested)} a year` : ""}.`
                : `Total ${fmtMoney(tradDollars + rothDollars)} a year.`}{" "}
              Traditional and Roth are separate elections but share one limit.
            </div>
            <div
              style={{
                marginTop: "1rem",
                padding: "0.75rem 0.9rem",
                borderRadius: "0.5rem",
                background: "#f8fafc",
                border: "1px solid #e2e8f0",
                fontSize: "0.8rem",
                color: "#475569",
                lineHeight: 1.6,
              }}
            >
              {/* Always visible: the one number that matters to this person */}
              <div style={{ color: "#1e293b" }}>
                {age != null ? (
                  <>
                    At {age}, your {CONTRIBUTION_LIMITS.year} limit is <strong>{fmtMoney(myLimit)}</strong>
                    {catchUp > 0
                      ? ` (${fmtMoney(CONTRIBUTION_LIMITS.elective)} + ${fmtMoney(catchUp)} catch-up).`
                      : "."}
                  </>
                ) : (
                  <>
                    Your {CONTRIBUTION_LIMITS.year} limit is <strong>{fmtMoney(CONTRIBUTION_LIMITS.elective)}</strong>.
                    Enter your age to see if catch-up applies.
                  </>
                )}
              </div>
              <details style={{ marginTop: "0.4rem" }}>
                <summary style={{ cursor: "pointer", fontWeight: 600, color: "#2A7D9C" }}>
                  {CONTRIBUTION_LIMITS.year} contribution limits
                </summary>
                <ul style={{ margin: "0.4rem 0 0", paddingLeft: "1.1rem", listStyle: "disc" }}>
                  <li>
                    <strong>{fmtMoney(CONTRIBUTION_LIMITS.elective)}</strong> a year of your own contributions,
                    Traditional and Roth combined. Agency contributions don't count toward it.
                  </li>
                  <li>
                    Age 50 or older: up to <strong>{fmtMoney(CONTRIBUTION_LIMITS.catchUp50)}</strong> more in catch-up
                    contributions.
                  </li>
                  <li>
                    Ages 60 to 63: the catch-up rises to <strong>{fmtMoney(CONTRIBUTION_LIMITS.catchUp60to63)}</strong>.
                  </li>
                  <li>
                    If you earned more than {fmtMoney(CONTRIBUTION_LIMITS.rothCatchUpWageThreshold)} in the previous
                    year, catch-up contributions must go in as Roth. This calculator uses your current salary for that
                    test, since it doesn't ask for last year's wages.
                  </li>
                </ul>
                <a
                  href={CONTRIBUTION_LIMITS.source}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ display: "inline-block", marginTop: "0.35rem", color: "#2A7D9C" }}
                >
                  Source: TSP contribution limits
                </a>
              </details>
            </div>
          </Card>

          {/* Future allocation */}
          <Card>
            <CardTitle hint="How new contributions are split across funds. Must add up to 100%.">
              Future contribution allocation
            </CardTitle>
            {allocation.map((row, i) => (
              <Row key={row.id}>
                <div style={{ flex: "1 1 150px" }}>
                  <label htmlFor={`${row.id}-fund`} style={labelStyle}>
                    Fund
                  </label>
                  <FundSelect
                    id={`${row.id}-fund`}
                    funds={funds}
                    value={row.fund}
                    onChange={(fund) => updateAllocation(row.id, { fund })}
                  />
                </div>
                <div style={{ flex: "0 1 110px" }}>
                  <label htmlFor={`${row.id}-pct`} style={labelStyle}>
                    Percent
                  </label>
                  <div style={{ position: "relative" }}>
                    <input
                      id={`${row.id}-pct`}
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={100}
                      step={1}
                      placeholder="0"
                      value={row.percent === 0 ? "" : row.percent}
                      onChange={(e) =>
                        updateAllocation(row.id, {
                          percent:
                            e.target.value === "" ? 0 : Math.min(100, Math.max(0, Math.round(Number(e.target.value)))),
                        })
                      }
                      style={{ ...inputStyle, paddingRight: "1.6rem" }}
                    />
                    <span
                      aria-hidden="true"
                      style={{
                        position: "absolute",
                        right: "0.6rem",
                        top: "50%",
                        transform: "translateY(-50%)",
                        color: "#94a3b8",
                        fontSize: "0.85rem",
                      }}
                    >
                      %
                    </span>
                  </div>
                </div>
                {allocation.length > 1 ? (
                  <RemoveButton label={`Remove allocation row ${i + 1}`} onClick={() => removeAllocation(row.id)} />
                ) : (
                  <span style={{ width: CONTROL_HEIGHT }} aria-hidden="true" />
                )}
              </Row>
            ))}
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "0.75rem",
              }}
            >
              <AddButton onClick={addAllocation}>Add fund</AddButton>
              <span
                role="status"
                style={{
                  marginTop: "0.75rem",
                  padding: "0.3rem 0.7rem",
                  borderRadius: "999px",
                  fontSize: "0.8rem",
                  fontWeight: 600,
                  color: allocStatus.color,
                  background: allocStatus.bg,
                }}
              >
                {allocStatus.text}
              </span>
            </div>
            {allocCheck.duplicates.length > 0 && (
              <div style={{ marginTop: "0.6rem", fontSize: "0.8rem", color: "#92400e" }}>
                {allocCheck.duplicates.map(fundLabel).join(", ")} {allocCheck.duplicates.length > 1 ? "are" : "is"}{" "}
                listed more than once; combine them into one row.
              </div>
            )}
          </Card>

          {/* Horizon */}
          <Card>
            <label htmlFor="horizon" style={{ ...labelStyle, fontSize: "0.75rem" }}>
              Projection horizon
            </label>
            <select
              id="horizon"
              value={horizon}
              onChange={(e) => setHorizon(Number(e.target.value))}
              style={{ ...inputStyle, maxWidth: "220px", cursor: "pointer" }}
            >
              {HORIZON_OPTIONS.map((y) => (
                <option key={y} value={y}>
                  {y} years
                </option>
              ))}
            </select>
          </Card>
        </div>

        {/* Summary of inputs — becomes the results panel once the projection is built */}
        <Card style={{ position: "sticky", top: "1rem" }}>
          <CardTitle>Your inputs</CardTitle>
          <dl style={{ margin: 0, display: "grid", gridTemplateColumns: "1fr auto", rowGap: "0.5rem", fontSize: "0.9rem" }}>
            <dt style={{ color: "#64748b" }}>Current balance</dt>
            <dd style={{ margin: 0, fontWeight: 700, color: "#0F2244", textAlign: "right" }}>{fmtMoney(summary.total)}</dd>
            <dt style={{ color: "#64748b", paddingLeft: "0.75rem" }}>Traditional</dt>
            <dd style={{ margin: 0, textAlign: "right" }}>{fmtMoney(summary.traditional)}</dd>
            <dt style={{ color: "#64748b", paddingLeft: "0.75rem" }}>Roth</dt>
            <dd style={{ margin: 0, textAlign: "right" }}>{fmtMoney(summary.roth)}</dd>
            <dt style={{ color: "#64748b" }}>Age</dt>
            <dd style={{ margin: 0, textAlign: "right" }}>{age ?? "—"}</dd>
            <dt style={{ color: "#64748b" }}>Salary</dt>
            <dd style={{ margin: 0, textAlign: "right" }}>{fmtMoney(salary)}</dd>
            <dt style={{ color: "#64748b" }}>Your contributions</dt>
            <dd style={{ margin: 0, textAlign: "right", color: overLimit ? "#92400e" : undefined }}>
              {fmtMoney(breakdown.employeeTotal)}/yr
            </dd>
            <dt style={{ color: "#64748b" }}>Agency contributions</dt>
            <dd style={{ margin: 0, textAlign: "right" }}>{fmtMoney(breakdown.agencyTotal)}/yr</dd>
            <dt style={{ color: "#64748b" }}>Future allocation</dt>
            <dd style={{ margin: 0, textAlign: "right", color: allocCheck.isComplete ? "#166534" : "#92400e", fontWeight: 600 }}>
              {fmtPct(allocCheck.total)}
            </dd>
            <dt style={{ color: "#64748b" }}>Horizon</dt>
            <dd style={{ margin: 0, textAlign: "right" }}>{horizon} years</dd>
          </dl>
          <div
            style={{
              marginTop: "1.25rem",
              padding: "0.9rem",
              borderRadius: "0.5rem",
              background: "#f5f9fe",
              border: "1px solid #cfe0f5",
              fontSize: "0.85rem",
              lineHeight: 1.5,
              color: "#1e293b",
            }}
          >
            {projection ? (
              <>
                <div style={{ color: "#64748b" }}>Average projected balance by {endYear}</div>
                <div style={{ fontSize: "1.5rem", fontWeight: 800, color: "#0F2244", fontVariantNumeric: "tabular-nums" }}>
                  {fmtMoney(projection.average.total)}
                </div>
                <div style={{ color: "#64748b", fontSize: "0.8rem" }}>
                  Range {fmtMoney(projection.below.total)} to {fmtMoney(projection.above.total)}
                </div>
              </>
            ) : (
              <span style={{ color: "#64748b" }}>
                Enter a balance or contributions to see your projected balance.
              </span>
            )}
          </div>
        </Card>
      </div>

      {/* Projected balance */}
      <Card style={{ marginTop: "1.5rem" }}>
        <CardTitle hint="Your balances and contributions grown by replaying real TSP monthly returns 2,000 times.">
          Projected balance by {endYear}
        </CardTitle>
        {returnsError ? (
          <div style={{ fontSize: "0.85rem", color: "#dc2626" }}>
            Couldn't load TSP historical returns. Try refreshing the page.
          </div>
        ) : !hasMoney ? (
          <div style={{ fontSize: "0.85rem", color: "#64748b" }}>
            Enter your balances or contributions to see a projection.
          </div>
        ) : !projection ? (
          <div style={{ fontSize: "0.85rem", color: "#94a3b8" }}>Running simulation…</div>
        ) : (
          <div style={{ opacity: simPending ? 0.6 : 1, transition: "opacity 150ms" }}>
            {!allocCheck.isComplete && yearRows.some((r) => r.total > 0) && (
              <div
                style={{
                  marginBottom: "0.9rem",
                  padding: "0.6rem 0.8rem",
                  borderRadius: "0.5rem",
                  background: "#fffbeb",
                  border: "1px solid #fde68a",
                  color: "#92400e",
                  fontSize: "0.82rem",
                }}
              >
                Your future allocation adds up to {fmtPct(allocCheck.total)}, not 100%. The projection spreads new
                contributions in the same proportions until you fix it.
              </div>
            )}
            <ScenarioTiles
              below={projection.below}
              average={projection.average}
              above={projection.above}
              contributed={projection.contributed[projection.contributed.length - 1]}
            />
            <ProjectionChart result={projection} firstYear={CONTRIBUTION_LIMITS.year} startAge={age} />
            <details style={{ marginTop: "0.6rem", fontSize: "0.8rem", color: "#475569", lineHeight: 1.6 }}>
              <summary style={{ cursor: "pointer", fontWeight: 600, color: "#2A7D9C" }}>How the projection works</summary>
              <ul style={{ margin: "0.4rem 0 0", paddingLeft: "1.1rem", listStyle: "disc" }}>
                <li>
                  Each of {projection.trials.toLocaleString()} simulated futures is built month by month from randomly
                  chosen real months of TSP history ({projection.poolSize} months,{" "}
                  {fmtMonth(projection.poolStart)} to {fmtMonth(projection.poolEnd)}). Every fund gets that same month's actual return, so
                  funds rise and fall together the way they really did.
                </li>
                <li>
                  Only months where all of your funds existed are used; adding a newer fund (such as a recent L Fund)
                  shortens the history the simulation draws from.
                </li>
                <li>
                  <strong>Below average</strong>, <strong>average</strong> and <strong>above average</strong> are the
                  25th, 50th and 75th percentiles: a quarter of outcomes ended below the first, half below the second,
                  and a quarter above the third. The light band covers 8 in 10 outcomes.
                </li>
                <li>
                  Today's balances stay in the funds they're in (no rebalancing). Each year's contributions, from the
                  table below, go in monthly and are split by your future allocation.
                </li>
                <li>
                  Figures are in future dollars, not adjusted for inflation, and assume no withdrawals. Past returns
                  don't guarantee future results.
                </li>
              </ul>
            </details>
          </div>
        )}
      </Card>

      {/* Contributions over the horizon: summary always visible, year-by-year table collapsed */}
      <Card style={{ marginTop: "1.5rem" }}>
        <CardTitle hint="What goes in each year, starting from today's balances. Investment growth isn't included yet.">
          Contributions over {horizon} years
        </CardTitle>
        {salary === 0 && contribMode === "percent" && summary.total === 0 ? (
          <div style={{ fontSize: "0.85rem", color: "#64748b" }}>
            Enter your balances and salary to see contributions year by year.
          </div>
        ) : (
          <>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem 1.5rem", fontSize: "0.9rem" }}>
              <span>
                <span style={{ color: "#64748b" }}>Contributed: </span>
                <strong>{fmtMoney(yearRows.reduce((t, r) => t + r.total, 0))}</strong>
              </span>
              {yearRows.length > 0 && (
                <span>
                  <span style={{ color: "#64748b" }}>Total by {yearRows[yearRows.length - 1].year}, before growth: </span>
                  <strong>
                    {fmtMoney(
                      yearRows[yearRows.length - 1].cumulativeTraditional + yearRows[yearRows.length - 1].cumulativeRoth,
                    )}
                  </strong>
                  <span style={{ color: "#94a3b8" }}>
                    {" "}
                    (Traditional {fmtMoney(yearRows[yearRows.length - 1].cumulativeTraditional)} · Roth{" "}
                    {fmtMoney(yearRows[yearRows.length - 1].cumulativeRoth)})
                  </span>
                </span>
              )}
            </div>
            <details
              style={{ marginTop: "0.9rem" }}
              onToggle={(e) => setYearsOpen(e.currentTarget.open)}
            >
              <summary style={{ cursor: "pointer", fontSize: "0.85rem", fontWeight: 600, color: "#2A7D9C" }}>
                {yearsOpen ? "Hide" : "Show"} year-by-year table
              </summary>
              <div style={{ marginTop: "0.75rem" }}>
                <ContributionsOverTime rows={yearRows} start={startBalances} />
              </div>
            </details>
          </>
        )}
      </Card>

      {/* Where the money goes */}
      <Card style={{ marginTop: "1.5rem" }}>
        <CardTitle hint={`One year of contributions at ${CONTRIBUTION_LIMITS.year} limits, applied paycheck by paycheck over 26 pay periods.`}>
          Where your contributions go
        </CardTitle>
        {salary === 0 && contribMode === "percent" ? (
          <div style={{ fontSize: "0.85rem", color: "#64748b" }}>Enter your salary to see the breakdown.</div>
        ) : (
          <BreakdownTable breakdown={breakdown} age={age} />
        )}
        {breakdown.traditionalRedirectedToRoth > 0.5 && (
          <div
            role="status"
            style={{
              marginTop: "0.9rem",
              padding: "0.7rem 0.9rem",
              borderRadius: "0.5rem",
              background: "#ecfdf5",
              border: "1px solid #a7f3d0",
              color: "#065f46",
              fontSize: "0.83rem",
              lineHeight: 1.55,
            }}
          >
            <strong>{fmtMoney(breakdown.traditionalRedirectedToRoth)}</strong> of your Traditional election goes in as
            Roth. At {age} with a salary over {fmtMoney(CONTRIBUTION_LIMITS.rothCatchUpWageThreshold)}, your{" "}
            {fmtMoney(breakdown.catchUpRoth)} of catch-up (everything above the{" "}
            {fmtMoney(CONTRIBUTION_LIMITS.elective)} regular limit) has to be Roth, and your Roth election covers only{" "}
            {fmtMoney(breakdown.catchUpRoth - breakdown.traditionalRedirectedToRoth)} of it.
          </div>
        )}
        {overLimit && (
          <div
            role="status"
            style={{
              marginTop: "0.9rem",
              padding: "0.7rem 0.9rem",
              borderRadius: "0.5rem",
              background: "#fffbeb",
              border: "1px solid #fde68a",
              color: "#92400e",
              fontSize: "0.83rem",
              lineHeight: 1.55,
            }}
          >
            You'd reach your {fmtMoney(myLimit)} limit in pay period {breakdown.limitReachedPeriod} of 26, so{" "}
            {fmtMoney(breakdown.notContributed)} of your election isn't contributed.
            {breakdown.matchLost > 0.5 && (
              <>
                {" "}
                Agency matching stops with your contributions, which costs{" "}
                <strong>{fmtMoney(breakdown.matchLost)}</strong> of match.
                {salary > 0 && spreadPct >= 5 && (
                  <>
                    {" "}
                    Contributing {spreadPct}% in total instead spreads the limit across the whole year and keeps the
                    full match.
                  </>
                )}
              </>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}

/**
 * TspProjection.tsx
 *
 * TSP Projection Calculator: inputs only so far.
 *   - Current balances: one row per fund holding (fund, amount, Roth or
 *     Traditional), starting with a single C Fund row; "+ Add fund" adds more.
 *   - Contributions: current age, salary, Roth share, and the contribution
 *     as a percent of salary or a dollar amount per year, with the current
 *     IRS limits alongside.
 *   - Where your contributions go: a year of contributions split into
 *     regular / catch-up / agency, Traditional vs Roth, with anything over
 *     the limit and any agency match lost by hitting it early.
 *   - Future allocation: how new contributions are split across funds, one
 *     row per fund, which must add up to 100%.
 *   - Projection horizon: a fixed list of year spans.
 * The projection itself is still to come; the right-hand panel summarizes
 * the inputs in the meantime.
 */

import { useEffect, useState } from "react";
import ErrorBoundary from "./ErrorBoundary";
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
  summarizeHoldings,
  type AllocationRow,
  type ContributionMode,
  type HoldingRow,
} from "../lib/tspProjection";

const fmtMoney = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);

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
        : "Only after the regular limit is full";

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
    </div>
  );
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
  const [age, setAge] = useState<number | null>(null);
  const [salary, setSalary] = useState(0);
  // Most FERS employees contribute 5%, the level that earns the full agency match.
  const [contribPct, setContribPct] = useState(5);
  const [contribMode, setContribMode] = useState<ContributionMode>("percent");
  const [contribDollars, setContribDollars] = useState(0);
  const [rothPct, setRothPct] = useState(0);

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
  const breakdown = contributionBreakdown({
    salary,
    mode: contribMode,
    percent: contribPct,
    dollarsPerYear: contribDollars,
    rothPercent: rothPct,
    age,
  });
  const overLimit = breakdown.notContributed > 0.5;
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
              <div style={{ flex: "0 1 130px" }}>
                <label htmlFor="roth-pct" style={labelStyle}>
                  Roth share
                </label>
                <PercentInput id="roth-pct" value={rothPct} onChange={setRothPct} />
              </div>
            </div>
            <div
              style={{ display: "flex", flexWrap: "wrap", gap: "0.6rem", alignItems: "flex-end", marginTop: "0.9rem" }}
            >
              <div>
                <span style={labelStyle}>Contribute as</span>
                <ModeToggle mode={contribMode} onChange={setContribMode} />
              </div>
              {contribMode === "percent" ? (
                <div style={{ flex: "0 1 130px" }}>
                  <label htmlFor="contrib-pct" style={labelStyle}>
                    Contribution
                  </label>
                  <PercentInput id="contrib-pct" value={contribPct} onChange={setContribPct} />
                </div>
              ) : (
                <div style={{ flex: "0 1 160px" }}>
                  <label htmlFor="contrib-dollars" style={labelStyle}>
                    Amount per year ($)
                  </label>
                  <input
                    id="contrib-dollars"
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step={500}
                    placeholder="0"
                    value={contribDollars === 0 ? "" : contribDollars}
                    onChange={(e) =>
                      setContribDollars(e.target.value === "" ? 0 : Math.max(0, Number(e.target.value)))
                    }
                    style={inputStyle}
                  />
                </div>
              )}
            </div>
            <div style={{ marginTop: "0.5rem", fontSize: "0.8rem", color: "#64748b" }}>
              Roth share is the part of your own contributions you elect as Roth; the rest is Traditional.
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
              <div style={{ fontWeight: 700, color: "#1e293b", marginBottom: "0.25rem" }}>
                {CONTRIBUTION_LIMITS.year} contribution limits
              </div>
              <ul style={{ margin: 0, paddingLeft: "1.1rem", listStyle: "disc" }}>
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
              {age != null && (
                <div style={{ marginTop: "0.5rem", color: "#1e293b" }}>
                  At {age}, your limit is <strong>{fmtMoney(myLimit)}</strong>
                  {catchUp > 0
                    ? ` (${fmtMoney(CONTRIBUTION_LIMITS.elective)} + ${fmtMoney(catchUp)} catch-up).`
                    : "."}
                </div>
              )}
              <a
                href={CONTRIBUTION_LIMITS.source}
                target="_blank"
                rel="noopener noreferrer"
                style={{ display: "inline-block", marginTop: "0.35rem", color: "#2A7D9C" }}
              >
                Source: TSP contribution limits
              </a>
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
              background: "#f8fafc",
              border: "1px dashed #cbd5e1",
              color: "#64748b",
              fontSize: "0.85rem",
              lineHeight: 1.5,
            }}
          >
            The projection (contributions, agency match and growth) is still being built. Results will appear here.
          </div>
        </Card>
      </div>

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
                  <> Contributing {spreadPct}% instead spreads the limit across the whole year and keeps the full match.</>
                )}
              </>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}

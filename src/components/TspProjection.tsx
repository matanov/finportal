/**
 * TspProjection.tsx
 *
 * TSP Projection Calculator: inputs only so far.
 *   - Current balances: one row per fund holding (fund, amount, Roth or
 *     Traditional), starting with a single C Fund row; "+ Add fund" adds more.
 *   - Contributions: current age, annual salary and the percent of it
 *     contributed, with the current IRS limits shown alongside. Age sets
 *     the catch-up the person qualifies for (and will drive tax treatment
 *     in the projection).
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
  annualContribution,
  checkAllocation,
  employeeLimit,
  fundLabel,
  newId,
  orderFunds,
  summarizeHoldings,
  type AllocationRow,
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
  const yearlyContribution = annualContribution(salary, contribPct);
  const { limit: myLimit, catchUp } = employeeLimit(age);
  const overLimit = yearlyContribution > myLimit;
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
            <CardTitle hint="Your own contributions, as a percent of base salary.">Contributions</CardTitle>
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
                <label htmlFor="contrib-pct" style={labelStyle}>
                  Contribution
                </label>
                <div style={{ position: "relative" }}>
                  <input
                    id="contrib-pct"
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={100}
                    step={1}
                    placeholder="0"
                    value={contribPct === 0 ? "" : contribPct}
                    onChange={(e) =>
                      setContribPct(
                        e.target.value === "" ? 0 : Math.min(100, Math.max(0, Math.round(Number(e.target.value)))),
                      )
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
            </div>
            {salary > 0 && (
              <div
                role="status"
                style={{ marginTop: "0.75rem", fontSize: "0.85rem", color: overLimit ? "#92400e" : "#1e293b" }}
              >
                {fmtMoney(yearlyContribution)} a year
                {overLimit &&
                  ` — above your ${CONTRIBUTION_LIMITS.year} limit of ${fmtMoney(myLimit)}, so contributions would stop once you reach it.`}
              </div>
            )}
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
                  year, catch-up contributions must go in as Roth.
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
              {fmtMoney(yearlyContribution)}/yr ({contribPct}%)
            </dd>
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
    </div>
  );
}

/**
 * TspProjectionReport.tsx
 *
 * Print-only summary of the TSP Projection Calculator. It is always rendered
 * but hidden on screen (`print-only`, see the print rules in global.css), and
 * the interactive calculator is hidden when printing (`screen-only`), so
 * "Print / Save as PDF" produces a clean report with no extra libraries: the
 * browser's own print dialog does the PDF.
 *
 * Everything shown here is passed in from TspProjection, so the report always
 * matches what's on screen, including the today's-dollars setting.
 */

import ProjectionChart from "./ProjectionChart";
import { fundLabel, type AllocationRow, type ContributionBreakdown, type ContributionYear, type HoldingRow } from "../lib/tspProjection";
import type { SimulationResult } from "../lib/tspSimulation";

const fmtMoney = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

const INK = "#1e293b";
const MUTED = "#64748b";

/** Width of the printable area on a US Letter / A4 page at the report's margins, in CSS pixels */
const PRINT_WIDTH = 690;

const th: React.CSSProperties = {
  textAlign: "right",
  padding: "0.25rem 0.4rem",
  borderBottom: "1.5px solid #cbd5e1",
  fontSize: "8.5pt",
  color: MUTED,
  fontWeight: 600,
};
const td: React.CSSProperties = {
  textAlign: "right",
  padding: "0.2rem 0.4rem",
  borderBottom: "1px solid #e2e8f0",
  fontVariantNumeric: "tabular-nums",
};

function Heading({ children }: { children: React.ReactNode }) {
  return (
    <h2
      style={{
        fontFamily: "Inter, system-ui, sans-serif",
        fontSize: "12pt",
        fontWeight: 700,
        color: "#0F2244",
        margin: "1.1rem 0 0.4rem",
        breakAfter: "avoid",
        letterSpacing: 0,
      }}
    >
      {children}
    </h2>
  );
}

function KeyValues({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <table style={{ borderCollapse: "collapse", width: "100%" }}>
      <tbody>
        {rows.map(([k, v]) => (
          <tr key={k}>
            <td style={{ ...td, textAlign: "left", color: MUTED, width: "45%" }}>{k}</td>
            <td style={{ ...td, textAlign: "left" }}>{v}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function TspProjectionReport({
  holdings,
  balances,
  age,
  salary,
  electionText,
  allocation,
  horizon,
  retireAge,
  retireIndex,
  todaysDollars,
  inflationPct,
  firstYear,
  breakdown,
  yearRows,
  result,
}: {
  holdings: HoldingRow[];
  balances: { total: number; traditional: number; roth: number };
  age: number | null;
  salary: number;
  /** e.g. "10% Traditional + 5% Roth of salary" */
  electionText: string;
  allocation: AllocationRow[];
  horizon: number;
  retireAge: number | null;
  retireIndex: number;
  todaysDollars: boolean;
  inflationPct: number;
  firstYear: number;
  breakdown: ContributionBreakdown;
  yearRows: ContributionYear[];
  /** Projection as shown on screen (already converted to today's dollars if selected), or null */
  result: SimulationResult | null;
}) {
  const endYear = firstYear + horizon;
  const printed = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  const heldRows = holdings.filter((h) => h.amount > 0);
  const allocRows = allocation.filter((a) => a.percent > 0);
  const dollarsNote = todaysDollars ? ` in today's dollars (${inflationPct}% inflation a year)` : " in future dollars";
  const yourTrad = breakdown.regularTraditional + breakdown.catchUpTraditional;
  const yourRoth = breakdown.regularRoth + breakdown.catchUpRoth;

  return (
    <div
      className="print-only"
      style={{ fontFamily: "Inter, system-ui, sans-serif", color: INK, fontSize: "9.5pt", lineHeight: 1.45 }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-end",
          borderBottom: "2px solid #0F2244",
          paddingBottom: "0.4rem",
        }}
      >
        <div>
          <div style={{ fontSize: "8.5pt", fontWeight: 700, color: "#C9A035", letterSpacing: "0.06em" }}>FERSMATH</div>
          <div style={{ fontSize: "16pt", fontWeight: 800, color: "#0F2244" }}>TSP Projection</div>
        </div>
        <div style={{ textAlign: "right", fontSize: "8.5pt", color: MUTED }}>
          Prepared {printed}
          <br />
          fersmath.com/tsp/projection
        </div>
      </div>

      {/* Inputs */}
      <Heading>Your inputs</Heading>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", breakInside: "avoid" }}>
        <div>
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead>
              <tr>
                <th style={{ ...th, textAlign: "left" }}>Current balance</th>
                <th style={{ ...th, textAlign: "left" }}>Type</th>
                <th style={th}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {heldRows.length === 0 ? (
                <tr>
                  <td style={{ ...td, textAlign: "left" }} colSpan={3}>
                    None entered
                  </td>
                </tr>
              ) : (
                heldRows.map((h) => (
                  <tr key={h.id}>
                    <td style={{ ...td, textAlign: "left" }}>{fundLabel(h.fund)}</td>
                    <td style={{ ...td, textAlign: "left" }}>{h.roth ? "Roth" : "Traditional"}</td>
                    <td style={td}>{fmtMoney(h.amount)}</td>
                  </tr>
                ))
              )}
              <tr>
                <td style={{ ...td, textAlign: "left", fontWeight: 700 }} colSpan={2}>
                  Total (Traditional {fmtMoney(balances.traditional)} · Roth {fmtMoney(balances.roth)})
                </td>
                <td style={{ ...td, fontWeight: 700 }}>{fmtMoney(balances.total)}</td>
              </tr>
            </tbody>
          </table>
          <div style={{ marginTop: "0.6rem" }}>
            <KeyValues
              rows={[
                [
                  "Future contribution allocation",
                  allocRows.length ? allocRows.map((a) => `${fundLabel(a.fund)} ${a.percent}%`).join(", ") : "None",
                ],
              ]}
            />
          </div>
        </div>
        <KeyValues
          rows={[
            ["Current age", age ?? "Not entered"],
            ["Annual salary", salary > 0 ? fmtMoney(salary) : "Not entered"],
            ["Your contributions", electionText],
            ["Retire at", retireAge != null && age != null ? `Age ${retireAge}` : "Not set"],
            ["Projection horizon", `${horizon} years (to ${endYear})`],
            ["Amounts shown", todaysDollars ? `Today's dollars, ${inflationPct}% inflation` : "Future dollars"],
          ]}
        />
      </div>

      {/* Projection */}
      <Heading>
        Projected balance by {endYear}
        <span style={{ fontWeight: 500, color: MUTED, fontSize: "9pt" }}>{dollarsNote}</span>
      </Heading>
      {result ? (
        <div style={{ breakInside: "avoid" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "0.5rem", marginBottom: "0.6rem" }}>
            {(
              [
                ["Below average", result.below, "1 in 4 outcomes were lower"],
                ["Average", result.average, "Half of outcomes were lower"],
                ["Above average", result.above, "1 in 4 outcomes were higher"],
              ] as const
            ).map(([label, s, hint]) => (
              <div
                key={label}
                style={{
                  border: label === "Average" ? "2px solid #2a78d6" : "1px solid #cbd5e1",
                  borderRadius: "6px",
                  padding: "0.45rem 0.6rem",
                }}
              >
                <div style={{ fontSize: "7.5pt", fontWeight: 700, color: MUTED, textTransform: "uppercase" }}>{label}</div>
                <div style={{ fontSize: "14pt", fontWeight: 800, color: "#0F2244" }}>{fmtMoney(s.total)}</div>
                <div style={{ fontSize: "8pt", color: "#475569" }}>
                  Traditional {fmtMoney(s.traditional)} · Roth {fmtMoney(s.roth)}
                </div>
                <div style={{ fontSize: "7.5pt", color: MUTED }}>{hint}</div>
              </div>
            ))}
          </div>
          <ProjectionChart
            result={result}
            firstYear={firstYear}
            startAge={age}
            retireIndex={retireIndex > 0 ? retireIndex : null}
            fixedWidth={PRINT_WIDTH}
            printMode
          />
        </div>
      ) : (
        <div style={{ color: MUTED }}>Enter balances or contributions to see a projection.</div>
      )}

      {/* This year's contributions */}
      <Heading>This year's contributions ({firstYear})</Heading>
      <table style={{ borderCollapse: "collapse", width: "100%", breakInside: "avoid" }}>
        <thead>
          <tr>
            <th style={{ ...th, textAlign: "left" }}>Contribution</th>
            <th style={{ ...th, textAlign: "left" }}>Tax treatment</th>
            <th style={th}>Per pay period</th>
            <th style={th}>Per month</th>
            <th style={th}>Per year</th>
          </tr>
        </thead>
        <tbody>
          {(
            [
              ["Yours", "Traditional", yourTrad],
              ["Yours", "Roth", yourRoth],
              ["Agency automatic (1%)", "Traditional", breakdown.agencyAutomatic],
              ["Agency match", "Traditional", breakdown.agencyMatch],
            ] as const
          ).map(([who, type, v]) => (
            <tr key={who + type}>
              <td style={{ ...td, textAlign: "left" }}>{who}</td>
              <td style={{ ...td, textAlign: "left" }}>{type}</td>
              <td style={td}>{fmtMoney(v / 26)}</td>
              <td style={td}>{fmtMoney(v / 12)}</td>
              <td style={td}>{fmtMoney(v)}</td>
            </tr>
          ))}
          <tr>
            <td style={{ ...td, textAlign: "left", fontWeight: 700 }} colSpan={2}>
              Total going in
            </td>
            <td style={{ ...td, fontWeight: 700 }}>{fmtMoney(breakdown.total / 26)}</td>
            <td style={{ ...td, fontWeight: 700 }}>{fmtMoney(breakdown.total / 12)}</td>
            <td style={{ ...td, fontWeight: 700 }}>{fmtMoney(breakdown.total)}</td>
          </tr>
        </tbody>
      </table>
      {(breakdown.notContributed > 0.5 || breakdown.matchLost > 0.5 || breakdown.traditionalRedirectedToRoth > 0.5) && (
        <ul style={{ margin: "0.35rem 0 0", paddingLeft: "1.1rem", listStyle: "disc", color: "#92400e", fontSize: "8.5pt" }}>
          {breakdown.traditionalRedirectedToRoth > 0.5 && (
            <li>
              {fmtMoney(breakdown.traditionalRedirectedToRoth)} of the Traditional election goes in as Roth: catch-up
              contributions must be Roth above a $150,000 salary.
            </li>
          )}
          {breakdown.notContributed > 0.5 && (
            <li>
              The election reaches the {fmtMoney(breakdown.limit)} limit in pay period {breakdown.limitReachedPeriod};{" "}
              {fmtMoney(breakdown.notContributed)} isn't contributed
              {breakdown.catchUpLimit === 0 && breakdown.matchLost > 0.5
                ? ` and ${fmtMoney(breakdown.matchLost)} of agency match is lost`
                : ""}
              .
            </li>
          )}
          {breakdown.catchUpLimit > 0 && breakdown.matchLost > 0.5 && (
            <li>
              Agency match applies only to regular contributions, not catch-up: it stops when the{" "}
              {fmtMoney(breakdown.limit - breakdown.catchUpLimit)} regular limit is reached in pay period{" "}
              {breakdown.regularLimitPeriod}, which loses {fmtMoney(breakdown.matchLost)} of match.
            </li>
          )}
        </ul>
      )}

      {/* Year by year */}
      <Heading>Year by year</Heading>
      <table style={{ borderCollapse: "collapse", width: "100%" }}>
        <thead style={{ display: "table-header-group" }}>
          <tr>
            <th style={{ ...th, textAlign: "left" }}>Year</th>
            <th style={{ ...th, textAlign: "left" }}>Age</th>
            <th style={th}>Put in that year</th>
            <th style={th}>Total put in</th>
            {result && (
              <>
                <th style={th}>Below avg. (end of year)</th>
                <th style={th}>Average</th>
                <th style={th}>Above avg.</th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {yearRows.map((r, i) => (
            <tr key={r.year} style={{ breakInside: "avoid" }}>
              <td style={{ ...td, textAlign: "left" }}>{r.year}</td>
              <td style={{ ...td, textAlign: "left" }}>
                {r.age ?? "—"}
                {r.retired ? " (retired)" : ""}
              </td>
              <td style={td}>{fmtMoney(r.total)}</td>
              <td style={td}>{fmtMoney(r.cumulativeTraditional + r.cumulativeRoth)}</td>
              {result && (
                <>
                  <td style={td}>{fmtMoney(result.bands[i + 1].p25)}</td>
                  <td style={{ ...td, fontWeight: 700 }}>{fmtMoney(result.bands[i + 1].p50)}</td>
                  <td style={td}>{fmtMoney(result.bands[i + 1].p75)}</td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {todaysDollars && result && (
        <div style={{ fontSize: "8pt", color: MUTED, marginTop: "0.25rem" }}>
          Balances are in today's dollars; "put in" figures are the amounts actually contributed, not adjusted.
        </div>
      )}

      {/* Assumptions */}
      <Heading>How this was calculated</Heading>
      <ul style={{ margin: 0, paddingLeft: "1.1rem", listStyle: "disc", fontSize: "8.5pt", color: "#475569" }}>
        <li>
          Contributions follow the {firstYear} IRS limits ($24,500 regular, plus catch-up from age 50), applied paycheck
          by paycheck over 26 pay periods, with FERS agency contributions (1% automatic plus up to 4% matching on regular contributions; catch-up is not matched). Salary
          and limits are held flat.
        </li>
        {result && (
          <li>
            The projection replays randomly chosen real months of TSP history ({result.trials.toLocaleString()}{" "}
            simulations, {result.poolSize} months of data). Below average, average and above average are the 25th,
            50th and 75th percentiles of the results.
          </li>
        )}
        <li>
          Today's balances stay in their funds (no rebalancing); new contributions follow your allocation. No
          withdrawals are assumed{retireAge != null && age != null ? "; contributions stop at the retirement age" : ""}.
        </li>
        <li>
          This is an educational estimate, not financial advice. Past returns don't guarantee future results. Check
          your figures with your TSP statement and agency HR.
        </li>
      </ul>
    </div>
  );
}

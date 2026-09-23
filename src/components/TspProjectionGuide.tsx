/**
 * TspProjectionGuide.tsx
 *
 * Collapsible "Where to find these numbers" guide for the TSP Projection
 * Calculator: for each input, where it appears on the TSP statement, on the
 * Earnings and Leave Statement (LES) and other pay documents, and online.
 * Screen and field names differ between agencies and change over time, so
 * the wording describes what to look for rather than exact button labels.
 */

const TSP_URL = "https://www.tsp.gov/";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ padding: "0.85rem 0", borderTop: "1px solid #f1f5f9" }}>
      <div style={{ fontWeight: 700, color: "#0F2244", marginBottom: "0.35rem" }}>{title}</div>
      <ul style={{ margin: 0, paddingLeft: "1.1rem", listStyle: "disc", display: "grid", gap: "0.3rem" }}>
        {children}
      </ul>
    </div>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        display: "inline-block",
        fontSize: "0.68rem",
        fontWeight: 700,
        textTransform: "uppercase",
        letterSpacing: "0.04em",
        color: "#2A7D9C",
        background: "#eef6f9",
        borderRadius: "999px",
        padding: "0.05rem 0.45rem",
        marginRight: "0.35rem",
      }}
    >
      {children}
    </span>
  );
}

export default function TspProjectionGuide() {
  return (
    <details
      style={{
        background: "#fff",
        border: "1px solid #e2e8f0",
        borderRadius: "0.75rem",
        padding: "0.9rem 1.25rem",
        marginBottom: "1.5rem",
        fontSize: "0.88rem",
        color: "#334155",
        lineHeight: 1.6,
      }}
    >
      <summary style={{ cursor: "pointer", fontWeight: 700, color: "#2A7D9C" }}>
        Where to find these numbers: your TSP statement, pay statement, and tsp.gov
      </summary>

      <p style={{ margin: "0.75rem 0 0.25rem", color: "#64748b" }}>
        Everything this calculator asks for is on two documents you already get: your{" "}
        <strong>TSP statement</strong> (quarterly and annual, online, and in the mail if you still receive paper
        statements) and your <strong>Earnings and Leave Statement (LES)</strong>, the pay statement your payroll
        office issues every pay period. Screen and field names vary by agency, so look for the descriptions below
        rather than exact labels.
      </p>

      <Section title="Current balances (fund, amount, Roth)">
        <li>
          <Tag>Online</Tag>
          Log in to your account at{" "}
          <a href={TSP_URL} target="_blank" rel="noopener noreferrer" style={{ color: "#2A7D9C" }}>
            tsp.gov
          </a>{" "}
          and open your account balance details. They list each fund you hold, and for each fund how much is
          Traditional and how much is Roth.
        </li>
        <li>
          <Tag>Statement</Tag>
          Your TSP statement has a section showing your balance in each fund, split into Traditional and Roth
          (it may call these balances by tax treatment or by source).
        </li>
        <li>
          Enter one row per fund. If a fund holds both Traditional and Roth money, add it twice and tick
          <strong> Roth</strong> on the Roth row. Use the latest balances you have; the projection starts from
          whatever you enter.
        </li>
      </Section>

      <Section title="Annual salary">
        <li>
          <Tag>LES</Tag>
          Your pay statement shows your annual salary or annual rate of basic pay, including locality pay. Use
          that figure, not your year-to-date earnings, and leave out overtime and bonuses.
        </li>
        <li>
          <Tag>SF-50</Tag>
          Your latest Notification of Personnel Action (SF-50) shows the same figure as adjusted basic pay.
        </li>
        <li>
          <Tag>W-2</Tag>
          The Roth catch-up rule really uses last year's Social Security wages, box 3 of your W-2. This
          calculator uses your current salary instead; if the two are on different sides of{" "}
          $150,000, keep that in mind.
        </li>
      </Section>

      <Section title="Traditional and Roth contributions">
        <li>
          <Tag>LES</Tag>
          The deductions section shows a TSP line (Traditional) and a TSP Roth line with the amount taken from each
          paycheck; many agencies also show the percentage you elected. Enter the percentages with{" "}
          <strong>% of salary</strong>, or multiply each paycheck amount by 26 and use <strong>$ per year</strong>.
        </li>
        <li>
          <Tag>Online</Tag>
          Your election is set, and can be viewed, in your agency's payroll self-service system (for example
          Employee Express, myPay, or the NFC Employee Personal Page), not on tsp.gov.
        </li>
        <li>
          If you've already made contributions this year, the calculator still works a full year at your election;
          the year-to-date TSP totals on your LES help you see how close you are to the limit.
        </li>
      </Section>

      <Section title="Future contribution allocation">
        <li>
          <Tag>Online</Tag>
          On tsp.gov, your contribution allocation shows how new money is split across funds. It's separate
          from your current balances: moving existing money (an interfund transfer) doesn't change it.
        </li>
        <li>
          <Tag>Statement</Tag>
          Your TSP statement also lists your contribution allocation as of the statement date.
        </li>
      </Section>

      <Section title="Agency contributions">
        <li>
          You don't enter these; the calculator works them out (FERS: 1% automatic plus up to 4% matching). To
          check, your LES shows the agency automatic and agency matching amounts for each pay period, and your
          TSP statement shows agency contributions received.
        </li>
      </Section>

      <Section title="Age">
        <li>
          Enter your age this year. Catch-up contributions start in the calendar year you turn 50, and the higher
          catch-up applies in the years you turn 60 through 63.
        </li>
      </Section>
    </details>
  );
}

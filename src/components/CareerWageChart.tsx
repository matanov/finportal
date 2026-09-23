/**
 * CareerWageChart.tsx
 *
 * Fixed illustration for the federal-compensation article: one typical
 * career (GS-9 in 2011 to GS-14 by 2026, about three years per grade)
 * played out in Washington DC and in Kansas, plotted against the Social
 * Security wage base.
 *
 * "Kansas" uses Rest of U.S. locality rates, which cover the state outside
 * the Kansas City metro. The Kansas City locality (KC) only dates from 2016,
 * so it can't carry a 2011 start anyway.
 */

import { useEffect, useState } from "react";
import { LAST_PAY_YEAR } from "../lib/payLookup";
import { TYPICAL_CAREER, simulateCareer, type CareerYear } from "../lib/careerPath";
import { WAGE_BASE } from "../lib/wageBase";
import ErrorBoundary from "./ErrorBoundary";
import {
  ScaleNote,
  ScaleToggle,
  WageLineChart,
  fmtMoney,
  fmtPct,
  type Scale,
} from "./WageLineChart";

const WAGE_BASE_COLOR = "#2A7D9C";

const PLACES = [
  { key: "DCB", label: "DC", color: "#C9A035" },
  { key: "RUS", label: "Kansas", color: "#0F2244" },
] as const;

type Careers = Record<(typeof PLACES)[number]["key"], CareerYear[]>;
type LoadState = "loading" | "done" | "error";

export default function CareerWageChart() {
  return (
    <ErrorBoundary name="GS Career vs. Wage Base">
      <CareerWageChartInner />
    </ErrorBoundary>
  );
}

function CareerWageChartInner() {
  const [scale, setScale] = useState<Scale>("log");
  const [careers, setCareers] = useState<Careers | null>(null);
  const [state, setState] = useState<LoadState>("loading");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const results = await Promise.all(
          PLACES.map((p) => simulateCareer(TYPICAL_CAREER, p.key, LAST_PAY_YEAR)),
        );
        if (cancelled) return;
        if (results.some((r) => r == null)) {
          setState("error");
          return;
        }
        setCareers({ DCB: results[0]!, RUS: results[1]! });
        setState("done");
      } catch {
        if (!cancelled) setState("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (state === "loading") {
    return (
      <div style={{ color: "#94a3b8", padding: "2rem 0", textAlign: "center" }}>
        Loading pay data…
      </div>
    );
  }

  if (state === "error" || !careers) {
    return (
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
        Pay data for this career path could not be loaded.
      </div>
    );
  }

  const years = careers.DCB.map((c) => c.year).filter((y) => WAGE_BASE[y] != null);
  const gradeStep = (c: CareerYear) => `GS-${c.grade} Step ${c.step}`;

  const series = [
    {
      label: "Wage base",
      color: WAGE_BASE_COLOR,
      points: years.map((year) => ({ year, value: WAGE_BASE[year] })),
    },
    ...PLACES.map((p) => ({
      label: p.label,
      color: p.color,
      points: careers[p.key]
        .filter((c) => WAGE_BASE[c.year] != null)
        .map((c) => ({
          year: c.year,
          value: c.salary,
          note: `${gradeStep(c)}, ${fmtPct(c.salary / WAGE_BASE[c.year], 0)} of wage base`,
        })),
    })),
  ];

  const th: React.CSSProperties = {
    padding: "0.45rem 0.5rem",
    textAlign: "right",
    color: "#64748b",
    fontWeight: 600,
    borderBottom: "2px solid #e2e8f0",
    whiteSpace: "nowrap",
  };
  const td: React.CSSProperties = {
    padding: "0.4rem 0.4rem",
    textAlign: "right",
    verticalAlign: "top",
    borderBottom: "1px solid #f1f5f9",
    whiteSpace: "nowrap",
  };
  const pctStyle: React.CSSProperties = {
    display: "block",
    color: "#94a3b8",
    fontSize: "0.8em",
  };

  return (
    <div style={{ fontFamily: "Inter, system-ui, sans-serif" }}>
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
          GS-9 (2011) to GS-14 (2026): DC vs. Kansas vs. wage base
        </div>
        <ScaleToggle scale={scale} onChange={setScale} />
      </div>

      <WageLineChart
        series={series}
        scale={scale}
        ariaLabel="A GS-9 to GS-14 career in DC and in Kansas compared with the Social Security wage base, 2011 to 2026"
      />
      <ScaleNote scale={scale} />

      <div style={{ overflowX: "auto", marginTop: "1.25rem" }}>
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontSize: "0.85rem",
            fontVariantNumeric: "tabular-nums",
            color: "#1e293b",
          }}
        >
          <thead>
            <tr>
              <th style={{ ...th, textAlign: "left" }}>Year</th>
              <th style={th}>Kansas</th>
              <th style={th}>DC</th>
              <th style={th}>Wage base</th>
            </tr>
          </thead>
          <tbody>
            {careers.DCB.map((dc, i) => {
              const ks = careers.RUS[i];
              const base = WAGE_BASE[dc.year];
              return (
                <tr key={dc.year}>
                  <td style={{ ...td, textAlign: "left" }}>
                    {dc.year}
                    <span style={pctStyle}>
                      GS-{dc.grade}/{dc.step}
                      {(ks.grade !== dc.grade || ks.step !== dc.step) &&
                        ` (KS ${ks.grade}/${ks.step})`}
                    </span>
                  </td>
                  <td style={td}>
                    {fmtMoney(ks.salary)}
                    {base && (
                      <span style={pctStyle}>{fmtPct(ks.salary / base, 0)}</span>
                    )}
                  </td>
                  <td style={td}>
                    {fmtMoney(dc.salary)}
                    {base && (
                      <span style={pctStyle}>{fmtPct(dc.salary / base, 0)}</span>
                    )}
                  </td>
                  <td style={td}>{base ? fmtMoney(base) : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p style={{ fontSize: "0.8rem", color: "#64748b", margin: "0.75rem 0 0", lineHeight: 1.5 }}>
        Promotions in 2014, 2017, 2020 and 2023; step increases on the
        standard waiting periods; promotion pay set by the two-step rule.
        Grey figures under each salary are that salary as a share of the year's wage base. Kansas
        uses Rest of U.S. locality rates, which apply outside the Kansas City
        metro.
      </p>
    </div>
  );
}

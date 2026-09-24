# TSP Projection Calculator: business logic reference

The calculator lives at `/tsp/projection/`. This document describes, end to end, what it does with every
input, which rule or formula it applies at each step, where each rule comes from, and what it deliberately
does not model.

- **Last checked against the code and the TSP sources:** 2026-09-24
- **Keep it current:** change this file in the same commit as any change to a rule, limit or formula.
- **Status and open work** are tracked in [Issue #5](https://github.com/matanov/finportal/issues/5). The
  yearly figures to refresh are in [Issue #6](https://github.com/matanov/finportal/issues/6).

## Contents

1. [What it does](#1-what-it-does)
2. [Where things live](#2-where-things-live)
3. [Inputs](#3-inputs)
4. [Constants and rules](#4-constants-and-rules)
5. [One year of contributions](#5-one-year-of-contributions)
6. [Worked examples](#6-worked-examples)
7. [Year by year](#7-year-by-year)
8. [The projection engine](#8-the-projection-engine)
9. [Results and today's dollars](#9-results-and-todays-dollars)
10. [Data the calculator depends on](#10-data-the-calculator-depends-on)
11. [Assumptions and known limitations](#11-assumptions-and-known-limitations)
12. [Sources and verification log](#12-sources-and-verification-log)
13. [Tests](#13-tests)
14. [Yearly maintenance and changing a rule](#14-yearly-maintenance-and-changing-a-rule)

---

## 1. What it does

Given what a person holds in the TSP today, their age and salary, how much they contribute, and how new
contributions are split across funds, the calculator answers: **what could this account be worth in 5 to 40
years?**

It does this in three stages:

```
 inputs
   │
   ├─ 5. contributionBreakdown()   one year: limits, catch-up, Roth catch-up rule, agency money
   │
   ├─ 7. projectContributions()    every year of the horizon: age steps, catch-up windows, retirement age
   │
   ├─ 8. simulateProjection()      2,000 simulated futures built from real historical TSP months
   │
   └─ 9. results                   below average / average / above average, yearly bands,
                                   optionally converted to today's dollars
```

The result is a range, not a forecast. "Below average", "average" and "above average" are the 25th, 50th
and 75th percentile of 2,000 simulated outcomes.

## 2. Where things live

| File | Role |
|---|---|
| `src/pages/tsp/projection.astro` | Page shell |
| `src/components/TspProjection.tsx` | Inputs, validation, wiring, results, the "Where your contributions go" notices |
| `src/components/TspProjectionGuide.tsx` | The "Where to find these numbers" help panel |
| `src/components/TspProjectionReport.tsx` | The Print / Save as PDF report |
| `src/components/ProjectionChart.tsx` | The fan chart |
| `src/lib/tspProjection.ts` | Contribution rules, IRS limits (`CONTRIBUTION_LIMITS`), balance helpers |
| `src/lib/tspSimulation.ts` | The Monte Carlo engine and the today's-dollars conversion |
| `public/tsp/monthly-returns.json`, `public/tsp/index.json` | Historical returns and the fund list (generated, see [section 10](#10-data-the-calculator-depends-on)) |
| `scripts/test-tsp-contributions.mts` | Tests, run with `npm run test:tsp` |

Nothing is saved between visits. Reloading the page resets every input to its default.

## 3. Inputs

| Input | Type and range | Default | Notes |
|---|---|---|---|
| **Current balances**: fund | Any TSP fund (G, F, C, S, I, L Income, L 2030 to L 2075) or the **Mutual Fund Window** | One row, C Fund | "+ Add fund" adds a row using the first fund not already listed. Several rows for the same fund are allowed and simply add up. |
| Current balances: amount | Dollars, 0 or more | Blank (0) | Total balance in that fund, Traditional and Roth together. |
| **Roth % of balance** | Whole percent, 0 to 100 | Blank (0) | One number for the whole account. Applied to every fund row. See [3.1](#31-the-roth-share-of-current-balances). |
| Mutual Fund Window: return (%/yr) | 0 to 100, decimals allowed | 6 | Shown only on Mutual Fund Window rows. See [8.5](#85-mutual-fund-window-fixed-rate-money). |
| **Current age** | Whole number, 0 to 100, or blank | Blank | Means the age you reach **this calendar year**, which is how TSP decides catch-up eligibility. |
| **Annual salary** | Dollars, 0 or more | Blank (0) | Basic pay. Drives percent elections, agency money and the Roth catch-up test. |
| Contribute as | "% of salary" or "$ per year" | % of salary | The two elections are remembered separately for each mode. |
| **Traditional election** | Whole percent 0 to 100, or dollars 0 or more | 5% | |
| **Roth election** | Whole percent 0 to 100, or dollars 0 or more | 0% | Same limit as Traditional: the two are combined for the IRS limit. |
| **Future allocation** | Rows of fund and whole percent 0 to 100 | C Fund 100% | How new contributions are split. Should total 100%. New rows are prefilled with whatever is left. Duplicate funds are flagged. The Mutual Fund Window is not offered here. |
| **Projection horizon** | 5, 10, 15, 20, 25, 30, 35 or 40 years | 20 | |
| **Retire at age** | Whole number 1 to 100, optional | Blank | Disabled until an age is entered. |
| Future / Today's dollars | Toggle, plus inflation 0 to 20% with decimals | Future dollars, 2.5% | Display only. See [section 9](#9-results-and-todays-dollars). |

Invalid or out-of-range typing is corrected as it is entered: negative numbers become 0, percents above 100
become 100, and a cleared box means 0 (or "not entered" for age and retirement age). The library functions
accept any number and clamp the same way, so they are safe to call directly.

### 3.1 The Roth share of current balances

The TSP website shows a Roth share for the account as a whole, not fund by fund, so the calculator asks
for one percentage. Each fund row's balance is split with it:

```
roth        = amount × rothPct / 100
traditional = amount − roth
```

Traditional and Roth money in the same fund earn the same return, so the **projected total does not depend
on this number at all**. It only affects how the final balance divides between Traditional and Roth, and
that split is an **estimate**: it assumes the Roth money is spread evenly across the funds. If most of it
actually sits in one fund, the real split will differ (for the same 60% Roth share, a test case moved the
end Roth balance anywhere from about $274,000 to $536,000 depending on where the Roth money sat, with the
total identical).

## 4. Constants and rules

### 4.1 IRS limits (`CONTRIBUTION_LIMITS`, tax year 2026)

| Constant | 2026 value | Meaning |
|---|---|---|
| `year` | 2026 | The tax year the limits belong to **and the first year of the projection**. Change it even if the limits do not change. |
| `elective` | $24,500 | Employee contributions, Traditional and Roth **combined**, not counting catch-up |
| `catchUp50` | $8,000 | Extra catch-up: ages 50 to 59, and from age 64 on |
| `catchUp60to63` | $11,250 | Extra catch-up for ages 60, 61, 62 and 63 (replaces the $8,000, it does not add to it) |
| `rothCatchUpWageThreshold` | $150,000 | If prior-year wages were above this, all catch-up must be Roth |
| `source` | https://www.tsp.gov/contribution-limits/ | The page the "IRS limits" note links to |

**Personal limit** (`employeeLimit(age)`): `elective` plus the catch-up for that age.

| Age | Catch-up | Personal limit |
|---|---|---|
| Not entered, or under 50 | $0 | $24,500 |
| 50 to 59 | $8,000 | $32,500 |
| 60 to 63 | $11,250 | $35,750 |
| 64 and over | $8,000 | $32,500 |

Catch-up eligibility begins in the calendar year a person turns 50 (TSP fact sheet TSPFS12), which is why the
age input means the age reached this year.

### 4.2 Pay periods and agency money

| Constant | Value | Meaning |
|---|---|---|
| `PAY_PERIODS` | 26 | Federal pay is biweekly. All timing inside a year is worked out over 26 paychecks. |
| Automatic contribution | 1% of pay | Paid every pay period, **even when the employee contributes nothing** and even after employee contributions have stopped at the limit |
| Matching | Up to 4% of pay | Earned each pay period on what the employee actually contributes that period (formula below) |

**Matching formula.** For a paycheck in which the employee contributes `p`% of that paycheck's pay:

```
match% = min(p, 3) + 0.5 × min(max(p − 3, 0), 2)
```

Dollar for dollar on the first 3%, 50 cents on the dollar on the next 2%, nothing beyond 5%. So `p` of 1, 3,
4, 5 and 10 earn 1%, 3%, 3.5%, 4% and 4%. Automatic plus matching is therefore at most 5% of pay.

Agency money is **always Traditional**, even when it matches Roth contributions.

## 5. One year of contributions

`contributionBreakdown(input)` works out one calendar year for one age. It runs in two passes.

### 5.1 Pass 1: pay period by pay period

Setup:

```
pay          = salary / 26
percent mode:  each election per paycheck = pay × pct / 100
dollars mode:  each election per paycheck = dollars / 26
perPeriod    = traditional per paycheck + roth per paycheck        (what is elected each paycheck)
rothShare    = roth per paycheck / perPeriod                       (0 if nothing is elected)
limit        = the personal limit for the age (section 4.1)
```

For each of the 26 paychecks:

```
contributed  = min( perPeriod , max(0, limit − contributedSoFar) )
notContributed += perPeriod − contributed
traditional in += contributed × (1 − rothShare)
roth in        += contributed × rothShare
```

What this means:

- **Both elections come out of every paycheck together**, in proportion, until the personal limit is
  reached. Then contributions stop for the rest of the year. Under 50 the limit is the $24,500 elective
  limit shared by Traditional and Roth, so electing $24,500 Traditional plus some Roth goes over it and both
  are cut back proportionally.
- The paycheck in which the limit runs out takes only what still fits, and every later paycheck takes
  nothing. `limitReachedPeriod` records the first paycheck that was cut short.
- Agency money, also every paycheck (only when pay is above zero):

```
automatic += pay × 1%
match     += pay × matchPct( contributed / pay × 100 ) / 100     (what was actually put in)
matchLost += pay × matchPct( perPeriod   / pay × 100 ) / 100  −  the line above
```

So **matching stops when contributions stop**, at the elective limit for under-50s and at the full personal
limit (including catch-up) for people 50 and over. Catch-up contributions are matched like any other. Both
points are stated in TSP's own fact sheets (see [section 12](#12-sources-and-verification-log)). `matchLost`
is the match that would have been earned had the whole election gone in.

### 5.2 Pass 2: sorting the year into buckets

Pass 1 gave the yearly totals `tradIn` and `rothIn`. Pass 2 labels the dollars, which matters for the Roth
catch-up rule and for the breakdown table. It never changes a total or the agency money.

```
catchUp = max(0, tradIn + rothIn − 24,500)          (only anything above the regular limit)
```

**Normal case** (no Roth catch-up requirement): Traditional fills the regular limit first, then Roth. Anything
above the regular limit is catch-up and keeps the tax type it was elected as.

```
regularTraditional = min(tradIn, 24,500)
regularRoth        = min(rothIn, 24,500 − regularTraditional)
catchUpTraditional = tradIn − regularTraditional
catchUpRoth        = rothIn − regularRoth
```

**Roth catch-up requirement.** Since January 1, 2026, a person aged 50 or over whose prior-year wages were
above the threshold must make **all** catch-up contributions as Roth, regardless of their election. The
calculator applies it when:

```
catch-up is available at this age   AND   salary > $150,000
```

(Salary stands in for prior-year wages. See [section 11](#11-assumptions-and-known-limitations).) Then:

```
catchUpTraditional = 0
catchUpRoth        = catchUp
moved              = max(0, catchUp − rothIn)        // Traditional dollars that had to be re-labelled Roth
regularTraditional = tradIn − moved
regularRoth        = rothIn + moved − catchUp
```

The person's Roth contributions count as the catch-up first, and Traditional is moved only to cover any
shortfall. So electing $24,500 Traditional plus $8,000 Roth stays exactly as elected, and electing $32,500
all Traditional becomes $24,500 Traditional plus $8,000 Roth automatically. `moved` is reported as
`traditionalRedirectedToRoth` and shown to the user.

If a salary has not been entered, the test cannot run. The calculator does not apply the rule, and flags
`rothCatchUpUnknown` so the page asks for the salary.

### 5.3 Totals

```
employeeTotal = regularTraditional + regularRoth + catchUpTraditional + catchUpRoth
agencyTotal   = automatic + match
total         = employeeTotal + agencyTotal
```

### 5.4 Edge cases

| Situation | Behavior |
|---|---|
| No age entered | Treated as under 50: no catch-up, $24,500 limit |
| Dollars mode, no salary | Employee contributions work normally, but **agency money is zero** (it is a percentage of pay), and the Roth catch-up test cannot run |
| Election above the limit | The excess is reported as `notContributed`, with the paycheck in which contributions stop and the match lost |
| Election exactly reaches the limit in the last paycheck | Nothing is cut, no match is lost |
| Nothing elected | No employee contributions and no match, but the automatic 1% is still paid |

## 6. Worked examples

Every figure below was produced by running the real functions, not calculated by hand.

| # | Situation | Result |
|---|---|---|
| A | Age 40, $100,000, 5% Traditional | Employee $5,000. Agency $1,000 automatic + $4,000 match. Total $10,000. |
| B | Same, but 5% **Roth** | Identical: employee $5,000, match $4,000. Roth earns the same match as Traditional. |
| C | Age 40, $200,000, 20% Traditional ($1,538.46 a paycheck) | Limit ($24,500) is reached in paycheck 16. $15,500 of the election is not contributed. Match $4,923.08, **$3,076.92 lost** (paychecks 17 to 26 earn nothing). Agency total $6,923.08. |
| D | Age 55, $200,000, 20% Traditional | Personal limit $32,500, reached in paycheck 22. $7,500 not contributed. Salary is over $150,000, so the $8,000 of catch-up must be Roth: regular Traditional $24,500, catch-up Roth $8,000, of which $8,000 was **redirected** from Traditional. Match $6,653.85 (21 full paychecks plus part of paycheck 22), $1,346.15 lost. Agency total $8,653.85, overall total $41,153.85. |
| E | Age 55, $100,000, 30% Traditional | $30,000 is under the $32,500 limit, so contributions run all year and nothing is lost. Regular Traditional $24,500 plus catch-up Traditional $5,500 (salary is under $150,000, so no redirect). Match the full $4,000. |
| F | Age 45, $100,000, $24,500 Traditional + $5,000 Roth (dollars) | $29,500 elected against a $24,500 limit, reached in paycheck 22. Both are cut in proportion: Traditional $20,347.46, Roth $4,152.54. $5,000 not contributed. Match $3,384.62, $615.38 lost. |
| G | Age 61, $240,000, $35,750 all Traditional | The full 60 to 63 limit spread over all 26 paychecks. Catch-up $11,250 is redirected to Roth. Full match $9,600 (4% of pay), agency total $12,000. |
| H | Dollars mode, $10,000 Traditional, no salary | Employee $10,000. Agency $0. The Roth catch-up test cannot run. |

Case D shows why the match keeps going past $24,500: the $24,500 regular limit is used up during paycheck 16,
after which contributions are catch-up, and they are matched until the $32,500 limit runs out in paycheck 22.

## 7. Year by year

`projectContributions(input, start, years, firstYear, retireAge)` repeats section 5 for each year of the
horizon.

- **Year 1 is `CONTRIBUTION_LIMITS.year` (2026)**, year 2 is 2027, and so on to the end of the horizon.
- **Age advances one per year**, so catch-up starts in the year the person turns 50 and steps up in the year
  they turn 60 and back down in the year they turn 64. Each year re-runs section 5 with that year's age.
- **Salary and the IRS limits are held flat** at today's values for the whole horizon.
- **Retirement age.** From the first year in which the age reaches the retirement age, the row is all zeros
  (employee and agency) and is marked retired. Rows continue to the end of the horizon so the balance keeps
  growing. Nothing is withdrawn. If the retirement age is at or below the current age, no contributions are
  projected at all. A retirement age without an age entered has no effect.
- Each row also carries a running total of the starting balance plus every contribution so far, **before any
  investment growth**.

Example: age 49, $200,000, 20% Traditional, retiring at 62 (Traditional rows are regular contributions; Roth
rows are Roth catch-up, because salary is over $150,000):

| Year | Age | Employee Traditional | Employee Roth | Agency | Note |
|---|---|---|---|---|---|
| 2026 | 49 | $24,500 | $0 | $6,923.08 | No catch-up yet; contributions and match stop in paycheck 16 |
| 2027 | 50 | $24,500 | $8,000 | $8,653.85 | Catch-up begins, matched through paycheck 22 |
| 2037 | 60 | $24,500 | $11,250 | $9,375.00 | Higher 60 to 63 catch-up |
| 2039 | 62 | $0 | $0 | $0 | Retired: contributions stop, growth continues |

## 8. The projection engine

`simulateProjection()` in `src/lib/tspSimulation.ts` grows the balances. It is a **historical monthly-block
bootstrap**, the same method as the TSP Monte Carlo tool.

### 8.1 Idea

Each simulated month, pick one real month from TSP's history at random and apply **that month's actual
return to every fund at once**. Because every fund gets the return from the same real month, stocks fall
together and the G Fund stays steady, exactly as they did. Correlation between funds comes from the data,
not from an assumed model.

### 8.2 Setup

1. **Funds in play.** The funds held today with a balance above zero, plus the funds in the future
   allocation if any year contributes money. Funds without published history (the Mutual Fund Window) are
   handled separately, see [8.5](#85-mutual-fund-window-fixed-rate-money).
2. **The pool of months.** Only months in which **every** fund in play has a real return can be drawn. Adding a
   young fund shortens the pool for the whole simulation. History starts in 1987-04 for the G Fund, 1988-01
   for F and C, 2001-05 for S and I, and each L Fund from its own launch (L 2075 from 2025-07).
3. **Starting balances** are tracked as Traditional and Roth separately for each fund, using the
   [Roth share](#31-the-roth-share-of-current-balances).
4. **Allocation weights.** The allocation percents are turned into weights that add to 1. A total other than
   100% is used proportionally (the page shows a warning), and if nothing is allocated everything goes to the
   first row's fund. Repeated funds are merged.

### 8.3 One trial

For each of **2,000 trials**, for each year, for each of its 12 months:

```
draw one month m from the pool, uniformly, with replacement
for every historical fund i:      traditional[i] ×= 1 + return[i][m]
                                  roth[i]        ×= 1 + return[i][m]
for every Mutual Fund Window row: balance ×= (1 + rate)^(1/12)
then, at the end of the month, add that month's contributions:
     traditional[i] += (employeeTraditional + agency) / 12 × weight[i]
     roth[i]        += employeeRoth / 12 × weight[i]
```

At the end of each year the total across all funds is recorded.

Points to know:

- **Contributions arrive as 12 equal monthly amounts** at the end of each month, after that month's return,
  and are split by the future allocation. (Limits and matching are worked out over 26 paychecks; only the
  deposit timing into the simulation is monthly.)
- **Agency money is Traditional.**
- **Existing balances stay in their funds.** There is no rebalancing.
- **Months are drawn independently**, so the simulation has no memory of trends or market regimes.
- **Repeatable.** The random numbers come from a fixed-seed generator, so the same inputs always give the same
  chart. Results change over time only because the historical data grows.
- **Retired years** contribute nothing, but balances keep growing to the end of the horizon.

### 8.4 Turning 2,000 trials into results

- **Yearly bands.** For each year, the 2,000 balances are sorted and the 10th, 25th, 50th, 75th and 90th
  percentiles are read off, interpolating between neighbours (position = `p/100 × 1,999`).
- **Scenarios.** The trials are ranked by final balance. **Below average** is the trial at the 25th percentile
  rank, **Average** at the 50th, **Above average** at the 75th. Each scenario reports that one trial's total,
  Traditional and Roth balances, so Traditional plus Roth always equals the total exactly. This makes the
  Average tile essentially equal to, though not computed identically to, the median band at the last year.
- **What you put in** (`contributed`): the starting balance plus every year's contributions, without growth,
  indexed like the bands.

### 8.5 Mutual Fund Window: fixed-rate money

TSP publishes no fund-level history for the Mutual Fund Window, so it cannot be replayed from real months.
Each Mutual Fund Window row instead grows at the yearly return the user enters (default 6%, range 0 to 100,
decimals allowed):

```
monthly growth = (1 + rate)^(1/12)        →  exactly (1 + rate) each year
```

- It is **identical in every trial**, so it adds no ups and downs. A $100,000 balance at 6% is exactly
  $179,084.77 after 10 years and $320,713.55 after 20, in every trial.
- **Balances only.** Future contributions cannot be directed into it.
- It does not shorten the historical pool, and adding it shifts every result by exactly its own growth
  without disturbing the other funds' results.
- An account holding only Mutual Fund Window money uses no history, so the result reports zero historical
  months and the chart collapses to a single line.
- The [Roth share](#31-the-roth-share-of-current-balances) applies to these balances too.

## 9. Results and today's dollars

The simulation always runs in **future (nominal) dollars**. The toggle changes only how results are shown.

**Today's dollars** (`inTodaysDollars`): with inflation `π`, the value for year `i` is divided by `(1 + π)^i`.
The three scenarios use the horizon year. "What you put in" is deflated the same way. Inflation is entered
from 0 to 20% (default 2.5%) and is held constant.

On the page, in order: a summary panel with the average projected balance and its range; three scenario tiles
(total, Traditional, Roth, and **growth** = total minus what you put in); the fan chart (8-in-10 band,
middle-half band, median line, dashed "what you put in" line, retirement marker); a "How the projection
works" note; the contributions-over-N-years table; and the "Where your contributions go" breakdown with its
notices. The Print / Save as PDF report shows the same figures from the same data.

**The "match lost" notice** appears only when contributions really stop before the year ends. It reports the
paycheck in which they stop and the match lost. When a salary is entered and the figure below is at least
5%, it also suggests a whole-number percent that spreads the person's own personal limit across the full year
(`floor(personal limit / salary × 100)`), which keeps the full match. For someone 50 or over that limit
includes catch-up.

## 10. Data the calculator depends on

| File | Contents | Produced by |
|---|---|---|
| `public/tsp/monthly-returns.json` | `months` (`YYYY-MM`), `funds`, and `returns[fund][month]` as a decimal, `null` before a fund existed. Also `asOf` and `dailyDataFrom`. | `scripts/build-tsp-lookup.mjs`, rebuilt daily by GitHub Actions |
| `public/tsp/index.json` | The list of funds that have data | Same script |

Real history reaches back to 1987 (see the README's "Pre-2003 history" section). Months before June 2003 are
TSP's own published monthly returns; from June 2003 they are derived from daily share prices. The latest,
still-incomplete month is always excluded.

If the returns file cannot be loaded, the page says so and shows no projection. The fund dropdowns fall back
to a built-in list if `index.json` cannot be loaded.

## 11. Assumptions and known limitations

**Contribution rules**

- **Year 1 is a full calendar year (2026)**, regardless of today's date and of anything already contributed
  this year.
- **Salary and limits are flat** for the whole horizon: no raises, no yearly indexing of the IRS limits.
- **The Roth catch-up test uses current salary** as a stand-in for prior-year wages from the same employer.
- **The "deemed Roth election" payroll variant is not modelled.** Some plans make everything above the
  regular limit Roth automatically; the calculator applies the rule only to catch-up, keeping the person's
  Roth contributions first.
- **The IRS overall annual additions limit (415(c)) is not applied.** Catch-up is excluded from it (tsp.gov
  limits page). Using the 2026 figure of $72,000 recorded in Issue #6, employee elective contributions plus
  agency money would reach it only at roughly $950,000 of pay ($72,000 − $24,500, divided by 5%).
- **Agency money assumes FERS or BRS** whenever a salary is entered. CSRS participants receive none and there
  is no switch for that. Uniformed-service specifics (combat-zone pay, holding a civilian and a uniformed
  account together) are not modelled.
- **Mid-year retirement is not modelled.** A retirement age zeroes the whole year in which it is reached.
- **Ages under 16 are accepted.** The input does not block them.

**Balances**

- **The Roth share is account-wide**, so the Traditional and Roth split of the result is an estimate (the
  total is exact). See [3.1](#31-the-roth-share-of-current-balances).
- **The Mutual Fund Window is a fixed rate**, with no risk. Real mutual funds fluctuate, so it flatters
  the range for any account holding them.

**Simulation**

- **Months are independent** and the past is assumed to represent the future. There is no trend, regime or
  valuation model.
- **Short history gives rough results, with no warning.** Holding a very young fund (L 2075 has about 14
  months of history) leaves only that many distinct months to draw from. The projection page does not warn
  about this the way the TSP Monte Carlo page does.
- **No rebalancing, withdrawals, taxes or fees** beyond what is already inside TSP share prices.
- **Contributions are deposited monthly**, not per paycheck.

**Display**

- **Today's-dollars "put in" is an approximation.** Cumulative contributions are divided by the inflation
  factor of the year shown, as if all had been made that year. Deflating each contribution by its own year
  would give a slightly higher "put in" and therefore slightly less "growth". Balances themselves are exact.
- **Percent inputs are whole numbers** in the interface (elections and allocation), though the library accepts
  any number. Money is shown rounded to whole dollars.

## 12. Sources and verification log

Rules are backed by TSP's own publications where possible. "Verified" means read directly from the TSP
document on the date shown.

| Rule | Source | Status |
|---|---|---|
| Elective limit applies to Traditional and Roth combined, excluding catch-up. Under 50, contributions stop when it is reached. | TSP fact sheet TSPFS7 "Annual Limit on Elective Deferrals", 1/2026 | Verified 2026-09-24 |
| Catch-up begins in the calendar year you turn 50. Catch-up does not count against the elective or annual additions limits. | TSPFS12 "Contributions Toward the Catch-Up Limit", 1/2026 | Verified 2026-09-24 |
| Catch-up of **$8,000** (ages 50 to 59 and 64+) and **$11,250** (ages 60 to 63) | tsp.gov/contribution-limits, catch-up table by birth year | Verified 2026-09-24 |
| Roth catch-up requirement above **$150,000** prior-year wages; once Traditional reaches the elective limit, further contributions are Roth catch-up | TSPFS7, TSPFS12 and tsp.gov/contribution-limits | Verified 2026-09-24 |
| 1% automatic contribution continues after employee contributions stop | TSPFS7 | Verified 2026-09-24 |
| Match: dollar for dollar on the first 3%, 50 cents on the next 2%, on the first 5% of basic pay **each pay period**; no contribution in a pay period means no match | TSPFS7 | Verified 2026-09-24 |
| Match **stops when the elective limit (under 50) or the catch-up limit (50+) is reached**; catch-up contributions are eligible for matching on the first 5% of salary | TSPFS7 and TSPFS12 | Verified 2026-09-24 |
| **$24,500** elective deferral limit for 2026 | The IRS annual limit, mirrored by tsp.gov | **Not independently verified.** tsp.gov renders this figure dynamically, so it is not in the static page. Check it in a browser at the yearly update. |
| Roth deferrals made earlier in the year count toward the Roth catch-up requirement (IRS final regulations, September 2025) | Recorded in Issue #5 | Not re-verified |
| 26 pay periods a year | Assumption for federal biweekly pay | n/a |
| Historical returns | TSP's published monthly returns and daily share prices | See the README |

**Log**

- **2026-09-24, catch-up matching corrected.** The calculator had stopped the match at the regular $24,500
  limit and reported the difference as "match lost". TSPFS7 and TSPFS12 say catch-up contributions are matched
  and that matching stops only when the elective limit (under 50) or the catch-up limit (50+) is reached. The
  logic, the tests, and the wording in the app, the report and the Guide were changed to match. For someone
  50 or over who maximises contributions the match had been understated by about 23% (about 31% at ages 60 to
  63).
- **2026-09-24, limits source URL.** TSP moved its limits page from `/making-contributions/contribution-limits/`
  to `/contribution-limits/`. `CONTRIBUTION_LIMITS.source` was updated.
- **2026-09-24, earlier the same day.** The per-fund Roth checkmark became one account-wide "Roth % of balance"
  box, and the Mutual Fund Window was added with a fixed yearly return.

## 13. Tests

`npm run test:tsp` runs about 3,900 checks against the real modules, so there is no second copy of the logic
to drift out of date. They cover:

- A matrix of ages, salaries and elections: catch-up limits by age, dollars conserved
  (`regular + catch-up + notContributed = elected`), the Roth catch-up rule and redirect, Traditional filling
  the regular limit first, and agency money.
- **The agency match is checked against an independent calculation** (whole paychecks until the limit runs
  out, plus one part-paycheck) rather than the implementation's own loop, so the test is not just repeating
  the code.
- Specific hand-worked cases: the Roth catch-up examples, front-loaded elections, "maximising" contributions
  at 50+ keeping the full 4% match at any salary, and Roth earning the same match as Traditional.
- Year by year: age steps, the catch-up windows, and retirement age.
- The engine: repeatability, ordered percentiles, Traditional plus Roth equalling the total, G Fund outcomes
  far tighter than C Fund, the Mutual Fund Window growing at exactly its rate, and today's-dollars conversion.

## 14. Yearly maintenance and changing a rule

**Every year** (see [Issue #6](https://github.com/matanov/finportal/issues/6)): update `CONTRIBUTION_LIMITS` in
`src/lib/tspProjection.ts` (`year` first, then the four limits), check the age windows and the Roth catch-up
rule are unchanged, check the $24,500 figure against tsp.gov in a browser, and run `npm run test:tsp`. The
tests read the limits from `CONTRIBUTION_LIMITS`, so they should pass unchanged; a failure means a rule
changed shape.

**When a rule changes**, change these together:

1. The logic in `src/lib/tspProjection.ts` (or `tspSimulation.ts`).
2. The tests, including the independent match calculation in `scripts/test-tsp-contributions.mts`.
3. Every place the rule is described in words: the "Where your contributions go" notes and the "How this
   table works" list in `TspProjection.tsx`, the report's notes and method text in `TspProjectionReport.tsx`,
   and the agency paragraph in `TspProjectionGuide.tsx`. Search for a distinctive phrase from the old wording
   to find them all.
4. This document, including the verification log in section 12.

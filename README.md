# FERSmath — Federal Retirement Planning Blog

A content-driven blog and calculator platform focused on **federal employee retirement planning**. Built with Astro and deployed via a fully automated CI/CD pipeline to GitHub Pages.

## About

This project helps federal employees navigate the complexities of retirement — covering FERS, TSP, CSRS, Social Security coordination, survivor benefits, and more. It pairs in-depth articles with sophisticated planning calculators.

## Calculators

All live calculators are listed at **[/calculators](https://fersmath.com/calculators)** (homepage card grid: `src/components/CalculatorGrid.astro`, reused by both pages). Each one is a static page (`src/pages/calculator/*.astro` or `src/pages/tsp/*.astro`) wrapping a React island (`src/components/*.tsx`, hydrated with `client:load`) that calls a pure calculation module in `src/lib/`.

| Calculator | Route | Logic |
| :--- | :--- | :--- |
| High-3 Average Salary | `/calculator/high-3` | `src/lib/high3.ts` |
| GS Salary History Lookup | `/calculator/salary-lookup` | `src/lib/payLookup.ts` |
| TSP Fund Performance | `/tsp/performance` | `public/tsp/*.json` (generated, see below) |
| TSP Monte Carlo Projection | `/tsp/monte-carlo` | `public/tsp/*.json` (generated, see below) |
| FERS Special Retirement Supplement | `/calculator/fers-supplement` | `src/lib/fersSupplement.ts` |

The blog/articles section on the homepage is not live yet — there's no `/blog` route, and the cards are marked "Coming Soon".

## Tech Stack

| Layer | Technology |
| :--- | :--- |
| Framework | [Astro 7](https://astro.build) |
| Styling | Tailwind CSS v4 (CSS-first config) |
| Fonts | Playfair Display, Inter, JetBrains Mono (self-hosted) |
| CI/CD | GitHub Actions |
| Hosting | GitHub Pages |

## CI/CD Pipeline

Every push to `main` automatically:
1. Installs dependencies
2. Builds the static site via `astro build` (this also regenerates the pay-scale and TSP lookup JSON — see [Updating Data Sources](#updating-data-sources))
3. Deploys to GitHub Pages

Live site: **https://fersmath.com**

## Project Structure

```text
/
├── .github/
│   └── workflows/
│       ├── deploy.yml            # Build + deploy to GitHub Pages, on every push to main
│       └── update-tsp-data.yml   # Daily: fetch TSP prices, rebuild lookups, commit + redeploy
├── scripts/
│   ├── opm-convert.py            # OPM Excel pay table -> JSON (manual, run once per new year)
│   ├── build-pay-lookup.mjs      # src/data/pay-scales/*.json  -> public/pay-scales/*.json
│   ├── fetch-tsp-prices.mjs      # tsp.gov CSV -> src/data/tsp/fund-price-history.csv
│   └── build-tsp-lookup.mjs      # src/data/tsp/*.csv -> public/tsp/*.json
├── public/
├── src/
│   ├── components/
│   ├── data/
│   │   ├── pay-scales/           # Raw OPM pay tables, one file per year (manual)
│   │   └── tsp/                  # Raw TSP price history CSV (fetched daily)
│   ├── layouts/
│   ├── lib/                      # Pure calculation logic, one module per calculator
│   ├── pages/
│   └── styles/
│       └── global.css       # Tailwind v4 brand design tokens
└── astro.config.mjs
```

## Local Development

```sh
npm install        # Install dependencies
npm run dev        # Start dev server at localhost:4321
npm run build      # Build for production
npm run preview    # Preview production build locally
```

## Updating Data Sources

The site has two data pipelines, with very different update processes because of what each source actually publishes:

### GS Pay Scales — manual, ~once a year

OPM publishes new General Schedule pay tables annually (typically effective each January) as an **Excel workbook**, not JSON and not a feed anything can poll. There's no automation for this — it's a manual step when a new year's rates are published:

1. Download the new year's GS pay table from OPM as Excel (`.xlsx`).
2. Convert it to JSON: `python3 scripts/opm-convert.py paytable.xlsx` (requires `pip install pandas openpyxl`). See the script's header comment for the expected output shape and a caveat about multi-sheet workbooks.
3. Move/rename the result to `src/data/pay-scales/YYYY-general-schedule-pay-rates.json`.
4. That's it. `npm run build` (and therefore every deploy) runs `scripts/build-pay-lookup.mjs`, which auto-discovers every file in `src/data/pay-scales/` and regenerates the compact lookups in `public/pay-scales/` — no code changes needed for a new year.

Run `npm run generate:pay` locally to regenerate `public/pay-scales/` without a full build.

### TSP Fund Prices — automated, daily

TSP.gov publishes a full daily price-history CSV, which is fetchable, so this pipeline runs unattended:

- **`.github/workflows/update-tsp-data.yml`** runs on a daily cron (13:00 UTC) and can also be triggered manually — either the "Run workflow" button on the Actions tab, or `gh workflow run update-tsp-data.yml`.
- Each run: fetches the latest CSV (`fetch-tsp-prices.mjs`), rebuilds the per-fund and monthly-returns JSON (`build-tsp-lookup.mjs`), and commits + pushes **only if the data actually changed**.
- The fetch step validates before overwriting anything — a blocked or malformed response (e.g. tsp.gov's WAF, a schema change) is refused rather than silently corrupting `src/data/tsp/fund-price-history.csv`, and the workflow run fails loudly instead.
- Because that commit is authored by the workflow's own `GITHUB_TOKEN`, it does **not** auto-trigger `deploy.yml` (GitHub blocks that specific chain to prevent workflow recursion) — `update-tsp-data.yml` explicitly re-dispatches `deploy.yml` itself whenever it pushes new data, so a successful fetch always ends in a live redeploy.

No manual steps are needed under normal operation. To run either script locally: `npm run fetch:tsp && npm run generate:tsp`.

## Deployment

Deployment is fully automated. To publish a change:

```sh
git add -A
git commit -m "your message"
git push
```

The GitHub Actions workflow handles the rest.

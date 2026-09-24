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
| TSP Projection Calculator | `/tsp/projection` | `src/lib/tspProjection.ts` (contribution rules, IRS limits), `src/lib/tspSimulation.ts` (Monte Carlo); tests: `npm run test:tsp`; **business logic reference: [`docs/tsp-projection-calculator.md`](docs/tsp-projection-calculator.md)**; status and open work in [Issue #5](https://github.com/matanov/finportal/issues/5), yearly updates in [Issue #6](https://github.com/matanov/finportal/issues/6) |
| FERS Special Retirement Supplement | `/calculator/fers-supplement` | `src/lib/fersSupplement.ts` |

Articles are MDX files (Markdown that can also embed the interactive chart components) in an Astro [content collection](https://docs.astro.build/en/guides/content-collections/) — see [Writing Articles](#writing-articles) below.

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
│       ├── deploy.yml               # Build + deploy to GitHub Pages, on push to main (ignores feedback/**)
│       ├── update-tsp-data.yml      # Daily: fetch TSP prices, rebuild lookups, commit + redeploy
│       └── consolidate-feedback.yml # Daily: roll feedback/inbox/*.json into feedback/log.jsonl
├── scripts/
│   ├── opm-convert.py            # OPM Excel pay table -> JSON (manual, run once per new year)
│   ├── build-pay-lookup.mjs      # src/data/pay-scales/*.json  -> public/pay-scales/*.json
│   ├── fetch-tsp-prices.mjs      # tsp.gov CSV -> src/data/tsp/fund-price-history.csv
│   ├── build-tsp-lookup.mjs      # src/data/tsp/*.csv -> public/tsp/*.json
│   └── consolidate-feedback.mjs  # feedback/inbox/*.json -> feedback/log.jsonl (run daily by Actions)
├── docs/
│   └── tsp-projection-calculator.md  # End-to-end business logic of the TSP Projection Calculator
├── workers/
│   └── feedback-worker/          # Cloudflare Worker behind the feedback form — see its own README
├── feedback/
│   ├── inbox/                    # One file per submission, written by the worker, consolidated daily
│   └── log.jsonl                 # All feedback, one JSON object per line
├── public/
├── src/
│   ├── components/
│   ├── content/
│   │   └── articles/             # Blog articles, one .mdx file each (see Writing Articles)
│   ├── data/
│   │   ├── pay-scales/           # Converted OPM pay tables (JSON), one file per year (manual)
│   │   ├── raw/                  # Original OPM Excel downloads, kept for provenance (manual)
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
npm run test:tsp   # Check the TSP contribution rules and projection simulation
```

## Writing Articles

Each article is one `.mdx` file in `src/content/articles/`. The file name becomes the URL: `my-topic.mdx` is published at `/blog/my-topic/`.

1. Copy `src/content/articles/_template.mdx` to a new file in the same folder. Files starting with `_` are never published, so the template stays out of the site.
2. Fill in the frontmatter at the top:

   | Field | Required | Notes |
   |---|---|---|
   | `title` | yes | Page title and card heading |
   | `description` | yes | One or two sentences (max 200 characters); shown on cards and used as the search-result description |
   | `category` | yes | Short label above the title, e.g. `Federal Pay` |
   | `published` | yes | `YYYY-MM-DD` |
   | `readMinutes` | no | Estimated from the word count if left out |
   | `draft` | no | `true` keeps the article out of the production build; it still shows in `npm run dev` for previewing |
   | `unlisted` | no | `true` deploys the article at its direct URL but keeps it off the homepage and `/blog`, out of the sitemap, and marked `noindex`. For previewing a draft on the live site. Anyone with the link can open it |

   The schema lives in `src/content.config.ts`, and `npm run build` stops with a clear error if a field is missing or malformed.
3. Write the body in Markdown: paragraphs, `##` headings, lists, links, tables (use `--:` in the separator row to right-align a column), `---` for the short gold section break, and footnotes with `[^name]`.
4. Components are imported at the top of the file and placed like HTML tags:
   - `<ChartBox>…</ChartBox>` draws the white bordered frame around a chart; put a React chart inside with `client:load`, e.g. `<WageBaseComparison client:load />`.
   - `<CollapsibleTable showLast={6} caption="…">` wraps a Markdown table so only the newest rows show until the reader clicks "Show all years". Keep a blank line before and after the table inside it.

   `src/content/articles/federal-compensation-vs-social-security-wage-maximum.mdx` uses all of these.
5. An article moves through three states. Use `draft: true` while writing (dev only, nothing deployed). Switch to `unlisted: true` when you want a live link to check it or share it, without it being listed or indexed. To publish, remove the `draft` and `unlisted` lines (or set them to `false`) and push to `main`. The article then appears on the homepage "Latest Articles" section (newest three), on `/blog`, and in the sitemap automatically.

   Unlisted is hidden, not private: the page is on the public internet at its URL for anyone who has it, and the `.mdx` source is readable in this public GitHub repo whichever state the article is in. Search engines are told not to index it (a `noindex` tag), but that is a request, not access control.

The page layout, breadcrumb, byline and typography come from `src/layouts/ArticleLayout.astro`, so articles contain no styling of their own. The pages themselves are generated by `src/pages/blog/[slug].astro`.

## Updating Data Sources

The site has two data pipelines, with very different update processes because of what each source actually publishes:

### GS Pay Scales — manual, ~once a year

OPM publishes new General Schedule pay tables annually (typically effective each January) as an **Excel workbook**, not JSON and not a feed anything can poll. There's no automation for this — it's a manual step when a new year's rates are published:

1. Download the new year's GS pay table from OPM as Excel. Recent years (~2016+) are `.xlsx`; older years OPM published as legacy binary `.xls` — both work, but need different pandas engines (next step).
2. One-time environment setup, if you haven't done this before:
   ```sh
   python3 -m venv .venv
   .venv/bin/pip install pandas openpyxl xlrd   # openpyxl → .xlsx, xlrd → .xls
   ```
   (`.venv/` is gitignored. On Homebrew Python, a bare `pip install` outside a venv fails with an "externally-managed-environment" error — don't reach for `--break-system-packages`, just use the venv.)
3. Convert it to JSON: `.venv/bin/python3 scripts/opm-convert.py paytable.xlsx`. See the script's header comment for the expected output shape and a caveat about multi-sheet workbooks.
4. **Verify before trusting the output** — see "Verifying a conversion" below. OPM's file shape has drifted before (locality-area realignments changing the row count) without raising any error, so a silent bad conversion is possible.
5. Keep the original download for provenance: move it to `src/data/raw/YYYY-general-schedule-pay-rates.xls` (or `.xlsx`).
6. Move/rename the converted JSON to `src/data/pay-scales/YYYY-general-schedule-pay-rates.json`.
7. **If this year is earlier than the current `FIRST_PAY_YEAR` or later than `LAST_PAY_YEAR`** (in `src/lib/payLookup.ts`), update those two constants. This step is easy to forget and the failure mode is silent: `build-pay-lookup.mjs` auto-discovers every file in `src/data/pay-scales/` regardless, so the new year's JSON is generated and served correctly either way — but `SalaryLookup.tsx` and `high3.ts` both build their year lists from `FIRST_PAY_YEAR`/`LAST_PAY_YEAR`, not from what data actually exists, so a year outside that range just never appears in the UI even though its JSON 200s fine. (This is exactly what happened backfilling 2011–2014.) A year filling a *gap* inside the existing range — e.g. 2015 — needs no code change; a missing year's fetch just 404s and is treated as "no data," not an error.
8. `npm run build` (and therefore every deploy) runs `scripts/build-pay-lookup.mjs`, which regenerates the compact lookups in `public/pay-scales/` from everything in `src/data/pay-scales/`.

Run `npm run generate:pay` locally to regenerate `public/pay-scales/` without a full build.

#### Verifying a conversion

Before moving a new year's JSON into `src/data/pay-scales/`, check it against a neighboring year you already trust:

- **Input shape**: same sheet name (`ALL_GS`) and same 32 columns (`LOCNAME`, `GRADE`, `ANNUAL1..10`, `HOURLY1..10`, `OVERTIME1..10`) as an adjacent year's raw file. A changed column set means OPM changed their template and `opm-convert.py`'s column assumptions need a look.
- **Output shape**: grades 1–15, 10 steps per grade, no unexpected nulls.
- **Locality set diff** against the adjacent year: some churn (a handful of codes added/removed) is normal — OPM periodically realigns locality-pay areas — but wholesale differences mean something's wrong with the read.
- **A known-value spot check**: look up the same locality/grade/step (e.g. `RUS` — Rest of US — GS-1 Step 1) across a few consecutive years and eyeball the trend. It should track known history — e.g. federal pay was frozen 2011–2013, so that value should be *identical* across those three years and then move in 2014.

### TSP Fund Prices — automated, daily

TSP.gov publishes a full daily price-history CSV, which is fetchable, so this pipeline runs unattended:

- **`.github/workflows/update-tsp-data.yml`** runs on a daily cron (13:00 UTC) and can also be triggered manually — either the "Run workflow" button on the Actions tab, or `gh workflow run update-tsp-data.yml`.
- Each run: fetches the latest CSV (`fetch-tsp-prices.mjs`), rebuilds the per-fund and monthly-returns JSON (`build-tsp-lookup.mjs`), and commits + pushes **only if the data actually changed**.
- The fetch step validates before overwriting anything — a blocked or malformed response (e.g. tsp.gov's WAF, a schema change) is refused rather than silently corrupting `src/data/tsp/fund-price-history.csv`, and the workflow run fails loudly instead.
- Because that commit is authored by the workflow's own `GITHUB_TOKEN`, it does **not** auto-trigger `deploy.yml` (GitHub blocks that specific chain to prevent workflow recursion) — `update-tsp-data.yml` explicitly re-dispatches `deploy.yml` itself whenever it pushes new data, so a successful fetch always ends in a live redeploy.

No manual steps are needed under normal operation. To run either script locally: `npm run fetch:tsp && npm run generate:tsp`.

#### Pre-2003 history (real data, manual, essentially one-time)

`fund-price-history.csv` only goes back to TSP's May 2003 share-price rebasing (every fund reset to $10.0000 that day when TSP changed bookkeeping systems) — not each fund's actual inception. The real funds are older: **G Fund since 4/1987, F and C Fund since 1/1988, S and I Fund since 5/2001.** TSP still publishes real monthly (not daily) returns for that whole earlier period on their `/fund-performance/` page.

- **`scripts/fetch-tsp-historical-returns.mjs`** pulls that real monthly-return history via the same internal endpoint that page's own JS uses (`getMonthlyReturnsSummary.csv` — not a documented public API, discovered from the page's `rates-of-returns.js`), through 2003-05 inclusive — the exact month that ends at the daily series' $10.00 anchor, so the two datasets meet with no gap or overlap. Output: `src/data/tsp/monthly-returns-pre2003.csv`. It sanity-checks the result against each fund's known real inception month before writing, and refuses to write if TSP's format or history has changed unexpectedly.
- This is **not part of the daily automation** — unlike share prices, TSP isn't going to revise 1987–2003 monthly returns, so there's nothing to keep polling for. Re-run it manually only if TSP's page structure changes and the file needs regenerating.
- **`build-tsp-lookup.mjs`** merges this into `public/tsp/monthly-returns.json` every time it runs (including in the daily automation above — no workflow changes were needed for this, it just reads one more, unchanging, already-committed input file). The merged file gets a `dailyDataFrom` field (currently `"2003-06"`) marking where real-but-monthly-resolution data ends and real-daily-derived data begins, so consumers can disclose the resolution change.
- This only feeds the **Monte Carlo bootstrap**, not the historic price chart (`TspPerformance.tsx`) — that chart's x-axis spaces points by index, not elapsed time, so mixing in sparser monthly points would visually compress decades of real history into what looks like a few months. Extending the chart itself would need a real rework of its axis, not just more data, so it's out of scope here.

## Feedback Widget

Every page has a small floating feedback form (`src/components/FeedbackWidget.tsx`,
bottom-right corner). There's no database behind it — submissions are
committed straight into this repo:

```
Browser  →  Cloudflare Worker  →  GitHub Contents API  →  feedback/inbox/*.json
                (honeypot +                                        │
                 rate limit)                    daily GitHub Action │ rolls up
                                                                     ▼
                                                          feedback/log.jsonl
```

- **`workers/feedback-worker/`** — the Cloudflare Worker the form POSTs to.
  It checks a honeypot field, rate-limits by IP (Workers KV), validates the
  message (required, ≤900 characters), then writes the submission as its
  own new file under `feedback/inbox/` via the GitHub API, authenticated
  with a fine-grained PAT scoped only to this repo's Contents permission.
  One file per submission (rather than appending to a shared file) avoids
  concurrent writes racing on a git blob SHA.
- **`.github/workflows/consolidate-feedback.yml`** runs daily, rolling every
  file in `feedback/inbox/` into `feedback/log.jsonl` (one JSON object per
  line, oldest first) and deleting the now-consolidated inbox files.
- **`.github/workflows/deploy.yml`** has `paths-ignore: feedback/**` — the
  worker's commits use a real PAT rather than the Actions-internal
  `GITHUB_TOKEN`, so GitHub's usual anti-recursion guard doesn't apply and
  every submission would otherwise trigger a full site rebuild.
- **No CAPTCHA** (e.g. Cloudflare Turnstile) — a deliberate choice to avoid
  the extra setup step; the honeypot + rate limit are considered enough for
  the expected volume. This can be revisited if spam becomes a real problem.
- **No submitter IP is ever committed** — this repo is public, and IPs only
  ever live transiently in Workers KV (with a TTL) for rate limiting.

Full operational detail — local dev, deploying the worker, and (important)
**how to rotate the GitHub token before it expires** — is in
[`workers/feedback-worker/README.md`](workers/feedback-worker/README.md).
That token can have an expiration date; GitHub emails a warning about a
week beforehand, and there's no other alerting on it, so that email is the
signal to act on.

## Deployment

Deployment is fully automated. To publish a change:

```sh
git add -A
git commit -m "your message"
git push
```

The GitHub Actions workflow handles the rest.

## Project Scope

**FERSmath** (fersmath.com) is a content-driven blog and calculator platform for federal employee retirement planning — FERS, TSP, CSRS, Social Security coordination, and survivor benefits. It pairs (eventually) in-depth articles with a set of planning calculators: High-3 Average Salary, GS Salary History Lookup, FERS Special Retirement Supplement, and TSP Fund Performance / Monte Carlo Projection. The articles/blog section is not live yet (see [Issue #2](https://github.com/matanov/finportal/issues/2)). A standalone FERS Basic Annuity Calculator is advertised on the site but not yet built ([Issue #3](https://github.com/matanov/finportal/issues/3)), and the TSP Monte Carlo tool is slated to extrapolate returns back ~70 years ([Issue #1](https://github.com/matanov/finportal/issues/1)).

## How It Was Built

- **Stack**: Astro 7 static site, React islands (`client:load`) for anything interactive, Tailwind v4 CSS-first config, TypeScript. Each calculator is a thin `.astro` page wrapping a React component (`src/components/`) that calls pure calculation logic (`src/lib/`) — no state or business logic lives in the page itself.
- **Data pipelines**: two very different sources feed the calculators. GS pay scales are OPM Excel workbooks, converted by hand once a year (`scripts/opm-convert.py`) — see the README's "Updating Data Sources" section, including a verification checklist and a documented gotcha around `FIRST_PAY_YEAR`/`LAST_PAY_YEAR` in `src/lib/payLookup.ts`. TSP fund prices are fetched and rebuilt automatically every day via GitHub Actions.
- **Feedback system**: a floating widget on every page (`src/components/FeedbackWidget.tsx`) posts to a Cloudflare Worker (`workers/feedback-worker/`), which writes each submission straight into this repo via the GitHub API — no database. A daily GitHub Action consolidates the inbox into one log file. Full architecture, anti-spam design, and GitHub token rotation instructions (**the token can expire**) are in `workers/feedback-worker/README.md`.
- **CI/CD**: fully automated. Every push to `main` builds and deploys to GitHub Pages via GitHub Actions; the data pipelines above commit back to `main` on their own schedules, with `deploy.yml` configured to ignore feedback-only commits so they don't trigger wasted rebuilds.

The root `README.md` is the source of truth for full details on all of the above (project structure, exact commands, pipeline internals) — this section is oriented at getting an agent up to speed quickly, not a substitute for it.

## Development

When starting the dev server, use background mode:

```
astro dev --background
```

Manage the background server with `astro dev stop`, `astro dev status`, and `astro dev logs`.

## Documentation

Full documentation: https://docs.astro.build

Consult these guides before working on related tasks:

- [Adding pages, dynamic routes, or middleware](https://docs.astro.build/en/guides/routing/)
- [Working with Astro components](https://docs.astro.build/en/basics/astro-components/)
- [Using React, Vue, Svelte, or other framework components](https://docs.astro.build/en/guides/framework-components/)
- [Adding or managing content](https://docs.astro.build/en/guides/content-collections/)
- [Adding styles or using Tailwind](https://docs.astro.build/en/guides/styling/)
- [Supporting multiple languages](https://docs.astro.build/en/guides/internationalization/)

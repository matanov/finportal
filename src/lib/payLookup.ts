/**
 * payLookup.ts
 *
 * On-demand GS salary lookup using pre-built compact JSON files
 * served from /public/pay-scales/.
 *
 * Files are fetched once per year and cached in memory for the session.
 * The JS bundle stays at zero pay-data weight.
 *
 * TO ADD A NEW YEAR:
 *   1. Drop YYYY-general-schedule-pay-rates.json into src/data/pay-scales/
 *   2. If that year falls outside [FIRST_PAY_YEAR, LAST_PAY_YEAR] below,
 *      update those constants to include it. This step is easy to miss:
 *      the new year's data is served correctly either way (build-pay-lookup.mjs
 *      auto-discovers every file), but SalaryLookup.tsx and high3.ts both
 *      build their year lists from these two constants, not from the data
 *      that actually exists — a year outside the range is silently invisible
 *      in the UI even though `/pay-scales/YYYY.json` 200s fine. (This is
 *      exactly what happened backfilling 2011-2014: the JSON was right,
 *      FIRST_PAY_YEAR was still 2016, and the new years just never rendered.)
 *   3. Run `npm run build` (or `npm run generate:pay` for just the lookups)
 *      — everything else regenerates automatically.
 *
 * A gap year (no file for some YYYY between FIRST_PAY_YEAR and LAST_PAY_YEAR,
 * e.g. 2015 before it was backfilled) does NOT need special handling —
 * lookupSalary()'s fetch simply 404s and callers already treat a missing
 * year as "no data for this year," not an error.
 */

// ---------------------------------------------------------------------------
// In-memory cache — fetched files are stored here for the session lifetime
// ---------------------------------------------------------------------------

/** Compact lookup map: "LOCALITY:GRADE:STEP" → annual salary */
type YearMap = Record<string, number>;

const yearCache = new Map<number, YearMap>();
let yearsIndex: number[] | null = null;

/** Earliest and latest pay year we have data for */
export const FIRST_PAY_YEAR = 2011;
export const LAST_PAY_YEAR = 2026;

// ---------------------------------------------------------------------------
// Internal fetch helpers
// ---------------------------------------------------------------------------

async function fetchYearMap(year: number): Promise<YearMap> {
  if (yearCache.has(year)) return yearCache.get(year)!;

  const res = await fetch(`/pay-scales/${year}.json`);
  if (!res.ok) throw new Error(`Pay data not available for year ${year}`);

  const data: YearMap = await res.json();
  yearCache.set(year, data);
  return data;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns the list of available pay years from the index.
 * Fetched once and cached.
 */
export async function getAvailableYears(): Promise<number[]> {
  if (yearsIndex) return yearsIndex;

  const res = await fetch("/pay-scales/index.json");
  if (!res.ok) throw new Error("Could not load pay scale index");

  const data: { years: number[] } = await res.json();
  yearsIndex = data.years;
  return yearsIndex;
}

/**
 * Look up an annual GS salary.
 *
 * @param year     - The pay year (e.g. 2024)
 * @param locality - Locality code (e.g. "DCB", "GS" for rest-of-US)
 * @param grade    - GS grade 1–15
 * @param step     - GS step 1–10
 * @returns Annual salary in dollars, or null if not found
 */
export async function lookupSalary(
  year: number,
  locality: string,
  grade: number,
  step: number,
): Promise<number | null> {
  const map = await fetchYearMap(year);
  return map[`${locality}:${grade}:${step}`] ?? null;
}

/**
 * Pre-fetches multiple years in parallel.
 * Call this once you know which years a user's career spans
 * so all data is ready before the calculation runs.
 */
export async function prefetchYears(years: number[]): Promise<void> {
  await Promise.all(years.map(fetchYearMap));
}

/**
 * Returns all locality codes available for a given year.
 */
export async function getLocalities(year: number): Promise<string[]> {
  const map = await fetchYearMap(year);
  const locs = new Set<string>();
  for (const key of Object.keys(map)) {
    locs.add(key.split(":")[0]);
  }
  return [...locs].sort();
}

/**
 * Returns all GS grades available for a given year + locality.
 */
export async function getGrades(
  year: number,
  locality: string,
): Promise<number[]> {
  const map = await fetchYearMap(year);
  const grades = new Set<number>();
  for (const key of Object.keys(map)) {
    const [loc, grade] = key.split(":");
    if (loc === locality) grades.add(Number(grade));
  }
  return [...grades].sort((a, b) => a - b);
}

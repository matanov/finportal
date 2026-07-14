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
 *   2. Run `npm run build` — the prebuild script does the rest automatically.
 */

// ---------------------------------------------------------------------------
// In-memory cache — fetched files are stored here for the session lifetime
// ---------------------------------------------------------------------------

/** Compact lookup map: "LOCALITY:GRADE:STEP" → annual salary */
type YearMap = Record<string, number>;

const yearCache = new Map<number, YearMap>();
let yearsIndex: number[] | null = null;

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

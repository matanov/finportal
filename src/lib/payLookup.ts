/**
 * payLookup.ts
 *
 * Utility to look up a GS annual salary from the pay scale JSON files.
 * Handles the inconsistent root keys across years (ALL_GS, ALL GS, 2018).
 * All pay data is imported at build time — zero runtime fetching.
 */

import data2016 from '../data/pay-scales/2016-general-schedule-pay-rates.json';
import data2017 from '../data/pay-scales/2017-general-schedule-pay-rates.json';
import data2018 from '../data/pay-scales/2018-general-schedule-pay-rates.json';
import data2019 from '../data/pay-scales/2019-general-schedule-pay-rates.json';
import data2020 from '../data/pay-scales/2020-general-schedule-pay-rates.json';
import data2021 from '../data/pay-scales/2021-general-schedule-pay-rates.json';
import data2022 from '../data/pay-scales/2022-general-schedule-pay-rates.json';
import data2023 from '../data/pay-scales/2023-general-schedule-pay-rates.json';
import data2024 from '../data/pay-scales/2024-general-schedule-pay-rates.json';
import data2025 from '../data/pay-scales/2025-general-schedule-pay-rates.json';
import data2026 from '../data/pay-scales/2026-general-schedule-pay-rates.json';

export interface PayEntry {
  location: string;
  grade: number;
  steps: { step: number; annual: number }[];
}

// Normalise any JSON file regardless of its root key
function extractEntries(raw: Record<string, unknown>): PayEntry[] {
  const key = Object.keys(raw)[0];
  return (raw[key] as PayEntry[]) ?? [];
}

const PAY_TABLES: Record<number, PayEntry[]> = {
  2016: extractEntries(data2016 as Record<string, unknown>),
  2017: extractEntries(data2017 as Record<string, unknown>),
  2018: extractEntries(data2018 as Record<string, unknown>),
  2019: extractEntries(data2019 as Record<string, unknown>),
  2020: extractEntries(data2020 as Record<string, unknown>),
  2021: extractEntries(data2021 as Record<string, unknown>),
  2022: extractEntries(data2022 as Record<string, unknown>),
  2023: extractEntries(data2023 as Record<string, unknown>),
  2024: extractEntries(data2024 as Record<string, unknown>),
  2025: extractEntries(data2025 as Record<string, unknown>),
  2026: extractEntries(data2026 as Record<string, unknown>),
};

export const AVAILABLE_YEARS = Object.keys(PAY_TABLES).map(Number).sort();

/**
 * Look up an annual GS salary.
 *
 * @param year     - The pay year (e.g. 2024)
 * @param location - Locality code from the dictionary (e.g. "DCB", "GS" for rest-of-US)
 * @param grade    - GS grade 1–15
 * @param step     - GS step 1–10
 * @returns Annual salary in dollars, or null if not found
 */
export function lookupSalary(
  year: number,
  location: string,
  grade: number,
  step: number
): number | null {
  const table = PAY_TABLES[year];
  if (!table) return null;

  const entry = table.find(
    (e) => e.location === location && e.grade === grade
  );
  if (!entry) return null;

  const stepEntry = entry.steps.find((s) => s.step === step);
  return stepEntry?.annual ?? null;
}

/**
 * Returns all available locality codes for a given year.
 */
export function getLocalities(year: number): string[] {
  const table = PAY_TABLES[year];
  if (!table) return [];
  return [...new Set(table.map((e) => e.location))].sort();
}

/**
 * Returns all grades available for a given year + locality.
 */
export function getGrades(year: number, location: string): number[] {
  const table = PAY_TABLES[year];
  if (!table) return [];
  return table
    .filter((e) => e.location === location)
    .map((e) => e.grade)
    .sort((a, b) => a - b);
}

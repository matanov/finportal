/**
 * fersAnnuity.ts
 *
 * FERS Basic Annuity estimator: the basic formula, immediate-retirement
 * eligibility, and the spousal survivor benefit election.
 *
 * Scope for this first version (see Issue #3 for what's deferred):
 *   - Immediate retirement only — 62+5, 60+20, MRA+30 for regular employees,
 *     and 50+20 / any age+25 for law enforcement officers, firefighters and
 *     air traffic controllers ("special provision" employees).
 *   - MRA+10 (reduced), deferred retirement, and disability retirement are
 *     NOT modeled. When the entered age/service falls in MRA+10 territory,
 *     `checkImmediateEligibility` reports it as ineligible with an
 *     explanatory note rather than silently computing an unreduced number.
 *   - CSRS is not modeled; this is FERS only.
 *
 * Sources (all fetched and read directly on 2026-09-24):
 *   - OPM CSRS/FERS Handbook, Chapter 46 "Special Retirement Provisions for
 *     Law Enforcement Officers, Firefighters, Air Traffic Controllers, and
 *     Military Reserve Technicians", Subchapter 46B (FERS), sections
 *     46B2.2-1 and 46B3.3-1: LEO/firefighter/ATC eligibility is age 50 with
 *     20 years of covered service, OR any age with 25 years of covered
 *     service ("Unlike CSRS, FERS law enforcement officers and firefighters
 *     may retire before age 50 if they have 25 years of service.").
 *   - https://www.opm.gov/retirement-center/fers-information/computation/ —
 *     the 1% standard formula; the 1.1% formula, explicitly conditioned on
 *     "Age 62 or Older at Separation With 20 or More Years of Service"; and
 *     the special-provision formula, "1.7% of your high-3 average salary
 *     multiplied by your years of service which do not exceed 20" plus "1%
 *     ... multiplied by your service exceeding 20 years".
 *   - https://www.opm.gov/retirement-center/fers-information/eligibility/ —
 *     immediate retirement paths (62+5, 60+20, MRA+30, MRA+10) and the MRA
 *     table by birth year.
 *   - https://www.opm.gov/retirement-center/survivor-benefits/ — full
 *     survivor election: 10% reduction, spouse gets 50% of the unreduced
 *     (i.e. pre-survivor-reduction) annuity; partial: 5% reduction, spouse
 *     gets 25%.
 */

// ---------------------------------------------------------------------------
// Basic annuity formula
// ---------------------------------------------------------------------------

export type RetirementCategory = "regular" | "specialProvision";

export const STANDARD_MULTIPLIER = 0.01;
export const ENHANCED_MULTIPLIER = 0.011;
/** The 1.1% multiplier requires BOTH of these — years alone is not enough */
export const ENHANCED_MULTIPLIER_MIN_AGE = 62;
export const ENHANCED_MULTIPLIER_MIN_YEARS = 20;

/** Law enforcement officers, firefighters, air traffic controllers */
export const SPECIAL_PROVISION_RATE_FIRST_20 = 0.017;
export const SPECIAL_PROVISION_RATE_AFTER_20 = 0.01;
export const SPECIAL_PROVISION_YEARS_CAP = 20;

export interface AnnuityInput {
  /** High-3 average salary, in dollars/year */
  highThree: number;
  /** Years of creditable service (or, for specialProvision, years of covered service) */
  yearsOfService: number;
  ageAtRetirement: number;
  category: RetirementCategory;
}

export type AnnuityTier = "standard" | "enhanced62" | "specialProvision";

export interface AnnuityBreakdown {
  tier: AnnuityTier;
  /** Human-readable explanation of which multiplier applied and why */
  multiplierNote: string;
  grossAnnualAnnuity: number;
  grossMonthlyAnnuity: number;
}

/**
 * The basic annuity formula only — does not check eligibility. Callers
 * should also run `checkImmediateEligibility` and show its result, since a
 * formula amount is meaningless (or actually wrong, e.g. no age reduction
 * applied) for someone who isn't eligible for an immediate, unreduced
 * annuity under the paths this module models.
 */
export function calculateFersAnnuity(input: AnnuityInput): AnnuityBreakdown {
  const highThree = Math.max(0, input.highThree || 0);
  const years = Math.max(0, input.yearsOfService || 0);

  if (input.category === "specialProvision") {
    const cappedYears = Math.min(years, SPECIAL_PROVISION_YEARS_CAP);
    const excessYears = Math.max(0, years - SPECIAL_PROVISION_YEARS_CAP);
    const grossAnnualAnnuity =
      highThree * SPECIAL_PROVISION_RATE_FIRST_20 * cappedYears +
      highThree * SPECIAL_PROVISION_RATE_AFTER_20 * excessYears;
    return {
      tier: "specialProvision",
      multiplierNote: "1.7% on the first 20 years of covered service, 1% on any years beyond that",
      grossAnnualAnnuity,
      grossMonthlyAnnuity: grossAnnualAnnuity / 12,
    };
  }

  const enhanced =
    input.ageAtRetirement >= ENHANCED_MULTIPLIER_MIN_AGE &&
    years >= ENHANCED_MULTIPLIER_MIN_YEARS;
  const rate = enhanced ? ENHANCED_MULTIPLIER : STANDARD_MULTIPLIER;
  const grossAnnualAnnuity = highThree * rate * years;

  return {
    tier: enhanced ? "enhanced62" : "standard",
    multiplierNote: enhanced
      ? "1.1%, since you're retiring at 62 or older with 20+ years of service"
      : "1% standard rate",
    grossAnnualAnnuity,
    grossMonthlyAnnuity: grossAnnualAnnuity / 12,
  };
}

// ---------------------------------------------------------------------------
// Minimum Retirement Age
// ---------------------------------------------------------------------------

export interface Mra {
  years: number;
  months: number;
  /** years + months/12, for comparing against a decimal age */
  decimal: number;
}

/** Birth years whose MRA doesn't fall on the flat 55/56/57 plateaus */
const MRA_STEP_TABLE: Record<number, { years: number; months: number }> = {
  1948: { years: 55, months: 2 },
  1949: { years: 55, months: 4 },
  1950: { years: 55, months: 6 },
  1951: { years: 55, months: 8 },
  1952: { years: 55, months: 10 },
  1965: { years: 56, months: 2 },
  1966: { years: 56, months: 4 },
  1967: { years: 56, months: 6 },
  1968: { years: 56, months: 8 },
  1969: { years: 56, months: 10 },
};

export function minimumRetirementAge(birthYear: number): Mra {
  let years: number;
  let months: number;
  if (birthYear < 1948) {
    years = 55;
    months = 0;
  } else if (birthYear >= 1953 && birthYear <= 1964) {
    years = 56;
    months = 0;
  } else if (birthYear >= 1970) {
    years = 57;
    months = 0;
  } else {
    const step = MRA_STEP_TABLE[birthYear] ?? { years: 55, months: 0 };
    years = step.years;
    months = step.months;
  }
  return { years, months, decimal: years + months / 12 };
}

// ---------------------------------------------------------------------------
// Immediate retirement eligibility
// ---------------------------------------------------------------------------

export type EligibilityPath =
  | "62+5"
  | "60+20"
  | "mra+30"
  | "specialProvision-50+20"
  | "specialProvision-any+25";

export interface EligibilityCheck {
  eligible: boolean;
  path: EligibilityPath | null;
  mra: Mra;
  /** Present when ineligible, or eligible via a path worth calling out */
  note?: string;
}

export interface EligibilityInput {
  ageAtRetirement: number;
  yearsOfService: number;
  birthYear: number;
  category: RetirementCategory;
}

export function checkImmediateEligibility(input: EligibilityInput): EligibilityCheck {
  const mra = minimumRetirementAge(input.birthYear);
  const age = input.ageAtRetirement || 0;
  const years = input.yearsOfService || 0;

  if (input.category === "specialProvision") {
    if (years >= 25) {
      return { eligible: true, path: "specialProvision-any+25", mra };
    }
    if (age >= 50 && years >= 20) {
      return { eligible: true, path: "specialProvision-50+20", mra };
    }
    return {
      eligible: false,
      path: null,
      mra,
      note:
        "Special-provision retirement (law enforcement, firefighter, or air traffic controller) needs " +
        "age 50 with 20 years of covered service, or any age with 25 years of covered service.",
    };
  }

  if (age >= 62 && years >= 5) return { eligible: true, path: "62+5", mra };
  if (age >= 60 && years >= 20) return { eligible: true, path: "60+20", mra };
  if (age >= mra.decimal && years >= 30) return { eligible: true, path: "mra+30", mra };

  const mraLabel = mra.months ? `${mra.years} years, ${mra.months} months` : `${mra.years}`;
  if (age >= mra.decimal && years >= 10) {
    return {
      eligible: false,
      path: null,
      mra,
      note:
        `At your Minimum Retirement Age (${mraLabel}) with ${years} years of service, you'd qualify for ` +
        "MRA+10 — an immediate annuity reduced 5/12 of 1% for every month you're under 62 (unless postponed). " +
        "This calculator doesn't model that reduction yet.",
    };
  }

  return {
    eligible: false,
    path: null,
    mra,
    note:
      "This combination of age and years of service doesn't meet FERS immediate (unreduced) retirement " +
      "eligibility (62 with 5 years, 60 with 20, or your MRA with 30). Deferred retirement may apply instead " +
      "— not modeled here.",
  };
}

// ---------------------------------------------------------------------------
// Survivor benefit election
// ---------------------------------------------------------------------------

export type SurvivorElection = "none" | "partial" | "full";

export const SURVIVOR_REDUCTION_PCT: Record<SurvivorElection, number> = {
  none: 0,
  partial: 0.05,
  full: 0.1,
};

export const SURVIVOR_BENEFIT_PCT: Record<SurvivorElection, number> = {
  none: 0,
  partial: 0.25,
  full: 0.5,
};

export interface SurvivorBreakdown {
  election: SurvivorElection;
  reductionPct: number;
  netAnnualAnnuity: number;
  netMonthlyAnnuity: number;
  survivorAnnualBenefit: number;
  survivorMonthlyBenefit: number;
}

/** `grossAnnualAnnuity` is the unreduced annuity — the survivor election reduces it, it doesn't come out of it */
export function applySurvivorElection(
  grossAnnualAnnuity: number,
  election: SurvivorElection,
): SurvivorBreakdown {
  const gross = Math.max(0, grossAnnualAnnuity || 0);
  const reductionPct = SURVIVOR_REDUCTION_PCT[election];
  const benefitPct = SURVIVOR_BENEFIT_PCT[election];
  const netAnnualAnnuity = gross * (1 - reductionPct);
  const survivorAnnualBenefit = gross * benefitPct;
  return {
    election,
    reductionPct,
    netAnnualAnnuity,
    netMonthlyAnnuity: netAnnualAnnuity / 12,
    survivorAnnualBenefit,
    survivorMonthlyBenefit: survivorAnnualBenefit / 12,
  };
}

// ---------------------------------------------------------------------------
// Everything together
// ---------------------------------------------------------------------------

export interface FersAnnuityInput {
  highThree: number;
  yearsOfService: number;
  ageAtRetirement: number;
  birthYear: number;
  category: RetirementCategory;
  survivorElection: SurvivorElection;
}

export interface FersAnnuityResult {
  eligibility: EligibilityCheck;
  annuity: AnnuityBreakdown;
  survivor: SurvivorBreakdown;
}

/**
 * Runs the eligibility check and the formula together. The formula amount is
 * always computed, even when `eligibility.eligible` is false, so the caller
 * can show "here's the formula amount if you kept working to reach an
 * unreduced path" alongside the eligibility note — it must not be presented
 * as this person's actual annuity when ineligible.
 */
export function estimateFersAnnuity(input: FersAnnuityInput): FersAnnuityResult {
  const eligibility = checkImmediateEligibility(input);
  const annuity = calculateFersAnnuity(input);
  const survivor = applySurvivorElection(annuity.grossAnnualAnnuity, input.survivorElection);
  return { eligibility, annuity, survivor };
}

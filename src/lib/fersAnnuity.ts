/**
 * fersAnnuity.ts
 *
 * FERS Basic Annuity estimator: the basic formula, immediate-retirement
 * eligibility (including MRA+10 and postponing it), and the spousal survivor
 * benefit election.
 *
 * Scope (see Issue #3 for what's deferred):
 *   - Immediate retirement: 62+5, 60+20, MRA+30 and MRA+10 for regular
 *     employees, VERA (voluntary early retirement, when the agency offers it:
 *     50+20 or any age+25, unreduced), and 50+20 / any age+25 for law
 *     enforcement officers, firefighters and air traffic controllers
 *     ("special provision").
 *   - MRA+10 is reduced 5/12 of 1% for each full month the annuity starts
 *     before age 62, unless the person has 20+ years and it starts at 60 or
 *     later. It can be postponed to shrink or remove the reduction
 *     (`annuityStartAge`). A VERA offer that the person qualifies for beats
 *     MRA+10, since VERA isn't reduced.
 *   - Deferred retirement, disability retirement, COLAs, unused sick leave
 *     credit and CSRS are NOT modeled. Combinations that don't qualify for an
 *     immediate annuity are reported as ineligible with an explanatory note,
 *     never silently computed.
 *
 * Order of calculation, per 5 CFR 842 subparts D and F and 843.306:
 *   1. Formula amount: High-3 x years x rate (842.403, 842.405).
 *   2. MRA+10 age reduction (842.404) — still part of the subpart D
 *      computation.
 *   3. Survivor election: the retiree's annuity is reduced 10% (full) or 5%
 *      (partial) of the step-2 amount (842.603(c)), and the spouse's benefit is
 *      50% or 25% of "an annuity computed under subpart D of part 842"
 *      (843.306(a)) — i.e. of the age-REDUCED annuity when MRA+10 applies.
 *
 * Sources (all fetched and read directly on 2026-09-24):
 *   - OPM CSRS/FERS Handbook, Chapter 46, Subchapter 46B (FERS), sections
 *     46B2.2-1 and 46B3.3-1: LEO/firefighter/ATC eligibility is age 50 with
 *     20 years of covered service, OR any age with 25 years of covered
 *     service ("Unlike CSRS, FERS law enforcement officers and firefighters
 *     may retire before age 50 if they have 25 years of service.").
 *   - https://www.opm.gov/retirement-center/fers-information/computation/ —
 *     the 1% standard formula; the 1.1% formula, conditioned on "Age 62 or
 *     Older at Separation With 20 or More Years of Service"; and the
 *     special-provision 1.7%/1% formula.
 *   - https://www.opm.gov/retirement-center/fers-information/eligibility/ —
 *     immediate retirement paths (62+5, 60+20, MRA+30, MRA+10) and the MRA
 *     table by birth year.
 *   - https://www.opm.gov/retirement-center/fers-information/types-of-retirement/
 *     — MRA+10: "reduced by 5/12 of 1 percent for each month (5 percent per
 *     year) that you are under age 62"; "If you have 20 years of creditable
 *     service and elect to have your annuity commence at age 60, the age
 *     reduction is eliminated"; a postponed annuity can begin "any date
 *     between your MRA and 2 days before your 62nd birthday", and FEHB/FEGLI
 *     can be picked up again then if held for the 5 years before separation.
 *   - 5 U.S.C. 8415(h) and 5 CFR 842.404 — the MRA+10 reduction is counted in
 *     "each full month by which the commencing date of annuity precedes the
 *     62nd birthday", waived with 20 years of service at age 60+ on the
 *     commencing date.
 *   - 5 U.S.C. 8415(i) and 5 CFR 842.403(b) — the 1.1% rate needs age 62+ "at
 *     the time of separation", and doesn't apply to special-provision
 *     employees; so postponing an MRA+10 annuity to 62 does NOT earn it.
 *   - 5 U.S.C. 8421(a)(1) — the FERS annuity supplement is payable under
 *     8412(a), (b), (d)(1), (e) and 8414(c); MRA+10 (8412(g)) is not listed.
 *     8421(a)(2): early retirees under 8414(b) (VERA, involuntary) get it only
 *     once they're "at least the applicable minimum retirement age".
 *   - 5 U.S.C. 8414(b)(1) — involuntary separation (not for cause) or VERA
 *     (an OPM-approved agency offer during restructuring, covering the
 *     employee) "after completing 25 years of service, or after becoming 50
 *     years of age and completing 20 years of service". Not reduced for age:
 *     8415(h) and 5 CFR 842.404 reduce only 8412(g)/8413(b) annuities.
 *   - https://www.opm.gov/retirement-center/survivor-benefits/, 5 CFR
 *     842.603(c) and 843.306(a), 5 U.S.C. 8442(a)(1) — full survivor election:
 *     10% reduction, spouse gets 50%; partial: 5% reduction, spouse gets 25%.
 */

// ---------------------------------------------------------------------------
// Basic annuity formula
// ---------------------------------------------------------------------------

export type RetirementCategory = "regular" | "specialProvision";

export const STANDARD_MULTIPLIER = 0.01;
export const ENHANCED_MULTIPLIER = 0.011;
/** The 1.1% multiplier requires BOTH of these, at separation — years alone is not enough */
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
  /** Age at separation — this, not the annuity start age, decides the 1.1% rate */
  ageAtRetirement: number;
  category: RetirementCategory;
}

export type AnnuityTier = "standard" | "enhanced62" | "specialProvision";

export interface AnnuityBreakdown {
  tier: AnnuityTier;
  /** Human-readable explanation of which multiplier applied and why */
  multiplierNote: string;
  /** The formula amount, before any age reduction or survivor election */
  grossAnnualAnnuity: number;
  grossMonthlyAnnuity: number;
}

/**
 * The basic annuity formula only — does not check eligibility or apply the
 * MRA+10 reduction. Use `estimateFersAnnuity` for the full picture.
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

export function mraLabel(mra: Mra): string {
  return mra.months ? `${mra.years} years, ${mra.months} months` : `${mra.years}`;
}

// ---------------------------------------------------------------------------
// Immediate retirement eligibility
// ---------------------------------------------------------------------------

export type EligibilityPath =
  | "62+5"
  | "60+20"
  | "mra+30"
  | "veraOrDsr"
  | "mra+10"
  | "specialProvision-50+20"
  | "specialProvision-any+25";

export interface EligibilityCheck {
  /** Entitled to an immediate annuity — which for "mra+10" is reduced unless postponed or waived */
  eligible: boolean;
  path: EligibilityPath | null;
  mra: Mra;
  /** Present when ineligible, or eligible via a path worth explaining */
  note?: string;
}

export interface EligibilityInput {
  ageAtRetirement: number;
  yearsOfService: number;
  birthYear: number;
  category: RetirementCategory;
  /**
   * Regular FERS only: the person has a VERA offer (voluntary early retirement)
   * or is being separated involuntarily, not for cause (discontinued service
   * retirement). Both use 5 U.S.C. 8414(b): 50 with 20 years, or any age with 25.
   */
  veraOrDsr?: boolean;
}

/** VERA / discontinued service retirement: 25 years at any age, or 50 with 20 (5 U.S.C. 8414(b)(1)) */
export function meetsVeraOrDsr(age: number, years: number): boolean {
  return years >= 25 || (age >= 50 && years >= 20);
}

export function checkImmediateEligibility(input: EligibilityInput): EligibilityCheck {
  const mra = minimumRetirementAge(input.birthYear);
  const age = input.ageAtRetirement || 0;
  const years = input.yearsOfService || 0;
  const veraOrDsr = input.category === "regular" && !!input.veraOrDsr;
  // Checked VERA/DSR but a regular path applies anyway: say so, since the offer isn't what makes them eligible
  const notNeeded = veraOrDsr
    ? "You'd qualify for this without VERA or discontinued service retirement too; the annuity is the same either way."
    : undefined;

  if (input.category === "specialProvision") {
    if (years >= 25) {
      return { eligible: true, path: "specialProvision-any+25", mra };
    }
    if (age >= 50 && years >= 20) {
      return { eligible: true, path: "specialProvision-50+20", mra };
    }
    let note =
      "Special-provision retirement (law enforcement, firefighter, or air traffic controller) needs " +
      "age 50 with 20 years of covered service, or any age with 25 years of covered service.";
    if (age >= mra.decimal) {
      note +=
        " At your Minimum Retirement Age with at least 10 years of total service, you may be able to retire " +
        "under MRA+10 as a regular FERS retiree instead — switch to Regular FERS and enter your total " +
        "creditable service to see that estimate.";
    }
    return { eligible: false, path: null, mra, note };
  }

  if (age >= 62 && years >= 5) return { eligible: true, path: "62+5", mra, note: notNeeded };
  if (age >= 60 && years >= 20) return { eligible: true, path: "60+20", mra, note: notNeeded };
  if (age >= mra.decimal && years >= 30) return { eligible: true, path: "mra+30", mra, note: notNeeded };
  // Checked before MRA+10: an early-retirement annuity isn't reduced for age, so it beats MRA+10
  if (veraOrDsr && meetsVeraOrDsr(age, years)) {
    return {
      eligible: true,
      path: "veraOrDsr",
      mra,
      note:
        age >= mra.decimal
          ? "Early retirement under VERA or discontinued service isn't reduced for age."
          : `Early retirement under VERA or discontinued service isn't reduced for age. The FERS Special ` +
            `Retirement Supplement, though, doesn't start until your Minimum Retirement Age (${mraLabel(mra)}).`,
    };
  }
  const veraOrDsrShort = veraOrDsr
    ? " VERA or discontinued service retirement would need age 50 with 20 years of service, or 25 years at any age."
    : "";

  if (age >= mra.decimal && years >= 10) {
    return {
      eligible: true,
      path: "mra+10",
      mra,
      note:
        `MRA+10: you're at or past your Minimum Retirement Age (${mraLabel(mra)}) with at least 10 years of ` +
        "service. The annuity is reduced 5/12 of 1% for each full month you're under 62 when it starts " +
        "(5% a year), unless you have 20+ years and it starts at 60 or later. You can postpone it to shrink " +
        "or remove the reduction." +
        veraOrDsrShort,
    };
  }

  return {
    eligible: false,
    path: null,
    mra,
    note:
      "This combination of age and years of service doesn't qualify for an immediate FERS annuity (62 with " +
      `5 years, 60 with 20, or your Minimum Retirement Age of ${mraLabel(mra)} with 30 — or with 10, reduced).` +
      veraOrDsrShort +
      " With at least 5 years of service you may be eligible for a deferred annuity instead — not modeled here.",
  };
}

// ---------------------------------------------------------------------------
// MRA+10 age reduction and postponement
// ---------------------------------------------------------------------------

/** 5/12 of 1% per full month under 62 — 5% a year */
export const MRA10_REDUCTION_PER_MONTH = 5 / 12 / 100;
/** OPM lets a postponed MRA+10 annuity begin as late as 2 days before the 62nd birthday — no reduction by then */
export const MRA10_LATEST_START_AGE = 62;

export interface AgeReduction {
  /** Age the annuity starts: the age at retirement, unless postponed */
  startAge: number;
  /** Full months between the start date and the 62nd birthday */
  fullMonthsUnder62: number;
  /** True when 20+ years and a start at 60 or later removes the reduction despite starting under 62 */
  waived: boolean;
  /** Fraction of the formula amount removed, e.g. 0.25 */
  pct: number;
}

/**
 * The MRA+10 reduction for an annuity starting at `startAge`. Months are
 * counted in full months only (a partial month doesn't count), per 5 CFR
 * 842.404; the small epsilon keeps decimal ages like 56.333... (56 years 4
 * months) from losing a month to floating-point rounding.
 */
export function mra10Reduction(yearsOfService: number, startAge: number): AgeReduction {
  const fullMonthsUnder62 = Math.max(0, Math.floor((62 - startAge) * 12 + 1e-9));
  const waived = fullMonthsUnder62 > 0 && yearsOfService >= 20 && startAge >= 60;
  return {
    startAge,
    fullMonthsUnder62,
    waived,
    pct: waived ? 0 : fullMonthsUnder62 * MRA10_REDUCTION_PER_MONTH,
  };
}

export interface StartAgeOption {
  startAge: number;
  reduction: AgeReduction;
  /** After the age reduction, before the survivor election */
  annualAnnuity: number;
}

/**
 * What an MRA+10 annuity would be for each possible start age: the age at
 * retirement itself, then every whole age after it up to 62.
 */
export function mra10StartAgeOptions(
  grossAnnualAnnuity: number,
  yearsOfService: number,
  ageAtRetirement: number,
): StartAgeOption[] {
  const ages = [ageAtRetirement];
  for (let a = Math.floor(ageAtRetirement) + 1; a <= MRA10_LATEST_START_AGE; a++) ages.push(a);
  return ages.map((startAge) => {
    const reduction = mra10Reduction(yearsOfService, startAge);
    return { startAge, reduction, annualAnnuity: Math.max(0, grossAnnualAnnuity) * (1 - reduction.pct) };
  });
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

/**
 * `annualAnnuity` is the annuity before the survivor election — after any
 * MRA+10 age reduction. Both the retiree's reduction and the spouse's benefit
 * are a share of it.
 */
export function applySurvivorElection(
  annualAnnuity: number,
  election: SurvivorElection,
): SurvivorBreakdown {
  const base = Math.max(0, annualAnnuity || 0);
  const reductionPct = SURVIVOR_REDUCTION_PCT[election];
  const benefitPct = SURVIVOR_BENEFIT_PCT[election];
  const netAnnualAnnuity = base * (1 - reductionPct);
  const survivorAnnualBenefit = base * benefitPct;
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
  /** Regular FERS only: VERA offer or involuntary (discontinued service) separation — see EligibilityInput */
  veraOrDsr?: boolean;
  /**
   * MRA+10 only: postpone the annuity to this age. Defaults to the age at
   * retirement; clamped to between that and 62. Ignored on other paths.
   */
  annuityStartAge?: number;
}

export interface FersAnnuityResult {
  eligibility: EligibilityCheck;
  annuity: AnnuityBreakdown;
  /** MRA+10 only; null on every other path */
  ageReduction: AgeReduction | null;
  /** The formula amount after any MRA+10 reduction — the base the survivor election works from */
  annualAnnuityAfterAgeReduction: number;
  monthlyAnnuityAfterAgeReduction: number;
  survivor: SurvivorBreakdown;
}

/**
 * Runs the eligibility check, the formula, the MRA+10 reduction and the
 * survivor election together. The formula amount is always computed, even
 * when `eligibility.eligible` is false, so the caller can show it alongside
 * the eligibility note — it must not be presented as this person's actual
 * annuity when ineligible.
 */
export function estimateFersAnnuity(input: FersAnnuityInput): FersAnnuityResult {
  const eligibility = checkImmediateEligibility(input);
  const annuity = calculateFersAnnuity(input);

  let ageReduction: AgeReduction | null = null;
  if (eligibility.path === "mra+10") {
    const requested = input.annuityStartAge ?? input.ageAtRetirement;
    const startAge = Math.min(MRA10_LATEST_START_AGE, Math.max(input.ageAtRetirement, requested));
    ageReduction = mra10Reduction(input.yearsOfService, startAge);
  }

  const annualAnnuityAfterAgeReduction = annuity.grossAnnualAnnuity * (1 - (ageReduction?.pct ?? 0));
  const survivor = applySurvivorElection(annualAnnuityAfterAgeReduction, input.survivorElection);
  return {
    eligibility,
    annuity,
    ageReduction,
    annualAnnuityAfterAgeReduction,
    monthlyAnnuityAfterAgeReduction: annualAnnuityAfterAgeReduction / 12,
    survivor,
  };
}

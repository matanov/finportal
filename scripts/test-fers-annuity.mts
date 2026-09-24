/**
 * test-fers-annuity.mts
 * Run: npm run test:fers-annuity
 *
 * Checks src/lib/fersAnnuity.ts against OPM's published rules, importing the
 * real module so there is no copy of the logic to drift out of date:
 *   - 1% standard multiplier; 1.1% only when BOTH age >= 62 AND years >= 20
 *     (years alone is not enough — this is the exact bug being fixed versus
 *     the old embedded estimate in High3Calculator.tsx, which used years only)
 *   - special-provision (LEO/firefighter/ATC) multiplier: 1.7% on the first
 *     20 years, 1% beyond, independent of age
 *   - Minimum Retirement Age by birth year, including the flat 56 plateau
 *     for 1953–1964
 *   - immediate eligibility paths: 62+5, 60+20, MRA+30, MRA+10 (regular);
 *     50+20 or any age+25 (special provision); fully-ineligible cases are
 *     flagged, not silently computed
 *   - MRA+10: 5/12 of 1% per FULL month under 62 at the annuity's start,
 *     waived with 20+ years starting at 60 or later (5 CFR 842.404);
 *     postponing shrinks it; postponing to 62 does not earn the 1.1% rate,
 *     which needs age 62 at separation (5 CFR 842.403(b))
 *   - survivor election: full = 10% reduction / 50% survivor benefit,
 *     partial = 5% / 25%, none = 0% / 0%, all a share of the annuity after
 *     any MRA+10 age reduction (5 CFR 843.306(a), 842.603(c))
 */

import {
  calculateFersAnnuity,
  checkImmediateEligibility,
  minimumRetirementAge,
  mra10Reduction,
  mra10StartAgeOptions,
  applySurvivorElection,
  estimateFersAnnuity,
  SPECIAL_PROVISION_YEARS_CAP,
} from "../src/lib/fersAnnuity.ts";

const failures: string[] = [];
let checks = 0;
const near = (a: number, b: number) => Math.abs(a - b) < 0.01;
const expect = (cond: boolean, msg: string) => {
  checks++;
  if (!cond) failures.push(msg);
};

// --- Basic formula: standard vs. enhanced (age 62 + 20 years) --------------

{
  const std = calculateFersAnnuity({
    highThree: 100_000,
    yearsOfService: 20,
    ageAtRetirement: 55,
    category: "regular",
  });
  expect(near(std.grossAnnualAnnuity, 20_000), "20yrs @55, $100k High-3: 1% standard = $20,000");
  expect(std.tier === "standard", "age 55 with 20 years is the standard tier, not enhanced");

  const enhanced = calculateFersAnnuity({
    highThree: 100_000,
    yearsOfService: 20,
    ageAtRetirement: 62,
    category: "regular",
  });
  expect(near(enhanced.grossAnnualAnnuity, 22_000), "20yrs @62, $100k High-3: 1.1% enhanced = $22,000");
  expect(enhanced.tier === "enhanced62", "age 62 with 20 years is the enhanced tier");

  // Regression test: years alone must NOT trigger the enhanced rate. The old
  // embedded estimate in High3Calculator.tsx used `years >= 20 ? 0.011 : 0.01`
  // with no age check — this is exactly the bug this module fixes.
  const under62 = calculateFersAnnuity({
    highThree: 100_000,
    yearsOfService: 25,
    ageAtRetirement: 55,
    category: "regular",
  });
  const oldBuggyAmount = 100_000 * 0.011 * 25; // what the old years-only logic would have given: $27,500
  expect(near(under62.grossAnnualAnnuity, 25_000), "25yrs @55 (under 62): 1% standard = $25,000, not the enhanced rate");
  expect(!near(under62.grossAnnualAnnuity, oldBuggyAmount), "25yrs @55 must differ from the old years-only 1.1% bug ($27,500)");
  expect(under62.tier === "standard", "years >= 20 alone, under age 62, is still the standard tier");

  // 20+ years but under 62 either way: still standard
  const years20under62 = calculateFersAnnuity({
    highThree: 100_000,
    yearsOfService: 20,
    ageAtRetirement: 61.9,
    category: "regular",
  });
  expect(years20under62.tier === "standard", "age just under 62 with 20 years is still standard, not enhanced");

  // 62+ but under 20 years: still standard
  const under20at62 = calculateFersAnnuity({
    highThree: 100_000,
    yearsOfService: 19,
    ageAtRetirement: 65,
    category: "regular",
  });
  expect(under20at62.tier === "standard", "age 65 with 19 years is still standard — needs 20+ years too");
  expect(near(under20at62.grossAnnualAnnuity, 19_000), "19yrs @65: 1% standard = $19,000");

  expect(near(calculateFersAnnuity({ highThree: -5000, yearsOfService: 10, ageAtRetirement: 55, category: "regular" }).grossAnnualAnnuity, 0), "negative High-3 clamps to $0 annuity, not negative");
  expect(near(calculateFersAnnuity({ highThree: 100_000, yearsOfService: -5, ageAtRetirement: 55, category: "regular" }).grossAnnualAnnuity, 0), "negative years clamps to $0 annuity");
}

// --- Special provision: LEO / firefighter / ATC ----------------------------

{
  // OPM handbook's own worked example: 25 years = (20 x 1.7%) + (5 x 1.0%) = 39% of High-3
  const leo25 = calculateFersAnnuity({
    highThree: 100_000,
    yearsOfService: 25,
    ageAtRetirement: 50,
    category: "specialProvision",
  });
  expect(near(leo25.grossAnnualAnnuity, 39_000), "OPM's own LEO example: 25 years = 39% of High-3 = $39,000");
  expect(leo25.tier === "specialProvision", "LEO/FF/ATC formula is its own tier");

  const leo15 = calculateFersAnnuity({
    highThree: 100_000,
    yearsOfService: 15,
    ageAtRetirement: 45,
    category: "specialProvision",
  });
  expect(near(leo15.grossAnnualAnnuity, 25_500), "15 years of covered service, all under the 20-year cap: 1.7% x 15 = 25.5%");

  // Special provision ignores the regular age-62 test entirely
  const leoAt65 = calculateFersAnnuity({
    highThree: 100_000,
    yearsOfService: 20,
    ageAtRetirement: 65,
    category: "specialProvision",
  });
  expect(near(leoAt65.grossAnnualAnnuity, 34_000), "special provision at 20 years is 1.7% x 20 = 34%, regardless of age");
  expect(SPECIAL_PROVISION_YEARS_CAP === 20, "the enhanced 1.7% tier is capped at 20 years, per OPM");
}

// --- Minimum Retirement Age table -------------------------------------------

{
  const cases: [number, number, number][] = [
    [1940, 55, 0],
    [1947, 55, 0],
    [1948, 55, 2],
    [1949, 55, 4],
    [1950, 55, 6],
    [1951, 55, 8],
    [1952, 55, 10],
    [1953, 56, 0],
    [1958, 56, 0],
    [1964, 56, 0],
    [1965, 56, 2],
    [1966, 56, 4],
    [1967, 56, 6],
    [1968, 56, 8],
    [1969, 56, 10],
    [1970, 57, 0],
    [1990, 57, 0],
  ];
  for (const [birthYear, years, months] of cases) {
    const mra = minimumRetirementAge(birthYear);
    expect(mra.years === years && mra.months === months, `MRA for birth year ${birthYear} is ${years}y ${months}mo, got ${mra.years}y ${mra.months}mo`);
    expect(near(mra.decimal, years + months / 12), `MRA decimal for ${birthYear} is years + months/12`);
  }
}

// --- Immediate eligibility: regular employees -------------------------------

{
  const e62 = checkImmediateEligibility({ ageAtRetirement: 62, yearsOfService: 5, birthYear: 1990, category: "regular" });
  expect(e62.eligible && e62.path === "62+5", "age 62 with 5 years is eligible via 62+5");

  const e60 = checkImmediateEligibility({ ageAtRetirement: 60, yearsOfService: 20, birthYear: 1990, category: "regular" });
  expect(e60.eligible && e60.path === "60+20", "age 60 with 20 years is eligible via 60+20, not 62+5");

  // MRA+30 at the exact MRA for a 1970+ birth year (MRA 57)
  const eMra30 = checkImmediateEligibility({ ageAtRetirement: 57, yearsOfService: 30, birthYear: 1975, category: "regular" });
  expect(eMra30.eligible && eMra30.path === "mra+30", "age === MRA with 30 years is eligible via MRA+30");

  // Just short of MRA: MRA+30 must not fire
  const belowMra = checkImmediateEligibility({ ageAtRetirement: 56.9, yearsOfService: 30, birthYear: 1975, category: "regular" });
  expect(!belowMra.eligible, "age just under MRA (57 for this birth year) with 30 years is not yet eligible");

  // MRA+10: at MRA with 10-29 years — an immediate annuity, reduced unless postponed or waived
  const mraPlus10 = checkImmediateEligibility({ ageAtRetirement: 57, yearsOfService: 15, birthYear: 1975, category: "regular" });
  expect(mraPlus10.eligible && mraPlus10.path === "mra+10", "MRA with 15 years is eligible via MRA+10");
  expect((mraPlus10.note ?? "").includes("MRA+10"), "the MRA+10 case explains itself by name");

  // MRA+10 wins over nothing else: 60+20, 62+5 and MRA+30 are all checked first
  const at61with15 = checkImmediateEligibility({ ageAtRetirement: 61, yearsOfService: 15, birthYear: 1975, category: "regular" });
  expect(at61with15.path === "mra+10", "age 61 with 15 years is MRA+10 (not 60+20: under 20 years; not 62+5: under 62)");
  const at59with22 = checkImmediateEligibility({ ageAtRetirement: 59, yearsOfService: 22, birthYear: 1966, category: "regular" });
  expect(at59with22.path === "mra+10", "age 59 with 22 years is MRA+10 (under 60, so not yet 60+20)");
  const at60with22 = checkImmediateEligibility({ ageAtRetirement: 60, yearsOfService: 22, birthYear: 1966, category: "regular" });
  expect(at60with22.path === "60+20", "age 60 with 22 years is 60+20, unreduced — not MRA+10");

  // Below even MRA+10 (under 10 years of service at MRA): ineligible, pointing at a deferred annuity
  const tooFewYears = checkImmediateEligibility({ ageAtRetirement: 57, yearsOfService: 8, birthYear: 1975, category: "regular" });
  expect(!tooFewYears.eligible && tooFewYears.path === null, "MRA with only 8 years doesn't meet even MRA+10");
  expect((tooFewYears.note ?? "").includes("deferred"), "the ineligible note points at a deferred annuity");

  // mra returned alongside eligibility, regardless of outcome
  expect(near(e62.mra.decimal, minimumRetirementAge(1990).decimal), "eligibility result carries the computed MRA");
}

// --- Immediate eligibility: special provision -------------------------------

{
  const any25 = checkImmediateEligibility({ ageAtRetirement: 45, yearsOfService: 25, birthYear: 1990, category: "specialProvision" });
  expect(any25.eligible && any25.path === "specialProvision-any+25", "any age with 25 years of covered service is eligible");

  const fifty20 = checkImmediateEligibility({ ageAtRetirement: 50, yearsOfService: 20, birthYear: 1990, category: "specialProvision" });
  expect(fifty20.eligible && fifty20.path === "specialProvision-50+20", "age 50 with 20 years of covered service is eligible");

  // 20+ years and 50+ but under 25: still eligible via 50+20, not any+25
  const between = checkImmediateEligibility({ ageAtRetirement: 60, yearsOfService: 24, birthYear: 1990, category: "specialProvision" });
  expect(between.eligible && between.path === "specialProvision-50+20", "24 years at 50+ is eligible via 50+20, since it's short of the 25-year mark");

  const tooYoungTooFewYears = checkImmediateEligibility({ ageAtRetirement: 45, yearsOfService: 18, birthYear: 1990, category: "specialProvision" });
  expect(!tooYoungTooFewYears.eligible, "under 50 with under 20 years and under 25 years total is not eligible");

  const underAgeEnoughYears = checkImmediateEligibility({ ageAtRetirement: 49, yearsOfService: 20, birthYear: 1990, category: "specialProvision" });
  expect(!underAgeEnoughYears.eligible, "20 years but under age 50 (and under 25 years) is not yet eligible for special provision");
}

// --- Survivor election --------------------------------------------------------

{
  const full = applySurvivorElection(20_000, "full");
  expect(near(full.reductionPct, 0.1), "full survivor election reduces the retiree's annuity by 10%");
  expect(near(full.netAnnualAnnuity, 18_000), "full election: $20,000 gross -> $18,000 net");
  expect(near(full.survivorAnnualBenefit, 10_000), "full election: spouse gets 50% of the unreduced annuity = $10,000");
  expect(near(full.netMonthlyAnnuity, 1_500), "monthly net is exactly annual / 12");
  expect(near(full.survivorMonthlyBenefit, 833.33), "monthly survivor benefit is exactly annual / 12");

  const partial = applySurvivorElection(20_000, "partial");
  expect(near(partial.reductionPct, 0.05), "partial survivor election reduces the retiree's annuity by 5%");
  expect(near(partial.netAnnualAnnuity, 19_000), "partial election: $20,000 gross -> $19,000 net");
  expect(near(partial.survivorAnnualBenefit, 5_000), "partial election: spouse gets 25% of the unreduced annuity = $5,000");

  const none = applySurvivorElection(20_000, "none");
  expect(near(none.reductionPct, 0), "no survivor election means no reduction");
  expect(near(none.netAnnualAnnuity, 20_000), "no election: net equals gross");
  expect(near(none.survivorAnnualBenefit, 0), "no election means no survivor benefit");

  expect(near(applySurvivorElection(-100, "full").netAnnualAnnuity, 0), "negative gross annuity clamps to $0, not negative");
}

// --- Everything together ------------------------------------------------------

{
  const eligible = estimateFersAnnuity({
    highThree: 120_000,
    yearsOfService: 30,
    ageAtRetirement: 60,
    birthYear: 1966,
    category: "regular",
    survivorElection: "full",
  });
  expect(eligible.eligibility.eligible && eligible.eligibility.path === "60+20", "60+20 wins when both 60+20 and MRA+30-eligible years are met at once");
  expect(near(eligible.annuity.grossAnnualAnnuity, 120_000 * 0.01 * 30), "combined result's annuity matches the standalone formula");
  expect(near(eligible.survivor.netAnnualAnnuity, eligible.annuity.grossAnnualAnnuity * 0.9), "combined result's survivor net matches the standalone election");

  // An ineligible combination still returns a computed formula amount, so the
  // UI can show it alongside the eligibility warning — it must never be
  // presented as this person's actual annuity, but it must not be silently
  // zeroed either.
  const ineligible = estimateFersAnnuity({
    highThree: 100_000,
    yearsOfService: 8,
    ageAtRetirement: 57,
    birthYear: 1975,
    category: "regular",
    survivorElection: "none",
  });
  expect(!ineligible.eligibility.eligible, "8 years at MRA is reported as ineligible");
  expect(near(ineligible.annuity.grossAnnualAnnuity, 100_000 * 0.01 * 8), "the formula amount is still computed even when ineligible");
  expect(ineligible.ageReduction === null, "no age reduction is applied off the MRA+10 path");
  expect(eligible.ageReduction === null, "no age reduction on an unreduced path (60+20)");
}

// --- MRA+10: the age reduction --------------------------------------------------

{
  // 5/12 of 1% per full month under 62 at the start date = 5% a year
  const at57 = mra10Reduction(15, 57);
  expect(at57.fullMonthsUnder62 === 60 && near(at57.pct * 100, 25), "starting at 57: 60 months under 62 = 25%");
  expect(!at57.waived, "15 years never waives the reduction");

  const at61 = mra10Reduction(15, 61);
  expect(at61.fullMonthsUnder62 === 12 && near(at61.pct * 100, 5), "starting at 61: 12 months = 5%");

  // Only FULL months count — a partial month doesn't
  const at57andHalf = mra10Reduction(15, 57.5);
  expect(at57andHalf.fullMonthsUnder62 === 54 && near(at57andHalf.pct * 100, 22.5), "starting at 57.5: 54 full months = 22.5%");
  const at5745 = mra10Reduction(15, 57.45);
  expect(at5745.fullMonthsUnder62 === 54, "57.45 is 54.6 months under 62 — only 54 full months count");

  // Floating point: 56 years 4 months (MRA for 1966) is 68 months under 62 exactly
  const mra1966 = minimumRetirementAge(1966).decimal;
  expect(mra10Reduction(15, mra1966).fullMonthsUnder62 === 68, "56y 4m as a decimal still counts 68 full months, not 67");

  // Starting at 62 (as late as OPM allows) — no reduction
  const at62 = mra10Reduction(15, 62);
  expect(at62.fullMonthsUnder62 === 0 && at62.pct === 0 && !at62.waived, "starting at 62: no months under 62, no reduction");

  // 20+ years and a start at 60 or later waives it (5 CFR 842.404(b))
  const waived60 = mra10Reduction(20, 60);
  expect(waived60.waived && waived60.pct === 0, "20 years starting at 60: reduction waived");
  expect(waived60.fullMonthsUnder62 === 24, "the months under 62 are still reported when waived");
  const waived61 = mra10Reduction(25, 61.5);
  expect(waived61.waived && waived61.pct === 0, "25 years starting at 61.5: reduction waived");
  const notYet60 = mra10Reduction(20, 59.9);
  expect(!notYet60.waived && notYet60.fullMonthsUnder62 === 25, "20 years starting at 59.9: not waived, 25 full months");
  const under20at60 = mra10Reduction(19, 60);
  expect(!under20at60.waived && near(under20at60.pct * 100, 10), "19 years starting at 60: not waived (needs 20), 24 months = 10%");
}

// --- MRA+10: postponement and the full estimate ------------------------------------

{
  const base = {
    highThree: 100_000,
    yearsOfService: 15,
    ageAtRetirement: 57,
    birthYear: 1975,
    category: "regular" as const,
    survivorElection: "none" as const,
  };

  const now = estimateFersAnnuity(base);
  expect(now.eligibility.path === "mra+10", "the full estimate recognizes MRA+10");
  expect(now.ageReduction !== null && now.ageReduction.startAge === 57, "no start age given: the annuity starts at the age at retirement");
  expect(near(now.annuity.grossAnnualAnnuity, 15_000), "formula amount: $100k x 15 x 1% = $15,000");
  expect(near(now.annualAnnuityAfterAgeReduction, 11_250), "starting at 57 cuts it 25%: $11,250");
  expect(near(now.monthlyAnnuityAfterAgeReduction, 937.5), "monthly is annual / 12");

  const postponed60 = estimateFersAnnuity({ ...base, annuityStartAge: 60 });
  expect(near(postponed60.annualAnnuityAfterAgeReduction, 13_500), "15 years postponed to 60: 24 months = 10%, $13,500");

  const postponed62 = estimateFersAnnuity({ ...base, annuityStartAge: 62 });
  expect(near(postponed62.annualAnnuityAfterAgeReduction, 15_000), "postponed to 62: no reduction, full $15,000");

  // Start ages outside the window are clamped, not trusted
  const tooEarly = estimateFersAnnuity({ ...base, annuityStartAge: 50 });
  expect(tooEarly.ageReduction?.startAge === 57, "a start age before retirement is clamped up to the age at retirement");
  const tooLate = estimateFersAnnuity({ ...base, annuityStartAge: 70 });
  expect(tooLate.ageReduction?.startAge === 62, "a start age past 62 is clamped to 62");

  // The start age is ignored off the MRA+10 path
  const unreduced = estimateFersAnnuity({ ...base, yearsOfService: 30, annuityStartAge: 60 });
  expect(unreduced.eligibility.path === "mra+30" && unreduced.ageReduction === null, "MRA+30 ignores a start age and has no reduction");

  // 20 years, postponed to 60: the reduction is waived entirely
  const twenty = estimateFersAnnuity({ ...base, yearsOfService: 20, annuityStartAge: 60 });
  expect(near(twenty.annualAnnuityAfterAgeReduction, 20_000), "20 years postponed to 60: waived, full $20,000");

  // Postponing to 62 does NOT earn the 1.1% rate — that needs age 62 at SEPARATION (5 CFR 842.403(b))
  const noEnhanced = estimateFersAnnuity({ ...base, yearsOfService: 25, annuityStartAge: 62 });
  expect(noEnhanced.annuity.tier === "standard", "MRA+10 postponed to 62 with 25 years still uses the 1% rate");
  expect(near(noEnhanced.annualAnnuityAfterAgeReduction, 25_000), "25 years postponed to 62: 1% x 25 = $25,000, not $27,500");

  // Survivor election works from the age-REDUCED annuity (5 CFR 843.306(a), 842.603(c))
  const withSurvivor = estimateFersAnnuity({ ...base, survivorElection: "full" });
  expect(near(withSurvivor.survivor.netAnnualAnnuity, 11_250 * 0.9), "full election: 10% off the age-reduced $11,250 = $10,125");
  expect(near(withSurvivor.survivor.survivorAnnualBenefit, 11_250 * 0.5), "full election: spouse gets 50% of the age-reduced $11,250 = $5,625");
  const partial = estimateFersAnnuity({ ...base, survivorElection: "partial" });
  expect(near(partial.survivor.netAnnualAnnuity, 11_250 * 0.95), "partial election: 5% off the age-reduced annuity");
  expect(near(partial.survivor.survivorAnnualBenefit, 11_250 * 0.25), "partial election: spouse gets 25% of the age-reduced annuity");
}

// --- MRA+10: start-age options ---------------------------------------------------

{
  const whole = mra10StartAgeOptions(15_000, 15, 57);
  expect(whole.map((o) => o.startAge).join(",") === "57,58,59,60,61,62", "retiring at 57: options at 57 through 62");
  expect(
    whole.map((o) => Math.round(o.reduction.pct * 100)).join(",") === "25,20,15,10,5,0",
    "15 years: 25/20/15/10/5/0% — no cliff, the reduction just shrinks each year",
  );
  expect(near(whole[whole.length - 1].annualAnnuity, 15_000), "the last option (62) is the full formula amount");

  const twentyYears = mra10StartAgeOptions(20_000, 20, 57);
  expect(
    twentyYears.map((o) => Math.round(o.reduction.pct * 100)).join(",") === "25,20,15,0,0,0",
    "20 years: the reduction drops to 0 at 60 — the 60+20 waiver",
  );

  const fractional = mra10StartAgeOptions(15_000, 15, 57.5);
  expect(fractional.map((o) => o.startAge).join(",") === "57.5,58,59,60,61,62", "retiring at 57.5: 57.5 first, then whole ages to 62");
  expect(near(fractional[0].annualAnnuity, 15_000 * (1 - 0.225)), "57.5: 54 full months = 22.5% off");
}

// --- VERA / discontinued service retirement (5 U.S.C. 8414(b)) ---------------------

{
  const e = (age: number, years: number, extra: Record<string, unknown> = {}) =>
    checkImmediateEligibility({ ageAtRetirement: age, yearsOfService: years, birthYear: 1975, category: "regular", veraOrDsr: true, ...extra });

  expect(e(57, 22).path === "veraOrDsr", "VERA/DSR at 57 with 22 years: early retirement, not MRA+10");
  expect(e(50, 20).path === "veraOrDsr", "VERA/DSR at exactly 50 with 20 years qualifies");
  expect(e(45, 25).path === "veraOrDsr", "VERA/DSR at any age with 25 years qualifies");
  expect(e(49.9, 24).path === null, "under 50 and under 25 years: VERA/DSR doesn't apply (and it's under MRA)");
  expect((e(49.9, 24).note ?? "").includes("50 with 20"), "the ineligible note spells out the VERA/DSR requirement");
  expect(e(57, 12).path === "mra+10", "12 years at MRA: VERA/DSR doesn't apply, MRA+10 still does");
  expect((e(57, 12).note ?? "").includes("VERA"), "…and the MRA+10 note says what VERA/DSR would need");

  // Regular unreduced paths come first; the note says the offer isn't needed
  const at60 = e(60, 20);
  expect(at60.path === "60+20" && (at60.note ?? "").includes("without VERA"), "60 with 20 years is 60+20 regardless, and says VERA isn't needed");
  expect(e(62, 25).path === "62+5", "62 with 25 years is 62+5 regardless of VERA/DSR");

  // Without the box checked, nothing changes
  expect(checkImmediateEligibility({ ageAtRetirement: 57, yearsOfService: 22, birthYear: 1975, category: "regular" }).path === "mra+10", "unchecked: 57 with 22 years is still MRA+10");
  expect(checkImmediateEligibility({ ageAtRetirement: 57, yearsOfService: 22, birthYear: 1975, category: "regular" }).note?.includes("VERA") === false, "unchecked: the MRA+10 note doesn't mention VERA");

  // Ignored for special-provision employees, who have their own 50+20 / any+25 rules
  const sp = checkImmediateEligibility({ ageAtRetirement: 45, yearsOfService: 22, birthYear: 1975, category: "specialProvision", veraOrDsr: true });
  expect(sp.path === null, "special provision ignores the VERA/DSR box");

  // The supplement note depends on reaching MRA (5 U.S.C. 8421(a)(2))
  expect((e(52, 25).note ?? "").includes("Minimum Retirement Age"), "under MRA: the note says the supplement waits for MRA");
  expect(!(e(58, 22).note ?? "").includes("Supplement"), "past MRA: no supplement caveat");

  // No age reduction, full formula amount — the big difference from MRA+10
  const base = { highThree: 100_000, yearsOfService: 22, ageAtRetirement: 57, birthYear: 1975, category: "regular" as const, survivorElection: "none" as const };
  const vera = estimateFersAnnuity({ ...base, veraOrDsr: true });
  const mra10 = estimateFersAnnuity(base);
  expect(vera.ageReduction === null && near(vera.annualAnnuityAfterAgeReduction, 22_000), "VERA/DSR at 57 with 22 years: unreduced $22,000");
  expect(near(mra10.annualAnnuityAfterAgeReduction, 22_000 * 0.75), "the same person without VERA/DSR: MRA+10, 25% off = $16,500");
  expect(estimateFersAnnuity({ ...base, veraOrDsr: true, annuityStartAge: 60 }).ageReduction === null, "a start age is ignored on the VERA/DSR path");
  expect(near(estimateFersAnnuity({ ...base, veraOrDsr: true, survivorElection: "full" }).survivor.survivorAnnualBenefit, 11_000), "VERA/DSR full survivor: 50% of the unreduced $22,000");
}

// --- Special provision falling short: points to MRA+10 when it could apply ----------

{
  const shortAtMra = checkImmediateEligibility({ ageAtRetirement: 57, yearsOfService: 15, birthYear: 1975, category: "specialProvision" });
  expect(!shortAtMra.eligible, "special provision with 15 years at 57 doesn't meet 50+20 or any+25");
  expect((shortAtMra.note ?? "").includes("MRA+10"), "at MRA, the note suggests MRA+10 as a regular retiree");
  const shortUnderMra = checkImmediateEligibility({ ageAtRetirement: 45, yearsOfService: 15, birthYear: 1975, category: "specialProvision" });
  expect(!(shortUnderMra.note ?? "").includes("MRA+10"), "under MRA, the note doesn't suggest MRA+10");
}

// --- Report -------------------------------------------------------------------

if (failures.length) {
  console.error(`${failures.length} of ${checks} checks failed:`);
  for (const f of failures.slice(0, 30)) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`All ${checks} FERS annuity checks passed.`);

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
 *   - immediate eligibility paths: 62+5, 60+20, MRA+30 (regular); 50+20 or
 *     any age+25 (special provision); MRA+10 and fully-ineligible cases are
 *     flagged, not silently computed as unreduced
 *   - survivor election: full = 10% reduction / 50% survivor benefit,
 *     partial = 5% / 25%, none = 0% / 0%, all off the unreduced annuity
 */

import {
  calculateFersAnnuity,
  checkImmediateEligibility,
  minimumRetirementAge,
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

  // MRA+10 territory: at MRA, 10-29 years — flagged, not computed as unreduced
  const mraPlus10 = checkImmediateEligibility({ ageAtRetirement: 57, yearsOfService: 15, birthYear: 1975, category: "regular" });
  expect(!mraPlus10.eligible && mraPlus10.path === null, "MRA with 15 years is MRA+10 territory: not modeled as an unreduced path");
  expect((mraPlus10.note ?? "").includes("MRA+10"), "the MRA+10 case explains itself by name");

  // Below even MRA+10 (under 10 years of service at MRA): generic ineligible note, not the MRA+10 one
  const tooFewYears = checkImmediateEligibility({ ageAtRetirement: 57, yearsOfService: 8, birthYear: 1975, category: "regular" });
  expect(!tooFewYears.eligible, "MRA with only 8 years doesn't meet even MRA+10");
  expect(!(tooFewYears.note ?? "").includes("MRA+10"), "under 10 years at MRA is not described as MRA+10");

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
  // UI can show "if you qualified" alongside the eligibility warning — it
  // must never be presented as this person's actual annuity, but it must not
  // be silently zeroed either.
  const ineligible = estimateFersAnnuity({
    highThree: 100_000,
    yearsOfService: 15,
    ageAtRetirement: 57,
    birthYear: 1975,
    category: "regular",
    survivorElection: "none",
  });
  expect(!ineligible.eligibility.eligible, "MRA+10 territory is reported as ineligible");
  expect(near(ineligible.annuity.grossAnnualAnnuity, 100_000 * 0.01 * 15), "the formula amount is still computed even when ineligible");
}

// --- Report -------------------------------------------------------------------

if (failures.length) {
  console.error(`${failures.length} of ${checks} checks failed:`);
  for (const f of failures.slice(0, 30)) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`All ${checks} FERS annuity checks passed.`);

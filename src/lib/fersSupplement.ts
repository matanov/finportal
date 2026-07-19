/**
 * fersSupplement.ts
 *
 * FERS Special Retirement Supplement (SRS) estimator.
 *
 * Formula per OPM CSRS/FERS Handbook Chapter 51:
 *   Monthly supplement = (estimated SS benefit at age 62) × (years of FERS
 *   civilian service ÷ 40)
 *
 * "Years of FERS civilian service" here is the service used to compute the
 * supplement itself — NOT the service used to compute the basic annuity.
 * Military service credited to the annuity through a military deposit
 * (buyback) counts toward the basic annuity's years of service, but OPM
 * excludes it from the supplement calculation. Callers must pass only
 * actual civilian FERS-creditable years; do not add buyback years in.
 */

export interface FersSupplementInput {
  /** Full-career Social Security benefit estimate at age 62, in dollars/month */
  monthlySocialSecurityEstimate: number;
  /** Years of civilian FERS-creditable service — military buyback years excluded */
  yearsOfFersCivilianService: number;
}

export interface FersSupplementResult {
  monthlySupplement: number;
  annualSupplement: number;
  /** yearsOfFersCivilianService / 40, i.e. the fraction of the SS estimate paid */
  serviceRatio: number;
}

const SUPPLEMENT_SERVICE_DIVISOR = 40;

export function calculateFersSupplement(
  input: FersSupplementInput,
): FersSupplementResult {
  const monthlySocialSecurityEstimate = Math.max(
    0,
    input.monthlySocialSecurityEstimate,
  );
  const yearsOfFersCivilianService = Math.max(
    0,
    input.yearsOfFersCivilianService,
  );

  const serviceRatio = yearsOfFersCivilianService / SUPPLEMENT_SERVICE_DIVISOR;
  const monthlySupplement = monthlySocialSecurityEstimate * serviceRatio;

  return {
    monthlySupplement,
    annualSupplement: monthlySupplement * 12,
    serviceRatio,
  };
}

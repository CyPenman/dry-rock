import { PARAMS } from './params';

export interface SoilMoistureCalibration {
  p5: number;
  p95: number;
}

// Placeholder until the weekly background calibration job (§3.5) has collected
// enough history for a given crag. Deliberately wide so an uncalibrated crag
// doesn't read as falsely saturated or falsely dry.
export const DEFAULT_SM_CALIBRATION: SoilMoistureCalibration = { p5: 0.1, p95: 0.4 };

/**
 * Primary seepage driver — spec §4.5. Modelled soil moisture already integrates
 * months of antecedent weather, snowmelt, drainage and evapotranspiration; the
 * squared exponent gives seepage its real character — negligible until the
 * ground is quite wet, then rising steeply.
 */
export function computeSmNorm(soilMoistureDeep: number, calibration: SoilMoistureCalibration = DEFAULT_SM_CALIBRATION): number {
  const range = calibration.p95 - calibration.p5;
  return range > 0 ? clamp((soilMoistureDeep - calibration.p5) / range, 0, 1) : 0;
}

export function computeSeepFluxFromSoilMoisture(
  soilMoistureDeep: number,
  seepIndex: number,
  calibration: SoilMoistureCalibration = DEFAULT_SM_CALIBRATION,
): number {
  const smNorm = computeSmNorm(soilMoistureDeep, calibration);
  return seepIndex * PARAMS.maxSeep * smNorm ** PARAMS.seepExp;
}

/**
 * Fallback seepage driver when soil moisture is unavailable for the selected
 * model (§4.5) — an exponentially-weighted mean of precipitation, tau = tauSeep
 * days, in place of the 5th/95th soil-moisture percentiles. `refMm` is the EWMA
 * precipitation rate (mm/hr) treated as "as good as saturated"; there's no
 * calibration data to anchor it in fallback mode, so it's a documented estimate
 * rather than a measurement, same as every other constant in §4.11.
 */
export function computeSeepFluxFallback(precipEwmaMm: number, seepIndex: number, refMm = 1.0): number {
  const smNorm = clamp(precipEwmaMm / refMm, 0, 1);
  return seepIndex * PARAMS.maxSeep * smNorm ** PARAMS.seepExp;
}

export function updatePrecipEwma(prevEwma: number, precipMm: number, tauSeepDays: number): number {
  const tauHours = tauSeepDays * 24;
  return prevEwma + (precipMm - prevEwma) * (1 / tauHours);
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

import { STEEPNESS_RAIN_EXPOSURE } from './rockDefaults';
import type { Steepness } from './types';

function deg2rad(d: number): number {
  return (d * Math.PI) / 180;
}

export interface PfaceInputs {
  precipitationMm: number;
  steepness: Steepness;
  windSpeedMs: number;
  windDirectionDeg: number; // meteorological convention: direction the wind comes FROM
  aspectDeg: number; // compass bearing the crag face looks toward
  kWDR: number;
}

/**
 * Water actually arriving at the face — spec §4.2. Rain falls vertically-ish and
 * crags are not horizontal: a slab catches more than the horizontal rate, a roof
 * almost nothing, and wind-driven rain hoses a face aligned with the wind.
 */
export function computePface(inputs: PfaceInputs): number {
  const { precipitationMm, steepness, windSpeedMs, windDirectionDeg, aspectDeg, kWDR } = inputs;

  const Pgeom = precipitationMm * STEEPNESS_RAIN_EXPOSURE[steepness];

  const alignment = Math.max(0, Math.cos(deg2rad(windDirectionDeg - aspectDeg)));
  const drivingRain = 1 + kWDR * (windSpeedMs / 10) * alignment;

  return Pgeom * drivingRain;
}

/**
 * Exponentially-weighted running mean of Pface, tau in hours — the drainage-from-
 * above driver (§4.2: "Some venues take drainage over the lip for many hours after
 * the rain stops"). Call once per hour with the previous EWMA value and the
 * current hour's Pface.
 */
export function updatePfaceEwma(prevEwma: number, pface: number, tauHours: number): number {
  return prevEwma + (pface - prevEwma) * (1 / tauHours);
}

export function computeRunoffAbove(catchmentAbove: number, pfaceEwma: number): number {
  return catchmentAbove * pfaceEwma;
}

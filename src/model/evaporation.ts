import { PARAMS } from './params';
import { surfaceDeficitKpa } from './vapour';

export interface EvaporationInputs {
  gtiFaceWm2: number;
  /** Air vapour pressure deficit, kPa - only used when `dewPointC` is absent (see `computeAeroFlux`). */
  vpdKpa: number;
  /** Dew point, °C. When given, the aerodynamic term runs on the rock-surface deficit instead of the air's VPD. */
  dewPointC?: number;
  windSpeedMs: number;
  canopyLight: number;
  windShelter: number;
  dryingRate: number;
  trockC: number;
  visibilityM: number;
}

/**
 * Aerodynamic moisture flux between the rock surface and the air, mm/hr -
 * §4.3/§4.4. Positive dries the rock; negative is dew forming on it. Driven by
 * es(rock) - es(dew point) (vapour.ts), so the same equation and the same
 * constant (kAero) give both drying and condensation: at about 10°C one degree
 * of dew-point spread is about 0.082 kPa, i.e. about 0.008 mm/hr per °C, which
 * is what the separate condensation constant used to be.
 *
 * Without a dew point it falls back to the air's VPD, which can never go
 * negative - kept for callers that only have the older inputs.
 */
export function computeAeroFlux(inputs: Omit<EvaporationInputs, 'gtiFaceWm2' | 'canopyLight' | 'visibilityM'>): number {
  const { vpdKpa, dewPointC, windSpeedMs, windShelter, dryingRate, trockC } = inputs;
  const deficit = dewPointC != null ? surfaceDeficitKpa(trockC, dewPointC) : vpdKpa;
  const windFn = 0.3 + 0.7 * Math.min(windSpeedMs / PARAMS.windRef, 1.5);
  return PARAMS.kAero * deficit * windFn * windShelter * dryingRate;
}

/**
 * Evaporation potential - spec §4.3. A Penman-style decomposition into a
 * radiative term (zero at night) and an aerodynamic term (works in the dark and
 * cold - this is what makes a cold dry northerly dry rock fast). The aerodynamic
 * term is the drying side of `computeAeroFlux`; its negative side is dew, which
 * `stepHour` adds as condensation instead.
 */
export function computeE0(inputs: EvaporationInputs): number {
  const { gtiFaceWm2, canopyLight, dryingRate, trockC, visibilityM } = inputs;

  const Erad = PARAMS.kRad * (gtiFaceWm2 / 1000);
  const Eaero = Math.max(0, computeAeroFlux(inputs));

  let E0 = Erad * canopyLight * dryingRate + Eaero;

  if (trockC < 0) E0 *= 0.05; // frozen rock - ice sublimates, slowly
  if (visibilityM < 1000) E0 *= 0.2; // fog / valley inversion stops drying dead

  return Math.max(0, E0);
}

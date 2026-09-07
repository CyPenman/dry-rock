import { PARAMS } from './params';

export interface EvaporationInputs {
  gtiFaceWm2: number;
  vpdKpa: number;
  windSpeedMs: number;
  canopyLight: number;
  windShelter: number;
  dryingRate: number;
  trockC: number;
  visibilityM: number;
}

/**
 * Evaporation potential — spec §4.3. A Penman-style decomposition into a
 * radiative term (zero at night) and an aerodynamic term (works in the dark and
 * cold — this is what makes a cold dry northerly dry rock fast).
 */
export function computeE0(inputs: EvaporationInputs): number {
  const { gtiFaceWm2, vpdKpa, windSpeedMs, canopyLight, windShelter, dryingRate, trockC, visibilityM } = inputs;

  const Erad = PARAMS.kRad * (gtiFaceWm2 / 1000);
  const windFn = 0.3 + 0.7 * Math.min(windSpeedMs / PARAMS.windRef, 1.5);
  const Eaero = PARAMS.kAero * vpdKpa * windFn * windShelter;

  let E0 = (Erad * canopyLight + Eaero) * dryingRate;

  if (trockC < 0) E0 *= 0.05; // frozen rock — ice sublimates, slowly
  if (visibilityM < 1000) E0 *= 0.2; // fog / valley inversion stops drying dead

  return Math.max(0, E0);
}

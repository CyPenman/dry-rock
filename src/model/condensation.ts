import { PARAMS } from './params';

/**
 * Condensation flux onto the surface — spec §4.4. The largest single mechanism
 * missing from v1: gritstone runs wet at dawn after a bone-dry week because the
 * rock cooled below the dew point overnight, nothing to do with rainfall. Wind
 * matters because condensation is limited by how fast humid air reaches the
 * surface — dead calm deposits less than a light breeze.
 */
export function computeCondensationFlux(trockC: number, dewPointC: number, windSpeedMs: number): number {
  if (trockC >= dewPointC) return 0;
  const spread = dewPointC - trockC;
  return PARAMS.kCond * spread * (0.5 + 0.5 * Math.min(windSpeedMs / 5, 1));
}

/**
 * Wind chill is a comfort factor for the climber, distinct from `frictionScoreHour`'s
 * rock-temperature terms - the rock can be dry and grippy while the wind is still
 * numbing hands and belaying is miserable. Kept as a separate caveat rather than
 * folded into the score, matching how `confidenceCaveat` handles showery days: a
 * number never silently absorbs a factor the climber should be told about directly.
 */

/**
 * Environment Canada / US NWS wind chill formula. Only physically meaningful
 * at or below 10C with a wind above ~4.8 km/h (1.34 m/s) - outside that range
 * "feels like" is just the air temperature itself.
 */
export function windChillC(airTempC: number, windSpeedMs: number): number {
  const windKmh = windSpeedMs * 3.6;
  if (airTempC > 10 || windKmh <= 4.8) return airTempC;
  const v016 = Math.pow(windKmh, 0.16);
  return 13.12 + 0.6215 * airTempC - 11.37 * v016 + 0.3965 * airTempC * v016;
}

/** Below this, hands numbing up on holds/gear is a real concern, not just "a bit nippy". */
export const WIND_CHILL_CAVEAT_THRESHOLD_C = 0;

export function windChillCaveat(worstWindChillC: number | null): string | null {
  if (worstWindChillC == null || worstWindChillC >= WIND_CHILL_CAVEAT_THRESHOLD_C) return null;
  return `cold in the wind - feels like ${Math.round(worstWindChillC)}°C, hands may struggle`;
}

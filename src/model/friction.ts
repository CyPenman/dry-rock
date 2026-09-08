import type { RockType } from './types';

export interface FrictionHourInputs {
  trockC: number;
  idealTempC: [number, number];
  dewPointC: number;
  windSpeedMs: number;
  /** Meteorological convention: direction the wind comes FROM. Optional — when
   * absent (e.g. older fixtures), the coastal salt penalty falls back to applying
   * on humidity alone rather than assuming offshore. */
  windDirectionDeg?: number;
  gtiFaceWm2: number;
  aspectDeg: number;
  coastal: boolean;
  rock: RockType;
}

function deg2rad(d: number): number {
  return (d * Math.PI) / 180;
}

/**
 * Smooth 0→1 ramp between `lo` and `hi` (cubic Hermite / "smoothstep"). Used in
 * place of hard thresholds throughout this module: a forecast landing a
 * fraction of a degree either side of a spec anchor (e.g. dew point 12°C, wind
 * 11 m/s) should not flip a discrete penalty on or off — that's a modelling
 * artefact, not a real signal, and the same "no cliff edge" reasoning the
 * seepage fallback already applies (§4.5).
 */
function smoothstep(x: number, lo: number, hi: number): number {
  if (lo === hi) return x >= hi ? 1 : 0;
  const t = Math.max(0, Math.min(1, (x - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
}

/** How far outside the ideal band this hour's rock temperature sits, 0 (ideal) to 1 (far off). */
function tempPenalty(trockC: number, idealTempC: [number, number]): number {
  const [lo, hi] = idealTempC;
  if (trockC >= lo && trockC <= hi) return 0;
  const dist = trockC < lo ? lo - trockC : trockC - hi;
  const bandWidth = Math.max(1, hi - lo);
  return Math.min(1, dist / bandWidth);
}

/**
 * Friction score for one daylight hour — spec §4.8. Dry is necessary, not
 * sufficient: grit in a damp heatwave is greasy even bone dry. Judged on rock
 * temperature (what your skin touches) and dew point (what climbers actually
 * judge conditions by), not air temperature or relative humidity.
 *
 * Every modifier below is a smooth ramp centred on the spec's own anchor value
 * (§4.8), not a step function — see `smoothstep` — so the score varies
 * continuously with conditions instead of jumping at an arbitrary threshold.
 */
export function frictionScoreHour(inputs: FrictionHourInputs): number {
  const { trockC, idealTempC, dewPointC, windSpeedMs, windDirectionDeg, gtiFaceWm2, aspectDeg, coastal, rock } = inputs;

  let score = 1 - tempPenalty(trockC, idealTempC);

  // Dew point: greasy above ~12C, crisp below ~5C — ramped across a band
  // centred on each anchor rather than snapping at it.
  const muggyPenalty = 0.3 * smoothstep(dewPointC, 10, 14);
  const crispBonus = 0.05 * (1 - smoothstep(dewPointC, 3, 7));
  score += crispBonus - muggyPenalty;

  // Condensation onset: heavy penalty as Trock closes in on the dew point —
  // the rock is on the edge of sweating, regardless of the absolute dew point.
  const spread = trockC - dewPointC;
  score -= 0.4 * (1 - smoothstep(spread, 0, 4));

  // Wind: reward the bouldering-relevant 3-7 m/s range, penalise above ~11 m/s.
  const windBonus = 0.1 * smoothstep(windSpeedMs, 2, 3) * (1 - smoothstep(windSpeedMs, 7, 8));
  const windPenalty = 0.2 * smoothstep(windSpeedMs, 9, 13);
  score += windBonus - windPenalty;

  // Strong sun on a south-facing wall above ~20C: a summer non-starter, even
  // though the same aspect is why it's a brilliant winter venue.
  const facingSouth = Math.abs(((aspectDeg - 180 + 180) % 360) - 180) < 45;
  const sunHeat = smoothstep(gtiFaceWm2, 400, 600) * smoothstep(trockC, 18, 22);
  if (facingSouth) score -= 0.3 * sunHeat;

  // Coastal salt is hygroscopic and holds damp in a humid onshore breeze — a
  // friction effect even when the rock is dry by any direct measurement (§4.8:
  // "high humidity AND the wind is onshore"). Onshore = wind blowing toward the
  // face, same alignment test as wind-driven rain (§4.2). Without a wind
  // direction to judge (older callers/fixtures), fall back to humidity alone
  // rather than silently dropping the effect.
  if (coastal) {
    const onshore = windDirectionDeg == null || Math.cos(deg2rad(windDirectionDeg - aspectDeg)) > 0;
    if (onshore) score -= 0.15 * smoothstep(dewPointC, 8, 12);
  }

  // Slate gets glassy in strong sun and heat — a friction problem, not a wetness one.
  if (rock === 'slate') score -= 0.3 * sunHeat;

  return Math.max(0, Math.min(1, score));
}

/** Best contiguous 3h daylight block's mean friction score for the day (§4.9). */
export function bestFrictionBlock(hourlyScores: number[], isDayFlags: boolean[], blockLength = 3): number {
  let best = 0;
  for (let i = 0; i + blockLength <= hourlyScores.length; i++) {
    let allDay = true;
    let sum = 0;
    for (let j = i; j < i + blockLength; j++) {
      if (!isDayFlags[j]) {
        allDay = false;
        break;
      }
      sum += hourlyScores[j];
    }
    if (allDay) best = Math.max(best, sum / blockLength);
  }
  return best;
}

import type { RockType } from './types';

export interface FrictionHourInputs {
  trockC: number;
  idealTempC: [number, number];
  dewPointC: number;
  windSpeedMs: number;
  gtiFaceWm2: number;
  aspectDeg: number;
  coastal: boolean;
  rock: RockType;
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
 */
export function frictionScoreHour(inputs: FrictionHourInputs): number {
  const { trockC, idealTempC, dewPointC, windSpeedMs, gtiFaceWm2, aspectDeg, coastal, rock } = inputs;

  let score = 1 - tempPenalty(trockC, idealTempC);

  // Dew point: below ~5C is good friction, above ~12C is greasy; penalise
  // heavily as the rock approaches its own condensation point.
  if (dewPointC > 12) score -= 0.3;
  else if (dewPointC < 5) score += 0.05;
  if (trockC - dewPointC < 2) score -= 0.4;

  // Wind: reward a light breeze (bouldering-relevant range), penalise strong wind.
  if (windSpeedMs >= 3 && windSpeedMs <= 7) score += 0.1;
  if (windSpeedMs > 11) score -= 0.2;

  // Strong sun on a south-facing wall above 20C: a summer non-starter, even
  // though the same aspect makes it a brilliant winter venue.
  const facingSouth = Math.abs(((aspectDeg - 180 + 180) % 360) - 180) < 45;
  if (facingSouth && gtiFaceWm2 > 500 && trockC > 20) score -= 0.3;

  // Coastal salt is hygroscopic and holds damp in humid onshore air — a
  // friction effect even when the rock is dry by any direct measurement.
  if (coastal && dewPointC > 10) score -= 0.15;

  // Slate in strong sun/heat gets glassy — a friction problem, not a wetness one.
  if (rock === 'slate' && gtiFaceWm2 > 500 && trockC > 20) score -= 0.3;

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

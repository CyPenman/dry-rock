import type { Discipline, RockType } from './types';
import { saturationVapourPressureKpa } from './vapour';

export interface FrictionHourInputs {
  trockC: number;
  idealTempC: [number, number];
  dewPointC: number;
  windSpeedMs: number;
  /** Meteorological convention: direction the wind comes FROM. Optional - when
   * absent (e.g. older fixtures), the coastal salt penalty falls back to applying
   * on humidity alone rather than assuming offshore. */
  windDirectionDeg?: number;
  gtiFaceWm2: number;
  aspectDeg: number;
  coastal: boolean;
  rock: RockType;
  /** What this crag is climbed as - shapes the wind sweet spot (see `windBandFor`).
   * Optional so existing callers/fixtures default to the original bouldering-tuned
   * band rather than failing to compile. */
  disciplines?: Discipline[];
}

function deg2rad(d: number): number {
  return (d * Math.PI) / 180;
}


/**
 * Relative humidity AT THE ROCK SURFACE, 0-1 - es(dew point) / es(Trock).
 * Deliberately not the API's `relative_humidity_2m`: what matters for a salt
 * film is the humidity the film itself sits in, on rock that can be 10C off air
 * temperature (§4.2), not the humidity two metres out in front of the face.
 * Clamped at 1 - past saturation the rock is condensing, which §4.4 handles.
 */
function rockSurfaceRh(trockC: number, dewPointC: number): number {
  return Math.min(1, saturationVapourPressureKpa(dewPointC) / saturationVapourPressureKpa(trockC));
}

/**
 * Rock-surface RH ramp over which sea salt goes from dry crystal to sticky.
 * NaCl deliquesces at about 75% RH; the ramp straddles it rather than snapping
 * at it, same "no cliff edge" practice as every other modifier here.
 */
const SALT_RH_RAMP: [number, number] = [0.72, 0.85];

/**
 * Smooth 0→1 ramp between `lo` and `hi` (cubic Hermite / "smoothstep"). Used in
 * place of hard thresholds throughout this module: a forecast landing a
 * fraction of a degree either side of a spec anchor (e.g. dew point 12°C, wind
 * 11 m/s) should not flip a discrete penalty on or off - that's a modelling
 * artefact, not a real signal, and the same "no cliff edge" reasoning the
 * seepage fallback already applies (§4.5).
 */
export function smoothstep(x: number, lo: number, hi: number): number {
  if (lo === hi) return x >= hi ? 1 : 0;
  const t = Math.max(0, Math.min(1, (x - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
}

interface WindBand {
  bonusRampUp: [number, number];
  bonusRampDown: [number, number];
  penaltyRamp: [number, number];
}

/**
 * Bouldering puts skin directly on rock at head height - a stiff breeze that's
 * pleasant on a rope is already drying fingertips and chilling hands there, so
 * its sweet spot is narrower and lower than a roped discipline's.
 */
const BOULDER_WIND_BAND: WindBand = { bonusRampUp: [2, 3], bonusRampDown: [7, 8], penaltyRamp: [9, 13] };

/**
 * Sport/trad climbers are higher off the deck, less skin-intensive, and often
 * grateful for wind that keeps midges off - so the same breeze is welcome
 * further up the scale before it becomes a problem (rope handling, being
 * heard, being blown off small holds).
 */
const ROPED_WIND_BAND: WindBand = { bonusRampUp: [3, 4], bonusRampDown: [9, 10], penaltyRamp: [12, 17] };

/**
 * When a crag serves both bouldering and a roped discipline, score to the more
 * conservative (bouldering) band - a day windy enough to bother the boulderer
 * shouldn't read as ideal just because the same crag also has routes.
 */
function windBandFor(disciplines: Discipline[] | undefined): WindBand {
  if (!disciplines || disciplines.length === 0 || disciplines.includes('boulder')) return BOULDER_WIND_BAND;
  return ROPED_WIND_BAND;
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
 * Each friction penalty for one hour, as the (positive) amount it took off the
 * score, so a day can say WHY its friction was poor in one line (§1, §6).
 * `score` is exactly `frictionScoreHour`'s result. Terms that don't apply to
 * this crag (sun-baked on a non-south face, slate glassiness on other rock,
 * salt inland or offshore) are 0.
 */
export interface FrictionBreakdown {
  /** Distance of the rock temperature outside the ideal band, 0-1 - too warm or too cold. */
  temp: number;
  muggy: number;
  nearDewPoint: number;
  windy: number;
  sunBaked: number;
  salt: number;
  slateGlassy: number;
  score: number;
}

/**
 * Friction score for one daylight hour - spec §4.8. Dry is necessary, not
 * sufficient: grit in a damp heatwave is greasy even bone dry. Judged on rock
 * temperature (what your skin touches) and dew point (what climbers actually
 * judge conditions by), not air temperature or relative humidity.
 *
 * Every modifier below is a smooth ramp centred on the spec's own anchor value
 * (§4.8), not a step function - see `smoothstep` - so the score varies
 * continuously with conditions instead of jumping at an arbitrary threshold.
 */
export function frictionScoreHour(inputs: FrictionHourInputs): number {
  return frictionBreakdownHour(inputs).score;
}

/** `frictionScoreHour` with every penalty term reported separately - see `FrictionBreakdown`. */
export function frictionBreakdownHour(inputs: FrictionHourInputs): FrictionBreakdown {
  const { trockC, idealTempC, dewPointC, windSpeedMs, windDirectionDeg, gtiFaceWm2, aspectDeg, coastal, rock, disciplines } =
    inputs;

  const temp = tempPenalty(trockC, idealTempC);
  let score = 1 - temp;

  // Dew point: greasy above ~12C, crisp below ~5C - ramped across a band
  // centred on each anchor rather than snapping at it.
  const muggyPenalty = 0.3 * smoothstep(dewPointC, 10, 14);
  const crispBonus = 0.05 * (1 - smoothstep(dewPointC, 3, 7));
  score += crispBonus - muggyPenalty;

  // Condensation onset: heavy penalty as Trock closes in on the dew point -
  // the rock is on the edge of sweating, regardless of the absolute dew point.
  const spread = trockC - dewPointC;
  const nearDewPoint = 0.4 * (1 - smoothstep(spread, 0, 4));
  score -= nearDewPoint;

  // Wind: reward a discipline-appropriate sweet spot, penalise above its top end.
  const windBand = windBandFor(disciplines);
  const windBonus =
    0.1 *
    smoothstep(windSpeedMs, windBand.bonusRampUp[0], windBand.bonusRampUp[1]) *
    (1 - smoothstep(windSpeedMs, windBand.bonusRampDown[0], windBand.bonusRampDown[1]));
  const windPenalty = 0.2 * smoothstep(windSpeedMs, windBand.penaltyRamp[0], windBand.penaltyRamp[1]);
  score += windBonus - windPenalty;

  // Strong sun on a south-facing wall above ~20C: a summer non-starter, even
  // though the same aspect is why it's a brilliant winter venue.
  const facingSouth = Math.abs(((aspectDeg - 180 + 180) % 360) - 180) < 45;
  const sunHeat = smoothstep(gtiFaceWm2, 400, 600) * smoothstep(trockC, 18, 22);
  const sunBaked = facingSouth ? 0.3 * sunHeat : 0;
  score -= sunBaked;

  // Coastal salt is hygroscopic and holds damp in a humid onshore breeze - a
  // friction effect even when the rock is dry by any direct measurement (§4.8:
  // "high humidity AND the wind is onshore"). Onshore = wind blowing toward the
  // face, same alignment test as wind-driven rain (§4.2). Without a wind
  // direction to judge (older callers/fixtures), fall back to humidity alone
  // rather than silently dropping the effect.
  //
  // Judged on rock-surface RH, not dew point. Salt goes sticky by deliquescence,
  // which is an RH threshold - and one dew point maps to wildly different RH
  // depending on how warm the rock is: 12C dew point on 13C rock is 94% RH and
  // greasy, the same dew point on 28C rock is 37% RH and dry crystal. This term
  // previously ramped on dew point 8-12C, which is §4.8's "use dew point, not
  // relative humidity" rule over-applied - that rule is about the friction
  // BAND, where the spec's own wording for this term is "when humidity is high".
  // The old form charged south-facing Portland up to 0.10 an hour on warm days
  // whose rock-surface RH never left the 50s.
  let salt = 0;
  if (coastal) {
    const onshore = windDirectionDeg == null || Math.cos(deg2rad(windDirectionDeg - aspectDeg)) > 0;
    if (onshore) salt = 0.15 * smoothstep(rockSurfaceRh(trockC, dewPointC), SALT_RH_RAMP[0], SALT_RH_RAMP[1]);
  }
  score -= salt;

  // Slate gets glassy in strong sun and heat - a friction problem, not a wetness one.
  const slateGlassy = rock === 'slate' ? 0.3 * sunHeat : 0;
  score -= slateGlassy;

  return {
    temp,
    muggy: muggyPenalty,
    nearDewPoint,
    windy: windPenalty,
    sunBaked,
    salt,
    slateGlassy,
    score: Math.max(0, Math.min(1, score)),
  };
}

export type FrictionReason = 'too_warm' | 'too_cold' | 'humid' | 'near_dew_point' | 'windy' | 'sun_baked' | 'salt';

/** Below this average penalty a term is not worth naming as the day's reason. */
const FRICTION_REASON_MIN_PENALTY = 0.1;

/**
 * The single biggest friction penalty across a window's hours (§1: every result
 * answers "why?" in one line), or null when none averages at least 0.1. The
 * temperature term becomes too warm or too cold by which side of the ideal band
 * the window's mean rock temperature is on. Slate glassiness counts as
 * sun-baked - it is the same sun-and-heat term, on a different rock.
 */
export function frictionReasonForWindow(
  breakdowns: FrictionBreakdown[],
  meanRockTempC: number,
  idealTempC: [number, number],
): FrictionReason | null {
  if (breakdowns.length === 0) return null;
  const mean = (pick: (b: FrictionBreakdown) => number) =>
    breakdowns.reduce((sum, b) => sum + pick(b), 0) / breakdowns.length;
  const tempReason: FrictionReason = meanRockTempC > (idealTempC[0] + idealTempC[1]) / 2 ? 'too_warm' : 'too_cold';
  const candidates: [FrictionReason, number][] = [
    [tempReason, mean((b) => b.temp)],
    ['humid', mean((b) => b.muggy)],
    ['near_dew_point', mean((b) => b.nearDewPoint)],
    ['windy', mean((b) => b.windy)],
    ['sun_baked', mean((b) => b.sunBaked + b.slateGlassy)],
    ['salt', mean((b) => b.salt)],
  ];
  let best: [FrictionReason, number] = candidates[0];
  for (const c of candidates) if (c[1] > best[1]) best = c;
  return best[1] >= FRICTION_REASON_MIN_PENALTY ? best[0] : null;
}

/**
 * A block within this window (inclusive hour-of-day start, exclusive end) gets
 * a small selection preference over an equally-good block outside it - most
 * climbers show up mid-morning to late afternoon, not at dawn, so a "best
 * block" that nobody would actually use shouldn't beat a slightly-lower-but-
 * usable one on a technicality. Bonus only breaks ties in SELECTION; the score
 * returned for whichever block wins is always its own unweighted average.
 */
const DEFAULT_TYPICAL_HOURS: [number, number] = [9, 17];

/**
 * A friction score is always a statement about a fixed-length window, never
 * about the whole day. Exported so the day rollup and the UI caption that
 * reports the window both read the length from one place.
 */
export const FRICTION_BLOCK_LENGTH_HOURS = 3;
const TYPICAL_HOURS_SELECTION_BONUS = 0.03;

function typicalHoursOverlapFraction(blockHoursOfDay: number[], window: [number, number]): number {
  const [winStart, winEnd] = window;
  let coveredHours = 0;
  for (const hourOfDay of blockHoursOfDay) {
    if (hourOfDay >= winStart && hourOfDay < winEnd) coveredHours++;
  }
  return coveredHours / blockHoursOfDay.length;
}

export interface FrictionBlockResult {
  score: number;
  /**
   * Clock hour (0-23) the winning block starts at, or null when no eligible
   * block existed at all (e.g. the day never had `blockLength` consecutive
   * dry daylight hours). Callers use this to show the actual window the
   * score describes - Friction is always a statement about a specific slice
   * of the day, not the whole day, and burying that made it easy to compare
   * it against a wholly different hour's reading elsewhere on screen.
   */
  startHourOfDay: number | null;
  /** Array index the winning block starts at (not a clock hour - they differ across a clock change); null with no block. */
  startIdx: number | null;
}

/**
 * Best contiguous `blockLength`-hour block's mean friction score for the day
 * (§4.9). Callers pass the eligibility flags: gate on daylight alone to search
 * freely, or on daylight AND climbable (dry) to keep the returned block
 * overlap-aware - see `computeDaysForModel`, which now does the latter so the
 * reported friction score always describes an hour you could actually be on
 * the rock, not a dry-looking number stranded inside a wet spell.
 *
 * `hoursOfDay` gives the clock hour of each element - pass the real hours
 * (from the timestamps, see time.ts) so a 23- or 25-hour day at a clock change
 * is labelled correctly. A plain number is the older form, the clock hour index
 * 0 corresponds to, each later element one hour on. It only affects the
 * typical-hours selection preference and the returned window, never the score.
 */
export function bestFrictionBlock(
  hourlyScores: number[],
  isDayFlags: boolean[],
  blockLength = FRICTION_BLOCK_LENGTH_HOURS,
  hoursOfDay: number[] | number = 0,
  typicalHours: [number, number] = DEFAULT_TYPICAL_HOURS,
): FrictionBlockResult {
  const hourAt = (i: number) => (Array.isArray(hoursOfDay) ? hoursOfDay[i] : (hoursOfDay + i) % 24);
  let best = 0;
  let bestStartHourOfDay: number | null = null;
  let bestStartIdx: number | null = null;
  let bestRank = -Infinity;
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
    if (!allDay) continue;
    const avg = sum / blockLength;
    const blockHours = Array.from({ length: blockLength }, (_, k) => hourAt(i + k));
    const bonus = TYPICAL_HOURS_SELECTION_BONUS * typicalHoursOverlapFraction(blockHours, typicalHours);
    const rank = avg + bonus;
    if (rank > bestRank) {
      bestRank = rank;
      best = avg;
      bestStartHourOfDay = blockHours[0];
      bestStartIdx = i;
    }
  }
  return { score: best, startHourOfDay: bestStartHourOfDay, startIdx: bestStartIdx };
}

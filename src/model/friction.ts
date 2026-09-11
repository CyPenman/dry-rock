import type { Discipline, RockType } from './types';

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
 * Smooth 0→1 ramp between `lo` and `hi` (cubic Hermite / "smoothstep"). Used in
 * place of hard thresholds throughout this module: a forecast landing a
 * fraction of a degree either side of a spec anchor (e.g. dew point 12°C, wind
 * 11 m/s) should not flip a discrete penalty on or off - that's a modelling
 * artefact, not a real signal, and the same "no cliff edge" reasoning the
 * seepage fallback already applies (§4.5).
 */
function smoothstep(x: number, lo: number, hi: number): number {
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
  const { trockC, idealTempC, dewPointC, windSpeedMs, windDirectionDeg, gtiFaceWm2, aspectDeg, coastal, rock, disciplines } =
    inputs;

  let score = 1 - tempPenalty(trockC, idealTempC);

  // Dew point: greasy above ~12C, crisp below ~5C - ramped across a band
  // centred on each anchor rather than snapping at it.
  const muggyPenalty = 0.3 * smoothstep(dewPointC, 10, 14);
  const crispBonus = 0.05 * (1 - smoothstep(dewPointC, 3, 7));
  score += crispBonus - muggyPenalty;

  // Condensation onset: heavy penalty as Trock closes in on the dew point -
  // the rock is on the edge of sweating, regardless of the absolute dew point.
  const spread = trockC - dewPointC;
  score -= 0.4 * (1 - smoothstep(spread, 0, 4));

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
  if (facingSouth) score -= 0.3 * sunHeat;

  // Coastal salt is hygroscopic and holds damp in a humid onshore breeze - a
  // friction effect even when the rock is dry by any direct measurement (§4.8:
  // "high humidity AND the wind is onshore"). Onshore = wind blowing toward the
  // face, same alignment test as wind-driven rain (§4.2). Without a wind
  // direction to judge (older callers/fixtures), fall back to humidity alone
  // rather than silently dropping the effect.
  if (coastal) {
    const onshore = windDirectionDeg == null || Math.cos(deg2rad(windDirectionDeg - aspectDeg)) > 0;
    if (onshore) score -= 0.15 * smoothstep(dewPointC, 8, 12);
  }

  // Slate gets glassy in strong sun and heat - a friction problem, not a wetness one.
  if (rock === 'slate') score -= 0.3 * sunHeat;

  return Math.max(0, Math.min(1, score));
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
const TYPICAL_HOURS_SELECTION_BONUS = 0.03;

function typicalHoursOverlapFraction(blockStartHourOfDay: number, blockLength: number, window: [number, number]): number {
  const [winStart, winEnd] = window;
  let coveredHours = 0;
  for (let h = 0; h < blockLength; h++) {
    const hourOfDay = (blockStartHourOfDay + h) % 24;
    if (hourOfDay >= winStart && hourOfDay < winEnd) coveredHours++;
  }
  return coveredHours / blockLength;
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
}

/**
 * Best contiguous `blockLength`-hour block's mean friction score for the day
 * (§4.9). Callers pass the eligibility flags: gate on daylight alone to search
 * freely, or on daylight AND climbable (dry) to keep the returned block
 * overlap-aware - see `computeDaysForModel`, which now does the latter so the
 * reported friction score always describes an hour you could actually be on
 * the rock, not a dry-looking number stranded inside a wet spell.
 *
 * `startHourOfDay` is the clock hour index 0 of the array corresponds to
 * (0 for a day-aligned 24-length slice, the normal case); it only affects the
 * typical-hours selection preference and the returned window, never the score.
 */
export function bestFrictionBlock(
  hourlyScores: number[],
  isDayFlags: boolean[],
  blockLength = 3,
  startHourOfDay = 0,
  typicalHours: [number, number] = DEFAULT_TYPICAL_HOURS,
): FrictionBlockResult {
  let best = 0;
  let bestStartHourOfDay: number | null = null;
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
    const blockStartHourOfDay = (startHourOfDay + i) % 24;
    const bonus = TYPICAL_HOURS_SELECTION_BONUS * typicalHoursOverlapFraction(blockStartHourOfDay, blockLength, typicalHours);
    const rank = avg + bonus;
    if (rank > bestRank) {
      bestRank = rank;
      best = avg;
      bestStartHourOfDay = blockStartHourOfDay;
    }
  }
  return { score: best, startHourOfDay: bestStartHourOfDay };
}

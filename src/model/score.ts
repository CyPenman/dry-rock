import { MODEL_DISPLAY_NAME, MODELS, type ModelName } from '../api/request';
import { displayBand, scoreBand, type ScoreBand } from './scoreBand';

export type Verdict = 'scored' | 'under_snow' | 'frozen' | 'rock_damage' | 'soft_rock_wet';

export interface DayScoreInputs {
  climbableDaylightHours: number;
  totalDaylightHours: number;
  /** Longest unbroken run of climbable daylight hours this day - see rockDrynessScore below. */
  bestContiguousClimbableHours?: number;
  bestFrictionBlockScore: number; // 0-1, §4.8
}

export interface ScoreBreakdown {
  rockDrynessScore: number;
  frictionScore: number;
  total: number;
}

/**
 * score(crag, day) = 0.6*rockDrynessScore + 0.4*frictionScore - §4.9.
 *
 * The window term was dropped: rock dryness is already computed from the same
 * `climbable[]` series and accounts for how dry the rock is, so a separate
 * multi-day-spell term was redundant with it.
 */
// A day is fully "dry enough" once it offers a full session - more daylight beyond that
// doesn't make it a better day to go. Capped at the day's own daylight in deep winter.
export const SESSION_HOURS = 6;

export function computeScoreBreakdown(inputs: DayScoreInputs): ScoreBreakdown {
  // rockDrynessScore: half from the total climbable hours, half from the best
  // unbroken block, each as a fraction of a session (SESSION_HOURS), not of the
  // day's daylight - otherwise "dry from 14:00" in June (seven hours of climbing)
  // scored about 0.4, penalising summer for having long days. A day with three
  // scattered 1h dry gaps and a day with one unbroken 3h window can have the
  // same total, but only the second is a day you can actually plan a route on -
  // pure total-hours scoring can't tell them apart, so blend in contiguity.
  const cap = Math.min(SESSION_HOURS, inputs.totalDaylightHours);
  const totalFraction = cap > 0 ? Math.min(1, inputs.climbableDaylightHours / cap) : 0;
  const contiguousFraction = cap > 0 ? Math.min(1, (inputs.bestContiguousClimbableHours ?? 0) / cap) : 0;
  const rockDrynessScore = 0.5 * totalFraction + 0.5 * contiguousFraction;

  const frictionScore = inputs.bestFrictionBlockScore;
  return {
    rockDrynessScore,
    frictionScore,
    total: 0.6 * rockDrynessScore + 0.4 * frictionScore,
  };
}

export function compositeScore(inputs: DayScoreInputs): number {
  return computeScoreBreakdown(inputs).total;
}

/**
 * Did Trock cross from below freezing to above (or vice versa) within the
 * preceding window - the mechanical damage mechanism for soft rock (§5.5),
 * distinct from surface wetness. Presence of both a sub-zero and an above-zero
 * reading in an hourly diurnal series is a reasonable proxy for an actual crossing.
 */
export function hadFreezeThawCycle(trockSeries: number[], dayEndIdx: number, windowHours = 48): boolean {
  const start = Math.max(0, dayEndIdx - windowHours + 1);
  let wasFrozen = false;
  let wasThawed = false;
  for (let i = start; i <= dayEndIdx; i++) {
    if (trockSeries[i] < 0) wasFrozen = true;
    if (trockSeries[i] > 0) wasThawed = true;
  }
  return wasFrozen && wasThawed;
}

export interface DayVerdictInputs {
  underSnowAnyHour: boolean;
  frozenAllDaylightHours: boolean;
  softRock: boolean;
  freezeThawInPreceding48h: boolean;
  /**
   * Soft rock with no daylight hour dry enough to climb - on soft rock
   * climbability already uses the stricter `softRockMatrixDryFraction`, so this
   * means "still damp inside all day" (§5.5).
   */
  softRockNoSafeDaylightHour: boolean;
}

/**
 * Hard gates, applied before scoring (§4.9, §5.5) - these produce a verdict
 * with an explanation, never a low score. A climber who understands why will
 * comply; one who is shown a low number will just go anyway. Soft rock climbed
 * wet is permanently damaged, so being wet is a block there, not a low score.
 */
export function dayVerdict(inputs: DayVerdictInputs): Verdict {
  if (inputs.underSnowAnyHour) return 'under_snow';
  if (inputs.softRock && inputs.freezeThawInPreceding48h) return 'rock_damage';
  if (inputs.softRock && inputs.softRockNoSafeDaylightHour) return 'soft_rock_wet';
  if (inputs.frozenAllDaylightHours) return 'frozen';
  return 'scored';
}

export function verdictMessage(verdict: Verdict): string {
  switch (verdict) {
    case 'under_snow':
      return 'Under snow';
    case 'frozen':
      return 'Frozen or verglassed';
    case 'rock_damage':
      return 'Do not climb: a freeze-thaw in the last 48 hours can loosen soft sandstone even when the surface looks dry';
    case 'soft_rock_wet':
      return 'Do not climb: soft sandstone is still damp inside - wet holds break and wear away permanently';
    case 'scored':
      return '';
  }
}

// --- §4.10 confidence --------------------------------------------------------

export interface ModelAgreement {
  agreeCount: number;
  total: number;
  fraction: number;
}

/** Fraction of models that agree - one boolean per model with data (for crag-days: same score band as the headline, §4.10). */
export function modelAgreement(perModelAgrees: boolean[]): ModelAgreement {
  const agreeCount = perModelAgrees.filter(Boolean).length;
  const total = perModelAgrees.length;
  return { agreeCount, total, fraction: total > 0 ? agreeCount / total : 0 };
}

const BAND_PHRASE: Record<ScoreBand, string> = { good: 'a good day', fair: 'a fair day', poor: 'a poor day' };

/** What `confidenceSentence` needs from a crag-day (`CragDayResult`). */
export interface ConfidenceSubject {
  confidence: ModelAgreement;
  /** Raw score, 0-1: the models' agreement is counted on its band. */
  score: number;
  /** The number shown, 0-1. */
  displayScore: number;
  /** Every model with data for the day - the same set `confidence` counts. */
  modelScores: { model: ModelName; score: number }[];
}

function joinNames(names: string[]): string {
  return names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * What the models agree on, in a sentence (§4.10): "3 of 4 models agree it's
 * a good day". Says plainly when fewer models reach the day ("only ECMWF and
 * GFS reach this day"), and with one model says there's nothing to check it
 * against rather than "1 of 1 models agree". The agreement is on the raw
 * score's band, so when the confidence trim moves the number shown into a
 * lower band, it says so instead of calling a 61 "a good day".
 */
export function confidenceSentence(day: ConfidenceSubject): string {
  const { agreeCount, total } = day.confidence;
  const band = scoreBand(day.score * 100);
  const names = day.modelScores.map((s) => MODEL_DISPLAY_NAME[s.model]);
  let sentence =
    total <= 1
      ? `Only ${names[0] ?? 'one model'} reaches this day - nothing to check it against`
      : `${agreeCount} of ${total} models agree it's ${BAND_PHRASE[band]}${
          total < MODELS.length && names.length === total ? ` (only ${joinNames(names)} reach this day)` : ''
        }`;
  const shown = displayBand(day);
  if (shown !== band) sentence += `, so it's marked down to ${BAND_PHRASE[shown]}`;
  return sentence;
}

/**
 * §4.10: "Weight showery situations down. If showers makes up most of the
 * precipitation, convective rain is poorly located by any model at any
 * resolution, so widen the uncertainty." `showerDominance` is the day's
 * showers-mm / total-precipitation-mm (0 when no rain fell - nothing to widen).
 * Above this threshold, model agreement is capped at "medium" confidence
 * (`confidenceTier`), regardless of the raw fraction, and the day carries a
 * caveat saying so.
 */
export const SHOWER_DOMINANCE_THRESHOLD = 0.6;

export function confidenceCaveat(showerDominance: number): string | null {
  return showerDominance > SHOWER_DOMINANCE_THRESHOLD
    ? 'showery - model agreement is less trustworthy than it looks'
    : null;
}

/**
 * §4.10 confidence tier - 0 low, 1 medium, 2 high - from the share of models
 * agreeing, then capped two ways:
 *
 * - By how many models reach the day: one model is at most low, two at most
 *   medium. A model with no data drops out of the count rather than voting no,
 *   which is right, but on its own it made the furthest days the surest -
 *   past about a week only ECMWF and GFS run (2 of 2, never low), and the last
 *   day is GFS alone ("1 of 1 models agree", top tier, no trim).
 * - When the day's rain was mostly showers (showerDominance >
 *   SHOWER_DOMINANCE_THRESHOLD): convective rain is poorly placed by every
 *   model, however well they happen to agree on this run - "widen the
 *   uncertainty".
 */
export function confidenceTier(agreement: ModelAgreement, showerDominance: number): number {
  const rawTier = agreement.fraction >= 0.75 ? 2 : agreement.fraction >= 0.5 ? 1 : 0;
  const modelCountCap = agreement.total <= 1 ? 0 : agreement.total === 2 ? 1 : 2;
  const showerCap = showerDominance > SHOWER_DOMINANCE_THRESHOLD ? 1 : 2;
  return Math.min(rawTier, modelCountCap, showerCap);
}

/**
 * The confidence trim: a mild multiplicative haircut that turns the raw score
 * into `displayScore`, the number shown and ranked on (§4.10). High
 * confidence is unchanged, medium loses 5%, low 15% - so a medium-confidence
 * day has to score over 5% higher to rank above a high-confidence one, and a
 * low-confidence day over 15%. Deliberately gentle: a much better day can still
 * outrank a slightly surer one.
 */
const CONFIDENCE_TIER_MULTIPLIER = [0.85, 0.95, 1.0] as const;

export function confidenceAdjustedScore(rawScore: number, agreement: ModelAgreement, showerDominance: number): number {
  return rawScore * CONFIDENCE_TIER_MULTIPLIER[confidenceTier(agreement, showerDominance)];
}

import type { ScoreBand } from './scoreBand';

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

/** "3 of 4 models agree it's a good day" - says what they agree on (§4.10). */
export function confidenceSentence(agreement: ModelAgreement, band: ScoreBand): string {
  return `${agreement.agreeCount} of ${agreement.total} models agree it's ${BAND_PHRASE[band]}`;
}

/**
 * §4.10: "Weight showery situations down. If showers makes up most of the
 * precipitation, convective rain is poorly located by any model at any
 * resolution, so widen the uncertainty." `showerDominance` is the day's
 * showers-mm / total-precipitation-mm (0 when no rain fell - nothing to widen).
 * Above this threshold, model agreement is treated as capped at "medium"
 * confidence for ranking purposes (see `ranking.ts`), regardless of the raw
 * fraction - a caveat, not a silently altered number, per the app's "never
 * present a bare number" principle.
 */
export const SHOWER_DOMINANCE_THRESHOLD = 0.6;

export function confidenceCaveat(showerDominance: number): string | null {
  return showerDominance > SHOWER_DOMINANCE_THRESHOLD
    ? 'showery - model agreement is less trustworthy than it looks'
    : null;
}

/**
 * §4.10 confidence tiers, capped when the day's precipitation was mostly
 * convective (showerDominance > SHOWER_DOMINANCE_THRESHOLD) - "widen the
 * uncertainty" for showery days, since convective rain is poorly located by
 * every model regardless of how well they happen to agree on this run.
 * Shared by ranking (sort order) and `confidenceAdjustedScore` (display
 * number) so the two never disagree about how confident a day is.
 */
export function confidenceTier(fraction: number, showerDominance: number): number {
  const rawTier = fraction >= 0.75 ? 2 : fraction >= 0.5 ? 1 : 0;
  return showerDominance > SHOWER_DOMINANCE_THRESHOLD ? Math.min(rawTier, 1) : rawTier;
}

/**
 * A mild multiplicative haircut on low-confidence days' displayed score - the
 * number itself should already hint "don't trust this too far" rather than
 * relying on the reader to notice a separate caveat sentence. Deliberately
 * gentle (top tier is unchanged, bottom tier loses at most 15%) so this stays
 * a nudge, not a second scoring system: ranking order is untouched, since
 * `rankCragDays` sorts on score band, confidence tier and raw `score`, never this value.
 */
const CONFIDENCE_TIER_MULTIPLIER = [0.85, 0.95, 1.0] as const;

export function confidenceAdjustedScore(rawScore: number, agreement: ModelAgreement, showerDominance: number): number {
  const tier = confidenceTier(agreement.fraction, showerDominance);
  return rawScore * CONFIDENCE_TIER_MULTIPLIER[tier];
}

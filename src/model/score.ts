import { windowScore } from './dryWindow';
import { PARAMS } from './params';

export type Verdict = 'scored' | 'under_snow' | 'frozen' | 'rock_damage';

export interface DayScoreInputs {
  windowHours: number; // longest qualifying window containing this day, §4.9
  minWindowHours?: number;
  climbableDaylightHours: number;
  totalDaylightHours: number;
  bestFrictionBlockScore: number; // 0-1, §4.8
}

export interface ScoreBreakdown {
  windowScoreValue: number;
  rockDrynessScore: number;
  frictionScore: number;
  total: number;
}

/** score(crag, day) = 0.40*windowScore + 0.35*rockDrynessScore + 0.25*frictionScore — §4.9. */
export function computeScoreBreakdown(inputs: DayScoreInputs): ScoreBreakdown {
  const windowScoreValue = windowScore(inputs.windowHours, inputs.minWindowHours ?? PARAMS.minWindowHours);
  const rockDrynessScore =
    inputs.totalDaylightHours > 0 ? inputs.climbableDaylightHours / inputs.totalDaylightHours : 0;
  const frictionScore = inputs.bestFrictionBlockScore;
  return {
    windowScoreValue,
    rockDrynessScore,
    frictionScore,
    total: 0.4 * windowScoreValue + 0.35 * rockDrynessScore + 0.25 * frictionScore,
  };
}

export function compositeScore(inputs: DayScoreInputs): number {
  return computeScoreBreakdown(inputs).total;
}

/**
 * Did Trock cross from below freezing to above (or vice versa) within the
 * preceding window — the mechanical damage mechanism for soft rock (§5.5),
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
}

/**
 * Hard gates, applied before scoring (§4.9, §5.5) — these produce a verdict
 * with an explanation, never a low score. A climber who understands why will
 * comply; one who is shown a low number will just go anyway.
 */
export function dayVerdict(inputs: DayVerdictInputs): Verdict {
  if (inputs.underSnowAnyHour) return 'under_snow';
  if (inputs.softRock && inputs.freezeThawInPreceding48h) return 'rock_damage';
  if (inputs.frozenAllDaylightHours) return 'frozen';
  return 'scored';
}

export function verdictMessage(verdict: Verdict): string {
  switch (verdict) {
    case 'under_snow':
      return 'Under snow';
    case 'frozen':
      return 'Frozen / verglas';
    case 'rock_damage':
      return 'Do not climb — rock damage (wet or freeze-thaw on soft rock)';
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

/** Fraction of models/ensemble members in which the crag-day is climbable — a real probability, not a hedge. */
export function modelAgreement(perModelDayClimbable: boolean[]): ModelAgreement {
  const agreeCount = perModelDayClimbable.filter(Boolean).length;
  const total = perModelDayClimbable.length;
  return { agreeCount, total, fraction: total > 0 ? agreeCount / total : 0 };
}

export function confidenceSentence(agreement: ModelAgreement): string {
  return `${agreement.agreeCount} of ${agreement.total} models agree`;
}

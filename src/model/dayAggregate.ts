import type { CellForecast } from '../api/client';
import { MODELS, type ModelName } from '../api/request';
import { buildHourlyInputsForModel } from './buildInputs';
import { longestQualifyingWindowForDay } from './dryWindow';
import { bestFrictionBlock, frictionScoreHour } from './friction';
import { PARAMS } from './params';
import { computeScoreBreakdown, dayVerdict, hadFreezeThawCycle, modelAgreement, type ModelAgreement, type Verdict } from './score';
import type { Crag } from './types';
import {
  climbableHoursForDay,
  findDryFrom,
  limitingFactorAt,
  runSimulation,
  type CragHourlyInput,
  type CragModelConfig,
  type HourResult,
  type LimitingFactor,
} from './wetness';

export interface CragDayResult {
  dayIndex: number;
  dayStartIdx: number;
  dayEndIdx: number;
  date: Date; // local midnight of this day, from this model's timestamps
  verdict: Verdict;
  score: number;
  windowScoreValue: number;
  rockDrynessScore: number;
  dryFromIdx: number | null; // global hour index into this model's series
  dryFromHourOfDay: number | null; // 0-23, for display
  climbableDaylightHours: number;
  totalDaylightHours: number;
  bestContiguousClimbableHours: number;
  bestFrictionBlockScore: number;
  limitingFactor: LimitingFactor;
  confidence: ModelAgreement;
  /** Showers-mm / total-precipitation-mm for the day, 0 when no rain fell — §4.10. */
  showerDominance: number;
}

export interface CragForecastResult {
  primaryModel: ModelName;
  availableModels: ModelName[];
  hourly: HourResult[]; // primary model's hourly series, for the detail timeline
  inputs: CragHourlyInput[]; // primary model's inputs, for the detail timeline
  days: CragDayResult[]; // primary model's day-by-day results, confidence-annotated
  /** Every resolved model's day-by-day score, for the "compare models" chart (§6 crag detail). */
  perModelDays: Partial<Record<ModelName, CragDayResult[]>>;
}

export function toModelConfig(crag: Crag): CragModelConfig {
  return {
    aspectDeg: crag.aspectDeg,
    steepness: crag.steepness,
    seepIndex: crag.seepIndex,
    tauSeep: crag.tauSeep,
    catchmentAbove: crag.catchmentAbove,
    windShelter: crag.windShelter,
    canopyLight: crag.canopyLight,
    tauRock: crag.tauRock,
    dryingRate: crag.dryingRate,
    Smax: crag.Smax,
    Mmax: crag.Mmax,
    infiltrationRate: crag.infiltrationRate,
  };
}

/** Per-day rollup (§4.9) for one model's hourly series. Confidence is filled in afterwards, once every model's results are in. */
function computeDaysForModel(
  crag: Crag,
  results: HourResult[],
  inputs: CragHourlyInput[],
  minWindowHours: number,
): Omit<CragDayResult, 'confidence'>[] {
  const climbable = results.map((r) => r.climbable);
  const trock = results.map((r) => r.Trock);
  const numDays = Math.floor(results.length / 24);
  const days: Omit<CragDayResult, 'confidence'>[] = [];

  for (let day = 0; day < numDays; day++) {
    const dayStart = day * 24;
    const dayEnd = dayStart + 23;

    const dayResults = results.slice(dayStart, dayEnd + 1);
    const dayInputs = inputs.slice(dayStart, dayEnd + 1);
    const isDayFlags = dayInputs.map((i) => i.isDay);

    const { totalClimbableDaylightHours, bestContiguousBlock } = climbableHoursForDay(dayResults, isDayFlags);
    const totalDaylightHours = isDayFlags.filter(Boolean).length;

    const windowHoursForDay = longestQualifyingWindowForDay(climbable, dayStart, dayEnd);

    const dayPrecipMm = dayInputs.reduce((sum, i) => sum + i.precipitationMm, 0);
    const dayShowersMm = dayInputs.reduce((sum, i) => sum + (i.showersMm ?? 0), 0);
    const showerDominance = dayPrecipMm > 0 ? Math.min(1, dayShowersMm / dayPrecipMm) : 0;

    const frictionScores = dayResults.map((r, idx) =>
      frictionScoreHour({
        trockC: r.Trock,
        idealTempC: crag.idealTempC,
        dewPointC: dayInputs[idx].dewPointC,
        windSpeedMs: dayInputs[idx].windSpeedMs,
        windDirectionDeg: dayInputs[idx].windDirectionDeg,
        gtiFaceWm2: dayInputs[idx].gtiFaceWm2,
        aspectDeg: crag.aspectDeg,
        coastal: crag.coastal,
        rock: crag.rock,
      }),
    );
    const bestFriction = bestFrictionBlock(frictionScores, isDayFlags);

    const underSnowAnyHour = dayResults.some((r) => r.underSnow);
    const frozenAllDaylightHours = totalDaylightHours > 0 && dayResults.every((r, idx) => !isDayFlags[idx] || r.frozen);
    const freezeThaw = hadFreezeThawCycle(trock, dayEnd, 48);

    const verdict = dayVerdict({
      underSnowAnyHour,
      frozenAllDaylightHours,
      softRock: crag.softRock,
      freezeThawInPreceding48h: freezeThaw,
    });

    const breakdown = computeScoreBreakdown({
      windowHours: windowHoursForDay,
      minWindowHours,
      climbableDaylightHours: totalClimbableDaylightHours,
      totalDaylightHours,
      bestContiguousClimbableHours: bestContiguousBlock?.hours ?? 0,
      bestFrictionBlockScore: bestFriction,
    });
    const score = verdict === 'scored' ? breakdown.total : 0;

    const dryFromOffset = findDryFrom(dayResults);

    days.push({
      dayIndex: day,
      dayStartIdx: dayStart,
      dayEndIdx: dayEnd,
      date: new Date(inputs[dayStart].time * 1000),
      verdict,
      score,
      windowScoreValue: breakdown.windowScoreValue,
      rockDrynessScore: breakdown.rockDrynessScore,
      dryFromIdx: dryFromOffset != null ? dayStart + dryFromOffset : null,
      dryFromHourOfDay: dryFromOffset,
      climbableDaylightHours: totalClimbableDaylightHours,
      totalDaylightHours,
      bestContiguousClimbableHours: bestContiguousBlock?.hours ?? 0,
      bestFrictionBlockScore: bestFriction,
      limitingFactor: limitingFactorAt(results, dayEnd),
      showerDominance,
    });
  }

  return days;
}

/**
 * Run the full model for one crag against one forecast cell — every model in
 * §3.3 for confidence, rolled up into per-day results (§4.9). Assumes the
 * hourly series starts at local midnight (guaranteed by the `timezone` +
 * `timeformat=unixtime` request parameters, §3.1), so days are simple 24-hour
 * chunks of the array.
 */
export function computeCragForecast(
  crag: Crag,
  cell: CellForecast,
  minWindowHours: number = PARAMS.minWindowHours,
): CragForecastResult | null {
  const config = toModelConfig(crag);

  const perModelResults = new Map<ModelName, HourResult[]>();
  const perModelInputs = new Map<ModelName, CragHourlyInput[]>();

  for (const model of MODELS) {
    const inputs = buildHourlyInputsForModel(crag, cell, model);
    if (!inputs || inputs.length === 0) continue;
    perModelInputs.set(model, inputs);
    perModelResults.set(model, runSimulation(inputs, config));
  }

  const availableModels = [...perModelResults.keys()];
  if (availableModels.length === 0) return null;

  const primaryModel = availableModels.includes('ukmo_seamless') ? 'ukmo_seamless' : availableModels[0];

  const perModelDaysRaw = new Map<ModelName, Omit<CragDayResult, 'confidence'>[]>();
  for (const model of availableModels) {
    perModelDaysRaw.set(model, computeDaysForModel(crag, perModelResults.get(model)!, perModelInputs.get(model)!, minWindowHours));
  }

  function withConfidence(model: ModelName): CragDayResult[] {
    const raw = perModelDaysRaw.get(model)!;
    return raw.map((d) => {
      const perModelDayClimbable = availableModels.map((m) => {
        const series = perModelResults.get(m)!;
        const slice = series.slice(d.dayStartIdx, Math.min(d.dayEndIdx + 1, series.length));
        return slice.some((r) => r.climbable);
      });
      return { ...d, confidence: modelAgreement(perModelDayClimbable) };
    });
  }

  const perModelDays: Partial<Record<ModelName, CragDayResult[]>> = {};
  for (const model of availableModels) {
    perModelDays[model] = withConfidence(model);
  }

  return {
    primaryModel,
    availableModels,
    hourly: perModelResults.get(primaryModel)!,
    inputs: perModelInputs.get(primaryModel)!,
    days: perModelDays[primaryModel]!,
    perModelDays,
  };
}

import type { CellForecast } from '../api/client';
import { MODELS, type ModelName } from '../api/request';
import { buildHourlyInputsForModel } from './buildInputs';
import { longestQualifyingWindowForDay } from './dryWindow';
import { bestFrictionBlock, frictionScoreHour } from './friction';
import { computeScoreBreakdown, dayVerdict, hadFreezeThawCycle, modelAgreement, type ModelAgreement, type Verdict } from './score';
import { PARAMS } from './params';
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
  date: Date; // local midnight of this day, from the primary model's timestamps
  verdict: Verdict;
  score: number;
  windowScoreValue: number;
  rockDrynessScore: number;
  dryFromIdx: number | null; // global hour index into the primary model's series
  dryFromHourOfDay: number | null; // 0-23, for display
  climbableDaylightHours: number;
  totalDaylightHours: number;
  bestFrictionBlockScore: number;
  limitingFactor: LimitingFactor;
  confidence: ModelAgreement;
}

export interface CragForecastResult {
  primaryModel: ModelName;
  availableModels: ModelName[];
  hourly: HourResult[]; // primary model's hourly series, for the detail timeline
  inputs: CragHourlyInput[]; // primary model's inputs, for the detail timeline
  days: CragDayResult[];
}

function toModelConfig(crag: Crag): CragModelConfig {
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
  const primaryResults = perModelResults.get(primaryModel)!;
  const primaryInputs = perModelInputs.get(primaryModel)!;
  const primaryClimbable = primaryResults.map((r) => r.climbable);
  const primaryTrock = primaryResults.map((r) => r.Trock);

  const numDays = Math.floor(primaryResults.length / 24);
  const days: CragDayResult[] = [];

  for (let day = 0; day < numDays; day++) {
    const dayStart = day * 24;
    const dayEnd = dayStart + 23;

    const dayResults = primaryResults.slice(dayStart, dayEnd + 1);
    const dayInputs = primaryInputs.slice(dayStart, dayEnd + 1);
    const isDayFlags = dayInputs.map((i) => i.isDay);

    const { totalClimbableDaylightHours } = climbableHoursForDay(dayResults, isDayFlags);
    const totalDaylightHours = isDayFlags.filter(Boolean).length;

    const windowHoursForDay = longestQualifyingWindowForDay(primaryClimbable, dayStart, dayEnd);

    const frictionScores = dayResults.map((r, idx) =>
      frictionScoreHour({
        trockC: r.Trock,
        idealTempC: crag.idealTempC,
        dewPointC: dayInputs[idx].dewPointC,
        windSpeedMs: dayInputs[idx].windSpeedMs,
        gtiFaceWm2: dayInputs[idx].gtiFaceWm2,
        aspectDeg: crag.aspectDeg,
        coastal: crag.coastal,
        rock: crag.rock,
      }),
    );
    const bestFriction = bestFrictionBlock(frictionScores, isDayFlags);

    const underSnowAnyHour = dayResults.some((r) => r.underSnow);
    const frozenAllDaylightHours =
      totalDaylightHours > 0 && dayResults.every((r, idx) => !isDayFlags[idx] || r.frozen);
    const freezeThaw = hadFreezeThawCycle(primaryTrock, dayEnd, 48);

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
      bestFrictionBlockScore: bestFriction,
    });
    const score = verdict === 'scored' ? breakdown.total : 0;

    const dryFromOffset = findDryFrom(dayResults);
    const dryFromIdx = dryFromOffset != null ? dayStart + dryFromOffset : null;
    const dryFromHourOfDay = dryFromOffset;

    const limitingFactor = limitingFactorAt(primaryResults, dayEnd);

    const perModelDayClimbable = availableModels.map((model) => {
      const series = perModelResults.get(model)!;
      const slice = series.slice(dayStart, Math.min(dayEnd + 1, series.length));
      return slice.some((r) => r.climbable);
    });
    const confidence = modelAgreement(perModelDayClimbable);

    days.push({
      dayIndex: day,
      dayStartIdx: dayStart,
      dayEndIdx: dayEnd,
      date: new Date(primaryInputs[dayStart].time * 1000),
      verdict,
      score,
      windowScoreValue: breakdown.windowScoreValue,
      rockDrynessScore: breakdown.rockDrynessScore,
      dryFromIdx,
      dryFromHourOfDay,
      climbableDaylightHours: totalClimbableDaylightHours,
      totalDaylightHours,
      bestFrictionBlockScore: bestFriction,
      limitingFactor,
      confidence,
    });
  }

  return {
    primaryModel,
    availableModels,
    hourly: primaryResults,
    inputs: primaryInputs,
    days,
  };
}

import type { CellForecast } from '../api/client';
import { MODELS, type ModelName } from '../api/request';
import { buildHourlyInputsForModel } from './buildInputs';
import { bestFrictionBlock, frictionScoreHour } from './friction';
import {
  computeScoreBreakdown,
  confidenceAdjustedScore,
  dayVerdict,
  hadFreezeThawCycle,
  modelAgreement,
  type ModelAgreement,
  type Verdict,
} from './score';
import type { Crag } from './types';
import { windChillC } from './windChill';
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
  /**
   * `score` softened by how much the models agree on this crag-day (§4.10),
   * for display only - ranking still sorts on confidence tier then raw
   * `score` (see ranking.ts), so this never changes ordering, only the
   * number shown. Equal to `score` when confidence is high.
   */
  displayScore: number;
  rockDrynessScore: number;
  dryFromIdx: number | null; // global hour index into this model's series
  dryFromHourOfDay: number | null; // 0-23, for display
  climbableDaylightHours: number;
  totalDaylightHours: number;
  bestContiguousClimbableHours: number;
  bestFrictionBlockScore: number;
  limitingFactor: LimitingFactor;
  confidence: ModelAgreement;
  /** Showers-mm / total-precipitation-mm for the day, 0 when no rain fell - §4.10. */
  showerDominance: number;
  /** Mean air temperature across daylight hours, for at-a-glance summaries (map popups, §6). */
  avgDaylightTempC: number;
  /**
   * Percentage chance of rain, for at-a-glance summaries. Real Open-Meteo
   * precipitation_probability, averaged across whichever of the four models
   * publish it for this day (UKMO never does) - falls back to the day's
   * "hours with measurable precip" proxy only when none of them do.
   * NOTE: still a per-model average, not a single calibrated forecast
   * probability - worth revisiting if it turns out to disagree noticeably
   * with what a mainstream weather app shows for the same day.
   */
  rainChancePct: number;
  /**
   * Coldest wind chill across the day's daylight hours, °C - a comfort factor
   * for the climber (numb hands, miserable belaying), distinct from
   * `bestFrictionBlockScore`'s rock-temperature terms. Null when there were no
   * daylight hours to evaluate. Never affects `score` - see `windChillCaveat`.
   */
  worstDaylightWindChillC: number | null;
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
  /** Cross-model precipitation_probability average per hour, global-hour-indexed to match `inputs` - §4.9/§6. */
  crossModelPrecipProbPct: (number | null)[],
): Omit<CragDayResult, 'confidence' | 'displayScore'>[] {
  const trock = results.map((r) => r.Trock);
  const numDays = Math.floor(results.length / 24);
  const days: Omit<CragDayResult, 'confidence' | 'displayScore'>[] = [];

  for (let day = 0; day < numDays; day++) {
    const dayStart = day * 24;
    const dayEnd = dayStart + 23;

    const dayResults = results.slice(dayStart, dayEnd + 1);
    const dayInputs = inputs.slice(dayStart, dayEnd + 1);
    const isDayFlags = dayInputs.map((i) => i.isDay);

    const { totalClimbableDaylightHours, bestContiguousBlock } = climbableHoursForDay(dayResults, isDayFlags);
    const totalDaylightHours = isDayFlags.filter(Boolean).length;

    const dayPrecipMm = dayInputs.reduce((sum, i) => sum + i.precipitationMm, 0);
    const dayShowersMm = dayInputs.reduce((sum, i) => sum + (i.showersMm ?? 0), 0);
    const showerDominance = dayPrecipMm > 0 ? Math.min(1, dayShowersMm / dayPrecipMm) : 0;

    const daylightTemps = dayInputs.filter((_, idx) => isDayFlags[idx]).map((i) => i.tempC);
    const avgDaylightTempC =
      (daylightTemps.length > 0 ? daylightTemps : dayInputs.map((i) => i.tempC)).reduce((sum, t) => sum + t, 0) /
      (daylightTemps.length > 0 ? daylightTemps.length : dayInputs.length);
    const dayCrossModelPrecipProb = crossModelPrecipProbPct
      .slice(dayStart, dayEnd + 1)
      .filter((v): v is number => v != null);
    const rainChancePct =
      dayCrossModelPrecipProb.length > 0
        ? Math.round(dayCrossModelPrecipProb.reduce((sum, v) => sum + v, 0) / dayCrossModelPrecipProb.length)
        : Math.round((100 * dayInputs.filter((i) => i.precipitationMm > 0.1).length) / dayInputs.length);

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
        disciplines: crag.disciplines,
      }),
    );
    // Gate the block search on daylight AND climbable (dry), not daylight alone,
    // so the reported friction score describes a window you could actually
    // climb in rather than the best-looking 3h stretch of an otherwise wet day.
    const dryDaylightFlags = isDayFlags.map((isDay, idx) => isDay && dayResults[idx].climbable);
    const bestFriction = bestFrictionBlock(frictionScores, dryDaylightFlags, 3, 0);

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
      climbableDaylightHours: totalClimbableDaylightHours,
      totalDaylightHours,
      bestContiguousClimbableHours: bestContiguousBlock?.hours ?? 0,
      bestFrictionBlockScore: bestFriction,
    });
    const score = verdict === 'scored' ? breakdown.total : 0;

    const dryFromOffset = findDryFrom(dayResults);

    const daylightWindChills = dayInputs
      .filter((_, idx) => isDayFlags[idx])
      .map((i) => windChillC(i.tempC, i.windSpeedMs));
    const worstDaylightWindChillC = daylightWindChills.length > 0 ? Math.min(...daylightWindChills) : null;

    days.push({
      dayIndex: day,
      dayStartIdx: dayStart,
      dayEndIdx: dayEnd,
      date: new Date(inputs[dayStart].time * 1000),
      verdict,
      score,
      rockDrynessScore: breakdown.rockDrynessScore,
      dryFromIdx: dryFromOffset != null ? dayStart + dryFromOffset : null,
      dryFromHourOfDay: dryFromOffset,
      climbableDaylightHours: totalClimbableDaylightHours,
      totalDaylightHours,
      bestContiguousClimbableHours: bestContiguousBlock?.hours ?? 0,
      bestFrictionBlockScore: bestFriction,
      limitingFactor: limitingFactorAt(results, dayEnd),
      showerDominance,
      avgDaylightTempC,
      rainChancePct,
      worstDaylightWindChillC,
    });
  }

  return days;
}

/**
 * Run the full model for one crag against one forecast cell - every model in
 * §3.3 for confidence, rolled up into per-day results (§4.9). Assumes the
 * hourly series starts at local midnight (guaranteed by the `timezone` +
 * `timeformat=unixtime` request parameters, §3.1), so days are simple 24-hour
 * chunks of the array.
 */
export function computeCragForecast(crag: Crag, cell: CellForecast): CragForecastResult | null {
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

  // Prefer UKMO (§3.3's default), but only among whichever models actually
  // cover the longest stretch of the requested range - a model whose real
  // forecast horizon is shorter than `forecast_days` (buildInputs.ts truncates
  // it there rather than feed it null-derived garbage) must not be chosen as
  // primary, or every day past its horizon would have no data to show at all.
  const maxHours = Math.max(...availableModels.map((m) => perModelResults.get(m)!.length));
  const primaryModel = availableModels.find((m) => perModelResults.get(m)!.length === maxHours) ?? availableModels[0];

  // Real precipitation_probability, averaged per hour across whichever models publish it
  // (UKMO never does) - shared by every model's day rollup below, §4.9/§6.
  const crossModelPrecipProbPct: (number | null)[] = cell.time.map((_, i) => {
    const values = availableModels
      .map((m) => cell.models[m]?.precipitation_probability?.[i])
      .filter((v): v is number => v != null);
    return values.length > 0 ? values.reduce((sum, v) => sum + v, 0) / values.length : null;
  });

  const perModelDaysRaw = new Map<ModelName, Omit<CragDayResult, 'confidence' | 'displayScore'>[]>();
  for (const model of availableModels) {
    perModelDaysRaw.set(
      model,
      computeDaysForModel(crag, perModelResults.get(model)!, perModelInputs.get(model)!, crossModelPrecipProbPct),
    );
  }

  function withConfidence(model: ModelName): CragDayResult[] {
    const raw = perModelDaysRaw.get(model)!;
    return raw.map((d) => {
      const perModelDayClimbable = availableModels.map((m) => {
        const series = perModelResults.get(m)!;
        const slice = series.slice(d.dayStartIdx, Math.min(d.dayEndIdx + 1, series.length));
        return slice.some((r) => r.climbable);
      });
      const confidence = modelAgreement(perModelDayClimbable);
      return { ...d, confidence, displayScore: confidenceAdjustedScore(d.score, confidence, d.showerDominance) };
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

import type { CellForecast } from '../api/client';
import { getSoilMoistureDeep } from '../api/soilMoisture';
import { SOIL_MOISTURE_CALIBRATION } from '../data/soilMoistureCalibration';
import { MODELS, PAST_DAYS, type ModelName } from '../api/request';
import { buildHourlyInputsForModel } from './buildInputs';
import {
  bestFrictionBlock,
  FRICTION_BLOCK_LENGTH_HOURS,
  frictionBreakdownHour,
  frictionReasonForWindow,
  type FrictionReason,
} from './friction';
import {
  computeScoreBreakdown,
  confidenceAdjustedScore,
  dayVerdict,
  hadFreezeThawCycle,
  modelAgreement,
  type ModelAgreement,
  type Verdict,
} from './score';
import { STEEPNESS_TILT_DEG } from './rockDefaults';
import { scoreBand } from './scoreBand';
import { sunOnFaceHours } from './solar';
import { DEFAULT_SM_CALIBRATION, type SoilMoistureCalibration } from './seepage';
import { dayBoundaries, hourOfDayLondon, type DayBoundary } from './time';
import type { Crag } from './types';
import { windChillC } from './windChill';
import {
  climbableHoursForDay,
  findDryFrom,
  dayLimitingFactor,
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
   * for display only - ranking still sorts on score band, confidence tier,
   * then raw `score` (see ranking.ts), so this never changes ordering, only
   * the number shown. Equal to `score` when confidence is high.
   */
  displayScore: number;
  rockDrynessScore: number;
  dryFromIdx: number | null; // global hour index into this model's series
  dryFromHourOfDay: number | null; // 0-23 clock hour from the timestamp, for display
  climbableDaylightHours: number;
  totalDaylightHours: number;
  bestContiguousClimbableHours: number;
  /**
   * Clock hours of the longest unbroken climbable daylight run (§4.7), end
   * exclusive - a block covering 09:00-16:59 is 9 and 17. Null when there was
   * no climbable daylight hour. `formatDryTiming` turns these into row wording.
   */
  bestWindowStartHour: number | null;
  bestWindowEndHour: number | null;
  /** Clock hour of the day's last daylight hour, so a window can be said to run to dusk; null with no daylight. */
  lastDaylightHour: number | null;
  bestFrictionBlockScore: number;
  /**
   * Clock hour (0-23) the friction block above starts at - always a 3h window
   * that was ALSO counted dry (see `bestFrictionBlock` in friction.ts), never
   * an independent reading. Null when the day never had 3 consecutive dry
   * daylight hours to evaluate at all, which is a different finding from "it
   * was dry but slick" (bestFrictionBlockScore near 0 with a real window) -
   * callers should show that distinction rather than rendering both as "0".
   */
  frictionWindowStartHour: number | null;
  /**
   * Mean rock temperature and mean dew point across the friction window above,
   * °C - the pair the friction score was computed from, so the UI can show why
   * it is what it is instead of leaving a low number unexplained (§6). Null
   * exactly when `frictionWindowStartHour` is (no eligible block).
   */
  frictionWindowRockTempC: number | null;
  frictionWindowDewPointC: number | null;
  /**
   * The largest friction penalty averaged over the friction window's hours, if
   * it is at least 0.1 (`frictionReasonForWindow`) - why a dry day still scored
   * poorly on friction. Null with no window, or when nothing much held it back.
   */
  frictionReason: FrictionReason | null;
  /** Mean `dryness` over the friction window's hours, 0-1: 1 when all of it was fully dry, less when the window is rock just damp inside (§4.7). Null with no window. */
  frictionWindowDryness: number | null;
  /**
   * Daylight hours weighted by how dry each counts (`HourResult.dryness`) -
   * what the dryness score is made of. Equals `climbableDaylightHours` unless
   * some hours were just damp inside, which add part of an hour each.
   */
  effectiveDryDaylightHours: number;
  /** The longest unbroken daylight run counted the same way - part credit for hours just damp inside (§4.7). Equals `bestContiguousClimbableHours` when every hour is fully dry or wet. */
  bestEffectiveRunHours: number;
  /**
   * Clock hours when direct sun can reach the face, end exclusive - geometry
   * only, whatever the cloud (`sunOnFaceHours`, solar.ts). Null when the sun
   * never gets round to this aspect that day.
   */
  sunOnFaceHours: { start: number; end: number } | null;
  /**
   * The day's daylight weather at a glance (§6 crag detail): air temperature
   * and wind speed ranges, the prevailing wind direction (speed-weighted vector
   * mean, meteorological FROM convention) and mean cloud cover. Null with no
   * daylight hours.
   */
  daylightWeather: {
    airTempC: { min: number; max: number };
    windSpeedMs: { min: number; max: number };
    windFromDeg: number;
    cloudCoverPct: number;
  } | null;
  limitingFactor: LimitingFactor;
  /**
   * How many models put this day in the same score band (good / fair / poor,
   * scoreBand.ts) as this day's own score (§4.10) - agreement on what kind of
   * day it is, not merely that it has one dry hour.
   */
  confidence: ModelAgreement;
  /** Every model with data for the whole day and its score (gated days count as 0), for the "models range" readout. */
  modelScores: { model: ModelName; score: number }[];
  modelScoreRange: { min: number; max: number };
  /** Showers-mm / total-precipitation-mm for the day, 0 when no rain fell - §4.10. */
  showerDominance: number;
  /** Mean air temperature across daylight hours, for at-a-glance summaries (map popups, §6). */
  avgDaylightTempC: number;
  /**
   * Highest hourly chance of rain in daylight, %, for at-a-glance summaries
   * (§11). Each hour's value is Open-Meteo's precipitation_probability averaged
   * across whichever models publish it for that hour (UKMO does for part of its
   * horizon, not all of it); the day's figure is the MAXIMUM over its daylight
   * hours, not a 24-hour mean - four hours at 60% and twenty dry hours is a 60%
   * day, not 10%. When no model publishes it: 100 if any daylight hour has at
   * least 0.5mm, else the share of daylight hours with measurable rain.
   */
  rainChancePct: number;
  /**
   * Coldest wind chill across the day's daylight hours, °C - a comfort factor
   * for the climber (numb hands, miserable belaying), distinct from
   * `bestFrictionBlockScore`'s rock-temperature terms. Null when there were no
   * daylight hours to evaluate. Never affects `score` - see `windChillCaveat`.
   */
  worstDaylightWindChillC: number | null;
  /**
   * The model this day's numbers came from. On the headline `days` that is the
   * model `chooseModelForDay` picked for it (§3.3); in `perModelDays` it is
   * simply that array's own model.
   */
  sourceModel: ModelName;
}

export interface CragForecastResult {
  /**
   * The model chosen for TODAY's headline (§3.3). No longer the model behind
   * every headline day - see `modelByDay` for that. Kept so callers that only
   * need "the model for now" keep compiling.
   */
  primaryModel: ModelName;
  availableModels: ModelName[];
  hourly: HourResult[]; // headline hourly series, stitched per day from `modelByDay`, for the detail timeline
  inputs: CragHourlyInput[]; // headline inputs, stitched the same way
  days: CragDayResult[]; // headline day-by-day results, each from its own `sourceModel`, confidence-annotated
  /** Which model each headline day (and its 24 hours in `hourly`/`inputs`) came from, one entry per day. */
  modelByDay: ModelName[];
  /** The model whose deep soil moisture drove seepage for every model here (§4.5), or null when none published any. */
  soilMoistureSource: ModelName | null;
  /** Every resolved model's day-by-day score, for the "compare models" chart (§6 crag detail). */
  perModelDays: Partial<Record<ModelName, CragDayResult[]>>;
}

// Lead-time-aware preference, §3.3: UKMO's 2km UKV only runs ~2 days ahead; beyond that
// ECMWF is the most skilful of the four for the UK. ICON and GFS are fallbacks.
const SHORT_RANGE_PREFERENCE: ModelName[] = ['ukmo_seamless', 'ecmwf_ifs025', 'icon_seamless', 'gfs_seamless'];
const LONG_RANGE_PREFERENCE: ModelName[] = ['ecmwf_ifs025', 'ukmo_seamless', 'icon_seamless', 'gfs_seamless'];
const SHORT_RANGE_LAST_LEAD_DAY = 2; // days after today still judged on UKMO first

/**
 * The model a headline day is taken from (§3.3): the first in the lead-time
 * preference list whose series covers the WHOLE day. Past days count as short
 * range, so they are judged on UKMO like today. Null when no model reaches the
 * end of this day. `dayEndIdx` is the day's last hour index (days are local
 * calendar days, so 23, 24 or 25 hours - see time.ts).
 */
export function chooseModelForDay(
  dayIndex: number,
  todayIndex: number,
  perModelResults: Map<ModelName, HourResult[]>,
  dayEndIdx: number,
): ModelName | null {
  const preference = dayIndex - todayIndex <= SHORT_RANGE_LAST_LEAD_DAY ? SHORT_RANGE_PREFERENCE : LONG_RANGE_PREFERENCE;
  for (const model of preference) {
    const series = perModelResults.get(model);
    if (series && series.length >= dayEndIdx + 1) return model;
  }
  return null;
}

// Models whose deep soil moisture feeds the shared seepage driver, in order of
// preference (§4.5). UKMO and GFS publish none.
const SOIL_MOISTURE_SOURCES: ModelName[] = ['ecmwf_ifs025', 'icon_seamless'];

/**
 * One deep soil-moisture series for the whole cell, fed to every model (§4.5).
 * Deep soil moisture is slow - it integrates weeks of weather - so one series
 * is as good a seepage driver for the next fortnight as four. Using one means
 * model disagreement reflects the weather rather than four different soil
 * schemes: at Wyndcliffe ECMWF's deep layer sat at 0.15-0.16 all summer and
 * ICON's at 0.27-0.30, about 10x apart in implied seepage. It also gives UKMO
 * and GFS, which publish no soil moisture, the real driver instead of the
 * precipitation-kernel fallback.
 *
 * Takes the first source with any real value. Gaps are held rather than dropped
 * to the fallback: nulls after the last real value hold that value (the source's
 * horizon ending is not the ground drying out), and nulls before the first real
 * value take the first real value.
 */
export function buildSharedSoilMoisture(cell: CellForecast): { series: (number | null)[]; source: ModelName } | null {
  for (const model of SOIL_MOISTURE_SOURCES) {
    const vars = cell.models[model];
    const raw = vars ? getSoilMoistureDeep(vars) : null;
    if (!raw) continue;
    const firstReal = raw.find((v) => v != null);
    if (firstReal == null) continue;
    let held: number = firstReal;
    const series = cell.time.map((_, i) => {
      const v = raw[i];
      if (v != null) held = v;
      return held;
    });
    return { series, source: model };
  }
  return null;
}

/**
 * This crag's deep soil-moisture climatology for the given source model (§3.5),
 * from the build-time calibration file - or null when there is none (unknown
 * crag, no source, or that model missing from the archive), in which case
 * callers fall back to `DEFAULT_SM_CALIBRATION`.
 */
export function soilMoistureCalibrationFor(
  cragId: string,
  source: ModelName | null | undefined,
): SoilMoistureCalibration | null {
  if (source !== 'ecmwf_ifs025' && source !== 'icon_seamless') return null;
  const calibration = SOIL_MOISTURE_CALIBRATION[cragId]?.[source];
  // A degenerate range is not a climatology - e.g. a coastal crag whose ICON cell
  // is sea, where soil moisture is 0 all year - and normalising against it would
  // pin seepage at zero. Same threshold the calibration script warns on.
  if (!calibration || calibration.p95 - calibration.p5 < MIN_CALIBRATION_RANGE) return null;
  return calibration;
}

const MIN_CALIBRATION_RANGE = 0.02;

/**
 * `soilMoistureSource` is the model the shared deep soil-moisture series came
 * from (§4.5) - the calibration has to match the series it normalises, since
 * ECMWF and ICON sit at very different absolute levels at the same place.
 */
export function toModelConfig(crag: Crag, soilMoistureSource?: ModelName | null): CragModelConfig {
  return {
    smCalibration: soilMoistureCalibrationFor(crag.id, soilMoistureSource) ?? DEFAULT_SM_CALIBRATION,
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
    softRock: crag.softRock,
  };
}

/**
 * The day's rain chance (§11): the highest cross-model hourly probability over
 * its daylight hours. Fallback when no model publishes a probability for any
 * daylight hour: 100 if a daylight hour has at least 0.5mm, else the share of
 * daylight hours with more than 0.1mm. All three arrays are indexed within the day.
 */
export function daylightRainChancePct(
  probabilityPct: (number | null)[],
  precipitationMm: number[],
  isDayFlags: boolean[],
): number {
  const daylight = isDayFlags.map((d, i) => (d ? i : -1)).filter((i) => i >= 0);
  if (daylight.length === 0) return 0;
  const probs = daylight.map((i) => probabilityPct[i]).filter((v): v is number => v != null);
  if (probs.length > 0) return Math.round(Math.max(...probs));
  if (daylight.some((i) => precipitationMm[i] >= 0.5)) return 100;
  return Math.round((100 * daylight.filter((i) => precipitationMm[i] > 0.1).length) / daylight.length);
}

/**
 * Daylight air temperature and wind ranges, prevailing wind direction and mean
 * cloud for one day (`CragDayResult.daylightWeather`). The direction is a
 * speed-weighted vector mean, so a light northerly at dawn doesn't cancel a
 * strong southerly all afternoon, and 350° and 10° average to north, not south.
 * Both arrays are indexed within the day.
 */
export function daylightWeatherSummary(dayInputs: CragHourlyInput[], isDayFlags: boolean[]): RawDay['daylightWeather'] {
  const hours = dayInputs.filter((_, i) => isDayFlags[i]);
  if (hours.length === 0) return null;
  const temps = hours.map((h) => h.tempC);
  const winds = hours.map((h) => h.windSpeedMs);
  let u = 0;
  let v = 0;
  for (const h of hours) {
    const rad = (h.windDirectionDeg * Math.PI) / 180;
    u += h.windSpeedMs * Math.sin(rad);
    v += h.windSpeedMs * Math.cos(rad);
  }
  const windFromDeg = ((Math.atan2(u, v) * 180) / Math.PI + 360) % 360;
  return {
    airTempC: { min: Math.min(...temps), max: Math.max(...temps) },
    windSpeedMs: { min: Math.min(...winds), max: Math.max(...winds) },
    windFromDeg,
    cloudCoverPct: hours.reduce((sum, h) => sum + h.cloudCoverPct, 0) / hours.length,
  };
}

/** A day before cross-model confidence is attached. */
type RawDay = Omit<CragDayResult, 'confidence' | 'displayScore' | 'modelScores' | 'modelScoreRange'>;

/** Per-day rollup (§4.9) for one model's hourly series. Confidence is filled in afterwards, once every model's results are in. */
function computeDaysForModel(
  crag: Crag,
  model: ModelName,
  results: HourResult[],
  inputs: CragHourlyInput[],
  /** Cross-model precipitation_probability average per hour, global-hour-indexed to match `inputs` - §4.9/§6. */
  crossModelPrecipProbPct: (number | null)[],
  /** The cell's local calendar days (time.ts); only days this model covers in full are rolled up. */
  boundaries: DayBoundary[],
): RawDay[] {
  const trock = results.map((r) => r.Trock);
  const days: RawDay[] = [];

  for (let day = 0; day < boundaries.length; day++) {
    const dayStart = boundaries[day].startIdx;
    const dayEnd = boundaries[day].endIdx;
    if (dayEnd >= results.length) break;

    const dayResults = results.slice(dayStart, dayEnd + 1);
    const dayInputs = inputs.slice(dayStart, dayEnd + 1);
    const isDayFlags = dayInputs.map((i) => i.isDay);
    // Clock hours from the timestamps, never array positions: across a clock
    // change a day has 23 or 25 hours and position no longer equals hour (§3.1).
    const hoursOfDay = dayInputs.map((i) => hourOfDayLondon(i.time));

    const { totalClimbableDaylightHours, bestContiguousBlock, effectiveDryDaylightHours, bestEffectiveRunHours } =
      climbableHoursForDay(dayResults, isDayFlags);
    const totalDaylightHours = isDayFlags.filter(Boolean).length;

    const dayPrecipMm = dayInputs.reduce((sum, i) => sum + i.precipitationMm, 0);
    const dayShowersMm = dayInputs.reduce((sum, i) => sum + (i.showersMm ?? 0), 0);
    const showerDominance = dayPrecipMm > 0 ? Math.min(1, dayShowersMm / dayPrecipMm) : 0;

    const daylightTemps = dayInputs.filter((_, idx) => isDayFlags[idx]).map((i) => i.tempC);
    const avgDaylightTempC =
      (daylightTemps.length > 0 ? daylightTemps : dayInputs.map((i) => i.tempC)).reduce((sum, t) => sum + t, 0) /
      (daylightTemps.length > 0 ? daylightTemps.length : dayInputs.length);
    const rainChancePct = daylightRainChancePct(
      crossModelPrecipProbPct.slice(dayStart, dayEnd + 1),
      dayInputs.map((i) => i.precipitationMm),
      isDayFlags,
    );

    // Indexed from the block's start index within the day (not its clock hour).
    const blockMeans = (startIdx: number) => {
      const hours: number[] = [];
      for (let h = startIdx; h < startIdx + FRICTION_BLOCK_LENGTH_HOURS && h < dayResults.length; h++) hours.push(h);
      const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
      return {
        rockTempC: mean(hours.map((h) => dayResults[h].Trock)),
        dewPointC: mean(hours.map((h) => dayInputs[h].dewPointC)),
      };
    };

    const frictionBreakdowns = dayResults.map((r, idx) =>
      frictionBreakdownHour({
        trockC: r.Trock,
        idealTempC: crag.idealTempC,
        dewPointC: dayInputs[idx].dewPointC,
        windSpeedMs: dayInputs[idx].windSpeedMs,
        windDirectionDeg: dayInputs[idx].windDirectionDeg,
        // Sun that actually reaches the rock through any tree cover, as the rock
        // temperature uses (§4.2) - a wooded face is not "sun-baked" by open-sky sun.
        gtiFaceWm2: dayInputs[idx].gtiFaceWm2 * crag.canopyLight,
        aspectDeg: crag.aspectDeg,
        coastal: crag.coastal,
        rock: crag.rock,
        disciplines: crag.disciplines,
      }),
    );
    // Gate the block search on daylight AND at least partly dry, not daylight
    // alone, so the reported friction score describes a window you could
    // actually climb in rather than the best-looking 3h stretch of an otherwise
    // wet day. Each hour's friction is weighted by how dry it counts (§4.7): a
    // fully dry hour is unchanged, rock just damp inside grips proportionately
    // worse, and there is no jump as the rock crosses the dry-inside line.
    const dryDaylightFlags = isDayFlags.map((isDay, idx) => isDay && dayResults[idx].dryness > 0);
    const frictionScores = frictionBreakdowns.map((b, idx) => b.score * dayResults[idx].dryness);
    const frictionBlock = bestFrictionBlock(frictionScores, dryDaylightFlags, FRICTION_BLOCK_LENGTH_HOURS, hoursOfDay);
    const bestFriction = frictionBlock.score;
    // The two temperatures the friction score is actually a statement about,
    // averaged across the winning block's hours (not the day - see §4.8). Kept
    // as outputs because the score alone cannot explain itself: when a COLDER
    // day scores worse than a warmer one, it is almost always this pair closing
    // on each other, and a reader without both numbers reads that as a bug
    // rather than as the model working (§6).
    const frictionWindow = frictionBlock.startIdx != null ? blockMeans(frictionBlock.startIdx) : null;
    const frictionWindowDryness =
      frictionBlock.startIdx != null
        ? dayResults
            .slice(frictionBlock.startIdx, frictionBlock.startIdx + FRICTION_BLOCK_LENGTH_HOURS)
            .reduce((sum, r) => sum + r.dryness, 0) / FRICTION_BLOCK_LENGTH_HOURS
        : null;
    // The one-line "why" for a dry day that still scored poorly on friction (§1).
    const frictionReason =
      frictionBlock.startIdx != null && frictionWindow
        ? frictionReasonForWindow(
            frictionBreakdowns.slice(frictionBlock.startIdx, frictionBlock.startIdx + FRICTION_BLOCK_LENGTH_HOURS),
            frictionWindow.rockTempC,
            crag.idealTempC,
          )
        : null;

    const underSnowAnyHour = dayResults.some((r) => r.underSnow);
    const frozenAllDaylightHours = totalDaylightHours > 0 && dayResults.every((r, idx) => !isDayFlags[idx] || r.frozen);
    const freezeThaw = hadFreezeThawCycle(trock, dayEnd, 48);

    const verdict = dayVerdict({
      underSnowAnyHour,
      frozenAllDaylightHours,
      softRock: crag.softRock,
      freezeThawInPreceding48h: freezeThaw,
      softRockNoSafeDaylightHour: crag.softRock && totalClimbableDaylightHours === 0,
    });

    const breakdown = computeScoreBreakdown({
      // Graded hours (§4.7), so rock just damp inside earns part of an hour.
      climbableDaylightHours: effectiveDryDaylightHours,
      totalDaylightHours,
      bestContiguousClimbableHours: bestEffectiveRunHours,
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
      dryFromHourOfDay: dryFromOffset != null ? hoursOfDay[dryFromOffset] : null,
      climbableDaylightHours: totalClimbableDaylightHours,
      totalDaylightHours,
      bestContiguousClimbableHours: bestContiguousBlock?.hours ?? 0,
      bestWindowStartHour: bestContiguousBlock ? hoursOfDay[bestContiguousBlock.startIdx] : null,
      bestWindowEndHour: bestContiguousBlock ? hoursOfDay[bestContiguousBlock.endIdx] + 1 : null,
      lastDaylightHour: isDayFlags.lastIndexOf(true) >= 0 ? hoursOfDay[isDayFlags.lastIndexOf(true)] : null,
      bestFrictionBlockScore: bestFriction,
      frictionWindowStartHour: frictionBlock.startHourOfDay,
      frictionWindowRockTempC: frictionWindow?.rockTempC ?? null,
      frictionWindowDewPointC: frictionWindow?.dewPointC ?? null,
      frictionReason,
      frictionWindowDryness,
      effectiveDryDaylightHours,
      bestEffectiveRunHours,
      sunOnFaceHours: sunOnFaceHours(
        dayInputs.map((i) => i.time),
        hoursOfDay,
        crag.lat,
        crag.lon,
        crag.aspectDeg,
        STEEPNESS_TILT_DEG[crag.steepness],
      ),
      daylightWeather: daylightWeatherSummary(dayInputs, isDayFlags),
      limitingFactor: dayLimitingFactor(results, dayStart, dayEnd, isDayFlags),
      showerDominance,
      avgDaylightTempC,
      rainChancePct,
      worstDaylightWindChillC,
      sourceModel: model,
    });
  }

  return days;
}

/**
 * Run the full model for one crag against one forecast cell - every model in
 * §3.3 for confidence, rolled up into per-day results (§4.9). Assumes the
 * hourly series starts at local midnight (guaranteed by the `timezone` +
 * `timeformat=unixtime` request parameters, §3.1). Days are local calendar
 * days read from the timestamps (time.ts), so 23 or 25 hours long across a
 * clock change - never fixed 24-hour chunks of the array.
 *
 * `todayIndex` is today's day index within the series - it decides which days
 * are judged on the short-range model preference (§3.3).
 */
export function computeCragForecast(
  crag: Crag,
  cell: CellForecast,
  todayIndex: number = PAST_DAYS,
): CragForecastResult | null {
  const perModelResults = new Map<ModelName, HourResult[]>();
  const perModelInputs = new Map<ModelName, CragHourlyInput[]>();

  const sharedSoilMoisture = buildSharedSoilMoisture(cell);
  // Calibrated against the same model's climatology as the series above (§3.5);
  // `runSimulation`'s initial M reads the same `config.smCalibration`.
  const config = toModelConfig(crag, sharedSoilMoisture?.source ?? null);

  for (const model of MODELS) {
    const inputs = buildHourlyInputsForModel(crag, cell, model, sharedSoilMoisture?.series ?? null);
    if (!inputs || inputs.length === 0) continue;
    perModelInputs.set(model, inputs);
    perModelResults.set(model, runSimulation(inputs, config));
  }

  const availableModels = [...perModelResults.keys()];
  if (availableModels.length === 0) return null;

  // Real precipitation_probability, averaged per hour across whichever models publish it
  // for that hour (UKMO does for part of its horizon) - shared by every model's day
  // rollup below, which takes the daylight maximum, §4.9/§6.
  const crossModelPrecipProbPct: (number | null)[] = cell.time.map((_, i) => {
    const values = availableModels
      .map((m) => cell.models[m]?.precipitation_probability?.[i])
      .filter((v): v is number => v != null);
    return values.length > 0 ? values.reduce((sum, v) => sum + v, 0) / values.length : null;
  });

  const boundaries = dayBoundaries(cell.time);
  const perModelDaysRaw = new Map<ModelName, RawDay[]>();
  for (const model of availableModels) {
    perModelDaysRaw.set(
      model,
      computeDaysForModel(crag, model, perModelResults.get(model)!, perModelInputs.get(model)!, crossModelPrecipProbPct, boundaries),
    );
  }

  function withConfidence(model: ModelName): CragDayResult[] {
    const raw = perModelDaysRaw.get(model)!;
    return raw.map((d, dayIdx) => {
      // A model whose forecast horizon doesn't cover this whole day has NO data
      // here (buildInputs truncates it, §11), not a "no" vote - it is left out
      // of the agreement set entirely rather than counted as disagreeing, which
      // would understate confidence for every far-out day.
      const modelScores = availableModels
        .map((m) => {
          const other = perModelDaysRaw.get(m)![dayIdx];
          return other ? { model: m, score: other.score } : null; // gated days already score 0
        })
        .filter((v): v is { model: ModelName; score: number } => v !== null);
      // Agreement on the score BAND (§4.10), not on "at least one dry daylight
      // hour": four models each giving one damp dry hour used to read "4 of 4
      // agree" beside a poor score. Band, because the score is what the row shows.
      const band = scoreBand(d.score * 100);
      const confidence = modelAgreement(modelScores.map((s) => scoreBand(s.score * 100) === band));
      const scores = modelScores.map((s) => s.score);
      return {
        ...d,
        confidence,
        modelScores,
        modelScoreRange: { min: Math.min(...scores), max: Math.max(...scores) },
        displayScore: confidenceAdjustedScore(d.score, confidence, d.showerDominance),
      };
    });
  }

  const perModelDays: Partial<Record<ModelName, CragDayResult[]>> = {};
  for (const model of availableModels) {
    perModelDays[model] = withConfidence(model);
  }

  // Headline outputs stitched per day (§3.3): each whole day that any model
  // covers comes from the lead-time-preferred model that covers it, along with
  // that day's hours of inputs and simulation results. Every model's series
  // starts at the same first hour and shares the cell's day boundaries, so the
  // stitched arrays keep each model's own indices (`dayStartIdx` and
  // `dryFromIdx` still point at the right hours). A small
  // jump in S/M at a midnight where the model changes is expected - each
  // model's water state is its own continuous simulation - and is left as is.
  const modelByDay: ModelName[] = [];
  const days: CragDayResult[] = [];
  const hourly: HourResult[] = [];
  const inputs: CragHourlyInput[] = [];
  for (let d = 0; d < boundaries.length; d++) {
    const { startIdx, endIdx } = boundaries[d];
    const model = chooseModelForDay(d, todayIndex, perModelResults, endIdx);
    if (!model) break;
    modelByDay.push(model);
    days.push(perModelDays[model]![d]);
    hourly.push(...perModelResults.get(model)!.slice(startIdx, endIdx + 1));
    inputs.push(...perModelInputs.get(model)!.slice(startIdx, endIdx + 1));
  }

  const primaryModel = modelByDay[Math.min(todayIndex, modelByDay.length - 1)] ?? availableModels[0];

  return {
    primaryModel,
    availableModels,
    hourly,
    inputs,
    days,
    modelByDay,
    soilMoistureSource: sharedSoilMoisture?.source ?? null,
    perModelDays,
  };
}

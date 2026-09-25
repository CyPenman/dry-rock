import type { CragDayResult, CragForecastResult } from './dayAggregate';
import { frictionScoreHour } from './friction';
import type { Crag } from './types';
import { limitingFactorAt } from './wetness';

// Ground truth (spec §8.1): what the rock was actually like, saved next to
// what the model said about the same hour, so the constants can be checked
// against reality instead of tuned blind. Kept on the device and emailed to
// the developer as a report (src/api/reports.ts).

export type ObservedCondition = 'dry' | 'damp' | 'seeping' | 'greasy' | 'verglas';

export const OBSERVED_CONDITIONS: { value: ObservedCondition; label: string }[] = [
  { value: 'dry', label: 'Dry' },
  { value: 'damp', label: 'Damp' },
  { value: 'seeping', label: 'Seeping' },
  { value: 'greasy', label: 'Greasy' },
  { value: 'verglas', label: 'Verglas' },
];

export interface Observation {
  id: string; // `${cragId}-${observedAtSec}`
  cragId: string;
  observedAtSec: number;
  condition: ObservedCondition;
  note?: string;
  snapshot: {
    // the model's view of that same hour
    sourceModel: string;
    S: number;
    M: number;
    Mmax: number;
    Trock: number;
    climbable: boolean;
    tempC: number;
    dewPointC: number;
    windSpeedMs: number;
    vpdKpa: number;
    precipLast24hMm: number;
    limitingFactor: string;
    dayScore: number;
    frictionHourScore: number;
  };
  /** Everything else needed to debug a report later - absent on observations logged before it existed. */
  context?: ObservationContext;
  /** When the report reached the inbox (§8.1); absent until it has been sent. */
  sentAtSec?: number;
}

/** One model's verdict on the observed day, cut down from `CragDayResult`. */
export interface ObservedDaySummary {
  model: string;
  verdict: string;
  score: number;
  displayScore: number;
  limitingFactor: string;
  frictionReason: string | null;
  dryFromHourOfDay: number | null;
  climbableDaylightHours: number;
  totalDaylightHours: number;
  frictionWindowStartHour: number | null;
}

/** One headline hour around the observation, inputs and model state side by side. */
export interface ObservedHour {
  time: number; // unixtime
  precipMm: number;
  tempC: number;
  dewPointC: number;
  windMs: number;
  windFromDeg: number;
  cloudPct: number;
  gtiFaceWm2: number;
  soilMoistureDeep: number | null;
  S: number;
  M: number;
  Trock: number;
  climbable: boolean;
  frozen: boolean;
  underSnow: boolean;
}

export interface ObservationContext {
  cragName: string;
  /** Git commit and build date of the app that made the report, so it can be replayed against the same model. */
  appBuild: string;
  /** When the forecast behind the report was downloaded (ms since epoch), or null if unknown. */
  forecastFetchedAt: number | null;
  /** The headline day (§3.3) - the one the app shows for that date. */
  headlineDay: ObservedDaySummary & {
    confidence: { agreeCount: number; total: number };
    modelScores: { model: string; score: number }[];
  };
  /** Every resolved model's view of the same day. */
  perModelDay: ObservedDaySummary[];
  /** The headline series from OBSERVED_HOURS_BEFORE hours before the observation to OBSERVED_HOURS_AFTER after. */
  hours: ObservedHour[];
}

export const OBSERVED_HOURS_BEFORE = 24;
export const OBSERVED_HOURS_AFTER = 6;

const round2 = (x: number) => Math.round(x * 100) / 100;

function summariseDay(day: CragDayResult): ObservedDaySummary {
  return {
    model: day.sourceModel,
    verdict: day.verdict,
    score: round2(day.score),
    displayScore: round2(day.displayScore),
    limitingFactor: day.limitingFactor,
    frictionReason: day.frictionReason,
    dryFromHourOfDay: day.dryFromHourOfDay,
    climbableDaylightHours: day.climbableDaylightHours,
    totalDaylightHours: day.totalDaylightHours,
    frictionWindowStartHour: day.frictionWindowStartHour,
  };
}

/** Index of the headline hour containing `nowSec`, or null outside the series. */
function hourIndexAt(forecast: CragForecastResult, nowSec: number): number | null {
  const { inputs } = forecast;
  if (inputs.length === 0 || nowSec < inputs[0].time || nowSec >= inputs[inputs.length - 1].time + 3600) return null;
  let idx = 0;
  while (idx + 1 < inputs.length && inputs[idx + 1].time <= nowSec) idx++;
  return idx;
}

/**
 * The rest of the model's picture around `nowSec` (§8.1): the day's verdict
 * from the headline and from every model, and the headline hours either side.
 * Null when `nowSec` falls outside the series, as for the snapshot.
 */
export function buildObservationContext(
  crag: Crag,
  forecast: CragForecastResult,
  nowSec: number,
  forecastFetchedAt: number | null,
  appBuild: string,
): ObservationContext | null {
  const idx = hourIndexAt(forecast, nowSec);
  if (idx == null) return null;
  const day = forecast.days.find((d) => idx >= d.dayStartIdx && idx <= d.dayEndIdx);
  if (!day) return null;

  const perModelDay: ObservedDaySummary[] = [];
  for (const days of Object.values(forecast.perModelDays)) {
    const same = days?.find((d) => d.dayIndex === day.dayIndex);
    if (same) perModelDay.push(summariseDay(same));
  }

  const hours: ObservedHour[] = [];
  const from = Math.max(0, idx - OBSERVED_HOURS_BEFORE);
  const to = Math.min(forecast.inputs.length - 1, idx + OBSERVED_HOURS_AFTER);
  for (let i = from; i <= to; i++) {
    const input = forecast.inputs[i];
    const result = forecast.hourly[i];
    hours.push({
      time: input.time,
      precipMm: round2(input.precipitationMm),
      tempC: round2(input.tempC),
      dewPointC: round2(input.dewPointC),
      windMs: round2(input.windSpeedMs),
      windFromDeg: Math.round(input.windDirectionDeg),
      cloudPct: Math.round(input.cloudCoverPct),
      gtiFaceWm2: Math.round(input.gtiFaceWm2),
      soilMoistureDeep: input.soilMoistureDeep == null ? null : round2(input.soilMoistureDeep),
      S: round2(result.S),
      M: round2(result.M),
      Trock: round2(result.Trock),
      climbable: result.climbable,
      frozen: result.frozen,
      underSnow: result.underSnow,
    });
  }

  return {
    cragName: crag.name,
    appBuild,
    forecastFetchedAt,
    headlineDay: {
      ...summariseDay(day),
      confidence: { agreeCount: day.confidence.agreeCount, total: day.confidence.total },
      modelScores: day.modelScores.map((m) => ({ model: m.model, score: round2(m.score) })),
    },
    perModelDay,
    hours,
  };
}

/**
 * The model's view of the hour containing `nowSec` (§8.1), from the headline
 * series. Null when `nowSec` falls outside the series - there is nothing to
 * compare the observation against, so the log should say so rather than guess.
 */
export function buildObservationSnapshot(
  crag: Crag,
  forecast: CragForecastResult,
  nowSec: number,
): Observation['snapshot'] | null {
  const { inputs, hourly, days } = forecast;
  const idx = hourIndexAt(forecast, nowSec);
  if (idx == null) return null;
  const input = inputs[idx];
  const result = hourly[idx];
  const day = days.find((d) => idx >= d.dayStartIdx && idx <= d.dayEndIdx);
  if (!result || !day) return null;

  let precipLast24hMm = 0;
  for (let i = Math.max(0, idx - 23); i <= idx; i++) precipLast24hMm += inputs[i].precipitationMm;

  return {
    sourceModel: day.sourceModel,
    S: result.S,
    M: result.M,
    Mmax: crag.Mmax,
    Trock: result.Trock,
    climbable: result.climbable,
    tempC: input.tempC,
    dewPointC: input.dewPointC,
    windSpeedMs: input.windSpeedMs,
    vpdKpa: input.vpdKpa,
    precipLast24hMm,
    limitingFactor: limitingFactorAt(hourly, idx),
    dayScore: day.score,
    frictionHourScore: frictionScoreHour({
      trockC: result.Trock,
      idealTempC: crag.idealTempC,
      dewPointC: input.dewPointC,
      windSpeedMs: input.windSpeedMs,
      windDirectionDeg: input.windDirectionDeg,
      gtiFaceWm2: input.gtiFaceWm2 * crag.canopyLight, // through tree cover, as in dayAggregate
      aspectDeg: crag.aspectDeg,
      coastal: crag.coastal,
      rock: crag.rock,
      disciplines: crag.disciplines,
    }),
  };
}

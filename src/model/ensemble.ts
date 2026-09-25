import type { EnsembleCellForecast } from '../api/ensembleClient';
import { getSoilMoistureDeep } from '../api/soilMoisture';
import { sunTrack, vpdFromDewPointKpa, type SunTrack } from './buildInputs';
import { FRICTION_BLOCK_LENGTH_HOURS } from './friction';
import { STEEPNESS_TILT_DEG } from './rockDefaults';
import { computeGtiFace } from './solar';
import { dayBoundaries, hourOfDayLondon, localDateKeyLondon } from './time';
import type { Crag } from './types';
import { runSimulation, stateAfter, type CragHourlyInput, type CragModelConfig, type HourResult } from './wetness';

/**
 * What the ensemble takes from the deterministic headline (§3.3), matched by
 * timestamp - the ensemble series need not line up with the headline's.
 */
export interface EnsembleHeadline {
  /**
   * The headline's hourly inputs. Every member takes its deep soil moisture,
   * so all share the headline's seepage driver (§4.5), and borrows what
   * icon_eu doesn't publish: dew point, lying snow and visibility.
   */
  inputsByTime: Map<number, CragHourlyInput>;
  /** The headline's hourly results: each member starts from the headline's state at the end of the hour before its first. */
  resultsByTime: Map<number, HourResult>;
}

/** `EnsembleHeadline` from a crag's headline series (`CragForecastResult.inputs` and `.hourly`). */
export function ensembleHeadline(inputs: CragHourlyInput[], hourly: HourResult[]): EnsembleHeadline {
  return {
    inputsByTime: new Map(inputs.map((i) => [i.time, i])),
    resultsByTime: new Map(hourly.map((r) => [r.time, r])),
  };
}

/**
 * Same shape as `buildHourlyInputsForModel` (§3.4), for one ensemble member's
 * raw variables. Built over the member's resolved stretch only: icon_eu
 * members carry nothing for most of the past days and nothing past their
 * ~5-day horizon - Open-Meteo fills both ends with nulls, which would
 * otherwise be read as 0°C air and a 0°C dew point. `offset` is the cell
 * index of `inputs[0]`.
 *
 * icon_eu's members publish no humidity, lying snow or visibility, so with a
 * `headline` they take the headline's for the same hour. A member with
 * neither its own dew point nor the headline's for an hour stops there.
 * Members then still differ in rain, temperature, wind and cloud - the terms
 * that decide most wet/dry outcomes - but not in humidity. Deep soil moisture
 * comes from the headline too, holding the last value seen for any hour it
 * lacks.
 */
function buildHourlyInputsForMember(
  crag: Crag,
  cell: EnsembleCellForecast,
  memberKey: string,
  sun: SunTrack,
  headline?: EnsembleHeadline,
): { inputs: CragHourlyInput[]; offset: number } | null {
  const vars = cell.members[memberKey];
  if (!vars || !vars.temperature_2m) return null;

  const headlineAt = (i: number) => headline?.inputsByTime.get(cell.time[i]);
  const dewPointAt = (i: number): number | null => vars.dew_point_2m?.[i] ?? headlineAt(i)?.dewPointC ?? null;
  const resolved = (i: number) => vars.temperature_2m[i] != null && dewPointAt(i) != null;
  let offset = 0;
  while (offset < cell.time.length && !resolved(offset)) offset++;
  let end = offset;
  while (end < cell.time.length && resolved(end)) end++;
  if (end === offset) return null;

  const soilMoistureDeepSeries = getSoilMoistureDeep(vars);
  const tiltDeg = STEEPNESS_TILT_DEG[crag.steepness];
  const inputs: CragHourlyInput[] = new Array(end - offset);
  let heldSharedSm: number | null = null;

  for (let i = offset; i < end; i++) {
    const shared = headlineAt(i);
    let soilMoistureDeep: number | null;
    if (headline) {
      if (shared?.soilMoistureDeep != null) heldSharedSm = shared.soilMoistureDeep;
      soilMoistureDeep = heldSharedSm;
    } else {
      soilMoistureDeep = soilMoistureDeepSeries ? (soilMoistureDeepSeries[i] ?? null) : null;
    }
    const { elevationDeg, azimuthDeg } = sun.radiation[i];
    const gtiFaceWm2 = computeGtiFace({
      dni: vars.direct_normal_irradiance?.[i] ?? 0,
      dhi: vars.diffuse_radiation?.[i] ?? 0,
      ghi: vars.shortwave_radiation?.[i] ?? 0,
      elevationDeg,
      azimuthDeg,
      aspectDeg: crag.aspectDeg,
      tiltDeg,
    });
    const tempC = vars.temperature_2m[i];
    const dewPointC = dewPointAt(i)!;

    inputs[i - offset] = {
      time: cell.time[i],
      precipitationMm: vars.precipitation?.[i] ?? 0,
      showersMm: vars.showers?.[i] ?? 0,
      snowDepthM: vars.snow_depth?.[i] ?? shared?.snowDepthM ?? 0,
      tempC,
      dewPointC,
      vpdKpa: vpdFromDewPointKpa(tempC, dewPointC),
      windSpeedMs: vars.wind_speed_10m?.[i] ?? 0,
      windDirectionDeg: vars.wind_direction_10m?.[i] ?? 0,
      cloudCoverPct: vars.cloud_cover?.[i] ?? 0,
      visibilityM: vars.visibility?.[i] ?? shared?.visibilityM ?? 20000,
      // The same daylight as the headline: the sun, as Open-Meteo's is_day.
      isDay: sun.isDay[i],
      gtiFaceWm2,
      soilMoistureDeep,
    };
  }

  return { inputs, offset };
}

export interface EnsembleDayResult {
  /** Local midnight of the day, from the ensemble's own timestamps. */
  date: Date;
  /** Members whose forecast covers this whole day. */
  memberCount: number;
  /** Members giving a session's worth of dry daylight - `FRICTION_BLOCK_LENGTH_HOURS` (3) hours of graded dryness in an unbroken run (`firstUsableWindowStart`). */
  usableCount: number;
  /** Clock hour by which half / 80% of the usable members' first such window has started; null with no usable member. */
  dryByHourP50: number | null;
  dryByHourP80: number | null;
}

/**
 * Nearest-rank percentile of `values` (p in 0-1): the smallest value that at
 * least a fraction p of them are at or below. Chosen over interpolation so that
 * "dry by 11:00 in half of them" is literally true of the members, and so the
 * answer is always a real clock hour. Null for an empty list.
 */
export function nearestRankPercentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil(p * sorted.length));
  return sorted[rank - 1];
}

/** Float slack for adding up graded hours. */
const HOURS_EPSILON = 1e-9;

/**
 * Index of the start of the first usable window in `from`..`to`, or null. A
 * window is an unbroken run of daylight hours with some dryness, holding
 * `FRICTION_BLOCK_LENGTH_HOURS` of graded dryness (§4.7) - the same counting
 * as the day's score, so rock just damp inside counts part of an hour. It
 * starts at the latest hour that still leaves those hours by the moment they
 * are first reached. With every hour fully dry or fully wet, this is simply
 * the first 3 dry daylight hours in a row. It used to count whole climbable
 * hours only, so a "nearly dry" 55 on the headline could read "0 of 40
 * members".
 */
export function firstUsableWindowStart(inputs: CragHourlyInput[], results: HourResult[], from: number, to: number): number | null {
  const dryness = (i: number) => (inputs[i].isDay ? results[i].dryness : 0);
  let runStart = -1;
  for (let i = from; i <= to; i++) {
    if (dryness(i) <= 0) {
      runStart = -1;
      continue;
    }
    if (runStart < 0) runStart = i;
    let sum = 0;
    for (let s = i; s >= runStart; s--) {
      sum += dryness(s);
      if (sum >= FRICTION_BLOCK_LENGTH_HOURS - HOURS_EPSILON) return s;
    }
  }
  return null;
}

/**
 * Run the full wetness simulation once per ensemble member (§3.3) and report,
 * for each requested day, how many members give a usable dry window and how
 * early - a real probability per day, not one yes/no for the whole range
 * (§4.10). `dateKeys` are London calendar dates (`YYYY-MM-DD`, time.ts), matched
 * against the ensemble's own day boundaries so a clock change or a differently
 * aligned series can't shift the days. Reuses the same `runSimulation` as the
 * deterministic path; only the inputs differ.
 *
 * With `headline`, each member starts from the headline's state at its first
 * hour rather than from cold: members have about three days of history
 * against the headline's sixteen, and started cold they read drier than the
 * headline after a wet spell - worst at Kilnsey's lip drainage and on soft
 * sandstone. See `EnsembleHeadline` for what else members take from it.
 */
export function runEnsembleForCrag(
  crag: Crag,
  config: CragModelConfig,
  cell: EnsembleCellForecast,
  dateKeys: string[],
  headline?: EnsembleHeadline,
): EnsembleDayResult[] {
  const boundaries = dayBoundaries(cell.time);
  const days = dateKeys.map((key) => boundaries.find((b) => localDateKeyLondon(cell.time[b.startIdx]) === key) ?? null);
  const perDay = dateKeys.map(() => ({ memberCount: 0, firstWindowHours: [] as number[] }));
  const sun = sunTrack(crag, cell.time);

  for (const key of Object.keys(cell.members).sort()) {
    const member = buildHourlyInputsForMember(crag, cell, key, sun, headline);
    if (!member) continue;
    const { inputs, offset } = member;
    const seed = headline?.resultsByTime.get(inputs[0].time - 3600);
    const results = runSimulation(inputs, config, seed ? stateAfter(seed) : undefined);
    days.forEach((day, d) => {
      // A member counts for a day only if its resolved stretch covers all of it.
      if (!day || day.startIdx < offset || day.endIdx - offset >= results.length) return;
      perDay[d].memberCount++;
      const start = firstUsableWindowStart(inputs, results, day.startIdx - offset, day.endIdx - offset);
      if (start != null) perDay[d].firstWindowHours.push(hourOfDayLondon(inputs[start].time));
    });
  }

  return dateKeys.map((key, d) => {
    const [y, m, dd] = key.split('-').map(Number);
    const hours = perDay[d].firstWindowHours;
    return {
      date: new Date(y, m - 1, dd),
      memberCount: perDay[d].memberCount,
      usableCount: hours.length,
      dryByHourP50: nearestRankPercentile(hours, 0.5),
      dryByHourP80: nearestRankPercentile(hours, 0.8),
    };
  });
}

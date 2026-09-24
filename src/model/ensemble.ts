import type { EnsembleCellForecast } from '../api/ensembleClient';
import { getSoilMoistureDeep } from '../api/soilMoisture';
import { FRICTION_BLOCK_LENGTH_HOURS } from './friction';
import { STEEPNESS_TILT_DEG } from './rockDefaults';
import { computeGtiFace, solarPositionForHourlyRadiation } from './solar';
import { dayBoundaries, hourOfDayLondon, localDateKeyLondon } from './time';
import { saturationVapourPressureKpa } from './vapour';
import type { Crag } from './types';
import { runSimulation, type CragHourlyInput, type CragModelConfig } from './wetness';

/**
 * Same shape as `buildHourlyInputsForModel` (§3.4), for one ensemble member's raw variables.
 * With `sharedSoilMoistureByTime`, deep soil moisture comes from that map (matched by
 * timestamp, not index, since the ensemble series need not line up with the
 * deterministic one), holding the last value seen for any hour the map lacks.
 *
 * Built over the member's resolved stretch only. icon_eu members carry nothing
 * for most of the past days and nothing past their ~5-day horizon - Open-Meteo
 * fills both ends with nulls, which would otherwise be read as 0degC air and a
 * 0degC dew point. `offset` is the cell index of `inputs[0]`.
 *
 * icon_eu's members publish no humidity at all (dew point, RH and VPD are all
 * null), so with `sharedDewPointByTime` a member without its own dew point uses
 * the headline's for the same hour, and VPD is worked out from the member's own
 * temperature against it. Members then still differ in rain, temperature, wind
 * and cloud - the terms that decide most wet/dry outcomes - but not in humidity.
 */
function buildHourlyInputsForMember(
  crag: Crag,
  cell: EnsembleCellForecast,
  memberKey: string,
  sharedSoilMoistureByTime?: Map<number, number | null>,
  sharedDewPointByTime?: Map<number, number>,
): { inputs: CragHourlyInput[]; offset: number } | null {
  const vars = cell.members[memberKey];
  if (!vars || !vars.temperature_2m) return null;

  const dewPointAt = (i: number): number | null => vars.dew_point_2m?.[i] ?? sharedDewPointByTime?.get(cell.time[i]) ?? null;
  const resolved = (i: number) => vars.temperature_2m[i] != null && dewPointAt(i) != null;
  let offset = 0;
  while (offset < cell.time.length && !resolved(offset)) offset++;
  let end = offset;
  while (end < cell.time.length && resolved(end)) end++;
  if (end === offset) return null;

  const soilMoistureDeepSeries = getSoilMoistureDeep(vars);
  const inputs: CragHourlyInput[] = new Array(end - offset);
  let heldSharedSm: number | null = null;

  for (let i = offset; i < end; i++) {
    const time = cell.time[i];
    let soilMoistureDeep: number | null;
    if (sharedSoilMoistureByTime) {
      const shared = sharedSoilMoistureByTime.get(time);
      if (shared != null) heldSharedSm = shared;
      soilMoistureDeep = heldSharedSm;
    } else {
      soilMoistureDeep = soilMoistureDeepSeries ? (soilMoistureDeepSeries[i] ?? null) : null;
    }
    const { elevationDeg, azimuthDeg } = solarPositionForHourlyRadiation(time, crag.lat, crag.lon);
    const gtiFaceWm2 = computeGtiFace({
      dni: vars.direct_normal_irradiance?.[i] ?? 0,
      dhi: vars.diffuse_radiation?.[i] ?? 0,
      ghi: vars.shortwave_radiation?.[i] ?? 0,
      elevationDeg,
      azimuthDeg,
      aspectDeg: crag.aspectDeg,
      tiltDeg: STEEPNESS_TILT_DEG[crag.steepness],
    });

    inputs[i - offset] = {
      time,
      precipitationMm: vars.precipitation?.[i] ?? 0,
      showersMm: vars.showers?.[i] ?? 0,
      snowDepthM: vars.snow_depth?.[i] ?? 0,
      tempC: vars.temperature_2m[i],
      dewPointC: dewPointAt(i)!,
      vpdKpa:
        vars.vapour_pressure_deficit?.[i] ??
        Math.max(0, saturationVapourPressureKpa(vars.temperature_2m[i]) - saturationVapourPressureKpa(dewPointAt(i)!)),
      windSpeedMs: vars.wind_speed_10m?.[i] ?? 0,
      windDirectionDeg: vars.wind_direction_10m?.[i] ?? 0,
      cloudCoverPct: vars.cloud_cover?.[i] ?? 0,
      visibilityM: vars.visibility?.[i] ?? 20000,
      // `is_day` is one shared series, not per member, so members don't carry
      // it - fall back to the sun being above the horizon rather than to "always
      // day", which counted night hours as daylight.
      isDay: vars.is_day?.[i] != null ? vars.is_day[i] === 1 : elevationDeg > 0,
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
  /** Members giving a dry daylight window of at least FRICTION_BLOCK_LENGTH_HOURS (3) hours - long enough for a session. */
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

/**
 * Run the full wetness simulation once per ensemble member (§3.3) and report,
 * for each requested day, how many members give a usable dry window and how
 * early - a real probability per day, not one yes/no for the whole range
 * (§4.10). `dateKeys` are London calendar dates (`YYYY-MM-DD`, time.ts), matched
 * against the ensemble's own day boundaries so a clock change or a differently
 * aligned series can't shift the days. Reuses the same `runSimulation` as the
 * deterministic path; only the inputs differ. "Usable" means at least 3
 * consecutive climbable daylight hours - the same daylight definition as the
 * score, and the length of the friction window.
 *
 * `sharedSoilMoistureByTime` (timestamp to deep soil moisture, from the
 * deterministic headline inputs) gives every member the same seepage driver as
 * the headline (§4.5) - members often carry no soil moisture of their own.
 * `sharedDewPointByTime` does the same for humidity, which icon_eu's members
 * don't publish at all (see `buildHourlyInputsForMember`).
 */
export function runEnsembleForCrag(
  crag: Crag,
  config: CragModelConfig,
  cell: EnsembleCellForecast,
  dateKeys: string[],
  sharedSoilMoistureByTime?: Map<number, number | null>,
  sharedDewPointByTime?: Map<number, number>,
): EnsembleDayResult[] {
  const boundaries = dayBoundaries(cell.time);
  const days = dateKeys.map((key) => boundaries.find((b) => localDateKeyLondon(cell.time[b.startIdx]) === key) ?? null);
  const perDay = dateKeys.map(() => ({ memberCount: 0, firstWindowHours: [] as number[] }));

  for (const key of Object.keys(cell.members).sort()) {
    const member = buildHourlyInputsForMember(crag, cell, key, sharedSoilMoistureByTime, sharedDewPointByTime);
    if (!member) continue;
    const { inputs, offset } = member;
    const results = runSimulation(inputs, config);
    days.forEach((day, d) => {
      // A member counts for a day only if its resolved stretch covers all of it.
      if (!day || day.startIdx < offset || day.endIdx - offset >= results.length) return;
      perDay[d].memberCount++;
      let run = 0;
      for (let i = day.startIdx - offset; i <= day.endIdx - offset; i++) {
        run = inputs[i].isDay && results[i].climbable ? run + 1 : 0;
        if (run === FRICTION_BLOCK_LENGTH_HOURS) {
          perDay[d].firstWindowHours.push(hourOfDayLondon(inputs[i - FRICTION_BLOCK_LENGTH_HOURS + 1].time));
          break;
        }
      }
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

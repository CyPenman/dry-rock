import type { EnsembleCellForecast } from '../api/ensembleClient';
import { getSoilMoistureDeep } from '../api/soilMoisture';
import { computeGtiFace, solarPosition } from './solar';
import type { Crag } from './types';
import { runSimulation, type CragHourlyInput, type CragModelConfig, type HourResult } from './wetness';

/** Same shape as `buildHourlyInputsForModel` (§3.4), for one ensemble member's raw variables. */
function buildHourlyInputsForMember(crag: Crag, cell: EnsembleCellForecast, memberKey: string): CragHourlyInput[] | null {
  const vars = cell.members[memberKey];
  if (!vars || !vars.temperature_2m || !vars.dew_point_2m) return null;

  const soilMoistureDeepSeries = getSoilMoistureDeep(vars);
  const n = cell.time.length;
  const inputs: CragHourlyInput[] = new Array(n);

  for (let i = 0; i < n; i++) {
    const time = cell.time[i];
    const { elevationDeg, azimuthDeg } = solarPosition(time, crag.lat, crag.lon);
    const gtiFaceWm2 = computeGtiFace({
      dni: vars.direct_normal_irradiance?.[i] ?? 0,
      dhi: vars.diffuse_radiation?.[i] ?? 0,
      ghi: vars.shortwave_radiation?.[i] ?? 0,
      elevationDeg,
      azimuthDeg,
      aspectDeg: crag.aspectDeg,
    });

    inputs[i] = {
      time,
      precipitationMm: vars.precipitation?.[i] ?? 0,
      showersMm: vars.showers?.[i] ?? 0,
      snowDepthM: vars.snow_depth?.[i] ?? 0,
      tempC: vars.temperature_2m[i],
      dewPointC: vars.dew_point_2m[i],
      vpdKpa: vars.vapour_pressure_deficit?.[i] ?? 0,
      windSpeedMs: vars.wind_speed_10m?.[i] ?? 0,
      windDirectionDeg: vars.wind_direction_10m?.[i] ?? 0,
      cloudCoverPct: vars.cloud_cover?.[i] ?? 0,
      visibilityM: vars.visibility?.[i] ?? 20000,
      isDay: (vars.is_day?.[i] ?? 1) === 1,
      gtiFaceWm2,
      soilMoistureDeep: soilMoistureDeepSeries ? (soilMoistureDeepSeries[i] ?? null) : null,
    };
  }

  return inputs;
}

export interface EnsembleDayResult {
  memberCount: number;
  climbableCount: number;
  fraction: number;
}

/**
 * Run the full wetness simulation once per ensemble member (§3.3) and report the
 * fraction of members in which the crag is climbable at any point in the given
 * hour range — a real probability, not a hedge (§4.10). Reuses the same
 * `runSimulation` the deterministic multi-model path uses; only the inputs
 * differ (per-member weather instead of per-model).
 */
export function runEnsembleForCrag(
  crag: Crag,
  config: CragModelConfig,
  cell: EnsembleCellForecast,
  hourRange: [number, number],
): EnsembleDayResult {
  const memberKeys = Object.keys(cell.members).sort();
  const [startIdx, endIdxInclusive] = hourRange;

  let climbableCount = 0;
  let memberCount = 0;

  for (const key of memberKeys) {
    const inputs = buildHourlyInputsForMember(crag, cell, key);
    if (!inputs || inputs.length === 0) continue;
    const results: HourResult[] = runSimulation(inputs, config);
    const slice = results.slice(startIdx, Math.min(endIdxInclusive + 1, results.length));
    if (slice.length === 0) continue;
    memberCount++;
    if (slice.some((r) => r.climbable)) climbableCount++;
  }

  return { memberCount, climbableCount, fraction: memberCount > 0 ? climbableCount / memberCount : 0 };
}

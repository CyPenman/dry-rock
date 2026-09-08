import { getSoilMoistureDeep } from '../api/soilMoisture';
import type { CellForecast } from '../api/client';
import type { ModelName } from '../api/request';
import { computeGtiFace, solarPosition } from './solar';
import type { Crag } from './types';
import type { CragHourlyInput } from './wetness';

/**
 * Build the per-hour model input series for one crag from one cell's raw
 * per-model variables, computing the plane-of-array irradiance (§3.4) along the
 * way. Returns null if the model didn't resolve the core variables for this cell.
 */
export function buildHourlyInputsForModel(crag: Crag, cell: CellForecast, model: ModelName): CragHourlyInput[] | null {
  const vars = cell.models[model];
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

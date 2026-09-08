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

  // Some models resolve a shorter forecast horizon than the requested
  // `forecast_days` (§3.1) - UKMO and ICON in particular commonly run out
  // days before ECMWF/GFS do. Open-Meteo doesn't omit those trailing hours,
  // it fills them with `null`. Left unchecked, a null temperature or dew
  // point flows straight into the physics model's arithmetic (e.g. §4.2's
  // `airTemp + solarGain - nightLoss`), where JS silently coerces `null` to
  // `0` - quietly treating an unresolved hour as 0degC air temperature and
  // dragging the rock-temperature simulation toward a false "frozen" verdict
  // for every crag once the primary model's real horizon is exceeded.
  // Truncate to the model's actually-resolved prefix instead.
  let resolvedLength = cell.time.length;
  for (let i = 0; i < cell.time.length; i++) {
    if (vars.temperature_2m[i] == null || vars.dew_point_2m[i] == null) {
      resolvedLength = i;
      break;
    }
  }
  if (resolvedLength === 0) return null;

  const soilMoistureDeepSeries = getSoilMoistureDeep(vars);
  const n = resolvedLength;
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

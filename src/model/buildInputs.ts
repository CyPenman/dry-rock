import { getSoilMoistureDeep } from '../api/soilMoisture';
import type { CellForecast } from '../api/client';
import type { ModelName } from '../api/request';
import { STEEPNESS_TILT_DEG } from './rockDefaults';
import { computeGtiFace, isDaylight, solarPositionForHourlyRadiation, type SolarPosition } from './solar';
import type { Crag } from './types';
import { saturationVapourPressureKpa } from './vapour';
import type { CragHourlyInput } from './wetness';

/**
 * The sun's geometry at one crag, hour by hour. It is the same for every
 * model and every ensemble member, so it is worked out once per crag and
 * shared (§3.4) - it was being recomputed for each of the four models, the
 * largest single cost of building the inputs.
 */
export interface SunTrack {
  /** Sun position for each hour's radiation mean (`solarPositionForHourlyRadiation`). */
  radiation: SolarPosition[];
  /** Daylight at each timestamp, as Open-Meteo's `is_day` (`isDaylight`), which is no longer requested (§3.1). */
  isDay: boolean[];
}

export function sunTrack(crag: Pick<Crag, 'lat' | 'lon'>, times: number[]): SunTrack {
  return {
    radiation: times.map((t) => solarPositionForHourlyRadiation(t, crag.lat, crag.lon)),
    isDay: times.map((t) => isDaylight(t, crag.lat, crag.lon)),
  };
}

/**
 * Air vapour pressure deficit, kPa, from temperature and dew point. Only a
 * fallback for the drying term (it runs on the rock-surface deficit whenever
 * there is a dew point, evaporation.ts) and a figure in the conditions-log
 * snapshot, so it is worked out here rather than requested (§3.1).
 */
export function vpdFromDewPointKpa(tempC: number, dewPointC: number): number {
  return Math.max(0, saturationVapourPressureKpa(tempC) - saturationVapourPressureKpa(dewPointC));
}

/**
 * Build the per-hour model input series for one crag from one cell's raw
 * per-model variables, computing the plane-of-array irradiance (§3.4) along the
 * way. Returns null if the model didn't resolve the core variables for this cell.
 *
 * `sharedSoilMoisture`, when given, replaces the model's own deep soil moisture
 * hour for hour (indexed like `cell.time`) - see `buildSharedSoilMoisture` in
 * dayAggregate.ts for why every model is fed the same series (§4.5). `sun` is
 * this crag's `sunTrack` over `cell.time`, worked out here when not given.
 */
export function buildHourlyInputsForModel(
  crag: Crag,
  cell: CellForecast,
  model: ModelName,
  sharedSoilMoisture?: (number | null)[] | null,
  sun: SunTrack = sunTrack(crag, cell.time),
): CragHourlyInput[] | null {
  const vars = cell.models[model];
  if (!vars || !vars.temperature_2m || !vars.dew_point_2m) return null;

  // Some models resolve a shorter forecast horizon than the requested
  // `forecast_days` (§3.1) - UKMO and ICON in particular commonly run out
  // days before ECMWF/GFS do. Open-Meteo doesn't omit those trailing hours,
  // it fills them with `null`. Left unchecked, a null temperature or dew
  // point flows straight into the physics model's arithmetic (e.g. §4.2's
  // `airTemp + solarGain - nightLoss`), where JS silently coerces `null` to
  // `0` - quietly treating an unresolved hour as 0degC air temperature and
  // dragging the rock-temperature simulation towards a false "frozen" verdict
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
  const tiltDeg = STEEPNESS_TILT_DEG[crag.steepness];
  const n = resolvedLength;
  const inputs: CragHourlyInput[] = new Array(n);

  for (let i = 0; i < n; i++) {
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
    const dewPointC = vars.dew_point_2m[i];

    inputs[i] = {
      time: cell.time[i],
      precipitationMm: vars.precipitation?.[i] ?? 0,
      showersMm: vars.showers?.[i] ?? 0,
      snowDepthM: vars.snow_depth?.[i] ?? 0,
      tempC,
      dewPointC,
      vpdKpa: vpdFromDewPointKpa(tempC, dewPointC),
      windSpeedMs: vars.wind_speed_10m?.[i] ?? 0,
      windDirectionDeg: vars.wind_direction_10m?.[i] ?? 0,
      cloudCoverPct: vars.cloud_cover?.[i] ?? 0,
      visibilityM: vars.visibility?.[i] ?? 20000,
      isDay: sun.isDay[i],
      gtiFaceWm2,
      soilMoistureDeep: sharedSoilMoisture
        ? (sharedSoilMoisture[i] ?? null)
        : soilMoistureDeepSeries
          ? (soilMoistureDeepSeries[i] ?? null)
          : null,
      precipProbabilityPct: vars.precipitation_probability?.[i] ?? null,
    };
  }

  return inputs;
}

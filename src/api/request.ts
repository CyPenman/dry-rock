// Open-Meteo forecast request - spec §3.1.

export const HOURLY_VARS = [
  'precipitation',
  'rain',
  'showers',
  'snowfall',
  'snow_depth',
  'temperature_2m',
  'dew_point_2m',
  'relative_humidity_2m',
  'vapour_pressure_deficit',
  'wind_speed_10m',
  'wind_direction_10m',
  'cloud_cover',
  'visibility',
  'shortwave_radiation',
  'direct_normal_irradiance',
  'diffuse_radiation',
  // Soil moisture depth naming varies by model (§3.5): request both the
  // ECMWF/GFS/UKMO-family deep band and the ICON-native band that's closest to
  // it, so the adapter has something to work with regardless of which model
  // resolved. Whichever the response doesn't contain is simply absent - the
  // adapter fails soft to the §4.5 fallback per model.
  'soil_moisture_7_to_28cm',
  'soil_moisture_28_to_100cm',
  'soil_moisture_9_to_27cm',
  'soil_moisture_27_to_81cm',
  'et0_fao_evapotranspiration',
  'is_day',
] as const;

export const DAILY_VARS = ['precipitation_sum', 'sunrise', 'sunset'] as const;

// Also the index of "today" within a CragForecastResult's `days` array.
export const PAST_DAYS = 16;
export const FORECAST_DAYS = 16;

// §3.3 - deterministic multi-model default. Disagreement between these four is the
// confidence signal (§4.10); the Ensemble API is a separate, opt-in request.
export const MODELS = ['ukmo_seamless', 'ecmwf_ifs025', 'icon_seamless', 'gfs_seamless'] as const;
export type ModelName = (typeof MODELS)[number];

export interface RequestCoordinate {
  lat: number;
  lon: number;
  elevationM: number;
}

export function buildForecastUrl(cells: RequestCoordinate[]): string {
  const params = new URLSearchParams({
    latitude: cells.map((c) => c.lat).join(','),
    longitude: cells.map((c) => c.lon).join(','),
    elevation: cells.map((c) => c.elevationM).join(','),
    hourly: HOURLY_VARS.join(','),
    daily: DAILY_VARS.join(','),
    models: MODELS.join(','),
    past_days: String(PAST_DAYS), // §3.1 - 14-day seepage lookback plus reservoir spin-up
    forecast_days: String(FORECAST_DAYS),
    timezone: 'Europe/London',
    wind_speed_unit: 'ms',
    timeformat: 'unixtime',
  });
  return `https://api.open-meteo.com/v1/forecast?${params.toString()}`;
}

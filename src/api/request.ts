// Open-Meteo forecast request - spec §3.1.

/**
 * Only what the model reads. Open-Meteo bills a request over 10 variables or
 * 2 weeks as several calls, multiplied again by every model and location
 * (§3.6), so each variable here costs about 100 calls per full load. Worked
 * out in the app instead: vapour pressure deficit (from temperature and dew
 * point) and `is_day` (from the sun's position, `isDaylight`). Dropped as
 * never read: rain, snowfall, relative humidity, ET0, the shallow soil bands
 * and every daily variable.
 */
export const HOURLY_VARS = [
  'precipitation',
  'precipitation_probability',
  'showers',
  'snow_depth',
  'temperature_2m',
  'dew_point_2m',
  'wind_speed_10m',
  'wind_direction_10m',
  'cloud_cover',
  'visibility',
  'shortwave_radiation',
  'direct_normal_irradiance',
  'diffuse_radiation',
  // The deep soil band drives seepage (§4.5). Naming varies by model (§3.5):
  // ECMWF's 28-100cm band and ICON's nearest, 27-81cm. Whichever a model
  // doesn't publish comes back absent, and the adapter falls back per model.
  'soil_moisture_28_to_100cm',
  'soil_moisture_27_to_81cm',
] as const;

// Also the index of "today" within a CragForecastResult's `days` array.
export const PAST_DAYS = 16;
export const FORECAST_DAYS = 16;

// §3.3 - deterministic multi-model default. Disagreement between these four is the
// confidence signal (§4.10); the Ensemble API is a separate, opt-in request.
export const MODELS = ['ukmo_seamless', 'ecmwf_ifs025', 'icon_seamless', 'gfs_seamless'] as const;
export type ModelName = (typeof MODELS)[number];

/** Short display names for the four deterministic models (§3.3). */
export const MODEL_DISPLAY_NAME: Record<ModelName, string> = {
  ukmo_seamless: 'UKMO',
  ecmwf_ifs025: 'ECMWF',
  icon_seamless: 'ICON',
  gfs_seamless: 'GFS',
};

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
    models: MODELS.join(','),
    past_days: String(PAST_DAYS), // §3.1 - 14-day seepage lookback plus reservoir spin-up
    forecast_days: String(FORECAST_DAYS),
    timezone: 'Europe/London',
    wind_speed_unit: 'ms',
    timeformat: 'unixtime',
  });
  return `https://api.open-meteo.com/v1/forecast?${params.toString()}`;
}

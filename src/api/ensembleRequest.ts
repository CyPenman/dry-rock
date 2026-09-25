// Ensemble API request - spec §3.3, opt-in, "when the user taps for detail on a
// crag". Single coordinate: unlike the primary multi-model request, this is one
// call per crag, made on demand rather than for the whole dataset up front.

// icon_eu gives member counts in the tens over the UK/Europe - a real
// distribution, not the 3-member/5-day MOGREPS-UK tie-breaker (§3.3).
export const ENSEMBLE_MODEL = 'icon_eu';

/**
 * Only what icon_eu's members actually publish. They carry no dew point,
 * humidity, lying snow, visibility, soil moisture or rain probability (all
 * null in real responses), so those come from the headline instead
 * (`EnsembleHeadline`, ensemble.ts). If `ENSEMBLE_MODEL` changes, check what
 * the new model publishes.
 */
export const ENSEMBLE_HOURLY_VARS = [
  'precipitation',
  'showers',
  'temperature_2m',
  'wind_speed_10m',
  'wind_direction_10m',
  'cloud_cover',
  'shortwave_radiation',
  'direct_normal_irradiance',
  'diffuse_radiation',
] as const;

/**
 * icon_eu's real span: about three and a half days of history and five days
 * ahead. Asking for the headline's 16 and 16 only bought nulls, and Open-Meteo
 * bills by days requested. Members start from the headline's state
 * (`runEnsembleForCrag`), so they don't need a long history of their own.
 */
export const ENSEMBLE_PAST_DAYS = 3;
export const ENSEMBLE_FORECAST_DAYS = 5;

export interface EnsembleRequestCoordinate {
  lat: number;
  lon: number;
  elevationM: number;
}

export function buildEnsembleUrl(coord: EnsembleRequestCoordinate): string {
  const params = new URLSearchParams({
    latitude: String(coord.lat),
    longitude: String(coord.lon),
    elevation: String(coord.elevationM),
    hourly: ENSEMBLE_HOURLY_VARS.join(','),
    models: ENSEMBLE_MODEL,
    past_days: String(ENSEMBLE_PAST_DAYS),
    forecast_days: String(ENSEMBLE_FORECAST_DAYS),
    timezone: 'Europe/London',
    wind_speed_unit: 'ms',
    timeformat: 'unixtime',
  });
  return `https://ensemble-api.open-meteo.com/v1/ensemble?${params.toString()}`;
}

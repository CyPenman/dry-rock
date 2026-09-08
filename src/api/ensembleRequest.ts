// Ensemble API request — spec §3.3, opt-in, "when the user taps for detail on a
// crag". Single coordinate: unlike the primary multi-model request, this is one
// call per crag, made on demand rather than for the whole dataset up front.
import { HOURLY_VARS } from './request';

// icon_eu gives member counts in the tens over the UK/Europe — a real
// distribution, not the 3-member/5-day MOGREPS-UK tie-breaker (§3.3).
export const ENSEMBLE_MODEL = 'icon_eu';

export interface EnsembleRequestCoordinate {
  lat: number;
  lon: number;
  elevationM: number;
}

export function buildEnsembleUrl(coord: EnsembleRequestCoordinate, pastDays: number, forecastDays: number): string {
  const params = new URLSearchParams({
    latitude: String(coord.lat),
    longitude: String(coord.lon),
    elevation: String(coord.elevationM),
    hourly: HOURLY_VARS.join(','),
    models: ENSEMBLE_MODEL,
    past_days: String(pastDays),
    forecast_days: String(forecastDays),
    timezone: 'Europe/London',
    wind_speed_unit: 'ms',
    timeformat: 'unixtime',
  });
  return `https://ensemble-api.open-meteo.com/v1/ensemble?${params.toString()}`;
}

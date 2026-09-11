import type { Crag } from '../model/types';
import { isStale, readCachedForecast, writeCachedForecast } from '../storage/db';
import { fetchCellForecasts, type CellForecast } from './client';

export interface ForecastBundle {
  fetchedAt: number;
  cellForecasts: Map<string, CellForecast>;
  cragToCellKey: Map<string, string>;
}

// Floor between forced refreshes - Open-Meteo bills each unique grid cell in
// the combined request once per model (§3.1: 4 models), so a mashed refresh
// button or a flaky-signal retry loop can burn through a lot of the daily
// quota in seconds for no new data (Open-Meteo's own models don't update
// that often anyway).
const MIN_FORCE_REFRESH_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Refresh on app open if cached data is older than 2h, or on explicit refresh
 * (§3.6). If the network fetch fails - one bar in a crag car park - fall back to
 * whatever is cached, however old, flagged stale so the UI can show its age (§2).
 */
export async function getForecast(
  crags: Crag[],
  opts?: { forceRefresh?: boolean },
): Promise<{ fetchedAt: number; stale: boolean; bundle: ForecastBundle }> {
  const cached = await readCachedForecast<ForecastBundle>();
  const forceRefreshAllowed = opts?.forceRefresh && (!cached || Date.now() - cached.fetchedAt > MIN_FORCE_REFRESH_INTERVAL_MS);
  const needsRefresh = forceRefreshAllowed || !cached || isStale(cached.fetchedAt);

  if (needsRefresh) {
    try {
      const { cellForecasts, cragToCellKey } = await fetchCellForecasts(crags);
      const bundle: ForecastBundle = { fetchedAt: Date.now(), cellForecasts, cragToCellKey };
      await writeCachedForecast(bundle);
      return { fetchedAt: bundle.fetchedAt, stale: false, bundle };
    } catch (err) {
      if (cached) {
        return { fetchedAt: cached.fetchedAt, stale: true, bundle: cached.data };
      }
      throw err;
    }
  }

  return { fetchedAt: cached.fetchedAt, stale: false, bundle: cached.data };
}

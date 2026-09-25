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
 * whatever is cached, however old, with `refreshError` saying why it wasn't
 * updated so the UI can show its age and the real reason (§2).
 *
 * The cache is a convenience: if IndexedDB is unavailable (private browsing,
 * storage blocked) the forecast still loads, it just isn't kept for offline.
 */
export async function getForecast(
  crags: Crag[],
  opts?: { forceRefresh?: boolean },
): Promise<{ fetchedAt: number; bundle: ForecastBundle; refreshError: unknown }> {
  const cached = await readCachedForecast<ForecastBundle>().catch(() => null);
  const forceRefreshAllowed = opts?.forceRefresh && (!cached || Date.now() - cached.fetchedAt > MIN_FORCE_REFRESH_INTERVAL_MS);
  const needsRefresh = forceRefreshAllowed || !cached || isStale(cached.fetchedAt);

  if (needsRefresh) {
    let bundle: ForecastBundle;
    try {
      const { cellForecasts, cragToCellKey } = await fetchCellForecasts(crags);
      bundle = { fetchedAt: Date.now(), cellForecasts, cragToCellKey };
    } catch (err) {
      if (cached) return { fetchedAt: cached.fetchedAt, bundle: cached.data, refreshError: err };
      throw err;
    }
    // A failed write only costs the offline copy - the fresh data is still good.
    await writeCachedForecast(bundle).catch(() => {});
    return { fetchedAt: bundle.fetchedAt, bundle, refreshError: null };
  }

  return { fetchedAt: cached.fetchedAt, bundle: cached.data, refreshError: null };
}

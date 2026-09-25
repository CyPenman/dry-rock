import { useCallback, useEffect, useState } from 'react';
import { getForecast } from '../api/forecastService';
import { describeError } from '../api/serviceError';
import { FORECAST_DAYS, PAST_DAYS } from '../api/request';
import { computeCragForecast, type CragForecastResult } from '../model/dayAggregate';
import { computeTodayIndex } from '../model/dateRange';
import type { Crag } from '../model/types';

export interface CragWithForecast {
  crag: Crag;
  forecast: CragForecastResult | null;
}

interface ForecastState {
  loading: boolean;
  /**
   * Why the last load or refresh failed, in the user's words (`describeError`),
   * or null if it worked. With `fetchedAt` set, data is still showing and this
   * is why it couldn't be updated; with `fetchedAt` null there's no data at all.
   */
  failure: string | null;
  /** When the data showing was downloaded; null until any has loaded. */
  fetchedAt: number | null;
  results: CragWithForecast[];
  /** Today's day index in the loaded series, derived from its timestamps (not assumed to be PAST_DAYS). */
  todayIndex: number;
  /** Whole days in the headline series - the last valid day index is `dayCount - 1`. */
  dayCount: number;
}

// Only used before any data has loaded, when nothing is shown against them anyway.
const INITIAL_STATE: ForecastState = {
  loading: true,
  failure: null,
  fetchedAt: null,
  results: [],
  todayIndex: PAST_DAYS,
  dayCount: PAST_DAYS + FORECAST_DAYS,
};

export function useForecast(crags: Crag[]) {
  const [state, setState] = useState<ForecastState>(INITIAL_STATE);

  const load = useCallback(
    async (forceRefresh: boolean) => {
      setState((s) => ({ ...s, loading: true, failure: null }));
      try {
        const { fetchedAt, bundle, refreshError } = await getForecast(crags, { forceRefresh });
        // Every cell in one response starts at the same local midnight (§3.1), so
        // any cell's first hour fixes today's index for the whole bundle.
        const firstCell = bundle.cellForecasts.values().next().value;
        const todayIndex = firstCell && firstCell.time.length > 0 ? computeTodayIndex(firstCell.time[0]) : PAST_DAYS;
        const results: CragWithForecast[] = crags.map((crag) => {
          const cellKey = bundle.cragToCellKey.get(crag.id);
          const cell = cellKey ? bundle.cellForecasts.get(cellKey) : undefined;
          const forecast = cell ? computeCragForecast(crag, cell, todayIndex) : null;
          return { crag, forecast };
        });
        const first = results.find((r) => r.forecast && r.forecast.inputs.length > 0)?.forecast;
        setState({
          loading: false,
          failure: refreshError ? describeError(refreshError) : null,
          fetchedAt,
          results,
          todayIndex: first ? computeTodayIndex(first.inputs[0].time) : todayIndex,
          dayCount: first ? first.days.length : 0,
        });
      } catch (err) {
        // Anything already showing stays showing; `failure` says why it wasn't updated.
        setState((s) => ({ ...s, loading: false, failure: describeError(err) }));
      }
    },
    [crags],
  );

  useEffect(() => {
    load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { ...state, refresh: () => load(true) };
}

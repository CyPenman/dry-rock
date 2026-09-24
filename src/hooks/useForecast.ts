import { useCallback, useEffect, useState } from 'react';
import { getForecast } from '../api/forecastService';
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
  error: string | null;
  fetchedAt: number | null;
  stale: boolean;
  results: CragWithForecast[];
  /** Today's day index in the loaded series, derived from its timestamps (not assumed to be PAST_DAYS). */
  todayIndex: number;
  /** Whole days in the headline series - the last valid day index is `dayCount - 1`. */
  dayCount: number;
}

// Only used before any data has loaded, when nothing is shown against them anyway.
const INITIAL_STATE: ForecastState = {
  loading: true,
  error: null,
  fetchedAt: null,
  stale: false,
  results: [],
  todayIndex: PAST_DAYS,
  dayCount: PAST_DAYS + FORECAST_DAYS,
};

export function useForecast(crags: Crag[]) {
  const [state, setState] = useState<ForecastState>(INITIAL_STATE);

  const load = useCallback(
    async (forceRefresh: boolean) => {
      setState((s) => ({ ...s, loading: true, error: null }));
      try {
        const { fetchedAt, stale, bundle } = await getForecast(crags, { forceRefresh });
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
          error: null,
          fetchedAt,
          stale,
          results,
          todayIndex: first ? computeTodayIndex(first.inputs[0].time) : todayIndex,
          dayCount: first ? first.days.length : 0,
        });
      } catch (err) {
        setState((s) => ({ ...s, loading: false, error: err instanceof Error ? err.message : String(err) }));
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

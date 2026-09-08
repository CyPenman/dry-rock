import { useCallback, useEffect, useState } from 'react';
import { getForecast } from '../api/forecastService';
import { computeCragForecast, type CragForecastResult } from '../model/dayAggregate';
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
}

const INITIAL_STATE: ForecastState = { loading: true, error: null, fetchedAt: null, stale: false, results: [] };

export function useForecast(crags: Crag[]) {
  const [state, setState] = useState<ForecastState>(INITIAL_STATE);

  const load = useCallback(
    async (forceRefresh: boolean) => {
      setState((s) => ({ ...s, loading: true, error: null }));
      try {
        const { fetchedAt, stale, bundle } = await getForecast(crags, { forceRefresh });
        const results: CragWithForecast[] = crags.map((crag) => {
          const cellKey = bundle.cragToCellKey.get(crag.id);
          const cell = cellKey ? bundle.cellForecasts.get(cellKey) : undefined;
          const forecast = cell ? computeCragForecast(crag, cell) : null;
          return { crag, forecast };
        });
        setState({ loading: false, error: null, fetchedAt, stale, results });
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

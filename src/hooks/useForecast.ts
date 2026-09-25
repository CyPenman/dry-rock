import { useCallback, useEffect, useRef, useState } from 'react';
import { getForecast } from '../api/forecastService';
import { describeError } from '../api/serviceError';
import { FORECAST_DAYS, PAST_DAYS } from '../api/request';
import { computeCragForecast, type CragForecastResult } from '../model/dayAggregate';
import { computeTodayIndex } from '../model/dateRange';
import { localDateKeyLondon } from '../model/time';
import type { Crag } from '../model/types';
import { isStale } from '../storage/db';

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

/** How often an open, visible app checks whether midnight has passed. */
const DATE_CHECK_INTERVAL_MS = 60 * 1000;

/**
 * Least time between loads started by a resume because the data is stale. A
 * failed refresh leaves the data stale, so without this every switch back to
 * the app would try again - against a limit that may last until tomorrow.
 */
const MIN_RESUME_RETRY_MS = 5 * 60 * 1000;

const londonToday = () => localDateKeyLondon(Math.floor(Date.now() / 1000));

export function useForecast(crags: Crag[]) {
  const [state, setState] = useState<ForecastState>(INITIAL_STATE);
  // One load at a time. A Refresh tap mid-load, a resume, or React's
  // development double-mount would otherwise send a second full request -
  // hundreds of Open-Meteo calls (§3.6) for the same answer.
  const inFlight = useRef(false);
  // The London date `todayIndex` was worked out on, and when the data showing
  // was fetched - read by the resume and midnight checks below.
  const computedOn = useRef<string | null>(null);
  const fetchedAtRef = useRef<number | null>(null);
  const lastLoadAt = useRef(0);

  const load = useCallback(
    async (forceRefresh: boolean) => {
      if (inFlight.current) return;
      inFlight.current = true;
      lastLoadAt.current = Date.now();
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
        computedOn.current = londonToday();
        fetchedAtRef.current = fetchedAt;
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
      } finally {
        inFlight.current = false;
      }
    },
    [crags],
  );

  useEffect(() => {
    load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // An installed app is often resumed rather than reopened - "check it the
  // night before, look again in the car park" - and used to keep whatever it
  // had, however old, with "today" fixed at load time, so after midnight every
  // range was a day out. On resume, reload when the data is past the 2-hour
  // refresh (§3.6) or the date has changed; while open, reload at midnight.
  // `load(false)` only fetches when the data is stale, so a date change alone
  // just recomputes the saved forecast against the new today.
  useEffect(() => {
    const dateChanged = () => computedOn.current != null && computedOn.current !== londonToday();
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      const staleRetry =
        fetchedAtRef.current != null && isStale(fetchedAtRef.current) && Date.now() - lastLoadAt.current > MIN_RESUME_RETRY_MS;
      if (dateChanged() || staleRetry) load(false);
    };
    const onTick = () => {
      if (document.visibilityState === 'visible' && dateChanged()) load(false);
    };
    document.addEventListener('visibilitychange', onVisible);
    const timer = window.setInterval(onTick, DATE_CHECK_INTERVAL_MS);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.clearInterval(timer);
    };
  }, [load]);

  return { ...state, refresh: () => load(true) };
}

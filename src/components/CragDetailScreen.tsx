import { useMemo, useState } from 'react';
import { buildEnsembleUrl } from '../api/ensembleRequest';
import { fetchEnsembleForecast, type EnsembleCellForecast } from '../api/ensembleClient';
import { FORECAST_DAYS, PAST_DAYS } from '../api/request';
import type { CragWithForecast } from '../hooks/useForecast';
import { formatAgeWords, formatDayLabel } from '../lib/format';
import { clampRangeToData, resolveDateRange, type DateRangeSelection } from '../model/dateRange';
import { soilMoistureCalibrationFor, toModelConfig } from '../model/dayAggregate';
import { runEnsembleForCrag, type EnsembleDayResult } from '../model/ensemble';
import { FRICTION_BLOCK_LENGTH_HOURS } from '../model/friction';
import { pickBestDayInRange } from '../model/ranking';
import { computeSmNorm } from '../model/seepage';
import { verdictMessage } from '../model/score';
import { localDateKeyLondon } from '../model/time';
import type { Settings } from '../state/settings';
import { isStale, readCachedEnsemble, writeCachedEnsemble } from '../storage/db';
import { DayScoreChart } from './DayScoreChart';
import { Explain } from './Explain';
import { HourlyTimeline } from './HourlyTimeline';
import { ObservationLog } from './ObservationLog';
import { RockTempChart } from './RockTempChart';
import { ScoreBreakdownTable } from './ScoreBreakdownTable';
import { WaterBudgetChart } from './WaterBudgetChart';

type EnsembleState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'done'; result: EnsembleDayResult[] };

function EnsembleSection({
  onRun,
  state,
}: {
  onRun: () => void;
  state: EnsembleState;
}) {
  return (
    <div className="mt-2">
      {state.status === 'idle' && (
        <button
          type="button"
          onClick={onRun}
          className="rounded-full px-3 py-1.5 text-sm"
          style={{ background: 'var(--ground-raised)', color: 'var(--text)' }}
        >
          Run ensemble forecast
        </button>
      )}
      {state.status === 'loading' && (
        <p className="text-sm" style={{ color: 'var(--text-dim)' }}>
          Running ~40 ensemble members for this window...
        </p>
      )}
      {state.status === 'error' && (
        <p className="text-sm" style={{ color: 'var(--warning)' }}>
          Couldn't fetch the ensemble: {state.message}
        </p>
      )}
      {state.status === 'done' && (
        <div className="space-y-2">
          {state.result.map((day) => (
            <div key={day.date.getTime()}>
              <p className="text-sm" style={{ color: 'var(--text)' }}>
                {ensembleDaySentence(day)}
              </p>
              {day.memberCount > 0 && (
                <div className="mt-1 h-2 w-full max-w-xs rounded" style={{ background: 'var(--ground-raised)' }}>
                  <div
                    className="h-2 rounded"
                    style={{ width: `${Math.round((day.usableCount / day.memberCount) * 100)}%`, background: 'var(--signal)' }}
                  />
                </div>
              )}
            </div>
          ))}
          <Explain>
            <p>
              Each member runs the same wetness model against a slightly different, equally plausible weather
              sequence (icon_eu, ~40 members) - a real probability, not a hedge. A member counts when it gives at least
              3 dry daylight hours in a row, long enough for a session; "dry by" is when that window starts. Members
              only reach about 5 days ahead, so later days may have none.
            </p>
          </Explain>
        </div>
      )}
    </div>
  );
}

const ENSEMBLE_DAY_LABEL = new Intl.DateTimeFormat('en-GB', { weekday: 'short' });

/** "Sat: 34 of 40 members give a 3h+ dry window - dry by 11:00 in half of them, by 13:00 in 80%" (§3.3). */
function ensembleDaySentence(day: EnsembleDayResult): string {
  const label = ENSEMBLE_DAY_LABEL.format(day.date);
  if (day.memberCount === 0) return `${label}: beyond the ensemble's range`;
  const head = `${label}: ${day.usableCount} of ${day.memberCount} members give a ${FRICTION_BLOCK_LENGTH_HOURS}h+ dry window`;
  const hh = (h: number) => `${String(h).padStart(2, '0')}:00`;
  if (day.dryByHourP50 == null || day.dryByHourP80 == null) return head;
  // "them" = the members that give a window; the percentiles are over those.
  return `${head} - dry by ${hh(day.dryByHourP50)} in half of them, by ${hh(day.dryByHourP80)} in 80%`;
}

/** Index of the last hour that has started - "now" on the timelines. -1 before the series begins. */
function nowIndex(inputs: { time: number }[]): number {
  const nowSec = Date.now() / 1000;
  let idx = -1;
  for (let i = 0; i < inputs.length && inputs[i].time <= nowSec; i++) idx = i;
  return idx;
}

/**
 * Universal Google Maps directions link: opens the native Maps app on mobile if
 * installed, else Maps in the browser. Omitting origin (no saved home address)
 * makes Google Maps use the device's current location instead.
 */
function directionsUrl(destination: { lat: number; lon: number }, origin?: { lat: number; lon: number }): string {
  const params = new URLSearchParams({ api: '1', destination: `${destination.lat},${destination.lon}` });
  if (origin) params.set('origin', `${origin.lat},${origin.lon}`);
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

export function CragDetailScreen({
  entry,
  pinned,
  onTogglePin,
  onBack,
  dateRange,
  todayIndex,
  dayCount,
  loading,
  fetchedAt,
  stale,
  onRefresh,
  homeSettings,
}: {
  entry: CragWithForecast;
  pinned: boolean;
  onTogglePin: () => void;
  onBack: () => void;
  dateRange: DateRangeSelection;
  todayIndex: number;
  dayCount: number;
  loading: boolean;
  fetchedAt: number | null;
  stale: boolean;
  onRefresh: () => void;
  homeSettings: Pick<Settings, 'homeLat' | 'homeLon'>;
}) {
  const { crag, forecast } = entry;

  // Clamped to the days the saved forecast covers (§2); if none are covered the
  // range collapses to the last covered day and `outOfData` says so on screen.
  const [requestedStart, requestedEnd] = useMemo(() => resolveDateRange(dateRange, todayIndex), [dateRange, todayIndex]);
  const covered = clampRangeToData([requestedStart, requestedEnd], dayCount);
  const outOfData = covered.range == null;
  const [rangeStart, rangeEnd] = covered.range ?? [Math.max(0, dayCount - 1), Math.max(0, dayCount - 1)];

  // The headline card and the pre-expanded table row show the best day *within
  // the user-selected range*, not always "today" - fixes a bug where the
  // headline ignored the range picker entirely (§6: "the best day").
  const daysInRange = useMemo(() => {
    if (!forecast) return [];
    return forecast.days.slice(rangeStart, Math.min(rangeEnd + 1, forecast.days.length));
  }, [forecast, rangeStart, rangeEnd]);
  const bestDay = useMemo(() => pickBestDayInRange(forecast?.days ?? [], rangeStart, rangeEnd), [forecast, rangeStart, rangeEnd]);
  const bestDayIndexInRange = bestDay ? daysInRange.findIndex((d) => d.dayIndex === bestDay.dayIndex) : null;

  const [ensembleState, setEnsembleState] = useState<EnsembleState>({ status: 'idle' });

  async function runEnsemble() {
    setEnsembleState({ status: 'loading' });
    try {
      const cached = await readCachedEnsemble<EnsembleCellForecast>(crag.id);
      let cell: EnsembleCellForecast;
      if (cached && !isStale(cached.fetchedAt)) {
        cell = cached.data;
      } else {
        const url = buildEnsembleUrl({ lat: crag.lat, lon: crag.lon, elevationM: crag.elevationM }, PAST_DAYS, FORECAST_DAYS);
        cell = await fetchEnsembleForecast(url);
        await writeCachedEnsemble(crag.id, cell);
      }
      const config = toModelConfig(crag, forecast?.soilMoistureSource);
      // Matched by calendar date, not index: the ensemble is fetched fresh
      // today, while the headline may be yesterday's cache, so the two series
      // need not start on the same day.
      const headline = forecast?.inputs ?? [];
      const dateKeys = daysInRange
        .map((d) => headline[d.dayStartIdx])
        .filter((i): i is NonNullable<typeof i> => i != null)
        .map((i) => localDateKeyLondon(i.time));
      // Same seepage driver as the headline (§4.5), matched by timestamp.
      const sharedSoilMoistureByTime = new Map<number, number | null>(
        (forecast?.inputs ?? []).map((i) => [i.time, i.soilMoistureDeep]),
      );
      // icon_eu members publish no humidity; they borrow the headline's dew point (ensemble.ts).
      const sharedDewPointByTime = new Map<number, number>(headline.map((i) => [i.time, i.dewPointC]));
      const result = runEnsembleForCrag(crag, config, cell, dateKeys, sharedSoilMoistureByTime, sharedDewPointByTime);
      setEnsembleState({ status: 'done', result });
    } catch (err) {
      setEnsembleState({ status: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }

  const smPercentileText = useMemo(() => {
    if (!forecast) return null;
    const today = forecast.days[todayIndex];
    const todayInput = today ? forecast.inputs[today.dayStartIdx] : undefined;
    if (!todayInput || todayInput.soilMoistureDeep == null) return null;
    // Only against this crag's own climatology (§3.5) - against the default
    // placeholder range the number would mean nothing, so say nothing.
    const calibration = soilMoistureCalibrationFor(crag.id, forecast.soilMoistureSource);
    if (!calibration) return null;
    // A position between p5 and p95, not a percentile - worded accordingly.
    const norm = computeSmNorm(todayInput.soilMoistureDeep, calibration);
    return `about ${Math.round(norm * 100)}% of the way from this spot's usual dry-season low to its wet-season high`;
  }, [forecast, todayIndex, crag.id]);

  // Show the timeline over the same date range selected on the home screen,
  // rather than the full ~32 day spin-up + forecast series, so it stays
  // readable and relevant to what's actually being planned around.
  const timelineSlice = useMemo(() => {
    if (!forecast) return null;
    // Day boundaries from the day results, not `dayIndex * 24`: a day at a
    // clock change is 23 or 25 hours (§3.1).
    const first = forecast.days[rangeStart];
    const last = forecast.days[Math.min(rangeEnd, forecast.days.length - 1)];
    if (!first || !last) return null;
    const startHour = first.dayStartIdx;
    const endHour = Math.min(forecast.hourly.length, last.dayEndIdx + 1);
    return {
      results: forecast.hourly.slice(startHour, endHour),
      inputs: forecast.inputs.slice(startHour, endHour),
      nowIdx: nowIndex(forecast.inputs) - startHour,
    };
  }, [forecast, rangeStart, rangeEnd]);

  return (
    <div className="mx-auto max-w-screen-sm pb-8">
      <header className="sticky top-0 z-10 flex items-center gap-2 px-2 py-2" style={{ background: 'var(--ground)' }}>
        <button
          type="button"
          onClick={onBack}
          className="flex h-11 items-center gap-1 rounded px-3 text-base font-medium"
          style={{ color: 'var(--signal)' }}
        >
          <span aria-hidden="true">&larr;</span> Back
        </button>
        <h1 className="flex-1 truncate text-xl font-medium">{crag.name}</h1>
        <button
          type="button"
          onClick={onTogglePin}
          aria-label={pinned ? 'Unpin' : 'Pin'}
          className="flex h-11 w-11 items-center justify-center text-lg"
          style={{ color: pinned ? 'var(--signal)' : 'var(--text-dim)' }}
        >
          {pinned ? '★' : '☆'}
        </button>
      </header>

      <div className="px-4 text-sm" style={{ color: 'var(--text-dim)' }}>
        {crag.area} &middot; {crag.rock} &middot; {crag.steepness}
      </div>
      <div className="px-4 text-xs" style={{ color: 'var(--text-dim)' }}>
        {fetchedAt ? formatAgeWords(fetchedAt) : 'loading...'}
        {stale && ", showing cached data as we couldn't reach the network"}
        {' · '}
        <button type="button" onClick={onRefresh} style={{ color: 'var(--signal)' }}>
          {loading ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      {!forecast && (
        <p className="px-4 py-6 text-sm" style={{ color: 'var(--warning)' }}>
          No forecast data for this crag yet.
        </p>
      )}

      {forecast && outOfData && (
        <p className="mx-4 mt-3 rounded border px-3 py-2 text-sm" style={{ borderColor: 'var(--warning)', color: 'var(--warning)' }}>
          Your saved forecast doesn't reach these dates - refresh when you have signal.
        </p>
      )}
      {forecast && !outOfData && covered.clamped && (
        <p className="mx-4 mt-3 text-sm" style={{ color: 'var(--text-dim)' }}>
          Showing the days the saved forecast covers.
        </p>
      )}

      {forecast && !outOfData && (
        <>
          {bestDay && (
            <div className="mx-4 mt-3 rounded border p-3" style={{ borderColor: 'var(--border)' }}>
              <h2 className="pb-2 text-xs uppercase tracking-wide" style={{ color: 'var(--text-dim)' }}>
                Score breakdown &mdash; best day in range
              </h2>
              <div className="flex items-baseline justify-between">
                <span className="font-medium">{formatDayLabel(bestDay.date)}</span>
                <span className="font-mono text-lg">
                  {bestDay.verdict === 'scored' ? Math.round(bestDay.displayScore * 100) : 'n/a'}
                </span>
              </div>
              {bestDay.verdict !== 'scored' && (
                <p className="mt-1 text-sm" style={{ color: 'var(--warning)' }}>
                  {verdictMessage(bestDay.verdict)}
                </p>
              )}
              <p className="mt-2 text-sm" style={{ color: 'var(--text-dim)' }}>
                Every day in the selected range, with the full breakdown, is below &mdash; tap a row to expand it.
              </p>
              <div className="mt-3">
                <ScoreBreakdownTable days={daysInRange} bestDayIndex={bestDayIndexInRange} />
              </div>
              <EnsembleSection onRun={runEnsemble} state={ensembleState} />
            </div>
          )}

          <ObservationLog crag={crag} forecast={forecast} />

          <div className="px-4 pt-4">
            <h2 className="pb-1 text-xs uppercase tracking-wide" style={{ color: 'var(--text-dim)' }}>
              Hourly conditions
            </h2>
            {timelineSlice && (
              <HourlyTimeline results={timelineSlice.results} inputs={timelineSlice.inputs} nowIdx={timelineSlice.nowIdx} />
            )}
          </div>

          <div className="mx-4 mt-4 rounded border p-3" style={{ borderColor: 'var(--border)' }}>
            <h2 className="pb-2 text-xs uppercase tracking-wide" style={{ color: 'var(--text-dim)' }}>
              Water in
            </h2>
            <WaterBudgetChart hourly={forecast.hourly} days={forecast.days} todayIndex={todayIndex} rangeStart={rangeStart} rangeEnd={rangeEnd} />
          </div>

          {smPercentileText && (
            <p className="mx-4 mt-3 text-sm" style={{ color: 'var(--text-dim)' }}>
              Deep soil moisture: {smPercentileText}.
            </p>
          )}

          <div className="mt-5 px-4">
            <h2 className="pb-1 text-xs uppercase tracking-wide" style={{ color: 'var(--text-dim)' }}>
              Score by day
            </h2>
            <DayScoreChart
              headlineDays={forecast.days}
              modelByDay={forecast.modelByDay}
              perModelDays={forecast.perModelDays}
              availableModels={forecast.availableModels}
              startIdx={rangeStart}
              endIdx={rangeEnd}
            />
          </div>

          <div className="mt-5 px-4">
            <h2 className="pb-1 text-xs uppercase tracking-wide" style={{ color: 'var(--text-dim)' }}>
              Rock temperature
            </h2>
            {timelineSlice && (
              <RockTempChart
                results={timelineSlice.results}
                inputs={timelineSlice.inputs}
                idealTempC={crag.idealTempC}
                nowIdx={timelineSlice.nowIdx}
              />
            )}
          </div>
        </>
      )}

      <div className="mx-4 mt-5 space-y-2 text-sm">
        <p style={{ color: 'var(--text)' }}>{crag.notes}</p>
        {crag.accessNote && <p style={{ color: 'var(--warning)' }}>Access: {crag.accessNote}</p>}
      </div>

      {crag.ukcUrl && (
        <div className="mx-4 mt-5 border-t pt-4" style={{ borderColor: 'var(--border)' }}>
          <a
            href={crag.ukcUrl}
            target="_blank"
            rel="noreferrer"
            className="flex h-11 items-center text-sm font-medium"
            style={{ color: 'var(--signal)' }}
          >
            View {crag.name} on UKClimbing &rarr;
          </a>
        </div>
      )}

      <div className="mx-4 mt-2 space-y-1 border-t pt-4" style={{ borderColor: 'var(--border)' }}>
        {homeSettings.homeLat != null && homeSettings.homeLon != null ? (
          <a
            href={directionsUrl({ lat: crag.lat, lon: crag.lon }, { lat: homeSettings.homeLat, lon: homeSettings.homeLon })}
            target="_blank"
            rel="noreferrer"
            className="flex h-11 items-center text-sm font-medium"
            style={{ color: 'var(--signal)' }}
          >
            Directions from home &rarr;
          </a>
        ) : (
          <p className="py-2 text-sm" style={{ color: 'var(--text-dim)' }}>
            Set a home address to get directions to {crag.name}.
          </p>
        )}

        {crag.parkingLat != null && crag.parkingLon != null ? (
          <a
            href={directionsUrl(
              { lat: crag.parkingLat, lon: crag.parkingLon },
              homeSettings.homeLat != null && homeSettings.homeLon != null
                ? { lat: homeSettings.homeLat, lon: homeSettings.homeLon }
                : undefined,
            )}
            target="_blank"
            rel="noreferrer"
            className="flex h-11 items-center text-sm font-medium"
            style={{ color: 'var(--signal)' }}
          >
            Directions to crag parking &rarr;
          </a>
        ) : (
          <p className="py-2 text-sm" style={{ color: 'var(--text-dim)' }}>
            Parking location unclear{crag.parkingNote ? `: ${crag.parkingNote}` : ' - not yet confirmed for this crag.'}
          </p>
        )}
      </div>
    </div>
  );
}

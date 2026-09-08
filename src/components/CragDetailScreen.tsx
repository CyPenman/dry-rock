import { useMemo, useState } from 'react';
import { buildEnsembleUrl } from '../api/ensembleRequest';
import { fetchEnsembleForecast } from '../api/ensembleClient';
import { FORECAST_DAYS, PAST_DAYS } from '../api/request';
import type { CragWithForecast } from '../hooks/useForecast';
import { formatDayLabel } from '../lib/format';
import { resolveDateRange, type DateRangeSelection } from '../model/dateRange';
import { toModelConfig } from '../model/dayAggregate';
import { runEnsembleForCrag, type EnsembleDayResult } from '../model/ensemble';
import { pickBestDayInRange } from '../model/ranking';
import { computeSmNorm, DEFAULT_SM_CALIBRATION } from '../model/seepage';
import { verdictMessage } from '../model/score';
import { DayScoreChart } from './DayScoreChart';
import { Explain } from './Explain';
import { HourlyTimeline } from './HourlyTimeline';
import { RockTempChart } from './RockTempChart';
import { ScoreBreakdownTable } from './ScoreBreakdownTable';
import { WaterBudgetChart } from './WaterBudgetChart';

type EnsembleState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'done'; result: EnsembleDayResult };

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
        <div>
          <p className="text-sm" style={{ color: 'var(--text)' }}>
            {state.result.climbableCount} of {state.result.memberCount} ensemble members agree
          </p>
          <div className="mt-1 h-2 w-full max-w-xs rounded" style={{ background: 'var(--ground-raised)' }}>
            <div
              className="h-2 rounded"
              style={{ width: `${Math.round(state.result.fraction * 100)}%`, background: 'var(--signal)' }}
            />
          </div>
          <Explain>
            <p>
              Each member is a full run of the same wetness model against a slightly different, equally plausible
              weather sequence (icon_eu, ~40 members). This is a real probability across that spread, not a hedge —
              wider agreement between members means the outcome is less sensitive to exactly how the weather plays
              out.
            </p>
          </Explain>
        </div>
      )}
    </div>
  );
}

export function CragDetailScreen({
  entry,
  pinned,
  onTogglePin,
  onBack,
  dateRange,
  todayIndex,
}: {
  entry: CragWithForecast;
  pinned: boolean;
  onTogglePin: () => void;
  onBack: () => void;
  dateRange: DateRangeSelection;
  todayIndex: number;
}) {
  const { crag, forecast } = entry;

  const [rangeStart, rangeEnd] = useMemo(() => resolveDateRange(dateRange, todayIndex), [dateRange, todayIndex]);

  // The headline card and the pre-expanded table row show the best day *within
  // the user-selected range*, not always "today" — fixes a bug where the
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
      const url = buildEnsembleUrl({ lat: crag.lat, lon: crag.lon, elevationM: crag.elevationM }, PAST_DAYS, FORECAST_DAYS);
      const cell = await fetchEnsembleForecast(url);
      const config = toModelConfig(crag);
      const hourRange: [number, number] = [rangeStart * 24, (rangeEnd + 1) * 24 - 1];
      const result = runEnsembleForCrag(crag, config, cell, hourRange);
      setEnsembleState({ status: 'done', result });
    } catch (err) {
      setEnsembleState({ status: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }

  const smPercentileText = useMemo(() => {
    if (!forecast) return null;
    const todayInput = forecast.inputs[todayIndex * 24];
    if (!todayInput || todayInput.soilMoistureDeep == null) return null;
    const norm = computeSmNorm(todayInput.soilMoistureDeep, DEFAULT_SM_CALIBRATION);
    return `wetter than ${Math.round(norm * 100)}% of the reference range`;
  }, [forecast, todayIndex]);

  // Show the timeline over the same date range selected on the home screen,
  // rather than the full ~32 day spin-up + forecast series, so it stays
  // readable and relevant to what's actually being planned around.
  const timelineSlice = useMemo(() => {
    if (!forecast) return null;
    const startHour = Math.max(0, rangeStart * 24);
    const endHour = Math.min(forecast.hourly.length, (rangeEnd + 1) * 24);
    return {
      results: forecast.hourly.slice(startHour, endHour),
      inputs: forecast.inputs.slice(startHour, endHour),
      nowIdx: todayIndex * 24 - startHour,
    };
  }, [forecast, rangeStart, rangeEnd, todayIndex]);

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

      {!forecast && (
        <p className="px-4 py-6 text-sm" style={{ color: 'var(--warning)' }}>
          No forecast data for this crag yet.
        </p>
      )}

      {forecast && (
        <>
          {bestDay && (
            <div className="mx-4 mt-3 rounded border p-3" style={{ borderColor: 'var(--border)' }}>
              <h2 className="pb-2 text-xs uppercase tracking-wide" style={{ color: 'var(--text-dim)' }}>
                Score breakdown &mdash; best day in range
              </h2>
              <div className="flex items-baseline justify-between">
                <span className="font-medium">{formatDayLabel(bestDay.date)}</span>
                <span className="font-mono text-lg">{bestDay.verdict === 'scored' ? Math.round(bestDay.score * 100) : 'n/a'}</span>
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
            <WaterBudgetChart hourly={forecast.hourly} endIdx={todayIndex * 24} />
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
    </div>
  );
}

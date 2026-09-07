import { useMemo } from 'react';
import type { CragWithForecast } from '../hooks/useForecast';
import { formatDayLabel, LIMITING_FACTOR_LABEL } from '../lib/format';
import { resolveDateRange, type DateRangeSelection } from '../model/dateRange';
import { computeSmNorm, DEFAULT_SM_CALIBRATION } from '../model/seepage';
import { confidenceSentence, verdictMessage } from '../model/score';
import { DayScoreChart } from './DayScoreChart';
import { Explain } from './Explain';
import { HourlyTimeline } from './HourlyTimeline';

function ScoreBar({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="w-20 shrink-0" style={{ color: 'var(--text-dim)' }}>
        {label}
      </span>
      <div className="h-2 flex-1 rounded" style={{ background: 'var(--ground-raised)' }}>
        <div className="h-2 rounded" style={{ width: `${Math.round(value * 100)}%`, background: 'var(--signal)' }} />
      </div>
      <span className="w-8 text-right font-mono">{Math.round(value * 100)}</span>
    </div>
  );
}

function WaterBudgetRow({ label, mm, colour }: { label: string; mm: number; colour: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="flex items-center gap-1.5" style={{ color: 'var(--text-dim)' }}>
        <span className="inline-block h-2 w-2 rounded-full" style={{ background: colour }} />
        {label}
      </span>
      <span className="font-mono">{mm.toFixed(2)}mm</span>
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

  const todayDay = forecast?.days.find((d) => d.dayIndex === todayIndex) ?? null;
  const [rangeStart, rangeEnd] = useMemo(() => resolveDateRange(dateRange, todayIndex), [dateRange, todayIndex]);

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

  const waterBudget = useMemo(() => {
    if (!forecast) return null;
    const dayStart = todayIndex * 24;
    if (dayStart < 24) return null;
    const window = forecast.hourly.slice(dayStart - 24, dayStart);
    if (window.length === 0) return null;
    return window.reduce(
      (acc, r) => ({
        rain: acc.rain + r.fluxes.rain,
        seepage: acc.seepage + r.fluxes.seepage,
        condensation: acc.condensation + r.fluxes.condensation,
        melt: acc.melt + r.fluxes.melt,
      }),
      { rain: 0, seepage: 0, condensation: 0, melt: 0 },
    );
  }, [forecast, todayIndex]);

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
          {todayDay && (
            <div className="mx-4 mt-3 rounded border p-3" style={{ borderColor: 'var(--border)' }}>
              <h2 className="pb-2 text-xs uppercase tracking-wide" style={{ color: 'var(--text-dim)' }}>
                Score breakdown
              </h2>
              <div className="flex items-baseline justify-between">
                <span className="font-medium">{formatDayLabel(todayDay.date)}</span>
                <span className="font-mono text-lg">{todayDay.verdict === 'scored' ? Math.round(todayDay.score * 100) : 'n/a'}</span>
              </div>
              {todayDay.verdict !== 'scored' ? (
                <p className="mt-1 text-sm" style={{ color: 'var(--warning)' }}>
                  {verdictMessage(todayDay.verdict)}
                </p>
              ) : (
                <>
                  <p className="mt-1 text-sm" style={{ color: 'var(--text-dim)' }}>
                    {LIMITING_FACTOR_LABEL[todayDay.limitingFactor] || 'no limiting factor'} &middot;{' '}
                    {confidenceSentence(todayDay.confidence)}
                  </p>
                  <div className="mt-2 space-y-1">
                    <ScoreBar label="Window" value={todayDay.windowScoreValue} />
                    <ScoreBar label="Dryness" value={todayDay.rockDrynessScore} />
                    <ScoreBar label="Friction" value={todayDay.bestFrictionBlockScore} />
                  </div>
                  <Explain>
                    <p>
                      Window: is there a long enough unbroken dry spell covering today. Dryness: fraction of today's
                      daylight hours the rock reads as climbable. Friction: how good the best 3-hour block feels
                      underfoot.
                    </p>
                  </Explain>
                </>
              )}
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

          {waterBudget && (
            <div className="mx-4 mt-4 rounded border p-3" style={{ borderColor: 'var(--border)' }}>
              <h2 className="pb-2 text-xs uppercase tracking-wide" style={{ color: 'var(--text-dim)' }}>
                Water in the last 24 hours
              </h2>
              <div className="space-y-1">
                <WaterBudgetRow label="Rain reaching the face" mm={waterBudget.rain} colour="var(--wet)" />
                <WaterBudgetRow label="Seepage" mm={waterBudget.seepage} colour="var(--warning)" />
                <WaterBudgetRow label="Condensation" mm={waterBudget.condensation} colour="var(--dry)" />
                <WaterBudgetRow label="Snowmelt" mm={waterBudget.melt} colour="var(--signal)" />
              </div>
              <Explain>
                <p>
                  What's actually put water into the rock yesterday, in millimetres. This is what usually explains a
                  surprising result better than the forecast alone.
                </p>
              </Explain>
            </div>
          )}

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

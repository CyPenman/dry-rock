import { useMemo } from 'react';
import { PAST_DAYS } from '../api/request';
import type { CragWithForecast } from '../hooks/useForecast';
import { formatDayLabel, LIMITING_FACTOR_LABEL } from '../lib/format';
import { computeSmNorm, DEFAULT_SM_CALIBRATION } from '../model/seepage';
import { confidenceSentence, verdictMessage } from '../model/score';
import { HourlyTimeline } from './HourlyTimeline';

function ScoreBar({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center gap-2 text-xs">
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

export function CragDetailScreen({
  entry,
  pinned,
  onTogglePin,
  onBack,
}: {
  entry: CragWithForecast;
  pinned: boolean;
  onTogglePin: () => void;
  onBack: () => void;
}) {
  const { crag, forecast } = entry;

  const todayDay = forecast?.days.find((d) => d.dayIndex === PAST_DAYS) ?? null;
  const smPercentileText = useMemo(() => {
    if (!forecast) return null;
    const todayInput = forecast.inputs[PAST_DAYS * 24];
    if (!todayInput || todayInput.soilMoistureDeep == null) return null;
    const norm = computeSmNorm(todayInput.soilMoistureDeep, DEFAULT_SM_CALIBRATION);
    return `wetter than ${Math.round(norm * 100)}% of the reference range`;
  }, [forecast]);

  return (
    <div className="mx-auto max-w-screen-sm pb-8">
      <header className="sticky top-0 z-10 flex items-center gap-2 px-4 py-3" style={{ background: 'var(--ground)' }}>
        <button type="button" onClick={onBack} style={{ color: 'var(--signal)' }}>
          ← Back
        </button>
        <h1 className="flex-1 truncate text-lg font-medium">{crag.name}</h1>
        <button type="button" onClick={onTogglePin} aria-label={pinned ? 'Unpin' : 'Pin'} style={{ color: pinned ? 'var(--signal)' : 'var(--text-dim)' }}>
          {pinned ? '★' : '☆'}
        </button>
      </header>

      <div className="px-4 text-sm" style={{ color: 'var(--text-dim)' }}>
        {crag.area} · {crag.rock} · {crag.steepness}
      </div>

      {!forecast && (
        <p className="px-4 py-6 text-sm" style={{ color: 'var(--warning)' }}>
          No forecast data for this crag yet.
        </p>
      )}

      {forecast && (
        <>
          <div className="px-4 pt-3">
            <HourlyTimeline results={forecast.hourly} inputs={forecast.inputs} nowIdx={PAST_DAYS * 24} />
          </div>

          {todayDay && (
            <div className="mx-4 mt-3 rounded border p-3" style={{ borderColor: 'var(--border)' }}>
              <div className="flex items-baseline justify-between">
                <span className="font-medium">{formatDayLabel(todayDay.date)}</span>
                <span className="font-mono text-lg">{todayDay.verdict === 'scored' ? Math.round(todayDay.score * 100) : '—'}</span>
              </div>
              {todayDay.verdict !== 'scored' ? (
                <p className="mt-1 text-sm" style={{ color: 'var(--warning)' }}>
                  {verdictMessage(todayDay.verdict)}
                </p>
              ) : (
                <>
                  <p className="mt-1 text-sm" style={{ color: 'var(--text-dim)' }}>
                    {LIMITING_FACTOR_LABEL[todayDay.limitingFactor] || 'no limiting factor'} ·{' '}
                    {confidenceSentence(todayDay.confidence)}
                  </p>
                  <div className="mt-2 space-y-1">
                    <ScoreBar label="Window" value={todayDay.windowScoreValue} />
                    <ScoreBar label="Dryness" value={todayDay.rockDrynessScore} />
                    <ScoreBar label="Friction" value={todayDay.bestFrictionBlockScore} />
                  </div>
                </>
              )}
            </div>
          )}

          {smPercentileText && (
            <p className="mx-4 mt-3 text-xs" style={{ color: 'var(--text-dim)' }}>
              Deep soil moisture: {smPercentileText}.
            </p>
          )}
        </>
      )}

      <div className="mx-4 mt-4 space-y-2 text-sm">
        <p style={{ color: 'var(--text)' }}>{crag.notes}</p>
        {crag.accessNote && (
          <p style={{ color: 'var(--warning)' }}>Access: {crag.accessNote}</p>
        )}
      </div>
    </div>
  );
}

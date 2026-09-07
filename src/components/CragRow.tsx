import { formatDayLabel, formatDistanceKm, LIMITING_FACTOR_LABEL } from '../lib/format';
import type { RankedCragDay } from '../model/ranking';
import { confidenceSentence, verdictMessage } from '../model/score';

const DAY_LETTER = new Intl.DateTimeFormat('en-GB', { weekday: 'narrow' });

function formatHourOfDay(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`;
}

function scoreColour(score: number): string {
  if (score >= 70) return 'var(--signal)';
  if (score >= 40) return 'var(--dry)';
  return 'var(--text-dim)';
}

/** Small day-by-day score strip, so the whole selected range is visible at a glance, not just the best day. */
function DayStrip({ ranked }: { ranked: RankedCragDay }) {
  if (ranked.daysInRange.length < 2) return null;

  return (
    <div className="mt-1.5 flex gap-1 overflow-x-auto">
      {ranked.daysInRange.map((d) => {
        const isBest = d.dayIndex === ranked.day.dayIndex;
        const isGated = d.verdict !== 'scored';
        return (
          <div
            key={d.dayIndex}
            className="flex w-9 shrink-0 flex-col items-center rounded py-1 text-xs"
            style={{
              background: isBest ? 'var(--ground-raised)' : 'transparent',
              border: isBest ? '1px solid var(--signal)' : '1px solid transparent',
            }}
          >
            <span style={{ color: 'var(--text-dim)' }}>{DAY_LETTER.format(d.date)}</span>
            <span className="font-mono" style={{ color: isGated ? 'var(--text-dim)' : scoreColour(d.score * 100) }}>
              {isGated ? '–' : Math.round(d.score * 100)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function CragRow({
  ranked,
  pinned,
  onSelect,
  onTogglePin,
}: {
  ranked: RankedCragDay;
  pinned: boolean;
  onSelect: () => void;
  onTogglePin: () => void;
}) {
  const { crag, day, distanceKm } = ranked;
  const isGated = day.verdict !== 'scored';

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => e.key === 'Enter' && onSelect()}
      className="flex items-center gap-3 border-b px-3 py-3 active:opacity-70"
      style={{ borderColor: 'var(--border)' }}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onTogglePin();
        }}
        aria-label={pinned ? 'Unpin' : 'Pin'}
        className="flex h-11 w-11 shrink-0 items-center justify-center text-lg leading-none"
        style={{ color: pinned ? 'var(--signal)' : 'var(--text-dim)' }}
      >
        {pinned ? '★' : '☆'}
      </button>

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate text-base font-medium">{crag.name}</span>
          <span className="shrink-0 text-sm" style={{ color: 'var(--text-dim)' }}>
            {crag.area}
          </span>
        </div>

        {isGated ? (
          <div className="mt-0.5 text-sm" style={{ color: 'var(--warning)' }}>
            {formatDayLabel(day.date)} &middot; {verdictMessage(day.verdict)}
          </div>
        ) : (
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-sm" style={{ color: 'var(--text-dim)' }}>
            <span style={{ color: 'var(--text)' }}>{formatDayLabel(day.date)}</span>
            <span>&middot;</span>
            <span>
              {day.climbableDaylightHours >= day.totalDaylightHours && day.totalDaylightHours > 0
                ? 'dry all day'
                : day.dryFromHourOfDay != null
                  ? `dry from ${formatHourOfDay(day.dryFromHourOfDay)}`
                  : 'not dry'}
            </span>
            {day.limitingFactor !== 'none' && (
              <>
                <span>&middot;</span>
                <span>{LIMITING_FACTOR_LABEL[day.limitingFactor]}</span>
              </>
            )}
            {distanceKm != null && (
              <>
                <span>&middot;</span>
                <span>{formatDistanceKm(distanceKm)}</span>
              </>
            )}
            <span>&middot;</span>
            <span>{confidenceSentence(day.confidence)}</span>
          </div>
        )}

        <DayStrip ranked={ranked} />
      </div>

      {!isGated && (
        <div className="shrink-0 text-right font-mono text-base font-medium" style={{ color: 'var(--text)' }}>
          {Math.round(day.score * 100)}
        </div>
      )}
    </div>
  );
}

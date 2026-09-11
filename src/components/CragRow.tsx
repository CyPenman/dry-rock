import { formatDayLabel, formatDistanceMiles, LIMITING_FACTOR_LABEL } from '../lib/format';
import type { RankedCragDay } from '../model/ranking';
import { confidenceSentence, verdictMessage } from '../model/score';

const DAY_LETTER = new Intl.DateTimeFormat('en-GB', { weekday: 'short' });

function formatHourOfDay(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`;
}

/**
 * Day-by-day score strip - score cells (design study "Crag Charts", option
 * 2m). The number is legible at a glance, the best day in range is filled
 * solid, and a gated (ruled-out) day reads as a cross rather than an empty
 * bar, so the whole selected range is visible without counting cells.
 */
function DayStrip({ ranked }: { ranked: RankedCragDay }) {
  if (ranked.daysInRange.length < 2) return null;

  return (
    <div className="mt-1.5 grid gap-[3px]" style={{ gridTemplateColumns: `repeat(${ranked.daysInRange.length},minmax(0,1fr))` }}>
      {ranked.daysInRange.map((d) => {
        const isBest = d.dayIndex === ranked.day.dayIndex;
        const isGated = d.verdict !== 'scored';
        return (
          <div
            key={d.dayIndex}
            className="text-center"
            style={{
              background: isBest ? 'var(--signal)' : 'var(--ground-raised)',
              padding: '5px 2px 4px',
              border: `1px solid ${isBest ? 'var(--signal)' : 'var(--border)'}`,
            }}
          >
            <div
              style={{
                font: '600 9px/1 ui-monospace,Menlo,monospace',
                letterSpacing: '0.03em',
                color: isBest ? 'var(--ground)' : 'var(--text-dim)',
              }}
            >
              {DAY_LETTER.format(d.date)}
            </div>
            <div
              style={{
                font: `600 ${isGated ? '13px' : '15px'}/1.1 ui-monospace,Menlo,monospace`,
                color: isGated ? 'var(--warning)' : isBest ? 'var(--ground)' : 'var(--text)',
                marginTop: 3,
              }}
            >
              {isGated ? '×' : Math.round(d.displayScore * 100)}
            </div>
            <div style={{ height: 3, background: isBest ? 'rgba(0,0,0,0.25)' : 'var(--ground-sunken)', marginTop: 4 }}>
              <div
                style={{
                  height: 3,
                  width: `${(isGated ? 0 : d.displayScore) * 100}%`,
                  background: isBest ? 'var(--ground)' : 'var(--signal)',
                }}
              />
            </div>
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
                <span>{formatDistanceMiles(distanceKm)}</span>
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
          {Math.round(day.displayScore * 100)}
        </div>
      )}
    </div>
  );
}

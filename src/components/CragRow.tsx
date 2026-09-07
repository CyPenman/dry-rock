import { confidenceSentence, verdictMessage } from '../model/score';
import type { RankedCragDay } from '../model/ranking';
import { formatDayLabel, formatDistanceKm, LIMITING_FACTOR_LABEL } from '../lib/format';

function formatHourOfDay(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`;
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
        className="shrink-0 text-lg leading-none"
        style={{ color: pinned ? 'var(--signal)' : 'var(--text-dim)' }}
      >
        {pinned ? '★' : '☆'}
      </button>

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate font-medium">{crag.name}</span>
          <span className="shrink-0 text-xs" style={{ color: 'var(--text-dim)' }}>
            {crag.area}
          </span>
        </div>

        {isGated ? (
          <div className="mt-0.5 text-sm" style={{ color: 'var(--warning)' }}>
            {formatDayLabel(day.date)} · {verdictMessage(day.verdict)}
          </div>
        ) : (
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-sm" style={{ color: 'var(--text-dim)' }}>
            <span style={{ color: 'var(--text)' }}>{formatDayLabel(day.date)}</span>
            <span>·</span>
            <span>
              {day.climbableDaylightHours >= day.totalDaylightHours && day.totalDaylightHours > 0
                ? 'dry all day'
                : day.dryFromHourOfDay != null
                  ? `dry from ${formatHourOfDay(day.dryFromHourOfDay)}`
                  : 'not dry today'}
            </span>
            {day.limitingFactor !== 'none' && (
              <>
                <span>·</span>
                <span>{LIMITING_FACTOR_LABEL[day.limitingFactor]}</span>
              </>
            )}
            {distanceKm != null && (
              <>
                <span>·</span>
                <span>{formatDistanceKm(distanceKm)}</span>
              </>
            )}
            <span>·</span>
            <span>{confidenceSentence(day.confidence)}</span>
          </div>
        )}
      </div>

      {!isGated && (
        <div className="shrink-0 text-right font-mono text-sm" style={{ color: 'var(--text)' }}>
          {Math.round(day.score * 100)}
        </div>
      )}
    </div>
  );
}

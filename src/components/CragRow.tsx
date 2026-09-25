import { dayReason, formatDayLabel, formatDistanceMiles, formatDriveTime, formatDryTiming } from '../lib/format';
import { estimateDriveMinutes } from '../model/distance';
import type { RankedCragDay } from '../model/ranking';
import { confidenceSentence, verdictMessage } from '../model/score';
import { SCORE_BAND_COLOR_VAR, scoreBand } from '../model/scoreBand';

const DAY_LETTER = new Intl.DateTimeFormat('en-GB', { weekday: 'short' });

/**
 * Columns for a day-cell strip. Past a week the cells get too narrow to read on
 * a phone, so longer ranges wrap onto two even rows (12 days as 6 + 6, 9 as
 * 5 + 4) - shared by the crag rows here and the Areas tab's area cards.
 */
export function dayStripColumns(dayCount: number): number {
  return dayCount > 7 ? Math.ceil(dayCount / 2) : dayCount;
}

/**
 * Day-by-day score strip - score cells (design study "Crag Charts", option
 * 2m), laid out like the Areas tab's area cells: day and score on top, with
 * only that half taking the best day's green fill, and a dark footer under it
 * holding a score line - as long as the score, coloured by its good/fair/poor
 * band. A gated (ruled-out) day reads as a cross over an empty line, so the
 * whole selected range is visible without counting cells.
 * `compact` (the Areas tab's crag rows, §6 Areas) drops the footer and
 * tightens the cells - the number carries it at that size.
 */
export function DayStrip({ ranked, compact = false }: { ranked: RankedCragDay; compact?: boolean }) {
  if (ranked.daysInRange.length < 2) return null;

  return (
    <div
      className={`${compact ? 'mt-1' : 'mt-2'} grid gap-[3px]`}
      style={{ gridTemplateColumns: `repeat(${dayStripColumns(ranked.daysInRange.length)},minmax(0,1fr))` }}
    >
      {ranked.daysInRange.map((d) => {
        const isBest = d.dayIndex === ranked.day.dayIndex;
        const isGated = d.verdict !== 'scored';
        const scorePct = Math.round(d.displayScore * 100);
        return (
          <div key={d.dayIndex} className="text-center" style={{ border: `1px solid ${isBest ? 'var(--signal)' : 'var(--border)'}` }}>
            <div style={{ background: isBest ? 'var(--signal)' : 'var(--ground-raised)', padding: compact ? '3px 2px' : '5px 2px 4px' }}>
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
                  font: `600 ${compact ? '12px' : isGated ? '13px' : '15px'}/1.1 ui-monospace,Menlo,monospace`,
                  color: isGated ? 'var(--warning)' : isBest ? 'var(--ground)' : 'var(--text)',
                  marginTop: compact ? 2 : 3,
                }}
              >
                {isGated ? '×' : scorePct}
              </div>
            </div>
            {!compact && (
              <div style={{ background: 'var(--ground-sunken)', padding: 3 }}>
                <div style={{ height: 6, background: 'var(--ground-raised)' }}>
                  {!isGated && (
                    <div style={{ height: 6, width: `${scorePct}%`, background: SCORE_BAND_COLOR_VAR[scoreBand(scorePct)] }} />
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * One crag on the Crags tab, laid out like an area card on the Areas tab: name
 * and best score on one line, then the conditions for the best day (when, how
 * dry, what limits it), then a quieter line with the drive and how far the
 * models agree, and the day strip across the full width under it.
 */
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
  const reason = dayReason(day);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => e.key === 'Enter' && onSelect()}
      className="border-b px-3 py-3 active:opacity-70"
      style={{ borderColor: 'var(--border)' }}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center">
          {/* Full 44px tap target, pulled into the row's padding so the star sits inline before the name. */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onTogglePin();
            }}
            aria-label={pinned ? 'Unpin' : 'Pin'}
            className="-my-3 -ml-3 flex h-11 w-11 shrink-0 items-center justify-center text-lg leading-none"
            style={{ color: pinned ? 'var(--signal)' : 'var(--text-dim)' }}
          >
            {pinned ? '★' : '☆'}
          </button>
          <span className="-ml-1 min-w-0 truncate text-base font-medium">
            {crag.name}
            <span className="ml-1.5 text-xs font-normal" style={{ color: 'var(--text-dim)' }}>
              {crag.area}
            </span>
          </span>
        </div>
        {!isGated && <span className="shrink-0 font-mono text-lg font-medium">{Math.round(day.displayScore * 100)}</span>}
      </div>

      {isGated ? (
        <div className="mt-0.5 text-sm" style={{ color: 'var(--warning)' }}>
          {formatDayLabel(day.date)} &middot; {verdictMessage(day.verdict)}
        </div>
      ) : (
        <>
          <div className="mt-0.5 text-sm" style={{ color: 'var(--text-dim)' }}>
            <span style={{ color: 'var(--text)' }}>{formatDayLabel(day.date)}</span> &middot; {formatDryTiming(day)}
            {reason && <> &middot; {reason}</>}
          </div>
          <div className="mt-px text-xs" style={{ color: 'var(--text-dim)' }}>
            {distanceKm != null && (
              <>
                {formatDistanceMiles(distanceKm)}, {formatDriveTime(estimateDriveMinutes(distanceKm))} &middot;{' '}
              </>
            )}
            {confidenceSentence(day.confidence, scoreBand(day.score * 100))}
          </div>
        </>
      )}

      <DayStrip ranked={ranked} />
    </div>
  );
}

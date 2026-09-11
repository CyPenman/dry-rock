import { Fragment, useState } from 'react';
import { formatDayLabel, LIMITING_FACTOR_LABEL } from '../lib/format';
import type { CragDayResult } from '../model/dayAggregate';
import { confidenceCaveat, confidenceSentence, verdictMessage } from '../model/score';
import { Explain } from './Explain';

export function ScoreBar({ label, value }: { label: string; value: number }) {
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

function formatHourOfDay(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`;
}

function dayTimingLabel(day: CragDayResult): string {
  if (day.verdict !== 'scored') return verdictMessage(day.verdict);
  if (day.climbableDaylightHours >= day.totalDaylightHours && day.totalDaylightHours > 0) return 'dry all day';
  if (day.dryFromHourOfDay != null) return `dry from ${formatHourOfDay(day.dryFromHourOfDay)}`;
  return 'not dry';
}

/**
 * Expandable score-breakdown table for every day in the selected range - spec
 * §6 crag detail's "score breakdown", extended per review request: precise
 * per-day/per-time detail rather than only ever showing "today", with the best
 * day in the range starred and pre-expanded.
 */
export function ScoreBreakdownTable({ days, bestDayIndex }: { days: CragDayResult[]; bestDayIndex: number | null }) {
  const [openIndex, setOpenIndex] = useState<number | null>(bestDayIndex);

  if (days.length === 0) return null;

  return (
    <div>
      <div className="overflow-x-auto rounded border" style={{ borderColor: 'var(--border)' }}>
        <table className="w-full min-w-[420px] text-sm" style={{ borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ color: 'var(--text-dim)' }}>
              <th className="px-2 py-1.5 text-left text-xs font-normal uppercase tracking-wide">Day</th>
              <th className="px-2 py-1.5 text-right text-xs font-normal uppercase tracking-wide">Score</th>
              <th className="px-2 py-1.5 text-left text-xs font-normal uppercase tracking-wide">Timing</th>
              <th className="px-2 py-1.5 text-left text-xs font-normal uppercase tracking-wide">Limiting factor</th>
            </tr>
          </thead>
          <tbody>
            {days.map((day, i) => {
              const isBest = i === bestDayIndex;
              const isOpen = openIndex === i;
              const isGated = day.verdict !== 'scored';
              const caveat = isGated ? null : confidenceCaveat(day.showerDominance);
              return (
                <Fragment key={day.dayIndex}>
                  <tr
                    role="button"
                    tabIndex={0}
                    onClick={() => setOpenIndex(isOpen ? null : i)}
                    onKeyDown={(e) => e.key === 'Enter' && setOpenIndex(isOpen ? null : i)}
                    className="cursor-pointer border-t"
                    style={{ borderColor: 'var(--border)', background: isBest ? 'var(--ground-raised)' : undefined }}
                  >
                    <td className="whitespace-nowrap px-2 py-2 font-medium">
                      {isBest && (
                        <span aria-label="Best day in range" style={{ color: 'var(--signal)' }}>
                          &#9733;{' '}
                        </span>
                      )}
                      {formatDayLabel(day.date)}
                    </td>
                    <td className="whitespace-nowrap px-2 py-2 text-right font-mono">{isGated ? 'n/a' : Math.round(day.score * 100)}</td>
                    <td className="whitespace-nowrap px-2 py-2" style={{ color: isGated ? 'var(--warning)' : 'var(--text-dim)' }}>
                      {dayTimingLabel(day)}
                    </td>
                    <td className="whitespace-nowrap px-2 py-2" style={{ color: 'var(--text-dim)' }}>
                      {isGated ? '' : LIMITING_FACTOR_LABEL[day.limitingFactor] || '-'}
                    </td>
                  </tr>
                  {isOpen && (
                    <tr style={{ background: 'var(--ground-raised)' }}>
                      <td colSpan={4} className="px-3 py-3">
                        {isGated ? (
                          <p className="text-sm" style={{ color: 'var(--warning)' }}>
                            {verdictMessage(day.verdict)}
                          </p>
                        ) : (
                          <div className="space-y-2">
                            <p className="text-sm" style={{ color: 'var(--text-dim)' }}>
                              {confidenceSentence(day.confidence)}
                              {caveat ? ` - ${caveat}` : ''}
                            </p>
                            <div className="space-y-1">
                              <ScoreBar label="Dryness" value={day.rockDrynessScore} />
                              <ScoreBar label="Friction" value={day.bestFrictionBlockScore} />
                            </div>
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      <Explain>
        <p>
          <strong>Dryness</strong> is the fraction of the day's daylight hours the rock reads as climbable, blended
          with how much of that is one unbroken block rather than scattered gaps - a day you can actually plan a
          session around scores higher than the same total hours in fragments.
        </p>
        <p>
          <strong>Friction</strong> is how good the best 3-hour block feels underfoot: temperature, dew point, wind
          and sun exposure.
        </p>
        <p>Tap a row to see its full breakdown. The best day in the range is starred and expanded by default.</p>
      </Explain>
    </div>
  );
}

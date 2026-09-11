import { Fragment, useState } from 'react';
import { formatDayLabel, LIMITING_FACTOR_LABEL } from '../lib/format';
import type { CragDayResult } from '../model/dayAggregate';
import { confidenceCaveat, confidenceSentence, verdictMessage } from '../model/score';
import { windChillCaveat } from '../model/windChill';
import { Explain } from './Explain';

export function ScoreBar({
  label,
  value,
  color = 'var(--signal)',
  caption,
}: {
  label: string;
  value: number;
  color?: string;
  /** Small line under the row - e.g. the exact clock window a score describes, so it never reads as a claim about the whole day. */
  caption?: string;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 text-sm">
        <span className="w-28 shrink-0" style={{ color: 'var(--text-dim)' }}>
          {label}
        </span>
        <div className="h-2 flex-1 rounded" style={{ background: 'var(--ground-raised)' }}>
          <div className="h-2 rounded" style={{ width: `${Math.round(value * 100)}%`, background: color }} />
        </div>
        <span className="w-8 text-right font-mono">{Math.round(value * 100)}</span>
      </div>
      {caption && (
        <div className="pl-[7.5rem] text-xs" style={{ color: 'var(--text-dim)' }}>
          {caption}
        </div>
      )}
    </div>
  );
}

/**
 * Same row rhythm as `ScoreBar` (label / track / value) for a stat that isn't
 * a 0-1 score - e.g. wind chill is a temperature, not "how good", so filling
 * a percentage bar for it would invent a number that doesn't mean anything.
 * The track is left empty rather than omitted, so it still lines up under the
 * bars above it.
 */
function StatRow({ label, value, tone = 'normal' }: { label: string; value: string; tone?: 'normal' | 'warn' | 'dim' }) {
  const color = tone === 'warn' ? 'var(--warning)' : tone === 'dim' ? 'var(--text-dim)' : 'var(--text)';
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="w-28 shrink-0" style={{ color: 'var(--text-dim)' }}>
        {label}
      </span>
      <div className="h-2 flex-1" />
      <span className="text-right font-mono" style={{ color }}>
        {value}
      </span>
    </div>
  );
}

function formatHourOfDay(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`;
}

/** The friction block is always a fixed 3h window - see `bestFrictionBlock` in friction.ts. */
const FRICTION_BLOCK_LENGTH_HOURS = 3;

function frictionWindowLabel(startHour: number): string {
  const endHour = (startHour + FRICTION_BLOCK_LENGTH_HOURS) % 24;
  return `best window: ${formatHourOfDay(startHour)}–${formatHourOfDay(endHour)}, already counted dry`;
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
              const windChill = isGated ? null : windChillCaveat(day.worstDaylightWindChillC);
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
                    <td className="whitespace-nowrap px-2 py-2 text-right font-mono">
                      {isGated ? 'n/a' : Math.round(day.displayScore * 100)}
                    </td>
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
                            <div className="space-y-1">
                              <ScoreBar label="Crag dryness" value={day.rockDrynessScore} />
                              {day.frictionWindowStartHour != null ? (
                                <ScoreBar
                                  label="Rock friction"
                                  value={day.bestFrictionBlockScore}
                                  caption={frictionWindowLabel(day.frictionWindowStartHour)}
                                />
                              ) : (
                                <StatRow label="Rock friction" value="no dry window" tone="dim" />
                              )}
                              <ScoreBar label="Confidence" value={day.confidence.fraction} color="var(--chart-water)" />
                              {day.worstDaylightWindChillC != null && (
                                <StatRow
                                  label="Feels like"
                                  value={`${Math.round(day.worstDaylightWindChillC)}°C`}
                                  tone={windChill != null ? 'warn' : 'normal'}
                                />
                              )}
                            </div>
                            <p className="text-sm" style={{ color: 'var(--text-dim)' }}>
                              {confidenceSentence(day.confidence)}
                              {caveat ? ` - ${caveat}` : ''}
                            </p>
                            {windChill && (
                              <p className="text-sm" style={{ color: 'var(--warning)' }}>
                                {windChill}
                              </p>
                            )}
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
          <strong>Crag dryness</strong>: how much of the day was dry, weighted toward one unbroken block over the same
          hours scattered in gaps.
        </p>
        <p>
          <strong>Rock friction</strong>: grip quality in the driest 3-hour block, shown with its exact clock window -
          always inside hours Crag dryness already counted as dry, never a reading of its own. "No dry window" means
          there wasn't a 3-hour dry block to judge at all, which is different from a low score (dry, but slick).
        </p>
        <p>
          <strong>Confidence</strong>: how many forecast models agree the crag is climbable. Shown in blue, not green,
          because it isn't part of the score formula - it only softens the number on low-agreement days and breaks
          ranking ties. Low means "trust this less", not "conditions are worse".
        </p>
        <p>
          <strong>Feels like</strong>: coldest wind chill in daylight hours - a comfort factor for the climber, not
          the rock, so it never changes the score. Turns orange once hands would likely struggle even on dry, grippy
          rock.
        </p>
        <p>Tap a row to see its full breakdown. The best day in the range is starred and expanded by default.</p>
      </Explain>
    </div>
  );
}

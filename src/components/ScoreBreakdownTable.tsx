import { Fragment, useState, type ReactNode } from 'react';
import {
  compass16,
  formatDayLabel,
  formatDrynessCaption,
  formatDrynessShort,
  formatDryTiming,
  formatRange,
  FRICTION_REASON_LABEL,
  LIMITING_FACTOR_LABEL,
  sentenceCase,
} from '../lib/format';
import { MODEL_DISPLAY_NAME, MODELS } from '../api/request';
import type { CragDayResult } from '../model/dayAggregate';
import { FRICTION_BLOCK_LENGTH_HOURS } from '../model/friction';
import { confidenceCaveat, confidenceSentence, SESSION_HOURS, verdictMessage } from '../model/score';
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
  /** Small line (or lines) under the row - e.g. the exact clock window a score describes, so it never reads as a claim about the whole day, and the readings behind it. */
  caption?: ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 text-sm">
        <span className="w-24 shrink-0" style={{ color: 'var(--text-dim)' }}>
          {label}
        </span>
        <div className="h-2 flex-1 rounded" style={{ background: 'var(--ground-raised)' }}>
          <div className="h-2 rounded" style={{ width: `${Math.round(value * 100)}%`, background: color }} />
        </div>
        <span className="w-8 text-right font-mono">{Math.round(value * 100)}</span>
      </div>
      {caption && (
        <div className="pl-[6.5rem] text-xs" style={{ color: 'var(--text-dim)' }}>
          {caption}
        </div>
      )}
    </div>
  );
}

/**
 * Same row rhythm as `ScoreBar` (label / track / value) for a stat that isn't
 * a 0-1 score - here, a friction row with no dry window to judge. The track is
 * left empty rather than omitted, so it still lines up under the bars above it.
 */
function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="w-24 shrink-0" style={{ color: 'var(--text-dim)' }}>
        {label}
      </span>
      <div className="h-2 flex-1" />
      <span className="text-right font-mono" style={{ color: 'var(--text-dim)' }}>
        {value}
      </span>
    </div>
  );
}

/**
 * One labelled reading in the conditions grid under the bars. The weather
 * used to be three run-on sentences; as label/value pairs it can be scanned
 * without reading, and wraps cleanly at phone width.
 */
function Condition({ label, value, warn = false }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] uppercase tracking-wide" style={{ color: 'var(--text-faint)' }}>
        {label}
      </div>
      <div className="truncate text-sm" style={{ color: warn ? 'var(--warning)' : 'var(--text)' }}>
        {value}
      </div>
    </div>
  );
}

function formatHourOfDay(hour: number): string {
  return `${String(hour % 24).padStart(2, '0')}:00`;
}

function frictionWindowRange(startHour: number): string {
  return `${formatHourOfDay(startHour)}-${formatHourOfDay(startHour + FRICTION_BLOCK_LENGTH_HOURS)}`;
}

/** A window of rock just damp inside (§4.7) is scored at reduced grip. */
function frictionWindowIsDamp(dryness: number | null): boolean {
  return dryness != null && dryness < 0.99;
}

function frictionWindowLabel(startHour: number, dryness: number | null): string {
  // Say the damp case outright rather than claim the window was counted dry.
  const state = frictionWindowIsDamp(dryness) ? 'rock nearly dry inside, grip reduced' : 'already counted dry';
  return `best window: ${frictionWindowRange(startHour)}, ${state}`;
}

/** "best 16:00-19:00 · rock damp inside" - the glanceable friction caption. */
function frictionShortLabel(day: CragDayResult, startHour: number): string {
  const parts = [`best ${frictionWindowRange(startHour)}`];
  if (frictionWindowIsDamp(day.frictionWindowDryness)) parts.push('rock damp inside');
  if (day.frictionReason) parts.push(FRICTION_REASON_LABEL[day.frictionReason]);
  return parts.join(' · ');
}

/** "1 of 4 models agree · scores 40-92", or "only GFS" - the glanceable confidence caption. */
function confidenceShortLabel(day: CragDayResult): string {
  const only = day.confidence.total <= 1 && day.modelScores[0] ? MODEL_DISPLAY_NAME[day.modelScores[0].model] : null;
  const parts = [only ? `only ${only} reaches this day` : `${day.confidence.agreeCount} of ${day.confidence.total} models agree`];
  if (day.modelScores.length > 1)
    parts.push(`scores ${Math.round(day.modelScoreRange.min * 100)}-${Math.round(day.modelScoreRange.max * 100)}`);
  if (confidenceCaveat(day.showerDominance)) parts.push('showery');
  return parts.join(' · ');
}

/**
 * The two temperatures behind a friction score, and what the gap between them
 * means. Rock temperature alone cannot explain the score: a COLDER day scoring
 * worse than a warmer one is almost always this gap closing, and the
 * condensation-onset term it drives is the largest single penalty in §4.8 (0.4,
 * against 0.3 for muggy air and 0.15 for coastal salt). Reported in words as
 * well as numbers - "17.7 and 14.3" only means something to a reader who
 * already knows the model.
 */
function dewPointSpreadLabel(rockTempC: number, dewPointC: number): string {
  const spread = rockTempC - dewPointC;
  const gap = `${spread.toFixed(1)}°C apart`;
  const note =
    spread <= 0
      ? 'rock is at the dew point - condensing'
      : spread < 2
        ? `only ${gap} - on the edge of condensing`
        : spread < 4
          ? `${gap} - close to the dew point, greasy`
          : `${gap} - well clear of the dew point`;
  return `rock ${rockTempC.toFixed(1)}°C · dew point ${dewPointC.toFixed(1)}°C · ${note}`;
}

function dayTimingLabel(day: CragDayResult): string {
  if (day.verdict !== 'scored') return verdictMessage(day.verdict);
  return formatDryTiming(day);
}

/**
 * Expandable score-breakdown table for every day in the selected range - spec
 * §6 crag detail's "score breakdown", extended per review request: precise
 * per-day/per-time detail rather than only ever showing "today", with the best
 * day in the range starred and pre-expanded.
 */
export function ScoreBreakdownTable({ days, bestDayIndex }: { days: CragDayResult[]; bestDayIndex: number | null }) {
  const [openIndex, setOpenIndex] = useState<number | null>(bestDayIndex);
  // Shared across days: someone who wants the numbers for one day wants them for the next.
  const [showNumbers, setShowNumbers] = useState(false);

  if (days.length === 0) return null;

  return (
    <div>
      <div className="overflow-x-auto rounded border" style={{ borderColor: 'var(--border)' }}>
        {/* Fixed layout: with auto layout the expanded row's captions fed into the
            column widths, so the day row shifted sideways whenever they changed. */}
        <table className="w-full table-fixed text-sm" style={{ borderCollapse: 'collapse' }}>
          <colgroup>
            <col style={{ width: '30%' }} />
            <col style={{ width: '14%' }} />
            <col style={{ width: '28%' }} />
            <col style={{ width: '28%' }} />
          </colgroup>
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
                    <td className="px-2 py-2" style={{ color: isGated ? 'var(--warning)' : 'var(--text-dim)' }}>
                      {dayTimingLabel(day)}
                    </td>
                    <td className="px-2 py-2" style={{ color: 'var(--text-dim)' }}>
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
                          <div className="space-y-3">
                            <div className="space-y-2">
                              <ScoreBar
                                label="Crag dryness"
                                value={day.rockDrynessScore}
                                caption={showNumbers ? formatDrynessCaption(day) : formatDrynessShort(day)}
                              />
                              {day.frictionWindowStartHour != null ? (
                                <ScoreBar
                                  label="Rock friction"
                                  value={day.bestFrictionBlockScore}
                                  caption={
                                    showNumbers ? (
                                      <>
                                        <div>{frictionWindowLabel(day.frictionWindowStartHour, day.frictionWindowDryness)}</div>
                                        {day.frictionWindowRockTempC != null && day.frictionWindowDewPointC != null && (
                                          <div>{dewPointSpreadLabel(day.frictionWindowRockTempC, day.frictionWindowDewPointC)}</div>
                                        )}
                                      </>
                                    ) : (
                                      frictionShortLabel(day, day.frictionWindowStartHour)
                                    )
                                  }
                                />
                              ) : (
                                <StatRow label="Rock friction" value="no dry window" />
                              )}
                              <ScoreBar
                                label="Confidence"
                                // Agreeing models out of all four, not out of those with data: a day
                                // only GFS reaches is one model's word, not full agreement (§4.10).
                                value={day.confidence.agreeCount / MODELS.length}
                                color="var(--chart-water)"
                                caption={
                                  showNumbers
                                    ? `${confidenceSentence(day)}${caveat ? ` - ${caveat}` : ''}${
                                        day.modelScores.length > 1
                                          ? ` · models range ${Math.round(day.modelScoreRange.min * 100)}-${Math.round(day.modelScoreRange.max * 100)}`
                                          : ''
                                      }`
                                    : confidenceShortLabel(day)
                                }
                              />
                            </div>
                            {windChill && (
                              <p className="text-sm" style={{ color: 'var(--warning)' }}>
                                {sentenceCase(windChill)}
                              </p>
                            )}
                            <div
                              className="grid grid-cols-3 gap-x-3 gap-y-2 border-t pt-3 sm:grid-cols-6"
                              style={{ borderColor: 'var(--border)' }}
                            >
                              {day.daylightWeather && (
                                <Condition
                                  label="Air"
                                  value={`${formatRange(day.daylightWeather.airTempC.min, day.daylightWeather.airTempC.max)}°C`}
                                />
                              )}
                              {day.worstDaylightWindChillC != null && (
                                <Condition
                                  label="Feels like"
                                  value={`${Math.round(day.worstDaylightWindChillC)}°C`}
                                  warn={windChill != null}
                                />
                              )}
                              {day.daylightWeather && (
                                <Condition
                                  label="Wind"
                                  value={`${formatRange(day.daylightWeather.windSpeedMs.min, day.daylightWeather.windSpeedMs.max)} m/s ${compass16(day.daylightWeather.windFromDeg)}`}
                                />
                              )}
                              {day.daylightWeather && (
                                <Condition label="Cloud" value={`${Math.round(day.daylightWeather.cloudCoverPct)}%`} />
                              )}
                              <Condition label="Rain chance" value={`${day.rainChancePct}%`} />
                              <Condition
                                label="Sun on face"
                                value={
                                  day.sunOnFaceHours
                                    ? `${formatHourOfDay(day.sunOnFaceHours.start)}-${formatHourOfDay(day.sunOnFaceHours.end)}`
                                    : 'None'
                                }
                              />
                            </div>
                          </div>
                        )}
                        <div className="mt-3 flex items-center justify-between text-xs" style={{ color: 'var(--text-faint)' }}>
                          {isGated ? (
                            <span />
                          ) : (
                            <button
                              type="button"
                              aria-expanded={showNumbers}
                              onClick={() => setShowNumbers((v) => !v)}
                              className="underline-offset-2 hover:underline"
                              style={{ color: 'var(--text-dim)' }}
                            >
                              {showNumbers ? 'Hide the numbers ▴' : 'Show the numbers ▾'}
                            </button>
                          )}
                          <span>Forecast: {MODEL_DISPLAY_NAME[day.sourceModel]}</span>
                        </div>
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
          <strong>Crag dryness</strong>: how many dry daylight hours there are, weighted towards one unbroken block over
          the same hours scattered in gaps - which is why the line underneath mentions the longest run when the dry hours
          are scattered. It is judged against a {SESSION_HOURS}-hour session (or the whole of a shorter winter day), so a
          day with a full session of dry rock scores full marks however long the daylight. Equal scores can mean one
          clean window or the same hours in scraps. Rock that is dry on the surface but still slightly damp inside counts
          for part of an hour, fading to nothing as it gets wetter, rather than all or nothing. The rain figure is the highest hourly
          chance of rain in daylight, not an average over the day.
        </p>
        <p>
          <strong>Rock friction</strong>: grip quality in the driest 3-hour block, shown with its exact clock window -
          always inside hours Crag dryness already counted as dry, never a reading of its own. "No dry window" means
          there wasn't a 3-hour dry block to judge at all, which is different from a low score (dry, but slick).
        </p>
        <p>
          The <strong>rock and dew point temperatures</strong> under it are what that score was judged on. The gap
          between them matters more than either number: rock within about 2&deg;C of the dew point is on the edge of
          sweating and grips badly however dry it measures, which is how a colder day can score worse than a warmer
          one. Wider than about 4&deg;C and condensation isn't a factor at all.
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
        <p>
          Tap a row to see its breakdown, and <strong>Show the numbers</strong> for the exact hours, temperatures and
          model spread behind each bar. The best day in the range is starred and expanded by default.
        </p>
      </Explain>
    </div>
  );
}

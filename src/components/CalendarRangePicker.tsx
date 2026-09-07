import { useState } from 'react';
import { dateToDayIndex, dayIndexToDate } from '../model/dateRange';

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTH_LABEL = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' });
const DAY_LABEL = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}
function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
function isBefore(a: Date, b: Date): boolean {
  return localMidnightTime(a) < localMidnightTime(b);
}
function localMidnightTime(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function buildWeeks(viewMonth: Date): (Date | null)[][] {
  const first = startOfMonth(viewMonth);
  const startOffset = (first.getDay() + 6) % 7; // Monday-first
  const daysInMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 0).getDate();

  const cells: (Date | null)[] = [];
  for (let i = 0; i < startOffset; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(viewMonth.getFullYear(), viewMonth.getMonth(), d));
  while (cells.length % 7 !== 0) cells.push(null);

  const weeks: (Date | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/**
 * A standard month-grid calendar for picking a date range, bounded to the
 * forecast window. Tap a day to start a range, tap a later day to complete
 * it; tapping before the current start begins a new range.
 */
export function CalendarRangePicker({
  todayIndex,
  maxDayIndex,
  initialStartIdx,
  initialEndIdx,
  onApply,
  onCancel,
}: {
  todayIndex: number;
  maxDayIndex: number;
  initialStartIdx: number;
  initialEndIdx: number;
  onApply: (startIdx: number, endIdx: number) => void;
  onCancel: () => void;
}) {
  const minDate = dayIndexToDate(todayIndex, todayIndex);
  const maxDate = dayIndexToDate(maxDayIndex, todayIndex);

  const [viewMonth, setViewMonth] = useState(() => startOfMonth(dayIndexToDate(initialStartIdx, todayIndex)));
  const [start, setStart] = useState<Date>(() => dayIndexToDate(initialStartIdx, todayIndex));
  const [end, setEnd] = useState<Date | null>(() => dayIndexToDate(initialEndIdx, todayIndex));

  const weeks = buildWeeks(viewMonth);
  const canGoPrev = startOfMonth(addMonths(viewMonth, -1)) >= startOfMonth(minDate);
  const canGoNext = startOfMonth(addMonths(viewMonth, 1)) <= startOfMonth(maxDate);

  function pick(date: Date) {
    if (isBefore(date, minDate) || isBefore(maxDate, date)) return;
    if (end !== null || isBefore(date, start)) {
      setStart(date);
      setEnd(null);
    } else {
      setEnd(date);
    }
  }

  function isInRange(date: Date): boolean {
    if (!end) return sameDay(date, start);
    return date >= start && date <= end;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center" onClick={onCancel}>
      <div
        className="w-full max-w-screen-sm rounded-t-2xl border p-4 sm:rounded-2xl"
        style={{ background: 'var(--ground)', borderColor: 'var(--border)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => canGoPrev && setViewMonth((m) => addMonths(m, -1))}
            disabled={!canGoPrev}
            aria-label="Previous month"
            className="flex h-11 w-11 items-center justify-center rounded text-lg disabled:opacity-30"
            style={{ color: 'var(--text)' }}
          >
            ‹
          </button>
          <span className="text-base font-medium">{MONTH_LABEL.format(viewMonth)}</span>
          <button
            type="button"
            onClick={() => canGoNext && setViewMonth((m) => addMonths(m, 1))}
            disabled={!canGoNext}
            aria-label="Next month"
            className="flex h-11 w-11 items-center justify-center rounded text-lg disabled:opacity-30"
            style={{ color: 'var(--text)' }}
          >
            ›
          </button>
        </div>

        <div className="mt-2 grid grid-cols-7 gap-1 text-center text-xs" style={{ color: 'var(--text-dim)' }}>
          {WEEKDAY_LABELS.map((w) => (
            <div key={w} className="py-1">
              {w}
            </div>
          ))}
        </div>

        {weeks.map((week, wi) => (
          <div key={wi} className="grid grid-cols-7 gap-1">
            {week.map((date, di) => {
              if (!date) return <div key={di} className="aspect-square" />;
              const outOfBounds = isBefore(date, minDate) || isBefore(maxDate, date);
              const selected = isInRange(date);
              const isEndpoint = sameDay(date, start) || (end && sameDay(date, end));
              return (
                <button
                  key={di}
                  type="button"
                  disabled={outOfBounds}
                  onClick={() => pick(date)}
                  className="aspect-square rounded text-sm disabled:opacity-20"
                  style={{
                    background: isEndpoint ? 'var(--signal)' : selected ? 'var(--ground-raised)' : 'transparent',
                    color: isEndpoint ? 'var(--ground)' : 'var(--text)',
                    fontWeight: isEndpoint ? 600 : 400,
                  }}
                >
                  {date.getDate()}
                </button>
              );
            })}
          </div>
        ))}

        <p className="mt-3 text-center text-sm" style={{ color: 'var(--text-dim)' }}>
          {end ? `${DAY_LABEL.format(start)} to ${DAY_LABEL.format(end)}` : `${DAY_LABEL.format(start)}: tap an end date`}
        </p>

        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="h-11 flex-1 rounded border text-sm"
            style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!end}
            onClick={() => end && onApply(dateToDayIndex(start, todayIndex), dateToDayIndex(end, todayIndex))}
            className="h-11 flex-1 rounded text-sm font-medium disabled:opacity-40"
            style={{ background: 'var(--signal)', color: 'var(--ground)' }}
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}

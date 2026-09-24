/**
 * A custom range is stored as local calendar dates (ISO `YYYY-MM-DD`), not day
 * indices, so a picked range stays on the same dates across midnight and across
 * refreshes - an index means a different date as soon as "today" moves (§6).
 */
export type DateRangeSelection = { kind: 'weekend' } | { kind: 'custom'; startDate: string; endDate: string };

export const DEFAULT_DATE_RANGE: DateRangeSelection = { kind: 'weekend' };

/** "This weekend" - the coming Saturday and Sunday (today counts if it's
 * already one of them). If today is Sunday, Saturday has already passed -
 * there's nothing left to look forward to but today. */
export function computeWeekendRange(todayIndex: number, now: Date = new Date()): [number, number] {
  const dow = now.getDay(); // 0 = Sunday .. 6 = Saturday
  if (dow === 0) return [todayIndex, todayIndex];
  const daysUntilSaturday = (6 - dow) % 7;
  const satIdx = todayIndex + daysUntilSaturday;
  return [satIdx, satIdx + 1];
}

/** [startDayIndex, endDayIndexInclusive] into a CragForecastResult's `days` array. */
export function resolveDateRange(selection: DateRangeSelection, todayIndex: number, now: Date = new Date()): [number, number] {
  if (selection.kind === 'custom') {
    return [
      dateToDayIndex(parseLocalIsoDate(selection.startDate), todayIndex, now),
      dateToDayIndex(parseLocalIsoDate(selection.endDate), todayIndex, now),
    ];
  }
  return computeWeekendRange(todayIndex, now);
}

/**
 * A resolved range against the days the saved forecast actually covers (§2:
 * disable scoring rather than extrapolate). `range` is null when none of the
 * requested days are covered; `clamped` says some were cut off.
 */
export function clampRangeToData(
  [start, end]: [number, number],
  dayCount: number,
): { range: [number, number] | null; clamped: boolean } {
  const lo = Math.max(0, start);
  const hi = Math.min(dayCount - 1, end);
  if (lo > hi) return { range: null, clamped: true };
  return { range: [lo, hi], clamped: lo !== start || hi !== end };
}

function localMidnight(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/**
 * Today's day index within a series whose first hour is `firstTimestampSec` -
 * the number of local calendar days from that hour's date to today's. Derived
 * from the data rather than assumed to be `PAST_DAYS`, which is only true on
 * the day the data was fetched: yesterday's cache (the car park with one bar of
 * signal, §2) would otherwise shift every date range by a day. Rounding absorbs
 * the 23- and 25-hour days at a clock change.
 */
export function computeTodayIndex(firstTimestampSec: number, now: Date = new Date()): number {
  const diffMs = localMidnight(now).getTime() - localMidnight(new Date(firstTimestampSec * 1000)).getTime();
  return Math.round(diffMs / 86400000);
}

/** Local calendar date as ISO `YYYY-MM-DD`. */
export function toLocalIsoDate(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/** Inverse of `toLocalIsoDate` - local midnight of that date. */
export function parseLocalIsoDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Calendar date for a day index, given today's own index into the same series. */
export function dayIndexToDate(dayIndex: number, todayIndex: number, now: Date = new Date()): Date {
  const base = localMidnight(now);
  base.setDate(base.getDate() + (dayIndex - todayIndex));
  return base;
}

/** Inverse of dayIndexToDate - the day index a calendar date falls on. */
export function dateToDayIndex(date: Date, todayIndex: number, now: Date = new Date()): number {
  const base = localMidnight(now);
  const target = localMidnight(date);
  const diffDays = Math.round((target.getTime() - base.getTime()) / 86400000);
  return todayIndex + diffDays;
}

/**
 * Does a seasonal restriction (months 1-12 inclusive, wrapping over the new
 * year when `fromMonth` > `toMonth`) apply on any day from `start` to `end`?
 * Checked month by month, so a range spanning several months overlaps if any
 * of them is inside the restriction.
 */
export function seasonalRestrictionOverlaps(
  restriction: { fromMonth: number; toMonth: number },
  start: Date,
  end: Date,
): boolean {
  const inForce = (month: number) =>
    restriction.fromMonth <= restriction.toMonth
      ? month >= restriction.fromMonth && month <= restriction.toMonth
      : month >= restriction.fromMonth || month <= restriction.toMonth;
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  const last = new Date(end.getFullYear(), end.getMonth(), 1);
  // At most 12 steps can matter - after that every month has been seen.
  for (let i = 0; i < 12 && cursor <= last; i++) {
    if (inForce(cursor.getMonth() + 1)) return true;
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return false;
}

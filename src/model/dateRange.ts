export type DateRangeSelection = { kind: 'weekend' } | { kind: 'custom'; startIdx: number; endIdx: number };

export const DEFAULT_DATE_RANGE: DateRangeSelection = { kind: 'weekend' };

/** "This weekend" — the coming Saturday and Sunday (today counts if it's
 * already one of them). If today is Sunday, Saturday has already passed —
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
  if (selection.kind === 'custom') return [selection.startIdx, selection.endIdx];
  return computeWeekendRange(todayIndex, now);
}

function localMidnight(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Calendar date for a day index, given today's own index into the same series. */
export function dayIndexToDate(dayIndex: number, todayIndex: number, now: Date = new Date()): Date {
  const base = localMidnight(now);
  base.setDate(base.getDate() + (dayIndex - todayIndex));
  return base;
}

/** Inverse of dayIndexToDate — the day index a calendar date falls on. */
export function dateToDayIndex(date: Date, todayIndex: number, now: Date = new Date()): number {
  const base = localMidnight(now);
  const target = localMidnight(date);
  const diffDays = Math.round((target.getTime() - base.getTime()) / 86400000);
  return todayIndex + diffDays;
}

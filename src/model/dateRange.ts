export type RangePreset = 'weekend' | '7day' | '14day';

export const RANGE_PRESET_LABELS: Record<RangePreset, string> = {
  weekend: 'This weekend',
  '7day': 'Next 7 days',
  '14day': 'Next 14 days',
};

/** [startDayIndex, endDayIndexInclusive] into a CragForecastResult's `days` array. */
export function computeRangeDayIndices(preset: RangePreset, todayIndex: number, now: Date = new Date()): [number, number] {
  if (preset === '7day') return [todayIndex, todayIndex + 6];
  if (preset === '14day') return [todayIndex, todayIndex + 13];

  // "This weekend" — the coming Saturday and Sunday (today counts if it's
  // already one of them). If today is Sunday, Saturday has already passed —
  // there's nothing left to look forward to but today.
  const dow = now.getDay(); // 0 = Sunday .. 6 = Saturday
  if (dow === 0) return [todayIndex, todayIndex];
  const daysUntilSaturday = (6 - dow) % 7;
  const satIdx = todayIndex + daysUntilSaturday;
  return [satIdx, satIdx + 1];
}

/**
 * Columns for a day-cell strip. Past a week the cells get too narrow to read on
 * a phone, so longer ranges wrap onto two even rows (12 days as 6 + 6, 9 as
 * 5 + 4) - shared by the crag rows and the Areas tab's area cards (§6).
 */
export function dayStripColumns(dayCount: number): number {
  return dayCount > 7 ? Math.ceil(dayCount / 2) : dayCount;
}

import { useMemo, useState } from 'react';
import { formatDayLabel } from '../lib/format';
import { dayIndexToDate, resolveDateRange, toLocalIsoDate, type DateRangeSelection } from '../model/dateRange';
import { CalendarRangePicker } from './CalendarRangePicker';

/**
 * "This weekend" / "Choose dates" (spec §6 Home, item 2). Shared by the Crags and
 * Areas tabs, both driving the one `dateRange` held in App, so a range picked on
 * either tab is the range the other tab, the map and the crag page all show.
 */
export function DateRangeControls({
  dateRange,
  onChangeDateRange,
  todayIndex,
  dayCount,
}: {
  dateRange: DateRangeSelection;
  onChangeDateRange: (range: DateRangeSelection) => void;
  todayIndex: number;
  dayCount: number;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const maxDayIndex = dayCount - 1;
  const [startIdx, endIdx] = useMemo(() => resolveDateRange(dateRange, todayIndex), [dateRange, todayIndex]);

  const rangeLabel =
    dateRange.kind === 'weekend'
      ? 'This weekend'
      : startIdx === endIdx
        ? formatDayLabel(dayIndexToDate(startIdx, todayIndex))
        : `${formatDayLabel(dayIndexToDate(startIdx, todayIndex))} to ${formatDayLabel(dayIndexToDate(endIdx, todayIndex))}`;

  return (
    <>
      <div className="mt-3 flex gap-1.5">
        <button
          type="button"
          onClick={() => onChangeDateRange({ kind: 'weekend' })}
          className="rounded-full px-3 py-1.5 text-sm"
          style={{
            background: dateRange.kind === 'weekend' ? 'var(--signal)' : 'var(--ground-raised)',
            color: dateRange.kind === 'weekend' ? 'var(--ground)' : 'var(--text)',
          }}
        >
          This weekend
        </button>
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          className="rounded-full px-3 py-1.5 text-sm"
          style={{
            background: dateRange.kind === 'custom' ? 'var(--signal)' : 'var(--ground-raised)',
            color: dateRange.kind === 'custom' ? 'var(--ground)' : 'var(--text)',
          }}
        >
          {dateRange.kind === 'custom' ? rangeLabel : 'Choose dates'}
        </button>
      </div>

      {pickerOpen && (
        <CalendarRangePicker
          todayIndex={todayIndex}
          maxDayIndex={maxDayIndex}
          initialStartIdx={Math.min(Math.max(startIdx, todayIndex), maxDayIndex)}
          initialEndIdx={Math.min(Math.max(endIdx, todayIndex), maxDayIndex)}
          onCancel={() => setPickerOpen(false)}
          onApply={(s, e) => {
            onChangeDateRange({
              kind: 'custom',
              startDate: toLocalIsoDate(dayIndexToDate(s, todayIndex)),
              endDate: toLocalIsoDate(dayIndexToDate(e, todayIndex)),
            });
            setPickerOpen(false);
          }}
        />
      )}
    </>
  );
}

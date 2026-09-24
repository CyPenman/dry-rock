import { describe, expect, it } from 'vitest';
import {
  clampRangeToData,
  computeTodayIndex,
  computeWeekendRange,
  dateToDayIndex,
  dayIndexToDate,
  parseLocalIsoDate,
  resolveDateRange,
  toLocalIsoDate,
} from './dateRange';

describe('computeWeekendRange', () => {
  it('includes today when today is Saturday', () => {
    const saturday = new Date(2024, 5, 1); // 2024-06-01 is a Saturday
    expect(computeWeekendRange(16, saturday)).toEqual([16, 17]);
  });

  it('is just today when today is Sunday (Saturday already passed)', () => {
    const sunday = new Date(2024, 5, 2);
    expect(computeWeekendRange(16, sunday)).toEqual([16, 16]);
  });

  it('looks forward to the coming Saturday on a weekday', () => {
    const wednesday = new Date(2024, 5, 5); // Wednesday
    expect(computeWeekendRange(16, wednesday)).toEqual([19, 20]); // +3 days to Saturday
  });
});

describe('resolveDateRange', () => {
  it('resolves the weekend selection the same as computeWeekendRange', () => {
    const saturday = new Date(2024, 5, 1);
    expect(resolveDateRange({ kind: 'weekend' }, 16, saturday)).toEqual([16, 17]);
  });

  it('resolves custom ISO dates to the right indices', () => {
    const now = new Date(2024, 5, 10); // today is day 16
    expect(resolveDateRange({ kind: 'custom', startDate: '2024-06-14', endDate: '2024-06-19' }, 16, now)).toEqual([20, 25]);
  });

  it('keeps a custom range on the same dates when "today" moves on a day', () => {
    const selection = { kind: 'custom' as const, startDate: '2024-06-14', endDate: '2024-06-15' };
    // Checked a day later against the same saved series: today is now day 17, the dates are unchanged.
    expect(resolveDateRange(selection, 17, new Date(2024, 5, 11))).toEqual([20, 21]);
  });
});

describe('computeTodayIndex', () => {
  const seriesStart = new Date(2024, 4, 25).getTime() / 1000; // local midnight 16 days before 10 June

  it('is 16 for a series starting 16 days ago', () => {
    expect(computeTodayIndex(seriesStart, new Date(2024, 5, 10, 9, 30))).toBe(16);
  });

  it('is 17 for the same series checked a day later (yesterday’s cache)', () => {
    expect(computeTodayIndex(seriesStart, new Date(2024, 5, 11, 0, 5))).toBe(17);
  });
});

describe('ISO local dates', () => {
  it('round-trips a local date', () => {
    const d = new Date(2026, 9, 25);
    expect(toLocalIsoDate(d)).toBe('2026-10-25');
    expect(parseLocalIsoDate('2026-10-25').getTime()).toBe(d.getTime());
  });
});

describe('clampRangeToData', () => {
  it('passes a covered range through', () => {
    expect(clampRangeToData([18, 19], 32)).toEqual({ range: [18, 19], clamped: false });
  });

  it('clamps a range that runs past the saved forecast', () => {
    expect(clampRangeToData([30, 33], 32)).toEqual({ range: [30, 31], clamped: true });
  });

  it('has no range when the saved forecast does not reach the dates at all', () => {
    expect(clampRangeToData([33, 34], 32)).toEqual({ range: null, clamped: true });
  });
});

describe('dayIndexToDate / dateToDayIndex', () => {
  it('round-trips a day index through a calendar date', () => {
    const now = new Date(2024, 5, 10);
    const date = dayIndexToDate(20, 16, now);
    expect(date.getFullYear()).toBe(2024);
    expect(date.getMonth()).toBe(5);
    expect(date.getDate()).toBe(14); // 4 days after 10 June
    expect(dateToDayIndex(date, 16, now)).toBe(20);
  });

  it('handles indices before today (negative offset)', () => {
    const now = new Date(2024, 5, 10);
    const date = dayIndexToDate(14, 16, now); // 2 days before today
    expect(date.getDate()).toBe(8);
    expect(dateToDayIndex(date, 16, now)).toBe(14);
  });
});

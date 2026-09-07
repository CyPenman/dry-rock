import { describe, expect, it } from 'vitest';
import { computeWeekendRange, dateToDayIndex, dayIndexToDate, resolveDateRange } from './dateRange';

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

  it('passes a custom selection through unchanged', () => {
    expect(resolveDateRange({ kind: 'custom', startIdx: 20, endIdx: 25 }, 16)).toEqual([20, 25]);
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

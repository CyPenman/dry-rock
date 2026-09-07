import { describe, expect, it } from 'vitest';
import { computeRangeDayIndices } from './dateRange';

describe('computeRangeDayIndices', () => {
  it('7day and 14day are fixed-length windows starting today', () => {
    expect(computeRangeDayIndices('7day', 16)).toEqual([16, 22]);
    expect(computeRangeDayIndices('14day', 16)).toEqual([16, 29]);
  });

  it('weekend includes today when today is Saturday', () => {
    const saturday = new Date(2024, 5, 1); // 2024-06-01 is a Saturday
    expect(computeRangeDayIndices('weekend', 16, saturday)).toEqual([16, 17]);
  });

  it('weekend is just today when today is Sunday (Saturday already passed)', () => {
    const sunday = new Date(2024, 5, 2);
    expect(computeRangeDayIndices('weekend', 16, sunday)).toEqual([16, 16]);
  });

  it('weekend looks forward to the coming Saturday on a weekday', () => {
    const wednesday = new Date(2024, 5, 5); // Wednesday
    expect(computeRangeDayIndices('weekend', 16, wednesday)).toEqual([19, 20]); // +3 days to Saturday
  });
});

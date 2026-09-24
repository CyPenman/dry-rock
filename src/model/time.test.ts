import { describe, expect, it } from 'vitest';
import { dayBoundaries, hourOfDayLondon, localDateKeyLondon } from './time';

const hourly = (fromIsoUtc: string, toIsoUtc: string) => {
  const out: number[] = [];
  for (let t = Date.parse(fromIsoUtc) / 1000; t <= Date.parse(toIsoUtc) / 1000; t += 3600) out.push(t);
  return out;
};
const sec = (isoUtc: string) => Date.parse(isoUtc) / 1000;

describe('clock change, 25 October 2026 (BST to GMT)', () => {
  // 2026-10-24T23:00Z is local midnight on 25 Oct (BST); 2026-10-26T00:00Z is local midnight on 26 Oct (GMT).
  const times = hourly('2026-10-24T23:00:00Z', '2026-10-26T23:00:00Z');

  it('gives 25 October 25 hours', () => {
    const days = dayBoundaries(times);
    const oct25 = days.find((d) => localDateKeyLondon(times[d.startIdx]) === '2026-10-25')!;
    expect(oct25.endIdx - oct25.startIdx + 1).toBe(25);
  });

  it('reads 01 twice across the change - BST, then GMT', () => {
    expect(hourOfDayLondon(sec('2026-10-25T00:00:00Z'))).toBe(1); // 01:00 BST
    expect(hourOfDayLondon(sec('2026-10-25T01:00:00Z'))).toBe(1); // 01:00 GMT
    expect(hourOfDayLondon(sec('2026-10-25T02:00:00Z'))).toBe(2);
  });

  it('reads 26 October 08:00Z as 08', () => {
    expect(hourOfDayLondon(sec('2026-10-26T08:00:00Z'))).toBe(8);
  });

  it('drops a trailing partial day', () => {
    // The series ends at 26 Oct 23:00Z = 27 Oct 00:00 local: a one-hour final day.
    const days = dayBoundaries(times);
    expect(localDateKeyLondon(times[days[days.length - 1].startIdx])).toBe('2026-10-26');
    expect(days.map((d) => d.endIdx - d.startIdx + 1)).toEqual([25, 24]);
  });
});

describe('clock change, 28 March 2027 (GMT to BST)', () => {
  // Local midnight 28 Mar is 00:00Z (GMT); local midnight 29 Mar is 28 Mar 23:00Z (BST).
  const times = hourly('2027-03-28T00:00:00Z', '2027-03-29T22:00:00Z');

  it('gives 28 March 23 hours', () => {
    const days = dayBoundaries(times);
    expect(days.map((d) => d.endIdx - d.startIdx + 1)).toEqual([23, 24]);
  });

  it('skips 01 on the day the clocks go forward', () => {
    expect(hourOfDayLondon(sec('2027-03-28T00:00:00Z'))).toBe(0);
    expect(hourOfDayLondon(sec('2027-03-28T01:00:00Z'))).toBe(2);
  });
});

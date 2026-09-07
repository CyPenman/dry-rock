import { describe, expect, it } from 'vitest';
import { isHourDry, longestQualifyingWindowForDay, windowScore } from './dryWindow';

describe('isHourDry', () => {
  it('treats trace drizzle below the threshold as dry', () => {
    expect(isHourDry(0.1)).toBe(true);
    expect(isHourDry(0)).toBe(true);
  });
  it('treats anything at or above the threshold as wet', () => {
    expect(isHourDry(0.2)).toBe(false);
    expect(isHourDry(2)).toBe(false);
  });
});

describe('longestQualifyingWindowForDay', () => {
  // Hand-built 72h array: hours 0-23 wet, 24-71 dry (a clean 48h dry window
  // covering day 2 (24-47) and half of day 3 (48-71)).
  const qualifies = [...Array(24).fill(false), ...Array(48).fill(true)];

  it('finds the run covering a day fully inside it', () => {
    // Day 2 = hours 24-47
    expect(longestQualifyingWindowForDay(qualifies, 24, 47)).toBe(48);
  });

  it('finds the run for a day only partially covered by it', () => {
    // Day 1 = hours 0-23: only overlaps the dry run at its very last instant (none, run starts at 24)
    expect(longestQualifyingWindowForDay(qualifies, 0, 23)).toBe(0);
  });

  it('returns 0 when no qualifying hour overlaps the day', () => {
    const allWet = Array(24).fill(false);
    expect(longestQualifyingWindowForDay(allWet, 0, 23)).toBe(0);
  });

  it('picks the longer of two runs that both touch the day', () => {
    // wet(0-9) dry(10-15) wet(16-17) dry(18-40) — day is hours 12-35
    const arr = [
      ...Array(10).fill(false),
      ...Array(6).fill(true), // 10-15 (6h)
      ...Array(2).fill(false), // 16-17
      ...Array(23).fill(true), // 18-40 (23h)
    ];
    expect(longestQualifyingWindowForDay(arr, 12, 35)).toBe(23);
  });
});

describe('windowScore (§4.9)', () => {
  it('is zero below minWindowHours', () => {
    expect(windowScore(40, 48)).toBe(0);
    expect(windowScore(47.9, 48)).toBe(0);
  });

  it('hits the fixed anchors exactly', () => {
    expect(windowScore(48, 48)).toBeCloseTo(0.6);
    expect(windowScore(72, 48)).toBeCloseTo(0.85);
    expect(windowScore(96, 48)).toBeCloseTo(1.0);
  });

  it('is 1.0 for anything at or beyond 96h', () => {
    expect(windowScore(200, 48)).toBe(1.0);
  });

  it('interpolates between anchors', () => {
    const mid = windowScore(60, 48); // halfway between 48 and 72
    expect(mid).toBeGreaterThan(0.6);
    expect(mid).toBeLessThan(0.85);
  });

  it('re-bases the ramp when minWindowHours is raised past an anchor', () => {
    // minWindowHours 80 sits between the 72 and 96 anchors — 72 should be dropped.
    expect(windowScore(79, 80)).toBe(0);
    expect(windowScore(80, 80)).toBe(0);
    const between = windowScore(88, 80); // halfway between 80 and 96
    expect(between).toBeGreaterThan(0);
    expect(between).toBeLessThan(1.0);
  });
});

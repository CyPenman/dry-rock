import { describe, expect, it } from 'vitest';
import { formatDryTiming, formatHeadlineModelCaption } from './format';

// Daylight 07:00-18:59 (12 hours) throughout.
const base = {
  totalDaylightHours: 12,
  lastDaylightHour: 18,
};

describe('formatDryTiming (§6 Home item 4)', () => {
  it('says "dry all day" when every daylight hour is climbable', () => {
    expect(
      formatDryTiming({ ...base, climbableDaylightHours: 12, dryFromHourOfDay: 0, bestWindowStartHour: 7, bestWindowEndHour: 19 }),
    ).toBe('dry all day');
  });

  it('says "dry from" when the window runs on to dusk', () => {
    expect(
      formatDryTiming({ ...base, climbableDaylightHours: 6, dryFromHourOfDay: 13, bestWindowStartHour: 13, bestWindowEndHour: 19 }),
    ).toBe('dry from 13:00');
  });

  it('gives a range when evening rain closes the window before dusk, instead of "not dry"', () => {
    expect(
      formatDryTiming({ ...base, climbableDaylightHours: 8, dryFromHourOfDay: null, bestWindowStartHour: 9, bestWindowEndHour: 17 }),
    ).toBe('dry 09:00-17:00');
  });

  it('says "no dry window" when no daylight hour is climbable', () => {
    expect(
      formatDryTiming({ ...base, climbableDaylightHours: 0, dryFromHourOfDay: null, bestWindowStartHour: null, bestWindowEndHour: null }),
    ).toBe('no dry window');
  });
});

describe('formatHeadlineModelCaption (§3.3)', () => {
  const days = [26, 27, 28, 29].map((d) => new Date(2026, 8, d)); // Sat 26 - Tue 29 Sept 2026

  it('names each run of days and says "after" for the last', () => {
    expect(formatHeadlineModelCaption(days, ['ukmo_seamless', 'ukmo_seamless', 'ecmwf_ifs025', 'ecmwf_ifs025'])).toBe(
      'Headline uses UKMO for Sat-Sun, ECMWF after',
    );
  });

  it('says so when one model covers every day shown', () => {
    expect(formatHeadlineModelCaption(days, ['ecmwf_ifs025', 'ecmwf_ifs025', 'ecmwf_ifs025', 'ecmwf_ifs025'])).toBe(
      'Headline uses ECMWF for every day shown',
    );
  });
});

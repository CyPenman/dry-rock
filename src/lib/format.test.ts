import { describe, expect, it } from 'vitest';
import {
  compass16,
  dayReason,
  daySummarySentence,
  formatDaylightWeather,
  formatDrynessCaption,
  formatDrynessShort,
  formatDryTiming,
  formatHeadlineModelCaption,
  formatDriveTime,
  formatSunOnFace,
} from './format';

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

describe('dayReason (§1 one-line why)', () => {
  it('gives what kept the rock wet ahead of any friction reason', () => {
    expect(dayReason({ limitingFactor: 'seepage', frictionReason: 'humid' })).toBe('limited by seepage');
  });

  it('falls back to the friction reason on a dry day', () => {
    expect(dayReason({ limitingFactor: 'none', frictionReason: 'humid' })).toBe('humid - greasy');
  });

  it('is null when nothing held the day back', () => {
    expect(dayReason({ limitingFactor: 'none', frictionReason: null })).toBeNull();
  });
});

describe('formatSunOnFace', () => {
  it('gives the clock window, end exclusive', () => {
    expect(formatSunOnFace({ start: 7, end: 13 })).toBe("sun on the face 07:00-13:00 (when it's out)");
  });

  it('says so when the face gets no sun', () => {
    expect(formatSunOnFace(null)).toBe('no direct sun on this face today');
  });
});

describe('compass16 / formatDaylightWeather', () => {
  it('names bearings on the 16-point compass, wrapping at north', () => {
    expect(compass16(0)).toBe('N');
    expect(compass16(225)).toBe('SW');
    expect(compass16(200)).toBe('SSW');
    expect(compass16(355)).toBe('N');
  });

  it('reads as one line of daylight weather', () => {
    expect(
      formatDaylightWeather({ airTempC: { min: 9.2, max: 14.4 }, windSpeedMs: { min: 4, max: 7 }, windFromDeg: 225, cloudCoverPct: 60.4 }),
    ).toBe('air 9-14°C · wind 4-7 m/s from the SW · cloud 60%');
  });
});

describe('daySummarySentence (§1)', () => {
  const day = {
    ...base,
    date: new Date(2026, 8, 26), // a Saturday
    verdict: 'scored' as const,
    score: 0.9,
    confidence: { agreeCount: 4, total: 4, fraction: 1 },
    limitingFactor: 'none' as const,
    frictionReason: null,
    climbableDaylightHours: 12,
    dryFromHourOfDay: 0,
    bestWindowStartHour: 7,
    bestWindowEndHour: 19,
  };

  it('gives timing, reason and agreement', () => {
    expect(daySummarySentence({ ...day, frictionReason: 'humid' })).toBe(
      "Sat: dry all day, humid - greasy. 4 of 4 models agree it's a good day.",
    );
  });

  it("says good friction when nothing held the day back", () => {
    expect(daySummarySentence(day)).toBe("Sat: dry all day, good friction. 4 of 4 models agree it's a good day.");
  });

  it('gives the verdict on a gated day', () => {
    expect(daySummarySentence({ ...day, verdict: 'under_snow', score: 0 })).toBe('Sat: Under snow.');
  });
});

describe('formatDriveTime', () => {
  it('reads as hours and minutes, or minutes under an hour', () => {
    expect(formatDriveTime(130)).toBe('~2h10 drive');
    expect(formatDriveTime(125)).toBe('~2h05 drive');
    expect(formatDriveTime(120)).toBe('~2h drive');
    expect(formatDriveTime(45)).toBe('~45min drive');
  });
});

describe('formatDryTiming - nearly dry (§4.7)', () => {
  const noWindow = { ...base, climbableDaylightHours: 0, dryFromHourOfDay: null, bestWindowStartHour: null, bestWindowEndHour: null };

  it('says "nearly dry" when partly damp hours add up to an hour or more', () => {
    expect(formatDryTiming({ ...noWindow, effectiveDryDaylightHours: 2.4 })).toBe('nearly dry');
  });

  it('still says "no dry window" when there is less than an hour of credit', () => {
    expect(formatDryTiming({ ...noWindow, effectiveDryDaylightHours: 0.4 })).toBe('no dry window');
    expect(formatDryTiming(noWindow)).toBe('no dry window');
  });
});

describe('formatDrynessCaption (§6, §4.7)', () => {
  const day = {
    totalDaylightHours: 12,
    climbableDaylightHours: 11,
    bestContiguousClimbableHours: 11,
    effectiveDryDaylightHours: 11,
    bestEffectiveRunHours: 11,
    rainChancePct: 14,
  };

  it('reads as before on a day of whole dry hours', () => {
    expect(formatDrynessCaption(day)).toBe(
      '11 of 12 daylight hours dry · longest unbroken run 11h · 14% top hourly rain chance',
    );
  });

  it('counts nearly dry hours into the run on a nearly dry day, instead of "0h"', () => {
    expect(
      formatDrynessCaption({
        ...day,
        climbableDaylightHours: 0,
        bestContiguousClimbableHours: 0,
        effectiveDryDaylightHours: 3.2,
        bestEffectiveRunHours: 2.9,
        rainChancePct: 10,
      }),
    ).toBe(
      '0 of 12 daylight hours dry (plus about 3h nearly dry) · longest unbroken run about 3h, counting nearly dry hours · 10% top hourly rain chance',
    );
  });

  it('extends a dry run that carries on into nearly dry hours', () => {
    expect(
      formatDrynessCaption({ ...day, climbableDaylightHours: 4, bestContiguousClimbableHours: 4, effectiveDryDaylightHours: 5.6, bestEffectiveRunHours: 5.6 }),
    ).toBe(
      '4 of 12 daylight hours dry (plus about 2h nearly dry) · longest unbroken run about 6h, counting nearly dry hours · 14% top hourly rain chance',
    );
  });

  it('says so when there is no daylight', () => {
    expect(formatDrynessCaption({ ...day, totalDaylightHours: 0 })).toBe('no daylight hours to judge');
  });
});

describe('formatDrynessShort', () => {
  const day = { totalDaylightHours: 12, climbableDaylightHours: 11, effectiveDryDaylightHours: 11, bestEffectiveRunHours: 11 };

  it('gives dry hours only when they form one run', () => {
    expect(formatDrynessShort(day)).toBe('11 of 12h dry');
  });

  it('adds nearly dry hours on a nearly dry day', () => {
    expect(
      formatDrynessShort({ ...day, climbableDaylightHours: 0, effectiveDryDaylightHours: 3.2, bestEffectiveRunHours: 2.9 }),
    ).toBe('0 of 12h dry · ~3h nearly dry');
  });

  it('mentions the longest run when the dry hours are scattered', () => {
    expect(formatDrynessShort({ ...day, climbableDaylightHours: 6, effectiveDryDaylightHours: 6, bestEffectiveRunHours: 2 })).toBe(
      '6 of 12h dry · longest run 2h',
    );
  });

  it('says dry all daylight / no daylight at the ends', () => {
    expect(formatDrynessShort({ ...day, climbableDaylightHours: 12 })).toBe('dry all daylight');
    expect(formatDrynessShort({ ...day, totalDaylightHours: 0 })).toBe('no daylight');
  });
});

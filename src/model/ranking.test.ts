import { describe, expect, it } from 'vitest';
import { CRAGS } from '../data/crags';
import type { CragDayResult } from './dayAggregate';
import { pickBestDayInRange, rankCragDays, sortByWorthTheDrive, type RankedCragDay } from './ranking';

function makeDay(overrides: Partial<CragDayResult> = {}): CragDayResult {
  return {
    dayIndex: 0,
    dayStartIdx: 0,
    dayEndIdx: 23,
    date: new Date(),
    verdict: 'scored',
    score: 0.5,
    displayScore: 0.5,
    rockDrynessScore: 0.5,
    dryFromIdx: null,
    dryFromHourOfDay: null,
    climbableDaylightHours: 6,
    totalDaylightHours: 10,
    bestContiguousClimbableHours: 6,
    bestWindowStartHour: 12,
    bestWindowEndHour: 18,
    lastDaylightHour: 17,
    bestFrictionBlockScore: 0.5,
    frictionWindowStartHour: 12,
    frictionWindowRockTempC: 12,
    frictionWindowDewPointC: 5,
    frictionReason: null,
    frictionWindowDryness: 1,
    effectiveDryDaylightHours: 6,
    bestEffectiveRunHours: 6,
    sunOnFaceHours: null,
    daylightWeather: null,
    limitingFactor: 'none',
    confidence: { agreeCount: 4, total: 4, fraction: 1 },
    modelScores: [],
    modelScoreRange: { min: 0.5, max: 0.5 },
    showerDominance: 0,
    avgDaylightTempC: 12,
    rainChancePct: 0,
    worstDaylightWindChillC: null,
    sourceModel: 'ecmwf_ifs025',
    ...overrides,
  };
}

/** A scored day whose raw score and shown score are both `shown` (0-1) - full confidence. */
function shownDay(shown: number, overrides: Partial<CragDayResult> = {}): CragDayResult {
  return makeDay({ score: shown, displayScore: shown, ...overrides });
}

describe('pickBestDayInRange', () => {
  it('picks the day with the highest number shown', () => {
    const days = [shownDay(0.3), shownDay(0.9), shownDay(0.5)];
    expect(pickBestDayInRange(days, 0, 2)!.displayScore).toBe(0.9);
  });

  it('picks on the number shown, not the raw score, so the headline matches the strip (§4.10)', () => {
    // Raw 1.0 on a low-confidence day shows 85; raw 0.98 on a high-confidence day shows 98.
    const days = [makeDay({ dayIndex: 0, score: 1, displayScore: 0.85 }), makeDay({ dayIndex: 1, score: 0.98, displayScore: 0.98 })];
    expect(pickBestDayInRange(days, 0, 1)!.dayIndex).toBe(1);
  });

  it('breaks a tie on the number shown by friction margin, then takes the earlier day', () => {
    const days = [
      shownDay(1, { dayIndex: 0, frictionWindowRockTempC: 8, frictionWindowDewPointC: 4 }),
      shownDay(1, { dayIndex: 1, frictionWindowRockTempC: 10, frictionWindowDewPointC: 0 }),
      shownDay(1, { dayIndex: 2, frictionWindowRockTempC: 10, frictionWindowDewPointC: 0 }),
    ];
    expect(pickBestDayInRange(days, 0, 2)!.dayIndex).toBe(1);
  });

  it('falls back to the first hard-gated day when nothing scores', () => {
    const days = [makeDay({ verdict: 'under_snow', score: 0 }), makeDay({ verdict: 'frozen', score: 0 })];
    expect(pickBestDayInRange(days, 0, 1)!.verdict).toBe('under_snow');
  });

  it('returns null for an empty range', () => {
    expect(pickBestDayInRange([], 0, 5)).toBeNull();
  });
});

describe('rankCragDays', () => {
  const portland = CRAGS.find((c) => c.id === 'portland-cuttings')!;
  const stanage = CRAGS.find((c) => c.id === 'stanage')!;
  const curbar = CRAGS.find((c) => c.id === 'curbar')!;
  const order = (ranked: RankedCragDay[]) => ranked.map((r) => r.crag.id);

  it('orders on the number shown, so the numbers always run downhill', () => {
    const entries = [
      { crag: portland, days: [shownDay(0.4)] },
      { crag: stanage, days: [shownDay(0.8)] },
      { crag: curbar, days: [shownDay(0.6)] },
    ];
    expect(order(rankCragDays(entries, [0, 0], null))).toEqual(['stanage', 'curbar', 'portland-cuttings']);
  });

  it('lets a much better medium-confidence day outrank a surer one, but not a slightly better one (§4.10)', () => {
    // Trevor 95 on 2 of 4 shows 90 and ranks above The Cuttings 84 on 4 of 4;
    // a shaky 86 on 1 of 4 shows 73 and doesn't.
    const solid84 = { crag: stanage, days: [makeDay({ score: 0.84, displayScore: 0.84, confidence: { agreeCount: 4, total: 4, fraction: 1 } })] };
    const medium95 = { crag: portland, days: [makeDay({ score: 0.95, displayScore: 0.9025, confidence: { agreeCount: 2, total: 4, fraction: 0.5 } })] };
    const shaky86 = { crag: curbar, days: [makeDay({ score: 0.86, displayScore: 0.731, confidence: { agreeCount: 1, total: 4, fraction: 0.25 } })] };
    expect(order(rankCragDays([solid84, medium95, shaky86], [0, 0], null))).toEqual(['portland-cuttings', 'stanage', 'curbar']);
  });

  it("puts a raw 72 trimmed to 61 below a 69 - the band is the shown number's", () => {
    const entries = [
      { crag: portland, days: [makeDay({ score: 0.72, displayScore: 0.612 })] },
      { crag: stanage, days: [shownDay(0.69)] },
    ];
    expect(order(rankCragDays(entries, [0, 0], null))).toEqual(['stanage', 'portland-cuttings']);
  });

  it('puts an uncertain 39 above a confident 0 in the poor band', () => {
    const entries = [
      { crag: portland, days: [makeDay({ score: 0, displayScore: 0, confidence: { agreeCount: 4, total: 4, fraction: 1 } })] },
      { crag: stanage, days: [makeDay({ score: 0.46, displayScore: 0.391, confidence: { agreeCount: 1, total: 4, fraction: 0.25 } })] },
    ];
    expect(order(rankCragDays(entries, [0, 0], null))).toEqual(['stanage', 'portland-cuttings']);
  });

  it('breaks a tie on the number shown by distance when home is set, else by friction margin', () => {
    const entries = [
      { crag: portland, days: [shownDay(1, { frictionWindowRockTempC: 14, frictionWindowDewPointC: 2 })] },
      { crag: stanage, days: [shownDay(0.996, { frictionWindowRockTempC: 8, frictionWindowDewPointC: 5 })] },
    ];
    // Both show 100. Without a home, Portland's rock sits further above the dew point.
    expect(order(rankCragDays(entries, [0, 0], null))).toEqual(['portland-cuttings', 'stanage']);
    // From Sheffield, Stanage is nearer.
    expect(order(rankCragDays(entries, [0, 0], { lat: 53.38, lon: -1.47 }))).toEqual(['stanage', 'portland-cuttings']);
  });

  it('picks the best day across a multi-day range and includes every day for the strip', () => {
    const days = [shownDay(0.2, { dayIndex: 0 }), shownDay(0.9, { dayIndex: 1 }), shownDay(0.5, { dayIndex: 2 })];
    const entries = [{ crag: portland, days }];
    const ranked = rankCragDays(entries, [0, 2], null);
    expect(ranked[0].day.displayScore).toBe(0.9);
    expect(ranked[0].daysInRange).toHaveLength(3);
  });

  it('drops entries with no day result and attaches distance when home is set', () => {
    const entries = [
      { crag: portland, days: [makeDay()] },
      { crag: stanage, days: null },
    ];
    const ranked = rankCragDays(entries, [0, 0], { lat: 53.38, lon: -1.47 }); // Sheffield-ish
    expect(ranked).toHaveLength(1);
    expect(ranked[0].distanceKm).not.toBeNull();
  });
});

describe('sortByWorthTheDrive', () => {
  const portland = CRAGS.find((c) => c.id === 'portland-cuttings')!;
  const stanage = CRAGS.find((c) => c.id === 'stanage')!;

  it('can promote a lower-scoring but much closer crag within the same band', () => {
    const ranked = [
      { crag: portland, day: shownDay(0.95), daysInRange: [], distanceKm: 400 },
      { crag: stanage, day: shownDay(0.8), daysInRange: [], distanceKm: 5 },
    ];
    expect(sortByWorthTheDrive(ranked)[0].crag.id).toBe('stanage');
  });

  it('never puts a poorer band first for being closer (§4.9): a 97 at 177km beats a 49 at 18km', () => {
    const ranked = [
      { crag: stanage, day: shownDay(0.49), daysInRange: [], distanceKm: 18 },
      { crag: portland, day: shownDay(0.97), daysInRange: [], distanceKm: 177 },
    ];
    expect(sortByWorthTheDrive(ranked)[0].crag.id).toBe('portland-cuttings');
  });
});

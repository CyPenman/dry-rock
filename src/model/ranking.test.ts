import { describe, expect, it } from 'vitest';
import { CRAGS } from '../data/crags';
import type { CragDayResult } from './dayAggregate';
import { pickBestDayInRange, rankCragDays, sortByWorthTheDrive } from './ranking';

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
    bestFrictionBlockScore: 0.5,
    frictionWindowStartHour: 12,
    limitingFactor: 'none',
    confidence: { agreeCount: 4, total: 4, fraction: 1 },
    showerDominance: 0,
    avgDaylightTempC: 12,
    rainChancePct: 0,
    worstDaylightWindChillC: null,
    ...overrides,
  };
}

describe('pickBestDayInRange', () => {
  it('picks the highest-scoring scored day in range', () => {
    const days = [makeDay({ score: 0.3 }), makeDay({ score: 0.9 }), makeDay({ score: 0.5 })];
    expect(pickBestDayInRange(days, 0, 2)!.score).toBe(0.9);
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

  it('never ranks a low-confidence day above a high-confidence one, even with a lower score', () => {
    const entries = [
      { crag: portland, days: [makeDay({ score: 0.95, confidence: { agreeCount: 1, total: 4, fraction: 0.25 } })] },
      { crag: stanage, days: [makeDay({ score: 0.4, confidence: { agreeCount: 4, total: 4, fraction: 1 } })] },
    ];
    const ranked = rankCragDays(entries, [0, 0], null);
    expect(ranked[0].crag.id).toBe('stanage');
  });

  it('sorts by score within the same confidence tier', () => {
    const entries = [
      { crag: portland, days: [makeDay({ score: 0.4 })] },
      { crag: stanage, days: [makeDay({ score: 0.8 })] },
    ];
    const ranked = rankCragDays(entries, [0, 0], null);
    expect(ranked[0].crag.id).toBe('stanage');
  });

  it('picks the best day across a multi-day range and includes every day for the strip', () => {
    const days = [makeDay({ dayIndex: 0, score: 0.2 }), makeDay({ dayIndex: 1, score: 0.9 }), makeDay({ dayIndex: 2, score: 0.5 })];
    const entries = [{ crag: portland, days }];
    const ranked = rankCragDays(entries, [0, 2], null);
    expect(ranked[0].day.score).toBe(0.9);
    expect(ranked[0].daysInRange).toHaveLength(3);
  });

  it('caps a showery high-confidence day below a genuinely high-confidence one (§4.10 widening)', () => {
    const entries = [
      {
        crag: portland,
        days: [makeDay({ score: 0.9, confidence: { agreeCount: 4, total: 4, fraction: 1 }, showerDominance: 0.9 })],
      },
      {
        crag: stanage,
        days: [makeDay({ score: 0.6, confidence: { agreeCount: 3, total: 4, fraction: 0.75 }, showerDominance: 0 })],
      },
    ];
    const ranked = rankCragDays(entries, [0, 0], null);
    // Both would land in the "high confidence" tier on raw fraction alone, but
    // the showery day is capped to "medium" - the frontal, uncapped day should rank first.
    expect(ranked[0].crag.id).toBe('stanage');
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
  it('can promote a lower-scoring but much closer crag over a higher-scoring distant one', () => {
    const portland = CRAGS.find((c) => c.id === 'portland-cuttings')!;
    const stanage = CRAGS.find((c) => c.id === 'stanage')!;
    const ranked = [
      { crag: portland, day: makeDay({ score: 0.9 }), daysInRange: [], distanceKm: 400 },
      { crag: stanage, day: makeDay({ score: 0.8 }), daysInRange: [], distanceKm: 5 },
    ];
    const sorted = sortByWorthTheDrive(ranked);
    expect(sorted[0].crag.id).toBe('stanage');
  });
});

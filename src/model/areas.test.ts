import { describe, expect, it } from 'vitest';
import { CRAGS } from '../data/crags';
import { nearestKm, sortAreas, summariseAreas } from './areas';
import type { CragDayResult } from './dayAggregate';
import type { RankedCragDay } from './ranking';

function day(dayIndex: number, displayScore: number, verdict: CragDayResult['verdict'] = 'scored'): CragDayResult {
  return { dayIndex, date: new Date(2026, 8, 25 + dayIndex), verdict, score: displayScore, displayScore } as CragDayResult;
}

/** A ranked entry whose best day is its highest scored day, as `rankCragDays` would pick. */
function ranked(cragId: string, days: CragDayResult[], distanceKm: number | null = null): RankedCragDay {
  const crag = CRAGS.find((c) => c.id === cragId)!;
  const scored = days.filter((d) => d.verdict === 'scored');
  const best = scored.length ? scored.reduce((a, b) => (b.score > a.score ? b : a)) : days[0];
  return { crag, day: best, daysInRange: days, distanceKm };
}

describe('summariseAreas', () => {
  it('groups crags by region and keeps their given order', () => {
    const areas = summariseAreas([
      ranked('stanage', [day(0, 0.9)]),
      ranked('portland-cuttings', [day(0, 0.8)]),
      ranked('curbar', [day(0, 0.7)]),
    ]);
    expect(areas.map((a) => a.region)).toEqual(['Peak District', 'Dorset']);
    expect(areas[0].crags.map((r) => r.crag.id)).toEqual(['stanage', 'curbar']);
  });

  it('moves ruled-out crags to the bottom of their region', () => {
    const areas = summariseAreas([ranked('raventor', [day(0, 0, 'under_snow')]), ranked('stanage', [day(0, 0.5)])]);
    expect(areas[0].crags.map((r) => r.crag.id)).toEqual(['stanage', 'raventor']);
  });

  it('scores a day by its best crag and counts every crag into a band, ruled-out as poor', () => {
    const [peak] = summariseAreas([
      ranked('stanage', [day(0, 0.92), day(1, 0.3)]),
      ranked('curbar', [day(0, 0.55), day(1, 0.4)]),
      ranked('raventor', [day(0, 0, 'frozen'), day(1, 0.8)]),
    ]);
    expect(peak.days.map((d) => d.bestScore)).toEqual([0.92, 0.8]);
    expect(peak.days[0].bestCrag!.crag.id).toBe('stanage');
    expect(peak.days[1].bestCrag!.crag.id).toBe('raventor');
    expect(peak.days[0].bands).toEqual({ good: 1, fair: 1, poor: 1 });
    expect(peak.days[1].bands).toEqual({ good: 1, fair: 0, poor: 2 });
    expect(peak.days[0].total).toBe(3);
  });

  it("does not average a lone good crag away - the region's score is its best crag's", () => {
    const [peak] = summariseAreas([
      ranked('raventor', [day(0, 0.95)]),
      ranked('stanage', [day(0, 0.1)]),
      ranked('curbar', [day(0, 0.1)]),
    ]);
    expect(peak.bestDay!.bestScore).toBe(0.95);
    expect(peak.bestDay!.bands).toEqual({ good: 1, fair: 0, poor: 2 });
  });

  it('breaks a best-score tie between days on the number of good crags', () => {
    const [peak] = summariseAreas([ranked('stanage', [day(0, 0.9), day(1, 0.9)]), ranked('curbar', [day(0, 0.2), day(1, 0.75)])]);
    expect(peak.bestDay!.dayIndex).toBe(1);
  });

  it('gives an all-ruled-out region no best day, a null score per day, and sorts it last', () => {
    const areas = summariseAreas([
      ranked('portland-cuttings', [day(0, 0, 'under_snow')]),
      ranked('stanage', [day(0, 0.2)]),
    ]);
    expect(areas.map((a) => a.region)).toEqual(['Peak District', 'Dorset']);
    expect(areas[1].bestDay).toBeNull();
    expect(areas[1].days[0].bestScore).toBeNull();
    expect(areas[1].days[0].bands.poor).toBe(1);
  });

  it('sorts regions by their best score', () => {
    const areas = summariseAreas([
      ranked('stanage', [day(0, 0.6)]),
      ranked('portland-cuttings', [day(0, 0.9)]),
      ranked('kilnsey', [day(0, 0.75)]),
    ]);
    expect(areas.map((a) => a.region)).toEqual(['Dorset', 'Yorkshire', 'Peak District']);
  });
});

describe('sortAreas', () => {
  // Stanage 0.9 at 100km, Curbar 0.4 at 20km (Peak); Portland 0.8 at 200km (Dorset);
  // Kilnsey 0.7 at 60km, Malham ruled out at 10km (Yorkshire).
  const areas = summariseAreas([
    ranked('stanage', [day(0, 0.9)], 100),
    ranked('portland-cuttings', [day(0, 0.8)], 200),
    ranked('kilnsey', [day(0, 0.7)], 60),
    ranked('curbar', [day(0, 0.4)], 20),
    ranked('malham-left', [day(0, 0, 'frozen')], 10),
  ]);

  it('keeps the score order for score', () => {
    expect(sortAreas(areas, 'score')).toBe(areas);
    expect(areas.map((a) => a.region)).toEqual(['Peak District', 'Dorset', 'Yorkshire']);
  });

  it('sorts regions by name both ways', () => {
    expect(sortAreas(areas, 'az').map((a) => a.region)).toEqual(['Dorset', 'Peak District', 'Yorkshire']);
    expect(sortAreas(areas, 'za').map((a) => a.region)).toEqual(['Yorkshire', 'Peak District', 'Dorset']);
  });

  it('measures a region by its nearest crag, ruled-out crags included', () => {
    expect(nearestKm(areas.find((a) => a.region === 'Yorkshire')!)).toBe(10);
    expect(sortAreas(areas, 'distance').map((a) => a.region)).toEqual(['Yorkshire', 'Peak District', 'Dorset']);
  });

  it("rates a region's worth the drive by its best crag", () => {
    // Peak: Stanage 0.9/3 = 0.30, Curbar 0.4/1.4 = 0.29; Yorkshire: Kilnsey 0.7/2.2 = 0.32; Dorset 0.8/5 = 0.16.
    expect(sortAreas(areas, 'drive').map((a) => a.region)).toEqual(['Yorkshire', 'Peak District', 'Dorset']);
  });

  it('sorts the crags inside each region the same way, ruled-out crags still last', () => {
    const peak = sortAreas(areas, 'distance').find((a) => a.region === 'Peak District')!;
    expect(peak.crags.map((r) => r.crag.id)).toEqual(['curbar', 'stanage']);
    const yorkshire = sortAreas(areas, 'distance').find((a) => a.region === 'Yorkshire')!;
    expect(yorkshire.crags.map((r) => r.crag.id)).toEqual(['kilnsey', 'malham-left']);
  });

  it('puts regions with no known distance last when home is unset', () => {
    const noHome = summariseAreas([ranked('stanage', [day(0, 0.9)]), ranked('portland-cuttings', [day(0, 0.8)], 50)]);
    expect(sortAreas(noHome, 'distance').map((a) => a.region)).toEqual(['Dorset', 'Peak District']);
  });
});

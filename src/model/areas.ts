import { compareWorthTheDrive, sortRanked, type RankedCragDay, type SortMode } from './ranking';
import { displayBand, type ScoreBand } from './scoreBand';
import type { Region } from './types';

/** One day of one region, across all its crags (spec §6 Areas). */
export interface AreaDay {
  dayIndex: number;
  date: Date;
  /** Highest `displayScore` (0-1) among the region's crags that day; null when every crag is ruled out. */
  bestScore: number | null;
  /** The crag giving `bestScore`; null exactly when `bestScore` is. */
  bestCrag: RankedCragDay | null;
  /** Crags per band that day, judged on `displayScore`; a ruled-out crag counts as poor. */
  bands: Record<ScoreBand, number>;
  total: number;
}

export interface AreaSummary {
  region: Region;
  /** The region's crags in the order given (the home ranking), ruled-out crags moved last. */
  crags: RankedCragDay[];
  days: AreaDay[];
  /** The day with the highest `bestScore`; null when every crag is ruled out on every day. */
  bestDay: AreaDay | null;
}

/**
 * Condense ranked crags into regions for the Areas tab (spec §6 Areas).
 *
 * An area's score for a day is its best crag's, not an average: "somewhere here
 * is this good" is the question a region answers, and a mean would let the one
 * dry cave in a wet region be averaged away (or a wet cave drag down a dry one).
 * The band counts sit alongside so a lone good crag can't pass for a good region.
 *
 * `displayScore`, not raw `score`, throughout - it's the number every crag row
 * and day strip shows, so the counts agree with what the rows underneath say.
 */
export function summariseAreas(ranked: RankedCragDay[]): AreaSummary[] {
  const byRegion = new Map<Region, RankedCragDay[]>();
  for (const r of ranked) {
    const list = byRegion.get(r.crag.region);
    if (list) list.push(r);
    else byRegion.set(r.crag.region, [r]);
  }

  const areas: AreaSummary[] = [];
  for (const [region, members] of byRegion) {
    const crags = [...members.filter((r) => r.day.verdict === 'scored'), ...members.filter((r) => r.day.verdict !== 'scored')];
    const days = summariseDays(crags);
    areas.push({ region, crags, days, bestDay: pickBestAreaDay(days) });
  }

  return areas.sort((a, b) => {
    const scoreDiff = (b.bestDay?.bestScore ?? -1) - (a.bestDay?.bestScore ?? -1);
    if (scoreDiff !== 0) return scoreDiff;
    const goodDiff = (b.bestDay?.bands.good ?? 0) - (a.bestDay?.bands.good ?? 0);
    if (goodDiff !== 0) return goodDiff;
    return a.region.localeCompare(b.region);
  });
}

/**
 * Re-order regions, and the crags inside each, by the Crags tab's "Sort by"
 * choice (spec §6 Areas). `score` keeps `summariseAreas`' own order. A region's
 * distance is its nearest crag's, and its "worth the drive" its best crag's by
 * the same order the crags inside use (band first, then score over distance) -
 * each the crag you'd actually drive to. Ruled-out crags stay at the bottom of
 * their region whatever the sort, as on the Crags tab.
 */
export function sortAreas(areas: AreaSummary[], mode: SortMode): AreaSummary[] {
  if (mode === 'score') return areas;

  const resorted = areas.map((a) => {
    const scored = a.crags.filter((r) => r.day.verdict === 'scored');
    const gated = a.crags.filter((r) => r.day.verdict !== 'scored');
    return { ...a, crags: [...sortRanked(scored, mode), ...sortRanked(gated, mode)] };
  });

  switch (mode) {
    case 'az':
      return resorted.sort((a, b) => a.region.localeCompare(b.region));
    case 'za':
      return resorted.sort((a, b) => b.region.localeCompare(a.region));
    case 'distance':
      return resorted.sort((a, b) => (nearestKm(a) ?? Infinity) - (nearestKm(b) ?? Infinity));
    case 'drive':
      return resorted.sort((a, b) => {
        const wa = bestWorth(a);
        const wb = bestWorth(b);
        if (wa == null || wb == null) return wa == null ? (wb == null ? 0 : 1) : -1;
        return compareWorthTheDrive(wa, wb);
      });
  }
}

/** Distance to the region's nearest crag; null when home is unset. */
export function nearestKm(area: AreaSummary): number | null {
  const ds = area.crags.map((r) => r.distanceKm).filter((d): d is number => d != null);
  return ds.length ? Math.min(...ds) : null;
}

/** The region's crag most worth the drive (`compareWorthTheDrive`); null when every crag is ruled out. */
function bestWorth(area: AreaSummary): RankedCragDay | null {
  const scored = area.crags.filter((r) => r.day.verdict === 'scored');
  return scored.length ? [...scored].sort(compareWorthTheDrive)[0] : null;
}

function summariseDays(crags: RankedCragDay[]): AreaDay[] {
  const dayIndices = [...new Set(crags.flatMap((r) => r.daysInRange.map((d) => d.dayIndex)))].sort((a, b) => a - b);

  return dayIndices.map((dayIndex) => {
    const bands: Record<ScoreBand, number> = { good: 0, fair: 0, poor: 0 };
    let bestScore: number | null = null;
    let bestCrag: RankedCragDay | null = null;
    let date: Date | null = null;
    let total = 0;

    for (const r of crags) {
      const d = r.daysInRange.find((x) => x.dayIndex === dayIndex);
      if (!d) continue;
      date ??= d.date;
      total++;
      if (d.verdict !== 'scored') {
        bands.poor++;
        continue;
      }
      bands[displayBand(d)]++;
      if (bestScore == null || d.displayScore > bestScore) {
        bestScore = d.displayScore;
        bestCrag = r;
      }
    }

    return { dayIndex, date: date!, bestScore, bestCrag, bands, total };
  });
}

/** Highest best score; a tie goes to the day with more good crags, then the earlier day. */
function pickBestAreaDay(days: AreaDay[]): AreaDay | null {
  let best: AreaDay | null = null;
  for (const d of days) {
    if (d.bestScore == null) continue;
    if (best == null || d.bestScore > best.bestScore! || (d.bestScore === best.bestScore && d.bands.good > best.bands.good)) {
      best = d;
    }
  }
  return best;
}

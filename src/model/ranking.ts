import type { CragDayResult } from './dayAggregate';
import { greatCircleDistanceKm } from './distance';
import { displayBand, displayPercent, type ScoreBand } from './scoreBand';
import type { Crag } from './types';

const BAND_ORDER: Record<ScoreBand, number> = { good: 2, fair: 1, poor: 0 };

export interface RankedCragDay {
  crag: Crag;
  day: CragDayResult; // best day within the selected range
  daysInRange: CragDayResult[]; // every day in the range, for the day-by-day strip
  distanceKm: number | null;
}

/**
 * Friction margin, °C: how far the rock sits above the dew point across the
 * day's friction window - the further, the less chance of it sweating. A
 * tie-break only (§4.10): on a good weekend a dozen crags score exactly 100,
 * both halves of the score saturated, and this still tells them apart.
 * Null with no friction window.
 */
function frictionMargin(day: CragDayResult): number | null {
  return day.frictionWindowRockTempC != null && day.frictionWindowDewPointC != null
    ? day.frictionWindowRockTempC - day.frictionWindowDewPointC
    : null;
}

/** Larger friction margin first; a day with no window last. */
function compareFrictionMargin(a: CragDayResult, b: CragDayResult): number {
  const ma = frictionMargin(a);
  const mb = frictionMargin(b);
  if (ma == null || mb == null) return ma == null ? (mb == null ? 0 : 1) : -1;
  return mb - ma;
}

/**
 * Best day first, for one crag's days (§4.10): the number shown
 * (`displayPercent`, the confidence-trimmed score as rounded on screen), then
 * friction margin. The same order the list ranks crags in, so a crag's
 * headline can't show a lower number than its own day strip.
 */
export function compareDays(a: CragDayResult, b: CragDayResult): number {
  return displayPercent(b) - displayPercent(a) || compareFrictionMargin(a, b);
}

/** Best day within [startIdx, endIdxInclusive], by `compareDays` (the earlier on a tie); falls back to the first hard-gated day so a reason can still be shown. */
export function pickBestDayInRange(
  days: CragDayResult[],
  startIdx: number,
  endIdxInclusive: number,
): CragDayResult | null {
  const candidates = days.slice(startIdx, Math.min(endIdxInclusive + 1, days.length));
  if (candidates.length === 0) return null;
  const scored = candidates.filter((d) => d.verdict === 'scored');
  if (scored.length === 0) return candidates[0];
  return scored.reduce((best, d) => (compareDays(d, best) < 0 ? d : best));
}

/**
 * The home list's order (§4.10): highest number shown first. The band is the
 * shown number's band (`displayBand`), so ordering on the number orders the
 * bands too, and the numbers always run downhill. Confidence counts through
 * the trim already in `displayScore`. Ties - usually several crags on 100 -
 * go to the nearer crag when home is set, else the larger friction margin.
 */
export function compareRanked(a: RankedCragDay, b: RankedCragDay): number {
  const scoreDiff = displayPercent(b.day) - displayPercent(a.day);
  if (scoreDiff !== 0) return scoreDiff;
  if (a.distanceKm != null && b.distanceKm != null && a.distanceKm !== b.distanceKm) return a.distanceKm - b.distanceKm;
  return compareFrictionMargin(a.day, b.day);
}

/**
 * Rank crag-days for the home list (§4.10) by `compareRanked`, each crag on
 * its best day in the range. Replaces "band, then confidence tier, then raw
 * score", which put a confident 0 above an uncertain 39 in the poor band, and
 * ranked on the raw score's band while every row was coloured by the shown one.
 */
export function rankCragDays(
  entries: { crag: Crag; days: CragDayResult[] | null }[],
  range: [number, number],
  home: { lat: number; lon: number } | null,
): RankedCragDay[] {
  const [startIdx, endIdx] = range;

  const ranked: RankedCragDay[] = [];
  for (const entry of entries) {
    if (!entry.days) continue;
    const best = pickBestDayInRange(entry.days, startIdx, endIdx);
    if (!best) continue;
    ranked.push({
      crag: entry.crag,
      day: best,
      daysInRange: entry.days.slice(startIdx, Math.min(endIdx + 1, entry.days.length)),
      distanceKm: home ? greatCircleDistanceKm(home.lat, home.lon, entry.crag.lat, entry.crag.lon) : null,
    });
  }

  return ranked.sort(compareRanked);
}

/** "Worth the drive" - the shown score divided by a mild function of distance (§4.9), halving it at 50km; plain score when home is unset. */
export function worthTheDrive(r: RankedCragDay): number {
  return r.distanceKm != null ? r.day.displayScore / (1 + r.distanceKm / 50) : r.day.displayScore;
}

/**
 * "Worth the drive" order (§4.9): band first (good, fair, poor - of the shown
 * number), then `worthTheDrive` within the band. Distance alone used to decide
 * too much: halving a score every 50km put a poor 49 at 18km above a 97 at
 * 177km. Now a good day never ranks below a poor one for being further away,
 * and distance only chooses between days of the same kind.
 */
export function compareWorthTheDrive(a: RankedCragDay, b: RankedCragDay): number {
  const bandDiff = BAND_ORDER[displayBand(b.day)] - BAND_ORDER[displayBand(a.day)];
  if (bandDiff !== 0) return bandDiff;
  return worthTheDrive(b) - worthTheDrive(a) || compareRanked(a, b);
}

/** "Worth the drive" sort (§4.9). */
export function sortByWorthTheDrive(ranked: RankedCragDay[]): RankedCragDay[] {
  return [...ranked].sort(compareWorthTheDrive);
}

/** Alphabetical by crag name. */
export function sortByName(ranked: RankedCragDay[], direction: 'asc' | 'desc'): RankedCragDay[] {
  const sorted = [...ranked].sort((a, b) => a.crag.name.localeCompare(b.crag.name));
  return direction === 'asc' ? sorted : sorted.reverse();
}

/**
 * The "Sort by" choices (§6 Home, item 5), shared by the Crags and Areas tabs.
 * `drive` and `distance` are only offered once a home location is set.
 */
export type SortMode = 'score' | 'drive' | 'az' | 'za' | 'distance';

/** `ranked` re-ordered by `mode`; `score` keeps `rankCragDays`' own order. */
export function sortRanked(ranked: RankedCragDay[], mode: SortMode): RankedCragDay[] {
  switch (mode) {
    case 'drive':
      return sortByWorthTheDrive(ranked);
    case 'az':
      return sortByName(ranked, 'asc');
    case 'za':
      return sortByName(ranked, 'desc');
    case 'distance':
      return sortByDistance(ranked);
    default:
      return ranked;
  }
}

/** Nearest to home first; crags with no known distance (home unset) sort last. */
export function sortByDistance(ranked: RankedCragDay[]): RankedCragDay[] {
  return [...ranked].sort((a, b) => {
    if (a.distanceKm == null && b.distanceKm == null) return 0;
    if (a.distanceKm == null) return 1;
    if (b.distanceKm == null) return -1;
    return a.distanceKm - b.distanceKm;
  });
}

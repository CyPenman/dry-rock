import type { CragDayResult } from './dayAggregate';
import { greatCircleDistanceKm } from './distance';
import type { Crag } from './types';

export interface RankedCragDay {
  crag: Crag;
  day: CragDayResult; // best day within the selected range
  daysInRange: CragDayResult[]; // every day in the range, for the day-by-day strip
  distanceKm: number | null;
}

/** Best day within [startIdx, endIdxInclusive]; falls back to the first hard-gated day so a reason can still be shown. */
export function pickBestDayInRange(
  days: CragDayResult[],
  startIdx: number,
  endIdxInclusive: number,
): CragDayResult | null {
  const candidates = days.slice(startIdx, Math.min(endIdxInclusive + 1, days.length));
  if (candidates.length === 0) return null;
  const scored = candidates.filter((d) => d.verdict === 'scored');
  if (scored.length === 0) return candidates[0];
  return scored.reduce((best, d) => (d.score > best.score ? d : best));
}

function confidenceTier(fraction: number): number {
  if (fraction >= 0.75) return 2;
  if (fraction >= 0.5) return 1;
  return 0;
}

/**
 * Rank crag-days for the home list — spec §4.10: "Never rank a low-confidence
 * crag-day above a high-confidence one." Sorts by confidence tier first, then
 * score within the tier.
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

  return ranked.sort((a, b) => {
    const tierDiff = confidenceTier(b.day.confidence.fraction) - confidenceTier(a.day.confidence.fraction);
    if (tierDiff !== 0) return tierDiff;
    return b.day.score - a.day.score;
  });
}

/** "Worth the drive" sort — score divided by a mild function of distance (§4.9). */
export function sortByWorthTheDrive(ranked: RankedCragDay[]): RankedCragDay[] {
  const worth = (r: RankedCragDay) => (r.distanceKm != null ? r.day.score / (1 + r.distanceKm / 50) : r.day.score);
  return [...ranked].sort((a, b) => worth(b) - worth(a));
}

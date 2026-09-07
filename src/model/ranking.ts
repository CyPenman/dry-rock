import type { CragDayResult } from './dayAggregate';
import { greatCircleDistanceKm } from './distance';
import type { Crag } from './types';

export interface RankedCragDay {
  crag: Crag;
  day: CragDayResult;
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
  entries: { crag: Crag; day: CragDayResult | null }[],
  home: { lat: number; lon: number } | null,
): RankedCragDay[] {
  const withDistance = entries
    .filter((e): e is { crag: Crag; day: CragDayResult } => e.day !== null)
    .map((e) => ({
      crag: e.crag,
      day: e.day,
      distanceKm: home ? greatCircleDistanceKm(home.lat, home.lon, e.crag.lat, e.crag.lon) : null,
    }));

  return withDistance.sort((a, b) => {
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

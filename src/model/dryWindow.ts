import { PARAMS } from './params';

// §9 step 5 — "dry window detection", the pure building block behind §4.9's
// windowScore. Decoupled from the physics: it operates on any boolean
// qualifying-hour array, whether that's a simple precipitation threshold now or
// the full two-reservoir model's `climbable[h]` later (§4.6).

export function isHourDry(precipMm: number, threshold: number = PARAMS.WET_THRESHOLD_MM): boolean {
  return precipMm < threshold;
}

/**
 * Length of the longest contiguous run of qualifying hours that overlaps the
 * given day's index range [dayStartIdx, dayEndIdx] (inclusive).
 */
export function longestQualifyingWindowForDay(
  qualifies: boolean[],
  dayStartIdx: number,
  dayEndIdx: number,
): number {
  let best = 0;
  let runStart: number | null = null;

  const consider = (start: number, endExclusive: number) => {
    if (endExclusive > dayStartIdx && start <= dayEndIdx) {
      best = Math.max(best, endExclusive - start);
    }
  };

  for (let i = 0; i < qualifies.length; i++) {
    if (qualifies[i]) {
      if (runStart === null) runStart = i;
    } else if (runStart !== null) {
      consider(runStart, i);
      runStart = null;
    }
  }
  if (runStart !== null) consider(runStart, qualifies.length);

  return best;
}

// §4.9 — fixed anchors: 48h -> 0.6, 72h -> 0.85, 96h+ -> 1.0.
const WINDOW_SCORE_ANCHORS: [hours: number, score: number][] = [
  [48, 0.6],
  [72, 0.85],
  [96, 1.0],
];

/**
 * Scales the longest qualifying window covering a day into the §4.9 windowScore
 * term. Below `minWindowHours` the result is always 0. Above it, the score
 * follows a piecewise-linear ramp through the fixed anchors; if the user has
 * raised `minWindowHours` past one of them, that anchor is dropped and the ramp
 * starts fresh from `minWindowHours`.
 */
export function windowScore(windowHours: number, minWindowHours: number = PARAMS.minWindowHours): number {
  if (windowHours < minWindowHours) return 0;
  if (windowHours >= 96) return 1.0;

  // Anchors at or above minWindowHours still apply as-is. If minWindowHours falls
  // strictly between the gate and the first surviving anchor, ramp up from 0 at
  // minWindowHours; if it lands exactly on an anchor, use that anchor's value
  // directly rather than resetting it to 0.
  const survivingAnchors = WINDOW_SCORE_ANCHORS.filter(([x]) => x >= minWindowHours);
  const knots: [number, number][] =
    survivingAnchors.length > 0 && survivingAnchors[0][0] === minWindowHours
      ? survivingAnchors
      : [[minWindowHours, 0], ...survivingAnchors];

  for (let i = 0; i < knots.length - 1; i++) {
    const [x0, y0] = knots[i];
    const [x1, y1] = knots[i + 1];
    if (windowHours >= x0 && windowHours <= x1) {
      return y0 + ((windowHours - x0) / (x1 - x0)) * (y1 - y0);
    }
  }
  return knots[knots.length - 1][1];
}

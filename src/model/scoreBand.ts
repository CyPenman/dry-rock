// Good/Fair/Poor score bands - shared by the map markers/legend (§6) and
// anywhere else a score needs a quick colour-coded read rather than a number.

export type ScoreBand = 'good' | 'fair' | 'poor';

export const SCORE_BAND_THRESHOLDS = { good: 70, fair: 45 } as const;

/** `scorePercent` is 0-100, matching how scores are displayed everywhere else. */
export function scoreBand(scorePercent: number): ScoreBand {
  if (scorePercent >= SCORE_BAND_THRESHOLDS.good) return 'good';
  if (scorePercent >= SCORE_BAND_THRESHOLDS.fair) return 'fair';
  return 'poor';
}

/** The number a day shows, 0-100: `displayScore` rounded, as every row, strip and pin prints it. */
export function displayPercent(day: { displayScore: number }): number {
  return Math.round(day.displayScore * 100);
}

/**
 * The band a day shows in - of the number on screen, not the raw score
 * (§4.10). Ranking, colours and the Areas counts all use this, so a raw 72
 * trimmed to 61 for low confidence is fair everywhere, and never sits in the
 * good group above a 69.
 */
export function displayBand(day: { displayScore: number }): ScoreBand {
  return scoreBand(displayPercent(day));
}

export const SCORE_BAND_LABEL: Record<ScoreBand, string> = {
  good: `Good (${SCORE_BAND_THRESHOLDS.good}+)`,
  fair: `Fair (${SCORE_BAND_THRESHOLDS.fair}-${SCORE_BAND_THRESHOLDS.good - 1})`,
  poor: `Poor (<${SCORE_BAND_THRESHOLDS.fair})`,
};

export const SCORE_BAND_COLOR_VAR: Record<ScoreBand, string> = {
  good: 'var(--signal)',
  fair: 'var(--chart-seepage)',
  poor: 'var(--warning)',
};

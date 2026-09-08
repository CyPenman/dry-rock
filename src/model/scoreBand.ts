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

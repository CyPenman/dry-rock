// Shared "nice number" axis scaling for hand-rolled SVG charts — round tick
// values (0 / 0.5 / 1, not 0 / 0.34 / 0.67) so a reader can actually anchor on
// them, per standard chart-axis practice.

function niceStep(roughStep: number): number {
  if (roughStep <= 0) return 1;
  const exponent = Math.floor(Math.log10(roughStep));
  const fraction = roughStep / 10 ** exponent;
  const niceFraction = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
  return niceFraction * 10 ** exponent;
}

export interface NiceScale {
  /** Axis ticks from 0 to the rounded-up max, inclusive. */
  ticks: number[];
  /** Rounded-up max — use this as the axis's top, not the raw data max, so the
   * scale itself lands on round numbers rather than just the labels. */
  max: number;
}

/** A "nice" 0-based axis for a positive-valued measurement (rain, mm, score, ...). */
export function niceScale(dataMax: number, targetTickCount = 4): NiceScale {
  if (dataMax <= 0) return { ticks: [0], max: 1 };
  const step = niceStep(dataMax / targetTickCount);
  const max = Math.ceil(dataMax / step) * step;
  const ticks: number[] = [];
  for (let v = 0; v <= max + step / 2; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return { ticks, max };
}

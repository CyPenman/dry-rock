import type { CragForecastResult } from './dayAggregate';
import { frictionScoreHour } from './friction';
import type { Crag } from './types';
import { limitingFactorAt } from './wetness';

// Personal ground truth (spec §8.1): what the rock was actually like, saved
// next to what the model said about the same hour, so the constants can be
// checked against reality instead of tuned blind. Stays on the device.

export type ObservedCondition = 'dry' | 'damp' | 'seeping' | 'greasy' | 'verglas';

export const OBSERVED_CONDITIONS: { value: ObservedCondition; label: string }[] = [
  { value: 'dry', label: 'Dry' },
  { value: 'damp', label: 'Damp' },
  { value: 'seeping', label: 'Seeping' },
  { value: 'greasy', label: 'Greasy' },
  { value: 'verglas', label: 'Verglas' },
];

export interface Observation {
  id: string; // `${cragId}-${observedAtSec}`
  cragId: string;
  observedAtSec: number;
  condition: ObservedCondition;
  note?: string;
  snapshot: {
    // the model's view of that same hour
    sourceModel: string;
    S: number;
    M: number;
    Mmax: number;
    Trock: number;
    climbable: boolean;
    tempC: number;
    dewPointC: number;
    windSpeedMs: number;
    vpdKpa: number;
    precipLast24hMm: number;
    limitingFactor: string;
    dayScore: number;
    frictionHourScore: number;
  };
}

/**
 * The model's view of the hour containing `nowSec` (§8.1), from the headline
 * series. Null when `nowSec` falls outside the series - there is nothing to
 * compare the observation against, so the log should say so rather than guess.
 */
export function buildObservationSnapshot(
  crag: Crag,
  forecast: CragForecastResult,
  nowSec: number,
): Observation['snapshot'] | null {
  const { inputs, hourly, days } = forecast;
  if (inputs.length === 0 || nowSec < inputs[0].time || nowSec >= inputs[inputs.length - 1].time + 3600) return null;

  let idx = 0;
  while (idx + 1 < inputs.length && inputs[idx + 1].time <= nowSec) idx++;
  const input = inputs[idx];
  const result = hourly[idx];
  const day = days.find((d) => idx >= d.dayStartIdx && idx <= d.dayEndIdx);
  if (!result || !day) return null;

  let precipLast24hMm = 0;
  for (let i = Math.max(0, idx - 23); i <= idx; i++) precipLast24hMm += inputs[i].precipitationMm;

  return {
    sourceModel: day.sourceModel,
    S: result.S,
    M: result.M,
    Mmax: crag.Mmax,
    Trock: result.Trock,
    climbable: result.climbable,
    tempC: input.tempC,
    dewPointC: input.dewPointC,
    windSpeedMs: input.windSpeedMs,
    vpdKpa: input.vpdKpa,
    precipLast24hMm,
    limitingFactor: limitingFactorAt(hourly, idx),
    dayScore: day.score,
    frictionHourScore: frictionScoreHour({
      trockC: result.Trock,
      idealTempC: crag.idealTempC,
      dewPointC: input.dewPointC,
      windSpeedMs: input.windSpeedMs,
      windDirectionDeg: input.windDirectionDeg,
      gtiFaceWm2: input.gtiFaceWm2 * crag.canopyLight, // through tree cover, as in dayAggregate
      aspectDeg: crag.aspectDeg,
      coastal: crag.coastal,
      rock: crag.rock,
      disciplines: crag.disciplines,
    }),
  };
}

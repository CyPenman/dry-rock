import type { Crag } from '../model/types';
import { dedupeCoordinates } from './dedupe';
import { buildForecastUrl, MODELS, type ModelName } from './request';
import { fetchFrom, readJson, ServiceError } from './serviceError';
import type { OpenMeteoResponse } from './types';

export interface CellForecast {
  time: number[]; // hourly, unixtime
  dailyTime: number[];
  dailySunrise: number[];
  dailySunset: number[];
  dailyPrecipSum: number[];
  models: Record<ModelName, Record<string, number[]>>;
}

function splitVariablesByModel(hourly: Record<string, number[]>): Record<ModelName, Record<string, number[]>> {
  const result = {} as Record<ModelName, Record<string, number[]>>;
  for (const model of MODELS) result[model] = {};

  for (const [key, values] of Object.entries(hourly)) {
    if (key === 'time') continue;
    const model = MODELS.find((m) => key.endsWith(`_${m}`));
    if (!model) continue; // not a per-model variable - ignore
    const baseVar = key.slice(0, key.length - model.length - 1);
    result[model][baseVar] = values;
  }

  return result;
}

function normalizeCell(response: OpenMeteoResponse): CellForecast {
  return {
    time: response.hourly.time,
    dailyTime: response.daily?.time ?? [],
    dailySunrise: response.daily?.sunrise ?? [],
    dailySunset: response.daily?.sunset ?? [],
    dailyPrecipSum: response.daily?.precipitation_sum ?? [],
    models: splitVariablesByModel(response.hourly),
  };
}

/**
 * Fetch the primary multi-model forecast for a set of crags in a single request
 * (§3.1), deduplicated by grid cell (§3.2), and normalise the response - which is
 * a bare object for one coordinate but an array for several - back onto crags.
 */
export async function fetchCellForecasts(
  crags: Crag[],
): Promise<{ cellForecasts: Map<string, CellForecast>; cragToCellKey: Map<string, string> }> {
  const { cells, cragToCellKey } = dedupeCoordinates(crags);
  const url = buildForecastUrl(cells);

  const res = await fetchFrom('Open-Meteo', url);
  const body = await readJson<unknown>('Open-Meteo', res);
  const responses: OpenMeteoResponse[] = Array.isArray(body) ? body : [body as OpenMeteoResponse];

  // One answer per requested cell, each with an hourly series - anything else
  // can't be matched back onto crags.
  if (responses.length !== cells.length || responses.some((r) => !r?.hourly?.time)) {
    throw new ServiceError('Open-Meteo', 'unreadable');
  }

  const cellForecasts = new Map<string, CellForecast>();
  cells.forEach((cell, i) => {
    cellForecasts.set(cell.key, normalizeCell(responses[i]));
  });

  return { cellForecasts, cragToCellKey };
}

import type { OpenMeteoResponse } from './types';

export interface EnsembleCellForecast {
  time: number[]; // hourly, unixtime
  members: Record<string, Record<string, number[]>>; // "member01" -> { baseVar: values }
}

const MEMBER_SUFFIX_RE = /_member(\d+)$/;

/** Split the ensemble response's `_memberNN`-suffixed hourly variables by member. */
function splitVariablesByMember(hourly: Record<string, number[]>): Record<string, Record<string, number[]>> {
  const result: Record<string, Record<string, number[]>> = {};
  for (const [key, values] of Object.entries(hourly)) {
    const match = key.match(MEMBER_SUFFIX_RE);
    if (!match) continue; // 'time' and any non-member key - ignore
    const memberKey = `member${match[1]}`;
    const baseVar = key.slice(0, key.length - match[0].length);
    if (!result[memberKey]) result[memberKey] = {};
    result[memberKey][baseVar] = values;
  }
  return result;
}

/**
 * Fetch the opt-in ensemble forecast for one crag (§3.3). Never cached to
 * IndexedDB - it's a separate, on-demand call, not part of the primary
 * multi-model payload §2 sizes the persisted cache around.
 */
export async function fetchEnsembleForecast(url: string): Promise<EnsembleCellForecast> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Open-Meteo ensemble request failed: ${res.status} ${res.statusText}`);
  }
  const body = (await res.json()) as OpenMeteoResponse;
  return {
    time: body.hourly.time,
    members: splitVariablesByMember(body.hourly),
  };
}

import { describe, expect, it } from 'vitest';
import type { EnsembleCellForecast } from '../api/ensembleClient';
import { CRAGS } from '../data/crags';
import { runEnsembleForCrag } from './ensemble';
import { toModelConfig } from './dayAggregate';

function crag(id: string) {
  const found = CRAGS.find((c) => c.id === id);
  if (!found) throw new Error(`fixture crag not found: ${id}`);
  return found;
}

function makeMemberVars(hours: number, opts: { dry: boolean }): Record<string, number[]> {
  const isDay = (i: number) => (i % 24 >= 6 && i % 24 <= 18 ? 1 : 0);
  return {
    precipitation: Array.from({ length: hours }, () => (opts.dry ? 0 : 5)),
    snow_depth: Array.from({ length: hours }, () => 0),
    temperature_2m: Array.from({ length: hours }, () => 18),
    dew_point_2m: Array.from({ length: hours }, () => (opts.dry ? 6 : 16)),
    vapour_pressure_deficit: Array.from({ length: hours }, () => (opts.dry ? 1.2 : 0.1)),
    wind_speed_10m: Array.from({ length: hours }, () => 4),
    wind_direction_10m: Array.from({ length: hours }, () => 180),
    cloud_cover: Array.from({ length: hours }, () => 10),
    visibility: Array.from({ length: hours }, () => 20000),
    shortwave_radiation: Array.from({ length: hours }, (_, i) => (isDay(i) ? 500 : 0)),
    direct_normal_irradiance: Array.from({ length: hours }, (_, i) => (isDay(i) ? 500 : 0)),
    diffuse_radiation: Array.from({ length: hours }, () => 50),
    is_day: Array.from({ length: hours }, (_, i) => isDay(i)),
    soil_moisture_28_to_100cm: Array.from({ length: hours }, () => 0.1),
  };
}

describe('runEnsembleForCrag', () => {
  it('reports the fraction of members climbable over the given hour range', () => {
    const hours = 24 * 3;
    const time = Array.from({ length: hours }, (_, i) => i * 3600);
    const cell: EnsembleCellForecast = {
      time,
      members: {
        member01: makeMemberVars(hours, { dry: true }),
        member02: makeMemberVars(hours, { dry: true }),
        member03: makeMemberVars(hours, { dry: false }),
        member04: makeMemberVars(hours, { dry: false }),
      },
    };

    const c = crag('portland-cuttings');
    const result = runEnsembleForCrag(c, toModelConfig(c), cell, [24, 47]);

    expect(result.memberCount).toBe(4);
    expect(result.climbableCount).toBe(2);
    expect(result.fraction).toBeCloseTo(0.5);
  });

  it('counts a member as climbable only in daylight, matching the deterministic confidence path', () => {
    // A "wet by day, dry by night" member: rain every daylight hour keeps the
    // rock wet all day, a dry windy night clears it. It IS climbable overnight
    // (the identical weather is asserted to clear overnight in dayAggregate's
    // M2 test), but not in any daylight hour - so it must NOT be counted, the
    // same daylight definition the "N of M models" sentence and the score use
    // (§4.9). The dry member alongside it proves members can still register, so
    // a 1-of-2 result isolates the gate rather than passing vacuously.
    const hours = 24 * 2;
    const time = Array.from({ length: hours }, (_, i) => i * 3600);
    const daylight = (i: number) => i % 24 >= 6 && i % 24 <= 18;
    const wetByDayDryByNight = (): Record<string, number[]> => ({
      precipitation: Array.from({ length: hours }, (_, i) => (daylight(i) ? 2 : 0)),
      snow_depth: Array.from({ length: hours }, () => 0),
      temperature_2m: Array.from({ length: hours }, () => 10),
      dew_point_2m: Array.from({ length: hours }, () => 2),
      vapour_pressure_deficit: Array.from({ length: hours }, (_, i) => (daylight(i) ? 0.3 : 1.2)),
      wind_speed_10m: Array.from({ length: hours }, (_, i) => (daylight(i) ? 3 : 8)),
      wind_direction_10m: Array.from({ length: hours }, () => 180),
      cloud_cover: Array.from({ length: hours }, () => 0),
      visibility: Array.from({ length: hours }, () => 20000),
      shortwave_radiation: Array.from({ length: hours }, (_, i) => (daylight(i) ? 500 : 0)),
      direct_normal_irradiance: Array.from({ length: hours }, (_, i) => (daylight(i) ? 500 : 0)),
      diffuse_radiation: Array.from({ length: hours }, () => 50),
      is_day: Array.from({ length: hours }, (_, i) => (daylight(i) ? 1 : 0)),
      soil_moisture_28_to_100cm: Array.from({ length: hours }, () => 0.1),
    });

    const cell: EnsembleCellForecast = {
      time,
      members: { member01: wetByDayDryByNight(), member02: makeMemberVars(hours, { dry: true }) },
    };

    const c = crag('slate');
    const result = runEnsembleForCrag(c, toModelConfig(c), cell, [24, 47]);

    expect(result.memberCount).toBe(2); // both resolve and reach the range
    expect(result.climbableCount).toBe(1); // only the always-dry member; the wet-by-day member clears only at night
    expect(result.fraction).toBeCloseTo(0.5);
  });

  it('returns zero members when nothing in the response resolves', () => {
    const c = crag('portland-cuttings');
    const result = runEnsembleForCrag(c, toModelConfig(c), { time: [], members: {} }, [0, 23]);
    expect(result.memberCount).toBe(0);
    expect(result.fraction).toBe(0);
  });
});

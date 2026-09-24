import { describe, expect, it } from 'vitest';
import type { EnsembleCellForecast } from '../api/ensembleClient';
import { CRAGS } from '../data/crags';
import { toModelConfig } from './dayAggregate';
import { nearestRankPercentile, runEnsembleForCrag } from './ensemble';

// London midnight, 1 June 2024 (BST) - days are read from the timestamps (time.ts).
const START = Date.UTC(2024, 4, 31, 23) / 1000;
const DAY_KEYS = ['2024-06-01', '2024-06-02', '2024-06-03'];

function crag(id: string) {
  const found = CRAGS.find((c) => c.id === id);
  if (!found) throw new Error(`fixture crag not found: ${id}`);
  return found;
}

const daylight = (i: number) => i % 24 >= 6 && i % 24 <= 18;

/** Dry member, wet all the time, or dry with a 3mm shower ending at `wetUntilHour` each morning. */
function makeMemberVars(hours: number, opts: { dry: boolean; wetUntilHour?: number }): Record<string, number[]> {
  const showerHour = (i: number) =>
    opts.wetUntilHour != null && i % 24 >= opts.wetUntilHour - 3 && i % 24 < opts.wetUntilHour;
  const wetHour = (i: number) => !opts.dry || showerHour(i);
  return {
    precipitation: Array.from({ length: hours }, (_, i) => (!opts.dry ? 5 : showerHour(i) ? 1 : 0)),
    snow_depth: Array.from({ length: hours }, () => 0),
    temperature_2m: Array.from({ length: hours }, () => 18),
    dew_point_2m: Array.from({ length: hours }, (_, i) => (wetHour(i) ? 16 : 6)),
    vapour_pressure_deficit: Array.from({ length: hours }, (_, i) => (wetHour(i) ? 0.1 : 1.2)),
    wind_speed_10m: Array.from({ length: hours }, () => 4),
    wind_direction_10m: Array.from({ length: hours }, () => 180),
    cloud_cover: Array.from({ length: hours }, () => 10),
    visibility: Array.from({ length: hours }, () => 20000),
    shortwave_radiation: Array.from({ length: hours }, (_, i) => (daylight(i) ? 500 : 0)),
    direct_normal_irradiance: Array.from({ length: hours }, (_, i) => (daylight(i) ? 500 : 0)),
    diffuse_radiation: Array.from({ length: hours }, () => 50),
    is_day: Array.from({ length: hours }, (_, i) => (daylight(i) ? 1 : 0)),
    soil_moisture_28_to_100cm: Array.from({ length: hours }, () => 0.1),
  };
}

function cellOf(hours: number, members: Record<string, Record<string, number[]>>): EnsembleCellForecast {
  return { time: Array.from({ length: hours }, (_, i) => START + i * 3600), members };
}

describe('nearestRankPercentile', () => {
  it('is the smallest value at least that fraction of the values are at or below', () => {
    expect(nearestRankPercentile([9, 13, 11, 10, 12], 0.5)).toBe(11);
    expect(nearestRankPercentile([9, 13, 11, 10, 12], 0.8)).toBe(12);
    expect(nearestRankPercentile([7], 0.8)).toBe(7);
  });

  it('is null for no values', () => {
    expect(nearestRankPercentile([], 0.5)).toBeNull();
  });
});

describe('runEnsembleForCrag (per day)', () => {
  it('reports, for each requested day, how many members give a 3h+ dry daylight window', () => {
    const hours = 24 * 3;
    const cell = cellOf(hours, {
      member01: makeMemberVars(hours, { dry: true }),
      member02: makeMemberVars(hours, { dry: true }),
      member03: makeMemberVars(hours, { dry: false }),
      member04: makeMemberVars(hours, { dry: false }),
    });
    const c = crag('portland-cuttings');
    const result = runEnsembleForCrag(c, toModelConfig(c), cell, DAY_KEYS.slice(1, 3));

    expect(result).toHaveLength(2);
    expect(result[0].date).toEqual(new Date(2024, 5, 2));
    for (const day of result) {
      expect(day.memberCount).toBe(4);
      expect(day.usableCount).toBe(2);
      expect(day.dryByHourP50).toBe(6); // dry from the first daylight hour
      expect(day.dryByHourP80).toBe(6);
    }
  });

  it('gives dry-by times from the clock hour each usable member first has a 3h window', () => {
    const hours = 24 * 2;
    const c = crag('portland-cuttings');
    // Two dry members (window from 06:00), two with an early-morning 3mm shower
    // that keeps Portland's limestone wet inside until mid-afternoon, and one wet all day.
    const cell = cellOf(hours, {
      a: makeMemberVars(hours, { dry: true }),
      b: makeMemberVars(hours, { dry: true }),
      c: makeMemberVars(hours, { dry: true, wetUntilHour: 7 }),
      d: makeMemberVars(hours, { dry: true, wetUntilHour: 8 }),
      e: makeMemberVars(hours, { dry: false }),
    });
    const [day] = runEnsembleForCrag(c, toModelConfig(c), cell, [DAY_KEYS[1]]);
    expect(day.memberCount).toBe(5);
    expect(day.usableCount).toBe(4);
    // First-window hours are [6, 6, 14, 15]: half are dry by 06:00, 80% (rank 4 of 4) by 15:00.
    // (16 and 16 before the two-layer rock temperature, P3-16: the sunlit surface now runs
    // warmer than the air, so the showered members dry an hour or two sooner.)
    expect(day.dryByHourP50).toBe(6);
    expect(day.dryByHourP80).toBe(15);
  });

  it('counts a member as usable only in daylight, matching the score', () => {
    // A "wet by day, dry by night" member: rain every daylight hour keeps the
    // rock wet all day, a dry windy night clears it. It must NOT count as
    // usable - no one climbs at 03:00. The dry member alongside it proves
    // members can still register, so 1 of 2 isolates the daylight gate.
    const hours = 24 * 2;
    const wetByDayDryByNight = (): Record<string, number[]> => ({
      ...makeMemberVars(hours, { dry: true }),
      precipitation: Array.from({ length: hours }, (_, i) => (daylight(i) ? 2 : 0)),
      temperature_2m: Array.from({ length: hours }, () => 10),
      dew_point_2m: Array.from({ length: hours }, () => 2),
      vapour_pressure_deficit: Array.from({ length: hours }, (_, i) => (daylight(i) ? 0.3 : 1.2)),
      wind_speed_10m: Array.from({ length: hours }, (_, i) => (daylight(i) ? 3 : 8)),
      cloud_cover: Array.from({ length: hours }, () => 0),
    });
    const cell = cellOf(hours, { member01: wetByDayDryByNight(), member02: makeMemberVars(hours, { dry: true }) });
    const c = crag('slate');
    const [day] = runEnsembleForCrag(c, toModelConfig(c), cell, [DAY_KEYS[1]]);
    expect(day.memberCount).toBe(2);
    expect(day.usableCount).toBe(1);
  });

  it('still counts members whose data only starts part-way through the past days (icon_eu has no early history)', () => {
    const hours = 24 * 3;
    const lateStart = makeMemberVars(hours, { dry: true });
    // Nothing for the first day - Open-Meteo pads it with nulls.
    for (const k of ['temperature_2m', 'dew_point_2m']) {
      lateStart[k] = lateStart[k].map((v, i) => (i < 24 ? (null as unknown as number) : v));
    }
    const c = crag('portland-cuttings');
    const [day1, day2] = runEnsembleForCrag(c, toModelConfig(c), cellOf(hours, { lateStart }), DAY_KEYS.slice(0, 2));
    expect(day1.memberCount).toBe(0);
    expect(day2.memberCount).toBe(1);
    expect(day2.usableCount).toBe(1);
  });

  it('judges daylight from the sun when a member carries no is_day (it is one shared series, not per member)', () => {
    // Wet by day, dry by night, and no is_day: the old fallback treated every
    // hour as daylight, so the dry night made this member "usable".
    const hours = 24 * 2;
    const vars: Record<string, number[]> = {
      ...makeMemberVars(hours, { dry: true }),
      precipitation: Array.from({ length: hours }, (_, i) => (daylight(i) ? 2 : 0)),
      temperature_2m: Array.from({ length: hours }, () => 10),
      dew_point_2m: Array.from({ length: hours }, () => 2),
      vapour_pressure_deficit: Array.from({ length: hours }, (_, i) => (daylight(i) ? 0.3 : 1.2)),
      wind_speed_10m: Array.from({ length: hours }, (_, i) => (daylight(i) ? 3 : 8)),
      cloud_cover: Array.from({ length: hours }, () => 0),
    };
    delete vars.is_day;
    const c = crag('slate');
    const [day] = runEnsembleForCrag(c, toModelConfig(c), cellOf(hours, { m: vars }), [DAY_KEYS[1]]);
    expect(day.memberCount).toBe(1);
    expect(day.usableCount).toBe(0);
  });

  it("uses the headline's dew point for members that publish no humidity (icon_eu), and skips them without one", () => {
    const hours = 24 * 2;
    const noHumidity = makeMemberVars(hours, { dry: true });
    delete noHumidity.dew_point_2m;
    delete noHumidity.vapour_pressure_deficit;
    const cell = cellOf(hours, { m: noHumidity });
    const c = crag('portland-cuttings');

    const withShared = new Map(cell.time.map((t) => [t, 6]));
    const [day] = runEnsembleForCrag(c, toModelConfig(c), cell, [DAY_KEYS[1]], undefined, withShared);
    expect(day.memberCount).toBe(1);
    expect(day.usableCount).toBe(1);

    const [without] = runEnsembleForCrag(c, toModelConfig(c), cell, [DAY_KEYS[1]]);
    expect(without.memberCount).toBe(0);
  });

  it('leaves out members whose horizon ends before the day, and reports no members for days beyond them all', () => {
    const hours = 24 * 3;
    const short = makeMemberVars(hours, { dry: true });
    // Resolved for day 1 only - Open-Meteo pads the rest with nulls.
    short.temperature_2m = short.temperature_2m.map((v, i) => (i < 24 ? v : (null as unknown as number)));
    const cell = cellOf(hours, { long: makeMemberVars(hours, { dry: true }), short });
    const c = crag('portland-cuttings');
    const [day1, day2] = runEnsembleForCrag(c, toModelConfig(c), cell, DAY_KEYS.slice(0, 2));
    expect(day1.memberCount).toBe(2);
    expect(day2.memberCount).toBe(1);

    const [beyond] = runEnsembleForCrag(c, toModelConfig(c), cellOf(0, {}), ['2024-06-10']);
    expect(beyond.memberCount).toBe(0);
    expect(beyond.dryByHourP50).toBeNull();
  });
});

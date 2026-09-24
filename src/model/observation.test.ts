import { describe, expect, it } from 'vitest';
import type { CellForecast } from '../api/client';
import { CRAGS } from '../data/crags';
import { computeCragForecast } from './dayAggregate';
import { buildObservationSnapshot } from './observation';

// London midnight on 1 June 2024 (BST), two days of hourly data.
const START = Date.UTC(2024, 4, 31, 23) / 1000;
const HOURS = 48;

function makeCell(): CellForecast {
  const time = Array.from({ length: HOURS }, (_, i) => START + i * 3600);
  const hod = (i: number) => i % 24;
  const isDay = (i: number) => (hod(i) >= 6 && hod(i) <= 18 ? 1 : 0);
  const vars = {
    precipitation: time.map((_, i) => (i === 30 ? 2 : 0)),
    snow_depth: time.map(() => 0),
    temperature_2m: time.map((_, i) => 10 + i * 0.1), // distinct per hour, so the right one is identifiable
    dew_point_2m: time.map(() => 6),
    vapour_pressure_deficit: time.map(() => 0.6),
    wind_speed_10m: time.map(() => 3),
    wind_direction_10m: time.map(() => 200),
    cloud_cover: time.map(() => 30),
    visibility: time.map(() => 20000),
    shortwave_radiation: time.map((_, i) => (isDay(i) ? 300 : 0)),
    direct_normal_irradiance: time.map((_, i) => (isDay(i) ? 300 : 0)),
    diffuse_radiation: time.map(() => 50),
    is_day: time.map((_, i) => isDay(i)),
  };
  return {
    time,
    dailyTime: [],
    dailySunrise: [],
    dailySunset: [],
    dailyPrecipSum: [],
    models: { ukmo_seamless: vars, ecmwf_ifs025: {}, icon_seamless: {}, gfs_seamless: {} },
  };
}

describe('buildObservationSnapshot (§8.1)', () => {
  const crag = CRAGS.find((c) => c.id === 'portland-cuttings')!;
  const forecast = computeCragForecast(crag, makeCell(), 0)!;

  it("returns the model's values for the hour containing the observation", () => {
    const idx = 33; // 09:00 on day 2, three hours after 2mm of rain at hour 30
    const snapshot = buildObservationSnapshot(crag, forecast, START + idx * 3600 + 20 * 60)!; // 09:20
    expect(snapshot).not.toBeNull();
    expect(snapshot.tempC).toBeCloseTo(10 + idx * 0.1);
    expect(snapshot.S).toBe(forecast.hourly[idx].S);
    expect(snapshot.M).toBe(forecast.hourly[idx].M);
    expect(snapshot.Trock).toBe(forecast.hourly[idx].Trock);
    expect(snapshot.climbable).toBe(forecast.hourly[idx].climbable);
    expect(snapshot.Mmax).toBe(crag.Mmax);
    expect(snapshot.precipLast24hMm).toBeCloseTo(2);
    expect(snapshot.dayScore).toBe(forecast.days[1].score);
    expect(snapshot.sourceModel).toBe('ukmo_seamless');
    expect(snapshot.frictionHourScore).toBeGreaterThanOrEqual(0);
  });

  it('returns null outside the series', () => {
    expect(buildObservationSnapshot(crag, forecast, START - 60)).toBeNull();
    expect(buildObservationSnapshot(crag, forecast, START + HOURS * 3600 + 60)).toBeNull();
  });
});

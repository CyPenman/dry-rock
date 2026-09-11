import { describe, expect, it } from 'vitest';
import type { CellForecast } from '../api/client';
import { CRAGS } from '../data/crags';
import { computeCragForecast } from './dayAggregate';

const LOCAL_MIDNIGHT_UNIX = Date.UTC(2024, 5, 1, 0, 0, 0) / 1000; // 2024-06-01 00:00 UTC, treated as day 0

function makeCellForecast(hours: number, opts: { withGfs?: boolean } = {}): CellForecast {
  const time = Array.from({ length: hours }, (_, i) => LOCAL_MIDNIGHT_UNIX + i * 3600);
  const hourOfDay = (i: number) => i % 24;
  const isDay = (i: number) => (hourOfDay(i) >= 6 && hourOfDay(i) <= 18 ? 1 : 0);
  const gti = (i: number) => (isDay(i) ? 600 * Math.sin((Math.PI * (hourOfDay(i) - 6)) / 12) : 0);

  const ukmoVars = {
    precipitation: time.map(() => 0),
    snow_depth: time.map(() => 0),
    temperature_2m: time.map((_, i) => 16 + 4 * Math.sin((Math.PI * (hourOfDay(i) - 6)) / 12)),
    dew_point_2m: time.map(() => 8),
    vapour_pressure_deficit: time.map(() => 0.8),
    wind_speed_10m: time.map(() => 4),
    wind_direction_10m: time.map(() => 180),
    cloud_cover: time.map(() => 10),
    visibility: time.map(() => 20000),
    shortwave_radiation: time.map((_, i) => gti(i)),
    direct_normal_irradiance: time.map((_, i) => gti(i)),
    diffuse_radiation: time.map(() => 50),
    is_day: time.map((_, i) => isDay(i)),
    soil_moisture_28_to_100cm: time.map(() => 0.15),
  };

  const models: CellForecast['models'] = {
    ukmo_seamless: ukmoVars,
    ecmwf_ifs025: {},
    icon_seamless: {},
    gfs_seamless: opts.withGfs ? ukmoVars : {},
  };

  return {
    time,
    dailyTime: [],
    dailySunrise: [],
    dailySunset: [],
    dailyPrecipSum: [],
    models,
  };
}

function crag(id: string) {
  const found = CRAGS.find((c) => c.id === id);
  if (!found) throw new Error(`fixture crag not found: ${id}`);
  return found;
}

describe('computeCragForecast', () => {
  it('produces one day result per 24h chunk, scored under dry sunny conditions', () => {
    const cell = makeCellForecast(24 * 3);
    const result = computeCragForecast(crag('portland-cuttings'), cell);

    expect(result).not.toBeNull();
    expect(result!.primaryModel).toBe('ukmo_seamless');
    expect(result!.days).toHaveLength(3);
    for (const day of result!.days) {
      expect(day.verdict).toBe('scored');
      expect(day.score).toBeGreaterThan(0);
    }
  });

  it('reports partial confidence when only some models resolved', () => {
    const cell = makeCellForecast(24 * 2, { withGfs: true });
    const result = computeCragForecast(crag('portland-cuttings'), cell);

    expect(result!.availableModels.sort()).toEqual(['gfs_seamless', 'ukmo_seamless'].sort());
    for (const day of result!.days) {
      expect(day.confidence.total).toBe(2);
      expect(day.confidence.agreeCount).toBeGreaterThan(0);
    }
  });

  it('returns null when no model resolved any usable data', () => {
    const empty: CellForecast = {
      time: [],
      dailyTime: [],
      dailySunrise: [],
      dailySunset: [],
      dailyPrecipSum: [],
      models: { ukmo_seamless: {}, ecmwf_ifs025: {}, icon_seamless: {}, gfs_seamless: {} },
    };
    expect(computeCragForecast(crag('portland-cuttings'), empty)).toBeNull();
  });

  it('flags a snowed-under day rather than scoring it', () => {
    const cell = makeCellForecast(24);
    cell.models.ukmo_seamless.snow_depth = cell.time.map(() => 0.1);
    const result = computeCragForecast(crag('stanage'), cell);
    expect(result!.days[0].verdict).toBe('under_snow');
    expect(result!.days[0].score).toBe(0);
  });

  it('reports showerDominance near 1 when precipitation was entirely convective (§4.10)', () => {
    const cell = makeCellForecast(24);
    cell.models.ukmo_seamless.precipitation = cell.time.map(() => 1);
    cell.models.ukmo_seamless.showers = cell.time.map(() => 1);
    const result = computeCragForecast(crag('portland-cuttings'), cell);
    expect(result!.days[0].showerDominance).toBeCloseTo(1);
  });

  it('reports showerDominance 0 when there is no precipitation, or when it was entirely frontal', () => {
    const dry = makeCellForecast(24);
    const dryResult = computeCragForecast(crag('portland-cuttings'), dry);
    expect(dryResult!.days[0].showerDominance).toBe(0);

    const frontal = makeCellForecast(24);
    frontal.models.ukmo_seamless.precipitation = frontal.time.map(() => 1);
    frontal.models.ukmo_seamless.showers = frontal.time.map(() => 0);
    const frontalResult = computeCragForecast(crag('portland-cuttings'), frontal);
    expect(frontalResult!.days[0].showerDominance).toBe(0);
  });

  it('populates bestContiguousClimbableHours, no larger than the total climbable hours', () => {
    const cell = makeCellForecast(24 * 2);
    const result = computeCragForecast(crag('portland-cuttings'), cell);
    for (const day of result!.days) {
      expect(day.bestContiguousClimbableHours).toBeLessThanOrEqual(day.climbableDaylightHours);
      expect(day.bestContiguousClimbableHours).toBeGreaterThanOrEqual(0);
    }
  });

  it('matches displayScore to score under full model agreement, and populates worstDaylightWindChillC', () => {
    const cell = makeCellForecast(24 * 3);
    const result = computeCragForecast(crag('portland-cuttings'), cell);
    for (const day of result!.days) {
      expect(day.displayScore).toBeCloseTo(day.score);
      expect(day.worstDaylightWindChillC).not.toBeNull();
    }
  });

  it('reports 0 friction for a day that never dries out, even though daylight hours alone would score well', () => {
    // Steady rain all day keeps the rock permanently wet, so it never becomes
    // climbable - the friction block search is gated on climbable AND
    // daylight (not daylight alone), so it must find nothing to average here.
    // Before the overlap-aware fix, this would have reported a non-zero
    // friction score from a window that was never actually climbable.
    const cell = makeCellForecast(24);
    cell.models.ukmo_seamless.precipitation = cell.time.map(() => 5);
    const result = computeCragForecast(crag('portland-cuttings'), cell);
    const day = result!.days[0];
    expect(day.bestContiguousClimbableHours).toBe(0);
    expect(day.bestFrictionBlockScore).toBe(0);
  });
});

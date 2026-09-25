import { describe, expect, it } from 'vitest';
import type { CellForecast } from '../api/client';
import { CRAGS } from '../data/crags';
import { buildHourlyInputsForModel } from './buildInputs';
import { SOIL_MOISTURE_CALIBRATION } from '../data/soilMoistureCalibration';
import {
  buildSharedSoilMoisture,
  computeCragForecast,
  daylightRainChancePct,
  daylightWeatherSummary,
  soilMoistureCalibrationFor,
  toModelConfig,
} from './dayAggregate';
import { scoreBand } from './scoreBand';
import { DEFAULT_SM_CALIBRATION } from './seepage';
import { isDaylight } from './solar';
import { hourOfDayLondon } from './time';
import type { CragHourlyInput } from './wetness';

// 2024-06-01 00:00 in London (BST, so 2024-05-31 23:00 UTC) - day 0. Days are
// read from the timestamps in Europe/London (time.ts), so this must be a real
// London midnight for `i % 24` to be the clock hour in the fixtures below.
const LOCAL_MIDNIGHT_UNIX = Date.UTC(2024, 4, 31, 23, 0, 0) / 1000;

interface CellWeather {
  tempC?: number;
  dewPointC?: number;
  vpdKpa?: number;
  cloudCoverPct?: number;
}

function makeCellForecast(hours: number, opts: { withGfs?: boolean; weather?: CellWeather } = {}): CellForecast {
  const w = opts.weather ?? {};
  const time = Array.from({ length: hours }, (_, i) => LOCAL_MIDNIGHT_UNIX + i * 3600);
  const hourOfDay = (i: number) => i % 24;
  const isDay = (i: number) => (hourOfDay(i) >= 6 && hourOfDay(i) <= 18 ? 1 : 0);
  const gti = (i: number) => (isDay(i) ? 600 * Math.sin((Math.PI * (hourOfDay(i) - 6)) / 12) : 0);

  const ukmoVars = {
    precipitation: time.map(() => 0),
    snow_depth: time.map(() => 0),
    temperature_2m: time.map((_, i) => w.tempC ?? 16 + 4 * Math.sin((Math.PI * (hourOfDay(i) - 6)) / 12)),
    dew_point_2m: time.map(() => w.dewPointC ?? 8),
    vapour_pressure_deficit: time.map(() => w.vpdKpa ?? 0.8),
    wind_speed_10m: time.map(() => 4),
    wind_direction_10m: time.map(() => 180),
    cloud_cover: time.map(() => w.cloudCoverPct ?? 10),
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
    models,
  };
}

function crag(id: string) {
  const found = CRAGS.find((c) => c.id === id);
  if (!found) throw new Error(`fixture crag not found: ${id}`);
  return found;
}

describe('daylightRainChancePct (§11)', () => {
  const isDay = Array.from({ length: 24 }, (_, h) => h >= 6 && h <= 18);
  const dry = Array.from({ length: 24 }, () => 0);

  it('is the daylight maximum, not the 24-hour mean: 4 daylight hours at 60% and the rest 0 gives 60', () => {
    const probs = Array.from({ length: 24 }, (_, h) => (h >= 10 && h < 14 ? 60 : 0));
    expect(daylightRainChancePct(probs, dry, isDay)).toBe(60);
  });

  it('ignores night-time hours', () => {
    const probs = Array.from({ length: 24 }, (_, h) => (h < 5 ? 90 : 10));
    expect(daylightRainChancePct(probs, dry, isDay)).toBe(10);
  });

  it('falls back to 100 when no model publishes a probability but a daylight hour has 0.5mm', () => {
    const probs = Array.from({ length: 24 }, () => null);
    const precip = Array.from({ length: 24 }, (_, h) => (h === 12 ? 0.6 : 0));
    expect(daylightRainChancePct(probs, precip, isDay)).toBe(100);
  });

  it('otherwise falls back to the share of daylight hours with measurable rain', () => {
    const probs = Array.from({ length: 24 }, () => null);
    const precip = Array.from({ length: 24 }, (_, h) => (h >= 6 && h < 9 ? 0.2 : 0)); // 3 of 13 daylight hours
    expect(daylightRainChancePct(probs, precip, isDay)).toBe(23);
  });
});

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

  it('matches displayScore to score when all four models agree, and populates worstDaylightWindChillC', () => {
    const cell = makeCellForecast(24 * 3);
    const ukmo = cell.models.ukmo_seamless;
    cell.models = { ukmo_seamless: ukmo, ecmwf_ifs025: ukmo, icon_seamless: ukmo, gfs_seamless: ukmo };
    const result = computeCragForecast(crag('portland-cuttings'), cell);
    for (const day of result!.days) {
      expect(day.confidence).toEqual({ agreeCount: 4, total: 4, fraction: 1 });
      expect(day.displayScore).toBeCloseTo(day.score);
      expect(day.worstDaylightWindChillC).not.toBeNull();
    }
  });

  it('trims a day only one model reaches as low confidence, however well it agrees with itself (§4.10)', () => {
    const result = computeCragForecast(crag('portland-cuttings'), makeCellForecast(24 * 3))!;
    for (const day of result.days) {
      expect(day.confidence.total).toBe(1);
      expect(day.displayScore).toBeCloseTo(day.score * 0.85);
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
    expect(day.frictionWindowStartHour).toBeNull();
  });

  it('excludes a model with no data for a far-out day from the confidence denominator (H1/§11)', () => {
    // ukmo resolves all three days; a second model runs out of horizon after
    // day 0. For days 1-2 that model has NO data, which must drop the
    // denominator to 1 rather than count the absent model as a disagreeing
    // "no" - the latter understates confidence and can demote a good day.
    const cell = makeCellForecast(24 * 3);
    const oneDay = (arr: number[]) => arr.slice(0, 24);
    cell.models.gfs_seamless = Object.fromEntries(
      Object.entries(cell.models.ukmo_seamless).map(([k, v]) => [k, oneDay(v)]),
    ) as Record<string, number[]>;

    const result = computeCragForecast(crag('portland-cuttings'), cell)!;
    expect(result.availableModels.sort()).toEqual(['gfs_seamless', 'ukmo_seamless'].sort());
    expect(result.days).toHaveLength(3);
    expect(result.days[0].confidence.total).toBe(2); // both models reach day 0
    expect(result.days[1].confidence.total).toBe(1); // only ukmo reaches day 1
    expect(result.days[2].confidence.total).toBe(1);
  });

  it('counts model agreement on the daylight definition of climbable, matching the score (M2)', () => {
    // Rain every daylight hour keeps the rock wet all day; a dry, windy night
    // clears it. So the crag is climbable only at night, never in daylight.
    // The score counts zero climbable daylight hours - and confidence must use
    // the same definition, reporting 0 agreeing models, not 1 on the strength
    // of an 03:00 clearing no climber would ever use.
    const cell = makeCellForecast(24);
    const slate = crag('slate');
    const daylight = (i: number) => isDaylight(cell.time[i], slate.lat, slate.lon);
    cell.models.ukmo_seamless.precipitation = cell.time.map((_, i) => (daylight(i) ? 2 : 0));
    cell.models.ukmo_seamless.wind_speed_10m = cell.time.map((_, i) => (daylight(i) ? 3 : 8));
    cell.models.ukmo_seamless.vapour_pressure_deficit = cell.time.map((_, i) => (daylight(i) ? 0.3 : 1.2));
    cell.models.ukmo_seamless.temperature_2m = cell.time.map(() => 10);
    cell.models.ukmo_seamless.dew_point_2m = cell.time.map(() => 2);
    cell.models.ukmo_seamless.cloud_cover = cell.time.map(() => 0);

    const result = computeCragForecast(crag('slate'), cell)!;
    const day = result.days[0];

    expect(day.climbableDaylightHours).toBe(0); // no daylight hour is dry
    const someNightHourClimbable = result.hourly.some((r, i) => !daylight(i) && r.climbable);
    expect(someNightHourClimbable).toBe(true); // but it does clear overnight
    // Confidence is agreement on the score band (P2-12): the one model with
    // data puts this no-dry-daylight day in the poor band, and agrees with itself.
    expect(day.score).toBeLessThan(0.45);
    expect(day.confidence.total).toBe(1);
    expect(day.confidence.agreeCount).toBe(1);
  });

  it('chooses the headline model per day by lead time, not once per crag (§3.3)', () => {
    // UKMO resolves 5 days, ECMWF 14, GFS all 16. Today is day 2, so days up to
    // 4 are short range (UKMO first), then ECMWF while it lasts, then GFS.
    const cell = makeCellForecast(24 * 16);
    const base = cell.models.ukmo_seamless;
    const resolvedFor = (days: number) =>
      Object.fromEntries(
        Object.entries(base).map(([k, v]) => [k, v.map((x, i) => (i < days * 24 ? x : (null as unknown as number)))]),
      ) as Record<string, number[]>;
    cell.models.ukmo_seamless = resolvedFor(5);
    cell.models.ecmwf_ifs025 = resolvedFor(14);
    cell.models.gfs_seamless = resolvedFor(16);

    const todayIndex = 2;
    const result = computeCragForecast(crag('portland-cuttings'), cell, todayIndex)!;

    expect(result.days).toHaveLength(16);
    expect(result.modelByDay).toHaveLength(16);
    expect(result.modelByDay[todayIndex]).toBe('ukmo_seamless');
    expect(result.modelByDay[todayIndex + 2]).toBe('ukmo_seamless');
    expect(result.modelByDay[todayIndex + 3]).toBe('ecmwf_ifs025');
    expect(result.modelByDay[15]).toBe('gfs_seamless');
    expect(result.days[todayIndex].sourceModel).toBe('ukmo_seamless');
    expect(result.days[todayIndex + 3].sourceModel).toBe('ecmwf_ifs025');
    expect(result.days[15].sourceModel).toBe('gfs_seamless');
    expect(result.primaryModel).toBe('ukmo_seamless');
    expect(result.hourly.length).toBe(result.days.length * 24);
    expect(result.inputs.length).toBe(result.days.length * 24);
  });

  it('feeds every model the same deep soil-moisture series, taken from ECMWF (§4.5)', () => {
    // Only ECMWF publishes soil moisture, and only for the first two days; UKMO
    // and GFS publish none. Every model must still see a real, held value.
    const cell = makeCellForecast(24 * 3, { withGfs: true });
    const { soil_moisture_28_to_100cm: _omit, ...noSoil } = cell.models.ukmo_seamless;
    cell.models.ukmo_seamless = noSoil;
    cell.models.gfs_seamless = noSoil;
    cell.models.ecmwf_ifs025 = {
      ...noSoil,
      soil_moisture_28_to_100cm: cell.time.map((_, i) => (i < 48 ? 0.25 : (null as unknown as number))),
    };

    const c = crag('portland-cuttings');
    const result = computeCragForecast(c, cell)!;
    expect(result.soilMoistureSource).toBe('ecmwf_ifs025');
    expect(result.availableModels.sort()).toEqual(['ecmwf_ifs025', 'gfs_seamless', 'ukmo_seamless'].sort());

    const shared = buildSharedSoilMoisture(cell)!;
    expect(shared.source).toBe('ecmwf_ifs025');
    for (const model of result.availableModels) {
      const inputs = buildHourlyInputsForModel(c, cell, model, shared.series)!;
      expect(inputs.every((i) => i.soilMoistureDeep != null)).toBe(true);
      expect(inputs[inputs.length - 1].soilMoistureDeep).toBe(0.25); // held past ECMWF's last real value
    }
    expect(result.inputs.every((i) => i.soilMoistureDeep != null)).toBe(true);
  });

  it('calibrates seepage against the source model climatology, else the default (§3.5)', () => {
    const c = crag('wyndcliffe');
    const ecmwf = SOIL_MOISTURE_CALIBRATION[c.id]?.ecmwf_ifs025;
    expect(ecmwf).toBeDefined();
    expect(toModelConfig(c, 'ecmwf_ifs025').smCalibration).toEqual(ecmwf);
    const icon = SOIL_MOISTURE_CALIBRATION[c.id]?.icon_seamless;
    if (icon) expect(toModelConfig(c, 'icon_seamless').smCalibration).toEqual(icon);

    // No source, a model with no soil moisture, or an unknown crag: the default.
    expect(toModelConfig(c, null).smCalibration).toEqual(DEFAULT_SM_CALIBRATION);
    expect(toModelConfig(c, 'gfs_seamless').smCalibration).toEqual(DEFAULT_SM_CALIBRATION);
    expect(toModelConfig({ ...c, id: 'not-a-crag' }, 'ecmwf_ifs025').smCalibration).toEqual(DEFAULT_SM_CALIBRATION);
    expect(soilMoistureCalibrationFor('not-a-crag', 'ecmwf_ifs025')).toBeNull();
    // A degenerate (sea-point) range is ignored rather than used. No crag has one now that
    // Cheyne Weares sits on land (§5.4), so a temporary entry stands in for one.
    SOIL_MOISTURE_CALIBRATION['sea-point'] = { icon_seamless: { p5: 0, p95: 0 } };
    try {
      expect(soilMoistureCalibrationFor('sea-point', 'icon_seamless')).toBeNull();
    } finally {
      delete SOIL_MOISTURE_CALIBRATION['sea-point'];
    }
  });

  it('slices days on local dates and labels hours from timestamps across the October clock change (§3.1)', () => {
    // London midnight 25 Oct 2026 (BST) for 3 local days: 25 + 24 + 24 hours.
    const start = Date.UTC(2026, 9, 24, 23) / 1000;
    const cell = makeCellForecast(73);
    cell.time = cell.time.map((_, i) => start + i * 3600);
    const clock = cell.time.map((t) => hourOfDayLondon(t));
    const day = (h: number) => (h >= 6 && h <= 17 ? 1 : 0);
    const vars = cell.models.ukmo_seamless;
    vars.shortwave_radiation = clock.map((h) => (day(h) ? 400 : 0));
    vars.direct_normal_irradiance = clock.map((h) => (day(h) ? 400 : 0));

    const c = crag('portland-cuttings');
    const result = computeCragForecast(c, cell, 0)!;
    expect(result.days.map((d) => d.dayEndIdx - d.dayStartIdx + 1)).toEqual([25, 24, 24]);
    expect(result.days[1].dayStartIdx).toBe(25);
    expect(result.hourly).toHaveLength(73);
    // Daylight comes from the sun (isDaylight). On the 25-hour day, 01:00 comes
    // twice, so the first daylight hour sits one array position after its clock
    // hour - and the label must be the clock hour.
    const lit = (d: number) => {
      const { dayStartIdx, dayEndIdx } = result.days[d];
      const idx = [];
      for (let i = dayStartIdx; i <= dayEndIdx; i++) if (isDaylight(cell.time[i], c.lat, c.lon)) idx.push(i);
      return idx;
    };
    const first0 = lit(0)[0];
    expect(first0 - result.days[0].dayStartIdx).toBe(clock[first0] + 1);
    expect(result.days[0].bestWindowStartHour).toBe(clock[first0]);
    expect(result.days[0].lastDaylightHour).toBe(clock[lit(0).at(-1)!]);
    expect(result.days[1].bestWindowStartHour).toBe(clock[lit(1)[0]]);
  });

  it('counts agreement by score band, and reports every model score and their range (§4.10)', () => {
    // UKMO dry all day; GFS identical but with rain from 06:00 to 12:00, so
    // its day scores lower and lands in a different band.
    const cell = makeCellForecast(24, { withGfs: true });
    cell.models.gfs_seamless = {
      ...cell.models.ukmo_seamless,
      precipitation: cell.time.map((_, i) => (i % 24 >= 6 && i % 24 < 12 ? 2 : 0)),
    };
    const result = computeCragForecast(crag('portland-cuttings'), cell, 0)!;
    const day = result.days[0];
    const ukmo = result.perModelDays.ukmo_seamless![0].score;
    const gfs = result.perModelDays.gfs_seamless![0].score;
    expect(day.sourceModel).toBe('ukmo_seamless');
    expect(day.modelScores.map((s) => s.model).sort()).toEqual(['gfs_seamless', 'ukmo_seamless']);
    expect(day.modelScoreRange).toEqual({ min: Math.min(ukmo, gfs), max: Math.max(ukmo, gfs) });
    const sameBand = scoreBand(ukmo * 100) === scoreBand(gfs * 100);
    expect(day.confidence.total).toBe(2);
    expect(day.confidence.agreeCount).toBe(sameBand ? 2 : 1);
    expect(sameBand).toBe(false); // the fixture is meant to split the bands
  });

  it('reports the clock hour the friction score is drawn from on a normal dry day', () => {
    const cell = makeCellForecast(24);
    const result = computeCragForecast(crag('portland-cuttings'), cell);
    const day = result!.days[0];
    expect(day.bestContiguousClimbableHours).toBeGreaterThan(0);
    expect(day.frictionWindowStartHour).not.toBeNull();
    expect(day.frictionWindowStartHour).toBeGreaterThanOrEqual(0);
    expect(day.frictionWindowStartHour).toBeLessThan(24);
  });

  it('names humidity as the reason on a muggy dry day, and nothing on an ideal one (§1)', () => {
    // Overcast so the rock never dips to the dew point overnight - dry, but greasy.
    const humid = makeCellForecast(24, { weather: { tempC: 16, dewPointC: 13.5, vpdKpa: 0.3, cloudCoverPct: 100 } });
    const humidDay = computeCragForecast(crag('cheddar-shade'), humid)!.days[0];
    expect(humidDay.frictionWindowStartHour).not.toBeNull();
    expect(humidDay.frictionReason).toBe('humid');

    const ideal = makeCellForecast(24, { weather: { tempC: 12, dewPointC: 3, vpdKpa: 0.9, cloudCoverPct: 100 } });
    const idealDay = computeCragForecast(crag('cheddar-shade'), ideal)!.days[0];
    expect(idealDay.frictionWindowStartHour).not.toBeNull();
    expect(idealDay.frictionReason).toBeNull();
  });

  it("ends the soft-rock freeze-thaw window at the day's last daylight hour, so an evening frost rules out the next day (§5.5)", () => {
    // December (dark by about 16:00): mild and dry, then a hard frost from 18:00
    // on day 2 to 09:00 on day 3 - after that day's last daylight hour.
    const harrisons = crag('harrisons');
    const cell = makeCellForecast(24 * 4, { weather: { dewPointC: -16, cloudCoverPct: 0 } });
    cell.time = cell.time.map((_, i) => Date.UTC(2026, 11, 1) / 1000 + i * 3600); // London midnight, GMT
    const lit = cell.time.map((t) => isDaylight(t, harrisons.lat, harrisons.lon));
    const vars = cell.models.ukmo_seamless;
    vars.shortwave_radiation = vars.direct_normal_irradiance = cell.time.map((_, i) => (lit[i] ? 200 : 0));
    vars.diffuse_radiation = cell.time.map((_, i) => (lit[i] ? 50 : 0));
    const frost = (i: number) => i >= 2 * 24 + 18 && i < 3 * 24 + 9;
    vars.temperature_2m = cell.time.map((_, i) => (frost(i) ? -12 : 12));
    const result = computeCragForecast(harrisons, cell, 0)!;
    expect(lit.slice(2 * 24 + 18, 3 * 24).some(Boolean)).toBe(false); // the frost starts after dark
    expect(result.hourly[2 * 24 + 23].Trock).toBeLessThan(0); // the rock froze that evening
    expect(result.days[2].verdict).not.toBe('rock_damage');
    expect(result.days[3].verdict).toBe('rock_damage');
  });
});

describe('daylightWeatherSummary', () => {
  const hour = (tempC: number, windSpeedMs: number, windDirectionDeg: number, cloudCoverPct: number) =>
    ({ tempC, windSpeedMs, windDirectionDeg, cloudCoverPct }) as CragHourlyInput;

  it('gives daylight ranges, mean cloud, and a vector-mean wind direction (350° and 10° average to north)', () => {
    const w = daylightWeatherSummary([hour(2, 1, 180, 0), hour(9, 4, 350, 40), hour(14, 6, 10, 80)], [false, true, true]);
    expect(w!.airTempC).toEqual({ min: 9, max: 14 });
    expect(w!.windSpeedMs).toEqual({ min: 4, max: 6 });
    expect(w!.cloudCoverPct).toBe(60);
    expect(Math.min(w!.windFromDeg, 360 - w!.windFromDeg)).toBeLessThan(5);
  });

  it('is null with no daylight hours', () => {
    expect(daylightWeatherSummary([hour(2, 1, 180, 0)], [false])).toBeNull();
  });
});

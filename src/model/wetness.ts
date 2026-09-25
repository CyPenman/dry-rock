import { PAST_DAYS } from '../api/request';
import { computeAeroFlux, computeE0 } from './evaporation';
import { smoothstep } from './friction';
import { PARAMS } from './params';
import { updateRockTemperature } from './rockTemperature';
import {
  computeSeepFluxFallback,
  computeSeepFluxFromSoilMoisture,
  computeSmNorm,
  DEFAULT_SM_CALIBRATION,
  updatePrecipEwma,
  type SoilMoistureCalibration,
} from './seepage';
import type { Steepness } from './types';
import { computePface, computeRunoffAbove, updatePfaceEwma } from './waterInputs';

// §4.2 - fixed constant for the drainage-from-above EWMA; not per-crag.
const PFACE_EWMA_TAU_HOURS = 8;

export interface CragHourlyInput {
  time: number; // unixtime
  precipitationMm: number;
  /** Convective share of precipitationMm - §4.10 confidence widening. Optional so
   * existing fixtures without it still compile; treated as 0 (frontal) when absent. */
  showersMm?: number;
  snowDepthM: number;
  tempC: number;
  dewPointC: number;
  vpdKpa: number;
  windSpeedMs: number;
  windDirectionDeg: number; // meteorological convention: FROM
  cloudCoverPct: number;
  visibilityM: number;
  isDay: boolean;
  gtiFaceWm2: number; // pre-computed plane-of-array irradiance, §3.4
  soilMoistureDeep: number | null; // null when unavailable for the resolved model, §3.5
  /** Open-Meteo's own precipitation_probability, % - null for hours a model doesn't publish it (UKMO only covers part of its horizon). */
  precipProbabilityPct?: number | null;
}

export interface CragModelConfig {
  aspectDeg: number;
  steepness: Steepness;
  seepIndex: number;
  tauSeep: number; // days
  catchmentAbove: number;
  windShelter: number;
  canopyLight: number;
  tauRock: number;
  dryingRate: number;
  Smax: number;
  Mmax: number;
  infiltrationRate: number;
  /** Soft sandstone (§5.5): judged dry inside on the stricter `softRockMatrixDryFraction`. */
  softRock: boolean;
  smCalibration?: SoilMoistureCalibration;
}

export interface CragState {
  S: number;
  M: number;
  Trock: number; // rock SURFACE temperature (§4.2)
  Tbulk: number; // the slow rock mass behind the surface (§4.2)
  pfaceEwma: number;
  precipEwma: number;
}

export type LimitingFactor = 'rain' | 'seepage' | 'condensation' | 'snow' | 'frozen' | 'drying' | 'none';

export interface HourFluxes {
  rain: number;
  seepage: number;
  condensation: number;
  melt: number;
}

export interface HourResult {
  time: number;
  S: number;
  M: number;
  Trock: number;
  climbable: boolean;
  /**
   * How dry this hour counts for the score, 0-1 (`hourDryness`). 1 whenever
   * `climbable`; for rock just damp inside it fades smoothly to 0 instead of
   * dropping straight there, so a small change in drying can't flip a whole day
   * between 100 and 0. `climbable` stays the yes/no used for wording and windows.
   */
  dryness: number;
  frozen: boolean;
  underSnow: boolean;
  fluxes: HourFluxes;
  /**
   * The rest of the state at the end of the hour, beside `S`, `M` and
   * `Trock`, so a run can be continued from any hour (`stateAfter`) - the
   * ensemble starts each member from the headline's state.
   */
  Tbulk: number;
  pfaceEwma: number;
  precipEwma: number;
}

/** The simulation state at the end of an hour, to start another run from (`runSimulation`'s `initial`). */
export function stateAfter(result: HourResult): CragState {
  return {
    S: result.S,
    M: result.M,
    Trock: result.Trock,
    Tbulk: result.Tbulk,
    pfaceEwma: result.pfaceEwma,
    precipEwma: result.precipEwma,
  };
}

/**
 * How dry an hour counts for the score (§4.7, §4.9): 0 with a wet surface, snow
 * or ice; otherwise full credit below the "dry inside" line, fading smoothly to
 * none `matrixDampCreditWidth` above it. The line itself was a hard cut-off, so
 * rock at 34% full inside scored a full day and 36% scored nothing - against
 * this model's own no-cliff-edge rule. Soft sandstone keeps the hard cut-off:
 * climbing it damp damages it (§5.5), so nearly dry earns nothing.
 */
export function hourDryness(surfaceDry: boolean, matrixFraction: number, softRock: boolean): number {
  if (!surfaceDry) return 0;
  const line = softRock ? PARAMS.softRockMatrixDryFraction : PARAMS.matrixDryFraction;
  if (softRock) return matrixFraction < line ? 1 : 0;
  if (matrixFraction < line) return 1;
  return 1 - smoothstep(matrixFraction, line, line + PARAMS.matrixDampCreditWidth);
}

/**
 * Enough water to glaze the face if the rock freezes (§4.6 step 7): a surface
 * film, or the rock wet inside past the dry line. Water deep in the pores of
 * rock that reads dry can't coat the holds. The old test was `S + M` over
 * 0.05mm, which almost no crag gets under even after a dry week, so any rock
 * below 0°C read as verglas and a crisp dry grit day was ruled out.
 */
export function canGlaze(S: number, M: number, Mmax: number): boolean {
  return S >= PARAMS.S_dry || M / Mmax >= PARAMS.matrixDryFraction;
}

/**
 * Initial state for a spin-up run - spec §4.5 "free bonus": deep soil moisture at
 * the start of the run gives the initial condition for M, removing v1's arbitrary
 * fixed starting value. Falls back to a documented mid-range estimate (matching
 * v1's own fallback) when soil moisture isn't available yet.
 */
export function initialState(
  airTempC: number,
  soilMoistureDeep: number | null,
  Mmax: number,
  calibration: SoilMoistureCalibration = DEFAULT_SM_CALIBRATION,
): CragState {
  const smNorm = soilMoistureDeep != null ? computeSmNorm(soilMoistureDeep, calibration) : 0.3;
  return {
    S: 0,
    M: smNorm * Mmax,
    Trock: airTempC,
    Tbulk: airTempC,
    pfaceEwma: 0,
    precipEwma: 0,
  };
}

/** One hourly update - spec §4.6. Order matters: gains before losses, surface before matrix. */
export function stepHour(
  state: CragState,
  input: CragHourlyInput,
  config: CragModelConfig,
): { state: CragState; result: HourResult } {
  // 1. Temperature - two layers; `trock` is the surface, used for everything below
  const { Tsurface: trock, Tbulk } = updateRockTemperature({
    prevTsurface: state.Trock,
    prevTbulk: state.Tbulk,
    airTemp: input.tempC,
    // Only the sun that gets through the trees warms the rock - the same
    // `canopyLight` share the radiative drying term already uses (§4.3).
    // Wooded faces were heating as if in open sky.
    gtiFace: input.gtiFaceWm2 * config.canopyLight,
    cloudCoverPct: input.cloudCoverPct,
    isDay: input.isDay,
    windSpeedMs: input.windSpeedMs,
    tauRock: config.tauRock,
  });

  // 2. Snow gate - lying snow means "not climbable", full stop. But the water
  // balance below still runs while snow lies on the face: a snowpack thawing
  // over the rock leaves it wet, and that wetness has to accumulate in S/M so
  // the crag reads wet for hours *after* the snow finally clears rather than
  // flipping dry the instant snow_depth hits zero (§4.2). Earlier versions
  // returned here early and discarded the melt entirely, so a thawed edge read
  // bone dry - exactly the behaviour §4.2 says the model must not have.
  const underSnow = input.snowDepthM > 0.01;

  let S = state.S;
  let M = state.M;

  // Snowmelt: meaningful whenever the API still reports lying snow (however
  // thin). meltwater enters S as liquid water. Guarded on snow presence so it
  // can't spuriously add water on a sunny day with no snow at all.
  const melt = input.snowDepthM > 0 ? Math.max(0, trock) * PARAMS.meltRate : 0;
  S += melt;

  // 3. Water in from the sky. Skipped while snow covers the face: rain lands on
  // the snowpack (feeding melt, already modelled above), not the rock film, and
  // a covered face sees no wind-driven rain or condensation. Seepage is
  // groundwater-driven and continues regardless of what's on the surface.
  let pface = 0;
  let runoffAbove = 0;
  let condensation = 0;
  let pfaceEwma: number;
  if (underSnow) {
    // Let the drainage EWMA decay towards zero rather than freeze, so the crag
    // isn't hit with stale lip-drainage the hour the snow clears.
    pfaceEwma = updatePfaceEwma(state.pfaceEwma, 0, PFACE_EWMA_TAU_HOURS);
  } else {
    pface = computePface({
      precipitationMm: input.precipitationMm,
      steepness: config.steepness,
      windSpeedMs: input.windSpeedMs,
      windDirectionDeg: input.windDirectionDeg,
      aspectDeg: config.aspectDeg,
      kWDR: PARAMS.kWDR,
    });
    pfaceEwma = updatePfaceEwma(state.pfaceEwma, pface, PFACE_EWMA_TAU_HOURS);
    runoffAbove = computeRunoffAbove(config.catchmentAbove, pfaceEwma);
    S += pface + runoffAbove;

    // Dew is the negative side of the same vapour-pressure flux that dries the
    // rock (§4.3/§4.4): rock below the dew point draws water out of the air.
    condensation = Math.max(
      0,
      -computeAeroFlux({
        vpdKpa: input.vpdKpa,
        dewPointC: input.dewPointC,
        windSpeedMs: input.windSpeedMs,
        windShelter: config.windShelter,
        dryingRate: config.dryingRate,
        trockC: trock,
      }),
    );
    S += condensation;
  }

  const precipEwma = updatePrecipEwma(state.precipEwma, input.precipitationMm, config.tauSeep);
  const seepFlux =
    input.soilMoistureDeep != null
      ? computeSeepFluxFromSoilMoisture(input.soilMoistureDeep, config.seepIndex, config.smCalibration)
      : computeSeepFluxFallback(precipEwma, config.seepIndex);
  S += seepFlux;

  // 4. Infiltration - surface water soaks in, but only into space that exists
  const availableCapacity = Math.max(0, 1 - M / config.Mmax);
  const infil = Math.min(S, config.infiltrationRate * availableCapacity);
  S -= infil;
  M += infil;

  // 5. Runoff - the surface can only hold so much film before water sheets off
  if (S > config.Smax) S = config.Smax;

  // 6. Evaporation, two-stage. A snow-covered face doesn't dry, so skip it while
  // snow lies - otherwise the meltwater we just added would evaporate straight
  // back off under a snowpack, which is not physical.
  if (!underSnow) {
    const E0 = computeE0({
      gtiFaceWm2: input.gtiFaceWm2,
      vpdKpa: input.vpdKpa,
      dewPointC: input.dewPointC,
      windSpeedMs: input.windSpeedMs,
      canopyLight: config.canopyLight,
      windShelter: config.windShelter,
      dryingRate: config.dryingRate,
      trockC: trock,
      visibilityM: input.visibilityM,
      iced: trock < 0 && canGlaze(S, M, config.Mmax),
    });
    let E = E0;
    if (S > 0) {
      const dS = Math.min(S, E);
      S -= dS;
      E -= dS;
    }
    if (E > 0 && M > 0) {
      const dM = Math.min(M, E * Math.pow(M / config.Mmax, PARAMS.stageIIExp));
      M -= dM;
    }
  }

  // 7. Freeze - rock below 0°C with water that can glaze it (`canGlaze`).
  // Reported only when the face is exposed; a snowed-under day is already gated
  // by `underSnow` and shouldn't also read as verglas.
  const frozen = !underSnow && trock < 0 && canGlaze(S, M, config.Mmax);

  // 8. Climbability - never while under snow, regardless of the reservoir state.
  // Soft sandstone needs to be much drier inside (§5.5): the global 0.35 still
  // leaves about 2mm of water in a 6mm sandstone matrix, enough for holds to
  // snap or wear away.
  const matrixDryFraction = config.softRock ? PARAMS.softRockMatrixDryFraction : PARAMS.matrixDryFraction;
  const surfaceDry = !underSnow && S < PARAMS.S_dry && !frozen;
  const climbable = surfaceDry && M / config.Mmax < matrixDryFraction;
  const dryness = hourDryness(surfaceDry, M / config.Mmax, config.softRock);

  return {
    state: { S, M, Trock: trock, Tbulk, pfaceEwma, precipEwma },
    result: {
      time: input.time,
      S,
      M,
      Trock: trock,
      climbable,
      dryness,
      frozen,
      underSnow,
      fluxes: { rain: pface + runoffAbove, seepage: seepFlux, condensation, melt },
      Tbulk,
      pfaceEwma,
      precipEwma,
    },
  };
}

/**
 * Run the hourly model over `inputs`. Without `initial` the run spins up from
 * `initialState`, which is what the headline's 16 days of history are for.
 * With it, the run carries on from that state - the ensemble passes the
 * headline's state at a member's first hour, since members have only about
 * three days of history and started cold would read drier than the headline
 * after a wet spell (§3.3).
 */
export function runSimulation(inputs: CragHourlyInput[], config: CragModelConfig, initial?: CragState): HourResult[] {
  if (inputs.length === 0) return [];

  let state: CragState;
  if (initial) {
    state = initial;
  } else {
    state = initialState(inputs[0].tempC, inputs[0].soilMoistureDeep, config.Mmax, config.smCalibration);
    // Spin-up bias (§4.5 fallback): a tauSeep-day kernel starting from 0 cannot
    // fill in the PAST_DAYS of history we have, so it would under-read seepage
    // for the whole run. Start it at the mean rate over that history instead.
    const spinUpHours = Math.min(inputs.length, PAST_DAYS * 24);
    let spinUpPrecip = 0;
    for (let i = 0; i < spinUpHours; i++) spinUpPrecip += inputs[i].precipitationMm;
    state = { ...state, precipEwma: spinUpPrecip / spinUpHours };
  }
  const results: HourResult[] = [];

  for (const input of inputs) {
    const step = stepHour(state, input, config);
    state = step.state;
    results.push(step.result);
  }

  return results;
}

// --- §4.7 outputs -----------------------------------------------------------

/**
 * First hour at which `climbable` becomes true and stays true through the end
 * of the given slice (e.g. a single day, or the whole scored window).
 */
export function findDryFrom(results: HourResult[]): number | null {
  if (results.length === 0) return null;
  let start = results.length;
  for (let i = results.length - 1; i >= 0; i--) {
    if (results[i].climbable) {
      start = i;
    } else {
      break;
    }
  }
  return start < results.length ? start : null;
}

export interface ClimbableBlock {
  startIdx: number;
  endIdx: number;
  hours: number;
}

/**
 * A day's dry daylight hours, two ways. The whole-hour counts (`climbable`)
 * drive the wording - "dry from", windows, soft-rock blocks. The graded sums
 * (`dryness`, §4.7) drive the score, so rock just damp inside earns part of
 * an hour instead of none: `effectiveDryDaylightHours` is the day's total
 * dryness, `bestEffectiveRunHours` the largest total over an unbroken run of
 * daylight hours with any dryness at all. Both equal the whole-hour counts
 * whenever every hour is fully dry or fully wet.
 */
export function climbableHoursForDay(
  results: HourResult[],
  isDayFlags: boolean[],
): {
  totalClimbableDaylightHours: number;
  bestContiguousBlock: ClimbableBlock | null;
  effectiveDryDaylightHours: number;
  bestEffectiveRunHours: number;
} {
  let total = 0;
  let bestLen = 0;
  let bestStart = -1;
  let curLen = 0;
  let curStart = -1;
  let effective = 0;
  let bestRun = 0;
  let curRun = 0;

  for (let i = 0; i < results.length; i++) {
    const ok = isDayFlags[i] && results[i].climbable;
    if (ok) {
      total++;
      if (curLen === 0) curStart = i;
      curLen++;
      if (curLen > bestLen) {
        bestLen = curLen;
        bestStart = curStart;
      }
    } else {
      curLen = 0;
    }

    const d = isDayFlags[i] ? results[i].dryness : 0;
    effective += d;
    curRun = d > 0 ? curRun + d : 0;
    bestRun = Math.max(bestRun, curRun);
  }

  return {
    totalClimbableDaylightHours: total,
    bestContiguousBlock: bestLen > 0 ? { startIdx: bestStart, endIdx: bestStart + bestLen - 1, hours: bestLen } : null,
    effectiveDryDaylightHours: effective,
    bestEffectiveRunHours: bestRun,
  };
}

/** Running totals of each water source, `x[i]` the sum over hours before `i` - so any window's total is two lookups. */
export interface FluxPrefixSums {
  rain: Float64Array;
  seepage: Float64Array;
  condensation: Float64Array;
}

/**
 * `FluxPrefixSums` for a whole run. `limitingFactorAt` looks back up to 72
 * hours for every wet daylight hour; with these it doesn't re-add them each
 * time.
 */
export function fluxPrefixSums(results: HourResult[]): FluxPrefixSums {
  const n = results.length;
  const sums = { rain: new Float64Array(n + 1), seepage: new Float64Array(n + 1), condensation: new Float64Array(n + 1) };
  for (let i = 0; i < n; i++) {
    const f = results[i].fluxes;
    sums.rain[i + 1] = sums.rain[i] + f.rain;
    sums.seepage[i + 1] = sums.seepage[i] + f.seepage;
    sums.condensation[i + 1] = sums.condensation[i] + f.condensation;
  }
  return sums;
}

/**
 * Which term is keeping the crag wet at hour `idx` - spec §4.7. Snow and frozen
 * are hard states reported directly. While the surface is wet, report whichever
 * flux contributed the most water over the preceding 24 hours. Once the surface
 * has dried but the rock is still wet inside, look back 72 hours instead - the
 * water in the matrix can be days old - and report seepage or condensation if
 * one of those dominates; otherwise the rock is simply still drying out from
 * earlier rain, which is its own answer rather than "none".
 */
export function limitingFactorAt(results: HourResult[], idx: number, sums?: FluxPrefixSums): LimitingFactor {
  const r = results[idx];
  if (r.underSnow) return 'snow';
  if (r.frozen) return 'frozen';
  if (r.climbable) return 'none';

  const surfaceWet = r.S >= PARAMS.S_dry;
  const windowStart = Math.max(0, idx - (surfaceWet ? 23 : 71));
  let rain = 0;
  let seepage = 0;
  let condensation = 0;
  if (sums) {
    rain = sums.rain[idx + 1] - sums.rain[windowStart];
    seepage = sums.seepage[idx + 1] - sums.seepage[windowStart];
    condensation = sums.condensation[idx + 1] - sums.condensation[windowStart];
  } else {
    for (let i = windowStart; i <= idx; i++) {
      rain += results[i].fluxes.rain;
      seepage += results[i].fluxes.seepage;
      condensation += results[i].fluxes.condensation;
    }
  }

  const entries: [LimitingFactor, number][] = [
    ['rain', rain],
    ['seepage', seepage],
    ['condensation', condensation],
  ];
  entries.sort((a, b) => b[1] - a[1]);
  if (surfaceWet) return entries[0][1] > 0 ? entries[0][0] : 'none';
  const [top, amount] = entries[0];
  return amount > 0 && (top === 'seepage' || top === 'condensation') ? top : 'drying';
}

/**
 * The day's limiting factor (§4.7): the most common `limitingFactorAt` across
 * the daylight hours that were NOT climbable, ties going to whichever occurs
 * first. 'none' when every daylight hour was climbable. Replaces reading it at
 * 23:00, which reported nothing for a crag wet all morning and dry by evening.
 * `isDayFlags` is indexed from `dayStart`. `sums` (`fluxPrefixSums(results)`)
 * saves re-adding the look-back window for every hour.
 */
export function dayLimitingFactor(
  results: HourResult[],
  dayStart: number,
  dayEnd: number,
  isDayFlags: boolean[],
  sums?: FluxPrefixSums,
): LimitingFactor {
  const counts = new Map<LimitingFactor, number>();
  const firstSeen: LimitingFactor[] = [];
  for (let i = dayStart; i <= dayEnd; i++) {
    if (!isDayFlags[i - dayStart] || results[i].climbable) continue;
    const factor = limitingFactorAt(results, i, sums);
    if (!counts.has(factor)) firstSeen.push(factor);
    counts.set(factor, (counts.get(factor) ?? 0) + 1);
  }
  let best: LimitingFactor = 'none';
  let bestCount = 0;
  for (const factor of firstSeen) {
    const n = counts.get(factor)!;
    if (n > bestCount) {
      best = factor;
      bestCount = n;
    }
  }
  return best;
}

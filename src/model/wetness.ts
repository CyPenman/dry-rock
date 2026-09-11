import { computeCondensationFlux } from './condensation';
import { computeE0 } from './evaporation';
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
  /** Open-Meteo's own precipitation_probability, % - null for models that don't publish it (UKMO doesn't). */
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
  smCalibration?: SoilMoistureCalibration;
}

export interface CragState {
  S: number;
  M: number;
  Trock: number;
  pfaceEwma: number;
  precipEwma: number;
}

export type LimitingFactor = 'rain' | 'seepage' | 'condensation' | 'snow' | 'frozen' | 'none';

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
  frozen: boolean;
  underSnow: boolean;
  fluxes: HourFluxes;
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
  // 1. Temperature
  const trock = updateRockTemperature({
    prevTrock: state.Trock,
    airTemp: input.tempC,
    gtiFace: input.gtiFaceWm2,
    cloudCoverPct: input.cloudCoverPct,
    isDay: input.isDay,
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
    // Let the drainage EWMA decay toward zero rather than freeze, so the crag
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

    condensation = computeCondensationFlux(trock, input.dewPointC, input.windSpeedMs);
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
      windSpeedMs: input.windSpeedMs,
      canopyLight: config.canopyLight,
      windShelter: config.windShelter,
      dryingRate: config.dryingRate,
      trockC: trock,
      visibilityM: input.visibilityM,
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

  // 7. Freeze - reported only when the face is exposed; a snowed-under day is
  // already gated by `underSnow` and shouldn't also read as verglas.
  const frozen = !underSnow && trock < 0 && S + M > PARAMS.frozenWetThreshold;

  // 8. Climbability - never while under snow, regardless of the reservoir state.
  const climbable = !underSnow && S < PARAMS.S_dry && M / config.Mmax < PARAMS.matrixDryFraction && !frozen;

  return {
    state: { S, M, Trock: trock, pfaceEwma, precipEwma },
    result: {
      time: input.time,
      S,
      M,
      Trock: trock,
      climbable,
      frozen,
      underSnow,
      fluxes: { rain: pface + runoffAbove, seepage: seepFlux, condensation, melt },
    },
  };
}

export function runSimulation(inputs: CragHourlyInput[], config: CragModelConfig): HourResult[] {
  if (inputs.length === 0) return [];

  let state = initialState(inputs[0].tempC, inputs[0].soilMoistureDeep, config.Mmax, config.smCalibration);
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

export function climbableHoursForDay(
  results: HourResult[],
  isDayFlags: boolean[],
): { totalClimbableDaylightHours: number; bestContiguousBlock: ClimbableBlock | null } {
  let total = 0;
  let bestLen = 0;
  let bestStart = -1;
  let curLen = 0;
  let curStart = -1;

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
  }

  return {
    totalClimbableDaylightHours: total,
    bestContiguousBlock: bestLen > 0 ? { startIdx: bestStart, endIdx: bestStart + bestLen - 1, hours: bestLen } : null,
  };
}

/**
 * Which term is keeping the crag wet at hour `idx` - spec §4.7. Snow and frozen
 * are hard states reported directly; otherwise report whichever flux
 * contributed the most water over the preceding 24 hours.
 */
export function limitingFactorAt(results: HourResult[], idx: number): LimitingFactor {
  const r = results[idx];
  if (r.underSnow) return 'snow';
  if (r.frozen) return 'frozen';
  if (r.climbable) return 'none';

  const windowStart = Math.max(0, idx - 23);
  let rain = 0;
  let seepage = 0;
  let condensation = 0;
  for (let i = windowStart; i <= idx; i++) {
    rain += results[i].fluxes.rain;
    seepage += results[i].fluxes.seepage;
    condensation += results[i].fluxes.condensation;
  }

  const entries: [LimitingFactor, number][] = [
    ['rain', rain],
    ['seepage', seepage],
    ['condensation', condensation],
  ];
  entries.sort((a, b) => b[1] - a[1]);
  return entries[0][1] > 0 ? entries[0][0] : 'none';
}

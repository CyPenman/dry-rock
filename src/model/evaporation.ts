import { PARAMS } from './params';
import { surfaceDeficitKpa } from './vapour';

export interface EvaporationInputs {
  gtiFaceWm2: number;
  /** Air vapour pressure deficit, kPa - only used when `dewPointC` is absent (see `computeAeroFlux`). */
  vpdKpa: number;
  /** Dew point, °C. When given, the aerodynamic term runs on the rock-surface deficit instead of the air's VPD. */
  dewPointC?: number;
  windSpeedMs: number;
  canopyLight: number;
  windShelter: number;
  dryingRate: number;
  trockC: number;
  visibilityM: number;
  /**
   * The face's water is ice: rock below 0°C holding enough water to glaze it
   * (`canGlaze`, wetness.ts). Ice only sublimates, slowly. Dry rock below 0°C is
   * not iced and dries at the full rate - a cold dry northerly is exactly the
   * weather that dries a crag fastest (§4.3). Absent means not iced.
   */
  iced?: boolean;
}

/** Share of the reference drying rate that happens in dead calm - the wind function's existing floor (§4.3). */
const STILL_AIR_EXCHANGE = 0.3;

/**
 * Aerodynamic moisture flux between the rock surface and the air, mm/hr -
 * §4.3/§4.4. Positive dries the rock; negative is dew forming on it. Driven by
 * es(rock) - es(dew point) (vapour.ts), so the same equation and the same
 * constant (kAero) give both drying and condensation: at about 10°C one degree
 * of dew-point spread is about 0.082 kPa, i.e. about 0.008 mm/hr per °C, which
 * is what the separate condensation constant used to be.
 *
 * Without a dew point it falls back to the air's VPD, which can never go
 * negative - kept for callers that only have the older inputs.
 *
 * Air movement has two parts. The 0.3 is still-air exchange: the air next to
 * the rock circulates on its own (it is warmed or cooled by the rock and rises
 * or sinks), so moisture moves even in dead calm. The rest is wind-driven.
 * `windShelter` only cuts the wind-driven part - a gully, a wood or a cave
 * keeps the wind off, but not the air's own circulation. It used to multiply
 * both, which gave a cave (shelter 0.5) half the still-air drying of an open
 * crag, below what a bowl of water evaporates in a still room; with the sun
 * gone (steepness tilt, §3.4) such a face could barely dry at all.
 */
export function computeAeroFlux(inputs: Omit<EvaporationInputs, 'gtiFaceWm2' | 'canopyLight' | 'visibilityM'>): number {
  const { vpdKpa, dewPointC, windSpeedMs, windShelter, dryingRate, trockC } = inputs;
  const deficit = dewPointC != null ? surfaceDeficitKpa(trockC, dewPointC) : vpdKpa;
  const airMovement = STILL_AIR_EXCHANGE + (1 - STILL_AIR_EXCHANGE) * Math.min(windSpeedMs / PARAMS.windRef, 1.5) * windShelter;
  return PARAMS.kAero * deficit * airMovement * dryingRate;
}


/**
 * Evaporation potential - spec §4.3. A Penman-style decomposition into a
 * radiative term (zero at night) and an aerodynamic term (works in the dark and
 * cold - this is what makes a cold dry northerly dry rock fast). The aerodynamic
 * term is the drying side of `computeAeroFlux`; its negative side is dew, which
 * `stepHour` adds as condensation instead.
 */
export function computeE0(inputs: EvaporationInputs): number {
  const { gtiFaceWm2, canopyLight, dryingRate, visibilityM, iced } = inputs;

  const Erad = PARAMS.kRad * (gtiFaceWm2 / 1000);
  const Eaero = Math.max(0, computeAeroFlux(inputs));

  let E0 = Erad * canopyLight * dryingRate + Eaero;

  // Only for ice. It used to apply to any rock below 0°C, so a dry face in a
  // frost could barely dry at all.
  if (iced) E0 *= 0.05;
  if (visibilityM < 1000) E0 *= 0.2; // fog / valley inversion stops drying dead

  return Math.max(0, E0);
}

// Default model parameters - spec §4.11. Every value is an informed estimate, not a
// measurement, and is in physical units specifically so it can be argued with.
export const PARAMS = {
  // Evaporation
  kRad: 0.28, // mm/hr at 1000 W/m^2 on the face
  kAero: 0.1, // mm/hr per kPa of vapour deficit at the rock surface, at reference wind
  windRef: 8, // m/s, where the wind function saturates

  // Condensation: no constant of its own - dew is the negative side of the
  // kAero flux on the rock-surface vapour deficit (evaporation.ts, §4.4).

  // Rain geometry
  kWDR: 0.8, // wind-driven rain gain at 10 m/s, fully aligned

  // Rock temperature
  kSolar: 12, // degC above air on a fully sunlit face
  kNight: 2.5, // degC below air under clear skies
  tauSurface: 1.5, // hours - rock skin responds quickly
  kWindCoupling: 0.15, // per m/s - wind pulls the surface back towards air temperature

  // Drying law
  stageIIExp: 1.5,
  S_dry: 0.02, // mm - below this the surface reads dry
  matrixDryFraction: 0.35, // M/Mmax below which the rock feels dry
  softRockMatrixDryFraction: 0.15, // M/Mmax below which soft sandstone is safe to climb (§5.5) - stricter than matrixDryFraction
  matrixDampCreditWidth: 0.1, // M/Mmax above the dry line over which an hour's dryness credit fades from full to none - no cliff edge (§4.7). Not for soft rock.

  // Seepage
  maxSeep: 0.08, // mm/hr at full saturation, seepIndex 1.0
  seepExp: 2.0,

  // Snow
  meltRate: 0.15, // mm/hr per degC above freezing
  frozenWetThreshold: 0.05,
} as const;

export type Params = typeof PARAMS;

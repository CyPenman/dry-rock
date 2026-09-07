// Default model parameters — spec §4.11. Every value is an informed estimate, not a
// measurement, and is in physical units specifically so it can be argued with.
export const PARAMS = {
  // Evaporation
  kRad: 0.28, // mm/hr at 1000 W/m^2 on the face
  kAero: 0.1, // mm/hr per kPa VPD at reference wind
  windRef: 8, // m/s, where the wind function saturates

  // Condensation
  kCond: 0.008, // mm/hr per degC of dew point spread

  // Rain geometry
  kWDR: 0.8, // wind-driven rain gain at 10 m/s, fully aligned

  // Rock temperature
  kSolar: 12, // degC above air on a fully sunlit face
  kNight: 2.5, // degC below air under clear skies

  // Drying law
  stageIIExp: 1.5,
  S_dry: 0.02, // mm — below this the surface reads dry
  matrixDryFraction: 0.35, // M/Mmax below which the rock feels dry

  // Seepage
  maxSeep: 0.08, // mm/hr at full saturation, seepIndex 1.0
  seepExp: 2.0,

  // Snow
  meltRate: 0.15, // mm/hr per degC above freezing
  frozenWetThreshold: 0.05,

  // Windows
  WET_THRESHOLD_MM: 0.2, // per hour; below this is trace drizzle
  minWindowHours: 48, // user-adjustable 12-96
} as const;

export type Params = typeof PARAMS;

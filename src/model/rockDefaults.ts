import type { RockType, Steepness } from './types';

// §5.3 - defaults by rock type. Per-crag overrides win where a venue is atypical.
export const ROCK_DEFAULTS: Record<
  RockType,
  { Smax: number; Mmax: number; infiltrationRate: number; tauRock: number }
> = {
  slate: { Smax: 0.15, Mmax: 0.2, infiltrationRate: 0.02, tauRock: 10 },
  granite: { Smax: 0.3, Mmax: 0.5, infiltrationRate: 0.04, tauRock: 18 },
  volcanic: { Smax: 0.3, Mmax: 0.6, infiltrationRate: 0.05, tauRock: 16 },
  limestone: { Smax: 0.25, Mmax: 1.0, infiltrationRate: 0.08, tauRock: 20 },
  gritstone: { Smax: 0.45, Mmax: 2.5, infiltrationRate: 0.2, tauRock: 9 },
  sandstone: { Smax: 0.6, Mmax: 6.0, infiltrationRate: 0.4, tauRock: 8 },
};

// §5.3 - a slab catches more than falls on the horizontal; a roof/cave almost nothing.
// Used in §4.2 to compute Pgeom = precipitation * rainExposure.
export const STEEPNESS_RAIN_EXPOSURE: Record<Steepness, number> = {
  slab: 1.15,
  vertical: 1.0,
  steep: 0.55,
  roof: 0.15,
  cave: 0.05,
};

// §4.8 - friction ideal temperature bands by rock type (rock temperature, not air).
// Only rock types present in the bundled dataset are given values.
export const IDEAL_TEMP_C: Partial<Record<RockType, [number, number]>> = {
  limestone: [8, 16], // sport limestone
  gritstone: [2, 10], // gritstone bouldering
  sandstone: [5, 14],
  slate: [8, 18],
};

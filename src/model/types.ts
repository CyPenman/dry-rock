// Crag schema - spec §5.2

export type Discipline = 'sport' | 'boulder' | 'trad';
export type RockType =
  | 'limestone'
  | 'gritstone'
  | 'sandstone'
  | 'slate'
  | 'granite'
  | 'volcanic';
export type Steepness = 'slab' | 'vertical' | 'steep' | 'roof' | 'cave';

/**
 * The broader grouping the Areas tab collapses crags into (spec §6 Areas). `area`
 * stays as the finer, climber-facing label ("Llandudno") shown inside a region
 * ("North Wales"); ten of the sixteen areas held a single crag, too fine to group by.
 */
export type Region =
  | 'Peak District'
  | 'Yorkshire'
  | 'North Wales'
  | 'Wye Valley'
  | 'Bristol & Somerset'
  | 'Devon'
  | 'Dorset'
  | 'Southern Sandstone';

export interface Crag {
  id: string;
  name: string;
  area: string;
  region: Region;
  lat: number;
  lon: number;
  elevationM: number;
  disciplines: Discipline[];
  rock: RockType;

  // Geometry
  aspectDeg: number;
  steepness: Steepness;

  // Water
  seepIndex: number;
  tauSeep: number;
  catchmentAbove: number;

  // Drying environment
  windShelter: number;
  canopyLight: number;
  tauRock: number;
  dryingRate: number;

  // Resolved from rock-type defaults (§5.3), overridden per crag where atypical
  Smax: number;
  Mmax: number;
  infiltrationRate: number;

  // Character
  idealTempC: [number, number];
  coastal: boolean;
  softRock: boolean;
  notes: string;
  accessNote?: string;
  /**
   * A restriction that only applies part of the year (e.g. bird nesting), months
   * 1-12 inclusive; `fromMonth` after `toMonth` wraps over the new year. The
   * detail screen shows it as a warning only when the selected dates overlap it.
   */
  seasonalRestriction?: { fromMonth: number; toMonth: number; text: string };
  ukcUrl?: string;

  // Parking - only set where a specific car park could be confirmed from
  // the crag's approach description; otherwise omitted (see parkingNote).
  parkingLat?: number;
  parkingLon?: number;
  parkingNote?: string;
}

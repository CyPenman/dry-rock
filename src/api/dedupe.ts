import { greatCircleDistanceKm } from '../model/distance';
import type { Crag } from '../model/types';

// §3.2 - build the request from unique forecast points and map results back
// to crags, rather than one point per crag. Every crag sits on its own UKC
// location, so the only points shared are those of crags close enough to
// read the same weather.
export interface GridCell {
  key: string;
  lat: number;
  lon: number;
  elevationM: number;
  cragIds: string[];
}

/**
 * Crags this close share one forecast point (§3.2): well inside the finest
 * model's 2km grid, and near enough in height that Open-Meteo's temperature
 * correction differs by at most about 0.2°C. Today that merges The Cornice with Chee
 * Dale Upper (180m apart, 16m of height), Lower Pen Trwyn with Parisella's
 * Cave (330m, 5m), and Malham Cove's two wings (66m, 0m of height). The next
 * closest pair, Cheddar's two sides, is 950m and 120m apart, which is real
 * difference in height. Each merged point saves a location's worth of calls,
 * about 1/34 of a load (§3.6).
 */
export const SHARED_POINT_MAX_M = 500;
export const SHARED_POINT_MAX_HEIGHT_M = 30;

function roundTo3dp(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/**
 * One forecast point per group of crags within `SHARED_POINT_MAX_M` and
 * `SHARED_POINT_MAX_HEIGHT_M` of each other. A group takes the position and
 * height of its first crag in `crags` order, so the point is always on real
 * rock, never a midpoint between two crags.
 */
export function dedupeCoordinates(crags: Crag[]): {
  cells: GridCell[];
  cragToCellKey: Map<string, string>;
} {
  const cells: GridCell[] = [];
  const cragToCellKey = new Map<string, string>();

  for (const crag of crags) {
    const lat = roundTo3dp(crag.lat);
    const lon = roundTo3dp(crag.lon);
    const shared = cells.find(
      (cell) =>
        greatCircleDistanceKm(cell.lat, cell.lon, lat, lon) * 1000 <= SHARED_POINT_MAX_M &&
        Math.abs(cell.elevationM - crag.elevationM) <= SHARED_POINT_MAX_HEIGHT_M,
    );
    if (shared) {
      shared.cragIds.push(crag.id);
      cragToCellKey.set(crag.id, shared.key);
    } else {
      const key = `${lat},${lon}`;
      cells.push({ key, lat, lon, elevationM: crag.elevationM, cragIds: [crag.id] });
      cragToCellKey.set(crag.id, key);
    }
  }

  return { cells, cragToCellKey };
}

/** For each crag that shares its forecast point, the other crags on it (§3.2 UI note). */
export function sharedPointPartners(crags: Crag[]): Map<string, string[]> {
  const partners = new Map<string, string[]>();
  for (const cell of dedupeCoordinates(crags).cells) {
    if (cell.cragIds.length < 2) continue;
    for (const id of cell.cragIds) partners.set(id, cell.cragIds.filter((other) => other !== id));
  }
  return partners;
}

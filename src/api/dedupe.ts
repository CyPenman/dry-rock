import type { Crag } from '../model/types';

// §3.2 - several crags share a forecast grid cell (e.g. LPT and Parisella's are
// ~15m apart). Build the request from unique rounded coordinates and map results
// back to crags, rather than one request per crag.
export interface GridCell {
  key: string;
  lat: number;
  lon: number;
  elevationM: number;
  cragIds: string[];
}

function roundTo3dp(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export function dedupeCoordinates(crags: Crag[]): {
  cells: GridCell[];
  cragToCellKey: Map<string, string>;
} {
  const cellMap = new Map<string, GridCell>();
  const cragToCellKey = new Map<string, string>();

  for (const crag of crags) {
    const lat = roundTo3dp(crag.lat);
    const lon = roundTo3dp(crag.lon);
    const key = `${lat},${lon}`;
    cragToCellKey.set(crag.id, key);

    const existing = cellMap.get(key);
    if (existing) {
      existing.cragIds.push(crag.id);
    } else {
      cellMap.set(key, { key, lat, lon, elevationM: crag.elevationM, cragIds: [crag.id] });
    }
  }

  return { cells: [...cellMap.values()], cragToCellKey };
}

/** Crags whose dedup key is shared with at least one other crag (§3.2 UI disclosure). */
export function sharedCellCragIds(crags: Crag[]): Set<string> {
  const { cells } = dedupeCoordinates(crags);
  const shared = new Set<string>();
  for (const cell of cells) {
    if (cell.cragIds.length > 1) {
      for (const id of cell.cragIds) shared.add(id);
    }
  }
  return shared;
}

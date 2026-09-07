import { describe, expect, it } from 'vitest';
import type { Crag } from '../model/types';
import { dedupeCoordinates, sharedCellCragIds } from './dedupe';

function makeCrag(overrides: Partial<Crag> & Pick<Crag, 'id' | 'lat' | 'lon'>): Crag {
  return {
    name: overrides.id,
    area: 'test',
    elevationM: 50,
    disciplines: ['sport'],
    rock: 'limestone',
    aspectDeg: 180,
    steepness: 'vertical',
    seepIndex: 0,
    tauSeep: 1,
    catchmentAbove: 0,
    windShelter: 1,
    canopyLight: 1,
    tauRock: 20,
    dryingRate: 1,
    Smax: 0.25,
    Mmax: 1,
    infiltrationRate: 0.08,
    idealTempC: [8, 16],
    coastal: false,
    softRock: false,
    notes: '',
    ...overrides,
  };
}

describe('dedupeCoordinates', () => {
  it('collapses crags whose coordinates round to the same 3dp cell', () => {
    const crags = [
      makeCrag({ id: 'a', lat: 53.33601, lon: -3.84501 }),
      makeCrag({ id: 'b', lat: 53.33599, lon: -3.84498 }), // rounds to the same key as a
      makeCrag({ id: 'c', lat: 51.0, lon: 0.0 }),
    ];

    const { cells, cragToCellKey } = dedupeCoordinates(crags);

    expect(cells).toHaveLength(2);
    expect(cragToCellKey.get('a')).toBe(cragToCellKey.get('b'));
    expect(cragToCellKey.get('c')).not.toBe(cragToCellKey.get('a'));
  });

  it('flags crags that share a cell so the UI can disclose it (§3.2)', () => {
    const crags = [
      makeCrag({ id: 'a', lat: 53.336, lon: -3.845 }),
      makeCrag({ id: 'b', lat: 53.336, lon: -3.845 }),
      makeCrag({ id: 'c', lat: 51.0, lon: 0.0 }),
    ];

    const shared = sharedCellCragIds(crags);
    expect(shared.has('a')).toBe(true);
    expect(shared.has('b')).toBe(true);
    expect(shared.has('c')).toBe(false);
  });
});

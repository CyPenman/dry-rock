import { describe, expect, it } from 'vitest';
import { CRAGS } from '../data/crags';
import type { Crag } from '../model/types';
import { dedupeCoordinates, sharedPointPartners } from './dedupe';

function makeCrag(overrides: Partial<Crag> & Pick<Crag, 'id' | 'lat' | 'lon'>): Crag {
  return {
    name: overrides.id,
    area: 'test',
    region: 'Peak District',
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

  it("shares a point within 500m and 30m of height, on the first crag's position (§3.2)", () => {
    const crags = [
      makeCrag({ id: 'a', lat: 53.3, lon: -1.8, elevationM: 200 }),
      makeCrag({ id: 'near', lat: 53.303, lon: -1.8, elevationM: 220 }), // ~330m north, 20m higher
      makeCrag({ id: 'higher', lat: 53.301, lon: -1.8, elevationM: 260 }), // ~110m, but 60m higher
      makeCrag({ id: 'far', lat: 53.306, lon: -1.8, elevationM: 200 }), // ~670m
    ];
    const { cells, cragToCellKey } = dedupeCoordinates(crags);
    expect(cells).toHaveLength(3);
    expect(cragToCellKey.get('near')).toBe(cragToCellKey.get('a'));
    expect(cragToCellKey.get('higher')).not.toBe(cragToCellKey.get('a'));
    expect(cragToCellKey.get('far')).not.toBe(cragToCellKey.get('a'));
    expect(cells.find((c) => c.cragIds.includes('near'))).toMatchObject({ lat: 53.3, lon: -1.8, elevationM: 200 });
  });

  it('merges exactly The Cornice with Chee Dale Upper, Lower Pen Trwyn with Parisella’s, and Malham’s two wings in the real crag list', () => {
    const { cells } = dedupeCoordinates(CRAGS);
    const shared = cells.filter((c) => c.cragIds.length > 1).map((c) => [...c.cragIds].sort());
    expect(shared).toEqual([
      ['cheedale-upper', 'cornice'],
      ['malham-left', 'malham-right'],
      ['lpt', 'parisellas'],
    ]);
    expect(cells).toHaveLength(CRAGS.length - 3);
  });

  it('lists the other crags on a shared point so the UI can say so (§3.2)', () => {
    const crags = [
      makeCrag({ id: 'a', lat: 53.336, lon: -3.845 }),
      makeCrag({ id: 'b', lat: 53.336, lon: -3.845 }),
      makeCrag({ id: 'c', lat: 51.0, lon: 0.0 }),
    ];

    const partners = sharedPointPartners(crags);
    expect(partners.get('a')).toEqual(['b']);
    expect(partners.get('b')).toEqual(['a']);
    expect(partners.has('c')).toBe(false);
  });
});

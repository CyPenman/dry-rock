import { describe, expect, it } from 'vitest';
import { estimateDriveMinutes, greatCircleDistanceKm } from './distance';

describe('estimateDriveMinutes (§6 Home row)', () => {
  it('uses the slow local speed for the first 50km and the long speed beyond', () => {
    expect(estimateDriveMinutes(0)).toBe(6);
    // 46km at 46 km/h = 60 min, plus 6.
    expect(estimateDriveMinutes(46)).toBe(66);
    // 50km at 46 km/h (65.2) + 74km at 74 km/h (60) + 6 = 131.
    expect(estimateDriveMinutes(124)).toBe(131);
  });

  it('gives a plausible Sheffield to Stanage (about 12km, ~21min by road) figure', () => {
    const km = greatCircleDistanceKm(53.381, -1.47, 53.345, -1.635);
    expect(estimateDriveMinutes(km)).toBeGreaterThan(15);
    expect(estimateDriveMinutes(km)).toBeLessThan(30);
  });

  it('no longer overstates long motorway trips (Sheffield to Symonds Yat, ~3h by road)', () => {
    const km = greatCircleDistanceKm(53.381, -1.47, 51.838, -2.641);
    expect(estimateDriveMinutes(km)).toBeGreaterThan(160);
    expect(estimateDriveMinutes(km)).toBeLessThan(200);
  });
});

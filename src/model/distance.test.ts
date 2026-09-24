import { describe, expect, it } from 'vitest';
import { estimateDriveMinutes, greatCircleDistanceKm } from './distance';

describe('estimateDriveMinutes (§6 Home row)', () => {
  it('applies the road factor, average speed and end allowance', () => {
    // 100km straight line -> 130km of road at 65 km/h = 120 min, plus 15.
    expect(estimateDriveMinutes(100)).toBe(135);
    expect(estimateDriveMinutes(0)).toBe(15);
  });

  it('gives a plausible Sheffield to Stanage (about 15km) figure', () => {
    const km = greatCircleDistanceKm(53.381, -1.47, 53.345, -1.635);
    expect(estimateDriveMinutes(km)).toBeGreaterThan(20);
    expect(estimateDriveMinutes(km)).toBeLessThan(40);
  });
});

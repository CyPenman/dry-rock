import { describe, expect, it } from 'vitest';
import { computeGtiFace, solarPosition } from './solar';

// Stanage Plantation — spec §3.4 validation venue, south-facing (aspectDeg 200 in the
// dataset, but the spec's worked example uses a due-south face, so test at 180).
const STANAGE_LAT = 53.345;
const STANAGE_LON = -1.635;
const SOUTH_ASPECT = 180;

function unixAtUtcHour(dateIso: string, utcHour: number): number {
  const d = new Date(`${dateIso}T00:00:00Z`);
  return d.getTime() / 1000 + utcHour * 3600;
}

function cosThetaForSouthFace(unixSeconds: number): number {
  const { elevationDeg, azimuthDeg } = solarPosition(unixSeconds, STANAGE_LAT, STANAGE_LON);
  if (elevationDeg <= 0) return 0;
  const elevRad = (elevationDeg * Math.PI) / 180;
  const azDiffRad = ((azimuthDeg - SOUTH_ASPECT) * Math.PI) / 180;
  return Math.max(0, Math.cos(elevRad) * Math.cos(azDiffRad));
}

describe('solarPosition', () => {
  it('reaches a much higher solar noon elevation in June than December', () => {
    // Solar noon at this longitude is close to 12:00 UTC.
    const juneNoon = solarPosition(unixAtUtcHour('2024-06-21', 12), STANAGE_LAT, STANAGE_LON);
    const decNoon = solarPosition(unixAtUtcHour('2024-12-21', 12), STANAGE_LAT, STANAGE_LON);

    expect(juneNoon.elevationDeg).toBeGreaterThan(55);
    expect(decNoon.elevationDeg).toBeGreaterThan(5);
    expect(decNoon.elevationDeg).toBeLessThan(20);
    expect(juneNoon.elevationDeg).toBeGreaterThan(decNoon.elevationDeg + 30);
  });

  it('faces roughly south at solar noon', () => {
    const noon = solarPosition(unixAtUtcHour('2024-06-21', 12), STANAGE_LAT, STANAGE_LON);
    expect(noon.azimuthDeg).toBeGreaterThan(170);
    expect(noon.azimuthDeg).toBeLessThan(190);
  });
});

describe('computeGtiFace geometry — south face at Stanage (§3.4)', () => {
  it('21 June: a south face still peaks at solar noon at this latitude (no dip)', () => {
    // The spec's §3.4 worked example describes a midday dip caused by the sun
    // passing near-overhead. At Stanage's latitude (53.3N) the summer-solstice
    // noon elevation only reaches ~60 degrees — never high enough for cos(elev)
    // to collapse faster than cos(azimuth-offset) grows — so the correct physical
    // behaviour here is a single peak at solar noon, not a dip. Verified numerically
    // against the NOAA solar position formula before writing this expectation.
    const morning = cosThetaForSouthFace(unixAtUtcHour('2024-06-21', 8));
    const noon = cosThetaForSouthFace(unixAtUtcHour('2024-06-21', 12));
    const afternoon = cosThetaForSouthFace(unixAtUtcHour('2024-06-21', 16));

    expect(noon).toBeGreaterThan(morning);
    expect(noon).toBeGreaterThan(afternoon);
  });

  it('21 December: a south face peaks flat at noon, no midday dip', () => {
    const morning = cosThetaForSouthFace(unixAtUtcHour('2024-12-21', 9));
    const noon = cosThetaForSouthFace(unixAtUtcHour('2024-12-21', 12));
    const afternoon = cosThetaForSouthFace(unixAtUtcHour('2024-12-21', 15));

    expect(noon).toBeGreaterThan(morning);
    expect(noon).toBeGreaterThan(afternoon);
  });

  it('a sunlit vertical face can exceed the horizontal (GHI) reading in winter', () => {
    // Low winter sun striking a south wall nearly face-on can deliver more energy
    // than falls on the horizontal plane — this is why south walls are winter venues.
    const { elevationDeg, azimuthDeg } = solarPosition(unixAtUtcHour('2024-12-21', 12), STANAGE_LAT, STANAGE_LON);
    const dni = 700; // clear-sky-ish direct normal irradiance, W/m^2
    const dhi = 60;
    const ghi = dni * Math.sin((elevationDeg * Math.PI) / 180) + dhi;

    const gti = computeGtiFace({ dni, dhi, ghi, elevationDeg, azimuthDeg, aspectDeg: SOUTH_ASPECT });
    expect(gti).toBeGreaterThan(ghi);
  });

  it('returns only diffuse/reflected light when the sun is below the horizon', () => {
    const gti = computeGtiFace({
      dni: 500,
      dhi: 50,
      ghi: 0,
      elevationDeg: -5,
      azimuthDeg: 0,
      aspectDeg: SOUTH_ASPECT,
    });
    expect(gti).toBeCloseTo(25, 5); // dhi * 0.5, ground term zero since ghi is 0
  });
});

import { describe, expect, it } from 'vitest';
import { beamIncidenceCos, computeGtiFace, solarPosition, solarPositionForHourlyRadiation, sunOnFaceHours } from './solar';

// Stanage Plantation - spec §3.4 validation venue, south-facing (aspectDeg 200 in the
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

describe('computeGtiFace geometry - south face at Stanage (§3.4)', () => {
  it('21 June: a south face still peaks at solar noon at this latitude (no dip)', () => {
    // The spec's §3.4 worked example describes a midday dip caused by the sun
    // passing near-overhead. At Stanage's latitude (53.3N) the summer-solstice
    // noon elevation only reaches ~60 degrees - never high enough for cos(elev)
    // to collapse faster than cos(azimuth-offset) grows - so the correct physical
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
    // than falls on the horizontal plane - this is why south walls are winter venues.
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

describe('sunOnFaceHours', () => {
  // 21 December 2026 is GMT, so UTC hours are clock hours.
  const times = Array.from({ length: 24 }, (_, h) => unixAtUtcHour('2026-12-21', h));
  const hours = Array.from({ length: 24 }, (_, h) => h);

  it('a south face on 21 December has sun around midday', () => {
    const sun = sunOnFaceHours(times, hours, STANAGE_LAT, STANAGE_LON, SOUTH_ASPECT);
    expect(sun).not.toBeNull();
    expect(sun!.start).toBeLessThanOrEqual(11);
    expect(sun!.end).toBeGreaterThanOrEqual(14);
    expect(sun!.start).toBeGreaterThanOrEqual(8); // not before the sun is 5° up
    expect(sun!.end).toBeLessThanOrEqual(16);
  });

  it('a north face (350°) on 21 December gets none', () => {
    expect(sunOnFaceHours(times, hours, STANAGE_LAT, STANAGE_LON, 350)).toBeNull();
  });

  it('an east face on the June solstice has the morning sun and loses it by early afternoon', () => {
    // BST: clock hour is UTC + 1.
    const juneTimes = Array.from({ length: 24 }, (_, h) => unixAtUtcHour('2026-06-20', h) + 23 * 3600);
    const sun = sunOnFaceHours(juneTimes, hours, STANAGE_LAT, STANAGE_LON, 90);
    expect(sun).not.toBeNull();
    expect(sun!.start).toBeLessThanOrEqual(6);
    expect(sun!.end).toBeLessThanOrEqual(14);
  });
});

describe('solarPositionForHourlyRadiation', () => {
  it('places the sun at the midpoint of the hour the radiation was averaged over', () => {
    const t = unixAtUtcHour('2026-09-28', 12);
    expect(solarPositionForHourlyRadiation(t, STANAGE_LAT, STANAGE_LON)).toEqual(solarPosition(t - 1800, STANAGE_LAT, STANAGE_LON));
  });

  it("keeps a west face's last hour of evening sun, which end-of-hour geometry dropped", () => {
    // The first hourly timestamp after sunset: the sun is down AT the timestamp,
    // but was up for most of the hour the radiation value averages.
    let t = unixAtUtcHour('2026-09-28', 15);
    while (solarPosition(t, STANAGE_LAT, STANAGE_LON).elevationDeg > 0) t += 3600;
    const mid = solarPositionForHourlyRadiation(t, STANAGE_LAT, STANAGE_LON);
    expect(mid.elevationDeg).toBeGreaterThan(0);

    const radiation = { dni: 250, dhi: 30, ghi: 60, aspectDeg: 270 };
    const atEnd = computeGtiFace({ ...radiation, ...solarPosition(t, STANAGE_LAT, STANAGE_LON) });
    const atMid = computeGtiFace({ ...radiation, ...mid });
    expect(atMid - atEnd).toBeGreaterThan(50); // the beam term now reaches the face
  });
});

describe('tilted faces (§3.4 - steepness sets the face angle)', () => {
  // Due south at noon: high June sun (about 60°) and low December sun (about 13°).
  const june = 60;
  const december = 13;

  it('vertical is the default and matches the original cos(elevation) x cos(azimuth difference)', () => {
    expect(beamIncidenceCos(june, 180, 180)).toBeCloseTo(Math.cos((june * Math.PI) / 180), 10);
    expect(beamIncidenceCos(30, 225, 180, 90)).toBeCloseTo(Math.cos((30 * Math.PI) / 180) * Math.cos(Math.PI / 4), 10);
  });

  it('under high summer sun a slab catches more beam than a wall, an overhang less, and a roof none', () => {
    const slab = beamIncidenceCos(june, 180, 180, 70);
    const wall = beamIncidenceCos(june, 180, 180, 90);
    const steep = beamIncidenceCos(june, 180, 180, 105);
    const roof = beamIncidenceCos(june, 180, 180, 135);
    expect(slab).toBeGreaterThan(wall);
    expect(steep).toBeLessThan(wall);
    expect(steep).toBeGreaterThan(0);
    expect(roof).toBe(0);
  });

  it('low winter sun still gets under an overhang', () => {
    expect(beamIncidenceCos(december, 180, 180, 105)).toBeGreaterThan(0.8 * beamIncidenceCos(december, 180, 180, 90));
    expect(beamIncidenceCos(december, 180, 180, 135)).toBeGreaterThan(0);
  });

  it('an overhang sees less sky and more ground than a wall; a slab the reverse', () => {
    const sky = { dni: 0, dhi: 100, ghi: 0, elevationDeg: 30, azimuthDeg: 180, aspectDeg: 180 };
    const ground = { dni: 0, dhi: 0, ghi: 500, elevationDeg: 30, azimuthDeg: 180, aspectDeg: 180 };
    expect(computeGtiFace({ ...sky, tiltDeg: 70 })).toBeGreaterThan(computeGtiFace(sky));
    expect(computeGtiFace({ ...sky, tiltDeg: 135 })).toBeLessThan(computeGtiFace(sky));
    expect(computeGtiFace({ ...ground, tiltDeg: 135 })).toBeGreaterThan(computeGtiFace(ground));
  });

  it('a south-facing roof gets no direct sun on the June solstice, while a vertical wall and a steep face do', () => {
    const juneTimes = Array.from({ length: 24 }, (_, h) => unixAtUtcHour('2026-06-20', h) + 23 * 3600);
    const hours = Array.from({ length: 24 }, (_, h) => h);
    expect(sunOnFaceHours(juneTimes, hours, STANAGE_LAT, STANAGE_LON, 180, 90)).not.toBeNull();
    const steep = sunOnFaceHours(juneTimes, hours, STANAGE_LAT, STANAGE_LON, 180, 105);
    expect(steep).not.toBeNull();
    expect(steep!.start).toBeLessThanOrEqual(13);
    expect(steep!.end).toBeGreaterThan(13);
    expect(sunOnFaceHours(juneTimes, hours, STANAGE_LAT, STANAGE_LON, 180, 135)).toBeNull();
  });
});

// Solar position (NOAA algorithm) and plane-of-array irradiance on a vertical face - spec §3.4.

function deg2rad(d: number): number {
  return (d * Math.PI) / 180;
}
function rad2deg(r: number): number {
  return (r * 180) / Math.PI;
}
function normalizeDeg(d: number): number {
  const m = d % 360;
  return m < 0 ? m + 360 : m;
}
function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

export interface SolarPosition {
  elevationDeg: number;
  azimuthDeg: number; // measured clockwise from north
}

/** Solar elevation and azimuth for a given instant and location. */
export function solarPosition(unixSeconds: number, latDeg: number, lonDeg: number): SolarPosition {
  const JD = unixSeconds / 86400 + 2440587.5;
  const T = (JD - 2451545.0) / 36525;

  const L0 = normalizeDeg(280.46646 + T * (36000.76983 + T * 0.0003032));
  const M = normalizeDeg(357.52911 + T * (35999.05029 - 0.0001537 * T));
  const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);

  const Mrad = deg2rad(M);
  const C =
    Math.sin(Mrad) * (1.914602 - T * (0.004817 + 0.000014 * T)) +
    Math.sin(2 * Mrad) * (0.019993 - 0.000101 * T) +
    Math.sin(3 * Mrad) * 0.000289;

  const trueLong = L0 + C;
  const omega = 125.04 - 1934.136 * T;
  const apparentLong = trueLong - 0.00569 - 0.00478 * Math.sin(deg2rad(omega));

  const meanObliq = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60;
  const obliqCorr = meanObliq + 0.00256 * Math.cos(deg2rad(omega));

  const declination = rad2deg(Math.asin(Math.sin(deg2rad(obliqCorr)) * Math.sin(deg2rad(apparentLong))));

  const y = Math.tan(deg2rad(obliqCorr / 2)) ** 2;
  const eqTimeMin =
    4 *
    rad2deg(
      y * Math.sin(2 * deg2rad(L0)) -
        2 * e * Math.sin(Mrad) +
        4 * e * y * Math.sin(Mrad) * Math.cos(2 * deg2rad(L0)) -
        0.5 * y * y * Math.sin(4 * deg2rad(L0)) -
        1.25 * e * e * Math.sin(2 * Mrad),
    );

  const date = new Date(unixSeconds * 1000);
  const utcMinutes = date.getUTCHours() * 60 + date.getUTCMinutes() + date.getUTCSeconds() / 60;
  let trueSolarTime = (utcMinutes + eqTimeMin + 4 * lonDeg) % 1440;
  if (trueSolarTime < 0) trueSolarTime += 1440;

  let hourAngle = trueSolarTime / 4 - 180;
  if (hourAngle < -180) hourAngle += 360;

  const latRad = deg2rad(latDeg);
  const decRad = deg2rad(declination);
  const haRad = deg2rad(hourAngle);

  const cosZenith = Math.sin(latRad) * Math.sin(decRad) + Math.cos(latRad) * Math.cos(decRad) * Math.cos(haRad);
  const zenithDeg = rad2deg(Math.acos(clamp(cosZenith, -1, 1)));
  const elevationDeg = 90 - zenithDeg;

  const denom = Math.cos(latRad) * Math.sin(deg2rad(zenithDeg));
  let azimuthDeg: number;
  if (Math.abs(denom) < 1e-6) {
    azimuthDeg = hourAngle > 0 ? 180 : 0;
  } else {
    const cosAz = (Math.sin(latRad) * Math.cos(deg2rad(zenithDeg)) - Math.sin(decRad)) / denom;
    const az = rad2deg(Math.acos(clamp(cosAz, -1, 1)));
    azimuthDeg = hourAngle > 0 ? normalizeDeg(az + 180) : normalizeDeg(540 - az);
  }

  return { elevationDeg, azimuthDeg };
}

/**
 * Sun position to pair with one of Open-Meteo's hourly radiation values
 * (`shortwave_radiation`, `direct_normal_irradiance`, `diffuse_radiation`).
 * Those are means over the hour BEFORE the timestamp, not instants, so the
 * geometry belongs at that hour's midpoint, 30 minutes earlier. Taking the
 * sun's position at the timestamp itself put it half an hour late: small for
 * a south face at midday, but at low sun it dropped or misplaced a whole hour
 * of beam on east and west faces - Gogarth (west) lost its last hour of
 * evening sun, 24 W/m² instead of about 255.
 */
export function solarPositionForHourlyRadiation(unixSeconds: number, latDeg: number, lonDeg: number): SolarPosition {
  return solarPosition(unixSeconds - 1800, latDeg, lonDeg);
}

export interface GtiFaceInputs {
  dni: number; // direct_normal_irradiance, W/m^2
  dhi: number; // diffuse_radiation (diffuse horizontal), W/m^2
  ghi: number; // shortwave_radiation (global horizontal), W/m^2
  elevationDeg: number;
  azimuthDeg: number; // solar azimuth, from north
  aspectDeg: number; // crag face bearing, from north
  /**
   * Face angle from horizontal: 90 is a vertical wall, under 90 a slab leaning
   * back to the sky, over 90 an overhang leaning out over the ground (see
   * `STEEPNESS_TILT_DEG`). Defaults to vertical.
   */
  tiltDeg?: number;
  albedo?: number;
}

/**
 * Cosine of the angle between the sun and the face's outward normal - how
 * squarely the direct beam hits it (§3.4). 0 when the sun is down, behind the
 * face, or (for an overhang) too high to get under it. For a vertical face it
 * is cos(elevation) x cos(azimuth difference), the original form.
 */
export function beamIncidenceCos(elevationDeg: number, azimuthDeg: number, aspectDeg: number, tiltDeg = 90): number {
  if (elevationDeg <= 0) return 0;
  const elevRad = deg2rad(elevationDeg);
  const tiltRad = deg2rad(tiltDeg);
  const cosTheta =
    Math.cos(tiltRad) * Math.sin(elevRad) +
    Math.sin(tiltRad) * Math.cos(elevRad) * Math.cos(deg2rad(azimuthDeg - aspectDeg));
  return Math.max(0, cosTheta);
}

/**
 * Global tilted irradiance on a crag face - spec §3.4:
 * GTI = beam-on-face + isotropic sky diffuse + ground-reflected.
 *
 * The tilt sets how much of each the face sees. A slab faces partly up, so it
 * gets more sky and more high summer sun; an overhang faces partly down, so it
 * sees less sky, more ground, and no beam once the sun climbs above the angle
 * of the overhang. Until this session every face was treated as vertical.
 */
export function computeGtiFace(inputs: GtiFaceInputs): number {
  const { dni, dhi, ghi, elevationDeg, azimuthDeg, aspectDeg, tiltDeg = 90, albedo = 0.2 } = inputs;

  const cosTilt = Math.cos(deg2rad(tiltDeg));
  const skyDiffuse = (dhi * (1 + cosTilt)) / 2;
  const groundReflected = (ghi * albedo * (1 - cosTilt)) / 2;
  const beam = dni * beamIncidenceCos(elevationDeg, azimuthDeg, aspectDeg, tiltDeg);

  return beam + skyDiffuse + groundReflected;
}

/** Sun below this elevation is too low to count as on the face - terrain and trees take it first. */
const SUN_ON_FACE_MIN_ELEVATION_DEG = 5;

/**
 * Clock hours of one day when direct sun can reach the face (§4.2 geometry, not
 * weather): the sun is at least 5° up AND in front of the face - within 90° of
 * its aspect for a vertical wall, and for an overhang also low enough to get
 * under it (`beamIncidenceCos` > 0, the same test the irradiance uses). Pure
 * geometry, independent of cloud - it says when the face COULD be in sun, so
 * climbers chasing sun in winter or shade in summer can plan round it.
 *
 * `times` are the day's hour-start timestamps and `hoursOfDay` their clock
 * hours (time.ts, so a clock-change day is labelled correctly). Each hour is
 * judged at its midpoint. Returns the longest unbroken stretch of sunny hours,
 * start and end exclusive (like `bestWindowEndHour`), or null when the sun never
 * reaches the face. A vertical face sees one stretch a day; an overhang can see
 * a morning and an evening stretch with none at midday, when the sun is too
 * high to get under it, so a first-to-last span would wrongly claim midday sun.
 */
export function sunOnFaceHours(
  times: number[],
  hoursOfDay: number[],
  latDeg: number,
  lonDeg: number,
  aspectDeg: number,
  tiltDeg = 90,
): { start: number; end: number } | null {
  let bestStart = -1;
  let bestLen = 0;
  let runStart = -1;
  for (let i = 0; i < times.length; i++) {
    const { elevationDeg, azimuthDeg } = solarPosition(times[i] + 1800, latDeg, lonDeg);
    const sunny =
      elevationDeg >= SUN_ON_FACE_MIN_ELEVATION_DEG && beamIncidenceCos(elevationDeg, azimuthDeg, aspectDeg, tiltDeg) > 0;
    if (!sunny) {
      runStart = -1;
      continue;
    }
    if (runStart < 0) runStart = i;
    if (i - runStart + 1 > bestLen) {
      bestLen = i - runStart + 1;
      bestStart = runStart;
    }
  }
  return bestStart < 0 ? null : { start: hoursOfDay[bestStart], end: hoursOfDay[bestStart + bestLen - 1] + 1 };
}

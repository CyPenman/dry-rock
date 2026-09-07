// Solar position (NOAA algorithm) and plane-of-array irradiance on a vertical face — spec §3.4.

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

export interface GtiFaceInputs {
  dni: number; // direct_normal_irradiance, W/m^2
  dhi: number; // diffuse_radiation (diffuse horizontal), W/m^2
  ghi: number; // shortwave_radiation (global horizontal), W/m^2
  elevationDeg: number;
  azimuthDeg: number; // solar azimuth, from north
  aspectDeg: number; // crag face bearing, from north
  albedo?: number;
}

/**
 * Global tilted irradiance on a vertical face (tilt = 90 deg) — spec §3.4.
 * GTI = beam-on-face + isotropic sky diffuse + ground-reflected.
 */
export function computeGtiFace(inputs: GtiFaceInputs): number {
  const { dni, dhi, ghi, elevationDeg, azimuthDeg, aspectDeg, albedo = 0.2 } = inputs;

  // Vertical face: cos(tilt) = 0, so sky diffuse halves and ground-reflected halves.
  const skyDiffuse = dhi * 0.5;
  const groundReflected = ghi * albedo * 0.5;

  if (elevationDeg <= 0) {
    return skyDiffuse + groundReflected;
  }

  const elevRad = deg2rad(elevationDeg);
  const azDiffRad = deg2rad(azimuthDeg - aspectDeg);
  const cosTheta = Math.max(0, Math.cos(elevRad) * Math.cos(azDiffRad));
  const beam = dni * cosTheta;

  return beam + skyDiffuse + groundReflected;
}

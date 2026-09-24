function deg2rad(d: number): number {
  return (d * Math.PI) / 180;
}

/** Great-circle distance in km - spec §4.9 "worth the drive" sort. */
export function greatCircleDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = deg2rad(lat2 - lat1);
  const dLon = deg2rad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Drive-time estimate (§6 Home row) - no routing API, so a deliberately rough
// rule of thumb: roads are about 1.3x the straight line in the UK, a mixed
// motorway/A-road/lane trip averages about 65 km/h, and 15 minutes goes on
// getting out of town at one end and parked at the other. Display only; the
// "worth the drive" sort still uses distance.
const ROAD_FACTOR = 1.3;
const AVERAGE_SPEED_KMH = 65;
const END_ALLOWANCE_MIN = 15;

export function estimateDriveMinutes(greatCircleKm: number): number {
  return Math.round(((greatCircleKm * ROAD_FACTOR) / AVERAGE_SPEED_KMH) * 60 + END_ALLOWANCE_MIN);
}

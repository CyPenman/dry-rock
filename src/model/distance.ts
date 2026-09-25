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

// Drive-time estimate (§6 Home row) - no routing API, so a rule of thumb. The
// first 50km of straight line are slow (town, A-roads, lanes at the crag end);
// beyond that motorways take over and the average rises. Speeds are per
// straight-line km, so the road factor (about 1.4 short, 1.25 long) is built
// in. Fitted to 136 OSRM routes from Sheffield, London, Bristol and Manchester
// to every crag: median error about 5%, 90th percentile about 13% (the flat
// 1.3x / 65 km/h / +15min rule it replaced read about 30% long). Still reads
// short on motorway-free cross-country trips such as Bristol to north Wales.
// Display only; the "worth the drive" sort still uses distance.
const END_ALLOWANCE_MIN = 6;
const LOCAL_KM = 50;
const LOCAL_SPEED_KMH = 46;
const LONG_SPEED_KMH = 74;

export function estimateDriveMinutes(greatCircleKm: number): number {
  const localKm = Math.min(greatCircleKm, LOCAL_KM);
  const longKm = Math.max(greatCircleKm - LOCAL_KM, 0);
  return Math.round(END_ALLOWANCE_MIN + (localKm / LOCAL_SPEED_KMH) * 60 + (longKm / LONG_SPEED_KMH) * 60);
}

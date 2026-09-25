// Home-location geocoding via postcodes.io - free, no API key, CORS-enabled,
// commercial use allowed, built on Ordnance Survey and ONS open data (OGL).
// Used only for the home-address section (find coordinates for a typed
// postcode or town, or a label for a geolocation fix); not part of the
// forecast pipeline. Replaced Nominatim, whose usage policy caps a public app
// at one request a second and isn't meant to back one.
//
// Street addresses aren't searchable, but a postcode anywhere in the text is
// picked out, and drive times (§6 Home) only need a postcode's precision.

export interface GeocodeResult {
  lat: number;
  lon: number;
  displayName: string;
}

const POSTCODES_BASE = 'https://api.postcodes.io';

const FULL_POSTCODE = /\b([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})\b/i;
const OUTCODE_ONLY = /^[A-Z]{1,2}\d[A-Z\d]?$/i;
const NOT_FOUND = "Couldn't find that - try a postcode or a town name";

/** Settlement types from OS Open Names, biggest first: "Sheffield" means the city, not the Cornish village. */
const PLACE_TYPE_RANK: Record<string, number> = {
  City: 0,
  Town: 1,
  Village: 2,
  'Suburban Area': 3,
  Hamlet: 4,
  'Other Settlement': 5,
};

interface PostcodeResult {
  postcode: string;
  latitude: number | null;
  longitude: number | null;
  admin_district?: string | null;
  distance?: number;
}

interface OutcodeResult {
  outcode: string;
  latitude: number | null;
  longitude: number | null;
  admin_district: string[];
}

interface PlaceResult {
  name_1: string;
  name_2: string | null;
  local_type: string;
  county_unitary: string | null;
  district_borough: string | null;
  region: string | null;
  latitude: number;
  longitude: number;
}

/** GET a postcodes.io endpoint's `result`; null on 404 (not found), throws on anything else. */
async function getResult<T>(path: string): Promise<T | null> {
  const res = await fetch(`${POSTCODES_BASE}${path}`, { headers: { Accept: 'application/json' } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Address lookup failed: ${res.status} ${res.statusText}`);
  const body = (await res.json()) as { result: T | null };
  return body.result;
}

/** "Stoke on Trent", "stoke-on-trent" and "St. Albans" all compare equal to the OS spelling. */
function normaliseName(s: string): string {
  return s
    .toLowerCase()
    .replace(/[.'’]/g, '')
    .replace(/[-\s]+/g, ' ')
    .trim();
}

/** OS gives Welsh councils as "Gwynedd - Gwynedd" or "Sir Benfro - Pembrokeshire"; keep the English part. */
function cleanArea(s: string): string {
  const parts = s.split(' - ');
  return parts[parts.length - 1];
}

/** "S10 2TN, Sheffield". ONS lists some councils as "Bristol, City of"; show just "Bristol". */
function withDistrict(code: string, district: string | null | undefined): string {
  return district ? `${code}, ${district.replace(/, City of$/, '')}` : code;
}

function placeLabel(place: PlaceResult, name: string): string {
  const area = [place.county_unitary, place.district_borough, place.region]
    .filter((a): a is string => !!a)
    .map(cleanArea)
    .find((a) => normaliseName(a) !== normaliseName(name));
  return area ? `${name}, ${area}` : name;
}

async function lookupPostcode(outcode: string, incode: string): Promise<GeocodeResult | null> {
  const code = `${outcode} ${incode}`.toUpperCase();
  const live = await getResult<PostcodeResult>(`/postcodes/${encodeURIComponent(code)}`);
  if (live && live.latitude != null && live.longitude != null) {
    return { lat: live.latitude, lon: live.longitude, displayName: withDistrict(live.postcode, live.admin_district) };
  }
  // A postcode that has since been retired still has a known position.
  const retired = await getResult<PostcodeResult>(`/terminated_postcodes/${encodeURIComponent(code)}`);
  if (retired && retired.latitude != null && retired.longitude != null) {
    return { lat: retired.latitude, lon: retired.longitude, displayName: retired.postcode };
  }
  // Mistyped last part: the district is still worth having.
  return lookupOutcode(outcode);
}

async function lookupOutcode(outcode: string): Promise<GeocodeResult | null> {
  const r = await getResult<OutcodeResult>(`/outcodes/${encodeURIComponent(outcode.toUpperCase())}`);
  if (!r || r.latitude == null || r.longitude == null) return null;
  return { lat: r.latitude, lon: r.longitude, displayName: withDistrict(r.outcode, r.admin_district[0]) };
}

/** Places whose name (English or Welsh) is exactly `term`, biggest settlement first. */
async function exactPlaces(term: string): Promise<{ place: PlaceResult; name: string }[]> {
  const params = new URLSearchParams({ q: term, limit: '100' });
  const results = (await getResult<PlaceResult[]>(`/places?${params.toString()}`)) ?? [];
  const want = normaliseName(term);
  const matches: { place: PlaceResult; name: string }[] = [];
  for (const place of results) {
    const name = [place.name_1, place.name_2].find((n) => n != null && normaliseName(n) === want);
    if (name) matches.push({ place, name });
  }
  const rank = (p: PlaceResult) => PLACE_TYPE_RANK[p.local_type] ?? 6;
  // Array.prototype.sort is stable, so equal ranks keep postcodes.io's order.
  return matches.sort((a, b) => rank(a.place) - rank(b.place));
}

/**
 * A town or village name, or a comma-separated address with one in it
 * ("12 High Street, Hathersage"). Each part is tried in turn; where a part
 * names several places, one whose county or district is named elsewhere in the
 * text wins ("Crookes, Sheffield"), otherwise the biggest.
 */
async function lookupPlace(query: string): Promise<GeocodeResult | null> {
  const parts = query
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  const terms = [...new Set([query.trim(), ...parts])].slice(0, 5);
  let fallback: GeocodeResult | null = null;
  for (const term of terms) {
    const matches = await exactPlaces(term);
    if (matches.length === 0) continue;
    const context = parts.filter((p) => p !== term).map(normaliseName);
    const inContext = matches.find(({ place }) =>
      [place.county_unitary, place.district_borough, place.region].some(
        (a) => a != null && context.includes(normaliseName(cleanArea(a))),
      ),
    );
    const best = inContext ?? matches[0];
    const result = { lat: best.place.latitude, lon: best.place.longitude, displayName: placeLabel(best.place, best.name) };
    if (inContext) return result;
    fallback ??= result;
  }
  return fallback;
}

/** Forward geocode a postcode, postcode district or town to coordinates plus a short label. */
export async function geocodeAddress(query: string): Promise<GeocodeResult> {
  const trimmed = query.trim();
  const postcode = trimmed.match(FULL_POSTCODE);
  const result = postcode
    ? await lookupPostcode(postcode[1], postcode[2])
    : OUTCODE_ONLY.test(trimmed)
      ? await lookupOutcode(trimmed)
      : await lookupPlace(trimmed);
  if (!result) throw new Error(NOT_FOUND);
  return result;
}

/** Reverse geocode coordinates (e.g. from geolocation) to the nearest postcode, within 20km. */
export async function reverseGeocode(lat: number, lon: number): Promise<string> {
  const params = new URLSearchParams({ lat: String(lat), lon: String(lon), widesearch: 'true', limit: '1' });
  const results = await getResult<PostcodeResult[]>(`/postcodes?${params.toString()}`);
  const nearest = results?.[0];
  if (!nearest) return `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
  const label = withDistrict(nearest.postcode, nearest.admin_district);
  return (nearest.distance ?? 0) > 500 ? `Near ${label}` : label;
}

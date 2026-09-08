// Address geocoding via OpenStreetMap's Nominatim - no API key required. Used
// only for the home-address section (find coordinates for a typed address, or
// a display label for a geolocation fix); not part of the forecast pipeline.

export interface GeocodeResult {
  lat: number;
  lon: number;
  displayName: string;
}

const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org';

/** Forward geocode a free-text address to coordinates plus a normalised label. */
export async function geocodeAddress(query: string): Promise<GeocodeResult> {
  const params = new URLSearchParams({ q: query, format: 'jsonv2', limit: '1' });
  const res = await fetch(`${NOMINATIM_BASE}/search?${params.toString()}`, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`Address lookup failed: ${res.status} ${res.statusText}`);
  const body = (await res.json()) as { lat: string; lon: string; display_name: string }[];
  if (body.length === 0) throw new Error("Couldn't find that address");
  const [first] = body;
  return { lat: Number(first.lat), lon: Number(first.lon), displayName: first.display_name };
}

/** Reverse geocode coordinates (e.g. from geolocation) to a human-readable label. */
export async function reverseGeocode(lat: number, lon: number): Promise<string> {
  const params = new URLSearchParams({ lat: String(lat), lon: String(lon), format: 'jsonv2' });
  const res = await fetch(`${NOMINATIM_BASE}/reverse?${params.toString()}`, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`Reverse lookup failed: ${res.status} ${res.statusText}`);
  const body = (await res.json()) as { display_name?: string };
  return body.display_name ?? `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
}

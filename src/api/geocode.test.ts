import { afterEach, describe, expect, it, vi } from 'vitest';
import { geocodeAddress, reverseGeocode } from './geocode';

/** Route each postcodes.io path (without the host) to a `result`, or to a 404 when absent. */
function mockPostcodesIo(routes: Record<string, unknown>) {
  const calls: string[] = [];
  // URLSearchParams writes spaces as "+".
  const decode = (s: string) => decodeURIComponent(s.replace(/\+/g, ' '));
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const path = url.replace('https://api.postcodes.io', '');
      calls.push(decode(path));
      const key = Object.keys(routes).find((k) => decode(path) === k);
      if (key === undefined) return new Response(JSON.stringify({ status: 404, error: 'Not found' }), { status: 404 });
      return new Response(JSON.stringify({ status: 200, result: routes[key] }), { status: 200 });
    }),
  );
  return calls;
}

function place(name_1: string, local_type: string, extra: Partial<Record<string, unknown>> = {}) {
  return {
    name_1,
    name_2: null,
    local_type,
    county_unitary: null,
    district_borough: null,
    region: null,
    latitude: 50,
    longitude: -1,
    ...extra,
  };
}

const S10_2TN = { postcode: 'S10 2TN', latitude: 53.381381, longitude: -1.48853, admin_district: 'Sheffield' };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('geocodeAddress - postcodes', () => {
  it('looks up a full postcode', async () => {
    mockPostcodesIo({ '/postcodes/S10 2TN': S10_2TN });
    await expect(geocodeAddress('S10 2TN')).resolves.toEqual({ lat: 53.381381, lon: -1.48853, displayName: 'S10 2TN, Sheffield' });
  });

  it('shortens "Bristol, City of" in the label', async () => {
    mockPostcodesIo({ '/postcodes/BS8 1TH': { postcode: 'BS8 1TH', latitude: 51.459, longitude: -2.602, admin_district: 'Bristol, City of' } });
    await expect(geocodeAddress('BS8 1TH')).resolves.toMatchObject({ displayName: 'BS8 1TH, Bristol' });
  });

  it('accepts lower case and no space', async () => {
    const calls = mockPostcodesIo({ '/postcodes/S10 2TN': S10_2TN });
    await expect(geocodeAddress('  s102tn ')).resolves.toMatchObject({ lat: 53.381381 });
    expect(calls).toEqual(['/postcodes/S10 2TN']);
  });

  it('picks a postcode out of a full street address', async () => {
    const calls = mockPostcodesIo({ '/postcodes/SW1A 2AA': { postcode: 'SW1A 2AA', latitude: 51.5035, longitude: -0.1277, admin_district: 'Westminster' } });
    await expect(geocodeAddress('10 Downing Street, London SW1A 2AA')).resolves.toMatchObject({ displayName: 'SW1A 2AA, Westminster' });
    expect(calls).toEqual(['/postcodes/SW1A 2AA']);
  });

  it('falls back to a retired postcode, then to its district', async () => {
    mockPostcodesIo({ '/terminated_postcodes/S10 9ZZ': { postcode: 'S10 9ZZ', latitude: 53.1, longitude: -1.5 } });
    await expect(geocodeAddress('S10 9ZZ')).resolves.toEqual({ lat: 53.1, lon: -1.5, displayName: 'S10 9ZZ' });

    mockPostcodesIo({ '/outcodes/S10': { outcode: 'S10', latitude: 53.37, longitude: -1.51, admin_district: ['Sheffield'] } });
    await expect(geocodeAddress('S10 9ZZ')).resolves.toEqual({ lat: 53.37, lon: -1.51, displayName: 'S10, Sheffield' });
  });

  it('looks up a postcode district on its own', async () => {
    mockPostcodesIo({ '/outcodes/S10': { outcode: 'S10', latitude: 53.37, longitude: -1.51, admin_district: ['Sheffield'] } });
    await expect(geocodeAddress('s10')).resolves.toEqual({ lat: 53.37, lon: -1.51, displayName: 'S10, Sheffield' });
  });

  it('skips a postcode with no position', async () => {
    mockPostcodesIo({ '/postcodes/GY1 1AA': { postcode: 'GY1 1AA', latitude: null, longitude: null } });
    await expect(geocodeAddress('GY1 1AA')).rejects.toThrow("Couldn't find that");
  });
});

describe('geocodeAddress - places', () => {
  it('prefers the city over a same-named village listed first', async () => {
    mockPostcodesIo({
      '/places?q=Sheffield&limit=100': [
        place('Sheffield', 'Village', { county_unitary: 'Cornwall', latitude: 50.08 }),
        place('Sheffield', 'City', { district_borough: 'Sheffield', region: 'Yorkshire and the Humber', latitude: 53.38 }),
        place('Sheffield Park', 'Suburban Area'),
      ],
    });
    await expect(geocodeAddress('Sheffield')).resolves.toEqual({
      lat: 53.38,
      lon: -1,
      displayName: 'Sheffield, Yorkshire and the Humber',
    });
  });

  it('matches the English name of a Welsh place', async () => {
    mockPostcodesIo({
      '/places?q=Newport&limit=100': [
        place('Newport', 'Town', { county_unitary: 'Isle of Wight' }),
        place('Casnewydd', 'City', { name_2: 'Newport', county_unitary: 'Casnewydd - Newport', region: 'Wales', latitude: 51.59 }),
      ],
    });
    await expect(geocodeAddress('Newport')).resolves.toEqual({ lat: 51.59, lon: -1, displayName: 'Newport, Wales' });
  });

  it('ignores partial name matches', async () => {
    mockPostcodesIo({ '/places?q=Sheff&limit=100': [place('Sheffield', 'City')] });
    await expect(geocodeAddress('Sheff')).rejects.toThrow("Couldn't find that");
  });

  it('treats hyphens, dots and case as equal', async () => {
    mockPostcodesIo({
      '/places?q=stoke on trent&limit=100': [place('Stoke-on-Trent', 'City', { county_unitary: 'City of Stoke-on-Trent' })],
    });
    await expect(geocodeAddress('stoke on trent')).resolves.toMatchObject({ displayName: 'Stoke-on-Trent, City of Stoke-on-Trent' });
  });

  it('finds the town in a comma-separated address', async () => {
    mockPostcodesIo({
      '/places?q=12 High Street, Hathersage&limit=100': [],
      '/places?q=12 High Street&limit=100': [],
      '/places?q=Hathersage&limit=100': [place('Hathersage', 'Village', { county_unitary: 'Derbyshire', latitude: 53.33 })],
    });
    await expect(geocodeAddress('12 High Street, Hathersage')).resolves.toEqual({ lat: 53.33, lon: -1, displayName: 'Hathersage, Derbyshire' });
  });

  it('uses the rest of the address to choose between same-named places', async () => {
    mockPostcodesIo({
      '/places?q=Crookes, Sheffield&limit=100': [],
      '/places?q=Crookes&limit=100': [
        place('Crookes', 'Hamlet', { county_unitary: 'Somewhere Else', latitude: 1 }),
        place('Crookes', 'Suburban Area', { district_borough: 'Sheffield', latitude: 53.385 }),
      ],
    });
    await expect(geocodeAddress('Crookes, Sheffield')).resolves.toEqual({ lat: 53.385, lon: -1, displayName: 'Crookes, Sheffield' });
  });

  it('says so when nothing matches', async () => {
    mockPostcodesIo({ '/places?q=Nowhereville&limit=100': [] });
    await expect(geocodeAddress('Nowhereville')).rejects.toThrow("Couldn't find that - try a postcode or a town name.");
  });

  it('reports a server error rather than "not found"', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('busy', { status: 503, statusText: 'Service Unavailable' })));
    await expect(geocodeAddress('Sheffield')).rejects.toThrow("postcodes.io isn't working right now (error 503)");
  });
});

describe('reverseGeocode', () => {
  it('labels a fix with its nearest postcode', async () => {
    mockPostcodesIo({ '/postcodes?lat=53.3814&lon=-1.4885&widesearch=true&limit=1': [{ ...S10_2TN, distance: 40 }] });
    await expect(reverseGeocode(53.3814, -1.4885)).resolves.toBe('S10 2TN, Sheffield');
  });

  it('says "near" when the nearest postcode is some way off', async () => {
    mockPostcodesIo({
      '/postcodes?lat=53.3457&lon=-1.6275&widesearch=true&limit=1': [
        { postcode: 'S32 1DY', latitude: 53.345, longitude: -1.6486, admin_district: 'Derbyshire Dales', distance: 1401 },
      ],
    });
    await expect(reverseGeocode(53.3457, -1.6275)).resolves.toBe('Near S32 1DY, Derbyshire Dales');
  });

  it('falls back to coordinates when no postcode is within range', async () => {
    mockPostcodesIo({ '/postcodes?lat=48.8566&lon=2.3522&widesearch=true&limit=1': null });
    await expect(reverseGeocode(48.8566, 2.3522)).resolves.toBe('48.8566, 2.3522');
  });
});

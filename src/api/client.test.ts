import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Crag } from '../model/types';
import { fetchCellForecasts } from './client';
import type { OpenMeteoResponse } from './types';

function makeCrag(id: string, lat: number, lon: number): Crag {
  return {
    id,
    name: id,
    area: 'test',
    lat,
    lon,
    elevationM: 50,
    disciplines: ['sport'],
    rock: 'limestone',
    aspectDeg: 180,
    steepness: 'vertical',
    seepIndex: 0,
    tauSeep: 1,
    catchmentAbove: 0,
    windShelter: 1,
    canopyLight: 1,
    tauRock: 20,
    dryingRate: 1,
    Smax: 0.25,
    Mmax: 1,
    infiltrationRate: 0.08,
    idealTempC: [8, 16],
    coastal: false,
    softRock: false,
    notes: '',
  };
}

function mockResponse(lat: number, lon: number): OpenMeteoResponse {
  return {
    latitude: lat,
    longitude: lon,
    elevation: 50,
    timezone: 'Europe/London',
    hourly: {
      time: [1000, 2000, 3000],
      precipitation_ukmo_seamless: [0, 1, 0],
      precipitation_ecmwf_ifs025: [0, 0.5, 0],
      temperature_2m_ukmo_seamless: [10, 11, 12],
      soil_moisture_28_to_100cm_ukmo_seamless: [0.3, 0.3, 0.3],
    },
    daily: {
      time: [1000],
      sunrise: [900],
      sunset: [4000],
      precipitation_sum: [1],
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchCellForecasts', () => {
  it('normalizes a multi-coordinate array response and splits variables by model', async () => {
    const crags = [makeCrag('a', 53.336, -3.845), makeCrag('b', 51.0, 0.0)];
    const responses = [mockResponse(53.336, -3.845), mockResponse(51.0, 0.0)];

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, status: 200, statusText: 'OK', json: async () => responses })),
    );

    const { cellForecasts, cragToCellKey } = await fetchCellForecasts(crags);

    expect(cellForecasts.size).toBe(2);
    const cellA = cellForecasts.get(cragToCellKey.get('a')!)!;
    expect(cellA.time).toEqual([1000, 2000, 3000]);
    expect(cellA.models.ukmo_seamless.precipitation).toEqual([0, 1, 0]);
    expect(cellA.models.ecmwf_ifs025.precipitation).toEqual([0, 0.5, 0]);
    expect(cellA.models.ukmo_seamless.temperature_2m).toEqual([10, 11, 12]);
    expect(cellA.models.ukmo_seamless.soil_moisture_28_to_100cm).toEqual([0.3, 0.3, 0.3]);
    expect(cellA.dailySunrise).toEqual([900]);
  });

  it('normalizes a bare single-coordinate object response', async () => {
    const crags = [makeCrag('a', 53.336, -3.845)];
    const response = mockResponse(53.336, -3.845);

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, status: 200, statusText: 'OK', json: async () => response })),
    );

    const { cellForecasts } = await fetchCellForecasts(crags);
    expect(cellForecasts.size).toBe(1);
  });

  it('throws when the request fails', async () => {
    const crags = [makeCrag('a', 53.336, -3.845)];
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 500, statusText: 'Server Error', json: async () => ({}) })),
    );

    await expect(fetchCellForecasts(crags)).rejects.toThrow(/500/);
  });
});

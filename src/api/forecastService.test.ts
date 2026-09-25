import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchCellForecasts } from './client';
import { getForecast, type ForecastBundle } from './forecastService';
import { ServiceError } from './serviceError';
import { readCachedForecast, writeCachedForecast } from '../storage/db';

vi.mock('./client', () => ({ fetchCellForecasts: vi.fn() }));
vi.mock('../storage/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../storage/db')>()),
  readCachedForecast: vi.fn(),
  writeCachedForecast: vi.fn(),
}));

const fresh = { cellForecasts: new Map(), cragToCellKey: new Map() };
const HOUR = 60 * 60 * 1000;

beforeEach(() => {
  vi.mocked(fetchCellForecasts).mockReset();
  vi.mocked(readCachedForecast).mockReset();
  vi.mocked(writeCachedForecast).mockReset().mockResolvedValue(undefined);
});

describe('getForecast', () => {
  it('still loads the forecast when the offline cache cannot be read', async () => {
    vi.mocked(readCachedForecast).mockRejectedValue(new Error('IndexedDB blocked'));
    vi.mocked(fetchCellForecasts).mockResolvedValue(fresh);
    const out = await getForecast([]);
    expect(out.refreshError).toBeNull();
    expect(out.bundle.cellForecasts).toBe(fresh.cellForecasts);
  });

  it('keeps a forecast that downloaded fine when saving it offline fails', async () => {
    vi.mocked(readCachedForecast).mockResolvedValue(null);
    vi.mocked(fetchCellForecasts).mockResolvedValue(fresh);
    vi.mocked(writeCachedForecast).mockRejectedValue(new Error('quota exceeded'));
    const out = await getForecast([]);
    expect(out.refreshError).toBeNull();
  });

  it('falls back to the saved forecast with the real reason it could not update', async () => {
    const saved = { fetchedAt: Date.now() - 5 * HOUR, data: fresh as ForecastBundle };
    const reason = new ServiceError('Open-Meteo', 'busy', 429);
    vi.mocked(readCachedForecast).mockResolvedValue(saved);
    vi.mocked(fetchCellForecasts).mockRejectedValue(reason);
    const out = await getForecast([]);
    expect(out.fetchedAt).toBe(saved.fetchedAt);
    expect(out.refreshError).toBe(reason);
  });

  it('throws the real reason when there is nothing saved to fall back on', async () => {
    vi.mocked(readCachedForecast).mockResolvedValue(null);
    vi.mocked(fetchCellForecasts).mockRejectedValue(new ServiceError('Open-Meteo', 'offline'));
    await expect(getForecast([])).rejects.toThrow('no internet connection');
  });
});

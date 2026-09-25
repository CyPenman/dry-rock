import { afterEach, describe, expect, it, vi } from 'vitest';
import { describeError, fetchFrom, readJson, ServiceError, UserFacingError } from './serviceError';

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubOnline(onLine: boolean) {
  vi.stubGlobal('navigator', { onLine });
}

describe('fetchFrom', () => {
  it('says there is no connection when the browser is offline', async () => {
    stubOnline(false);
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))));
    await expect(fetchFrom('Open-Meteo', 'https://x')).rejects.toThrow('no internet connection');
  });

  it("doesn't claim there's no connection when the browser is online but gets no answer", async () => {
    stubOnline(true);
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))));
    const err = await fetchFrom('Open-Meteo', 'https://x').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ServiceError);
    expect((err as ServiceError).problem).toBe('unreachable');
    expect((err as Error).message).toMatch(/couldn't reach Open-Meteo/);
  });

  it.each([
    [429, 'busy', /too many requests/],
    [503, 'down', /isn't working right now \(error 503\)/],
    [400, 'refused', /turned the request down \(error 400\)/],
  ])('reads HTTP %i as %s', async (status, problem, message) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status })));
    const err = await fetchFrom('Open-Meteo', 'https://x').catch((e: unknown) => e);
    expect((err as ServiceError).problem).toBe(problem);
    expect((err as Error).message).toMatch(message);
  });

  it.each([
    ['Daily API request limit exceeded. Please try again tomorrow.', 'day', /from this network today - try again tomorrow/],
    ['Hourly API request limit exceeded. Please try again in the next hour.', 'hour', /this hour - try again in an hour/],
    ['Minutely API request limit exceeded. Please try again in one minute.', 'minute', /try again in a few minutes/],
  ])("reads the limit a 429 names: '%s'", async (reason, limit, message) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: true, reason }), { status: 429 })));
    const err = (await fetchFrom('Open-Meteo', 'https://x').catch((e: unknown) => e)) as ServiceError;
    expect(err.problem).toBe('busy');
    expect(err.limit).toBe(limit);
    expect(err.message).toMatch(message);
  });

  it('lets through a status the caller handles itself', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })));
    const res = await fetchFrom('postcodes.io', 'https://x', undefined, [404]);
    expect(res.status).toBe(404);
  });
});

describe('readJson', () => {
  it('reports a body that is not JSON as unreadable', async () => {
    await expect(readJson('Open-Meteo', new Response('<html>'))).rejects.toThrow("sent back something the app couldn't read");
  });
});

describe('describeError', () => {
  it('passes a message already written for the user straight through', () => {
    expect(describeError(new UserFacingError("the report service didn't accept it"))).toBe("the report service didn't accept it");
  });

  it("puts any other error down to the app, not the connection", () => {
    expect(describeError(new TypeError("Cannot read properties of undefined (reading 'x')"))).toMatch(/^something went wrong inside the app/);
  });
});

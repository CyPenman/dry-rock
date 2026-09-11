import { openDB, type IDBPDatabase } from 'idb';

// §3.6 / §2 - cache raw forecast responses in IndexedDB (not derived scores; the
// simulation is cheap enough to recompute on every parameter change).
export interface CachedForecast<T> {
  fetchedAt: number; // ms since epoch
  data: T;
}

const DB_NAME = 'dry-rock';
const STORE_NAME = 'forecastCache';
const ENSEMBLE_STORE_NAME = 'ensembleCache';
const CACHE_KEY = 'forecast';
const DEFAULT_MAX_AGE_MS = 2 * 60 * 60 * 1000; // 2 hours - Open-Meteo updates hourly

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDB(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, 2, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
        if (!db.objectStoreNames.contains(ENSEMBLE_STORE_NAME)) {
          db.createObjectStore(ENSEMBLE_STORE_NAME);
        }
      },
    });
  }
  return dbPromise;
}

export async function readCachedForecast<T>(): Promise<CachedForecast<T> | null> {
  const db = await getDB();
  const entry = await db.get(STORE_NAME, CACHE_KEY);
  return (entry as CachedForecast<T> | undefined) ?? null;
}

export async function writeCachedForecast<T>(data: T): Promise<void> {
  const db = await getDB();
  const entry: CachedForecast<T> = { fetchedAt: Date.now(), data };
  await db.put(STORE_NAME, entry, CACHE_KEY);
}

export function isStale(fetchedAt: number, maxAgeMs: number = DEFAULT_MAX_AGE_MS): boolean {
  return Date.now() - fetchedAt > maxAgeMs;
}

// Ensemble responses (§3.3) are per-crag and requested on demand, with no
// caching of their own until now - reopening a crag detail screen re-ran the
// ~40-member request from scratch every time. Cache by crag id, same 2h
// staleness window as the primary forecast since it's the same underlying
// model cadence.
export async function readCachedEnsemble<T>(cragId: string): Promise<CachedForecast<T> | null> {
  const db = await getDB();
  const entry = await db.get(ENSEMBLE_STORE_NAME, cragId);
  return (entry as CachedForecast<T> | undefined) ?? null;
}

export async function writeCachedEnsemble<T>(cragId: string, data: T): Promise<void> {
  const db = await getDB();
  const entry: CachedForecast<T> = { fetchedAt: Date.now(), data };
  await db.put(ENSEMBLE_STORE_NAME, entry, cragId);
}

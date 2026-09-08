import { openDB, type IDBPDatabase } from 'idb';

// §3.6 / §2 - cache raw forecast responses in IndexedDB (not derived scores; the
// simulation is cheap enough to recompute on every parameter change).
export interface CachedForecast<T> {
  fetchedAt: number; // ms since epoch
  data: T;
}

const DB_NAME = 'dry-rock';
const STORE_NAME = 'forecastCache';
const CACHE_KEY = 'forecast';
const DEFAULT_MAX_AGE_MS = 2 * 60 * 60 * 1000; // 2 hours - Open-Meteo updates hourly

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDB(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
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

import { openDB, type IDBPDatabase } from 'idb';
import type { Observation } from '../model/observation';

// §3.6 / §2 - cache raw forecast responses in IndexedDB (not derived scores; the
// simulation is cheap enough to recompute on every parameter change).
export interface CachedForecast<T> {
  fetchedAt: number; // ms since epoch
  data: T;
}

const DB_NAME = 'dry-rock';
const STORE_NAME = 'forecastCache';
const ENSEMBLE_STORE_NAME = 'ensembleCache';
const OBSERVATION_STORE_NAME = 'observations';
const CACHE_KEY = 'forecast';
const DEFAULT_MAX_AGE_MS = 2 * 60 * 60 * 1000; // 2 hours - Open-Meteo updates hourly

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDB(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, 3, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
        if (!db.objectStoreNames.contains(ENSEMBLE_STORE_NAME)) {
          db.createObjectStore(ENSEMBLE_STORE_NAME);
        }
        if (!db.objectStoreNames.contains(OBSERVATION_STORE_NAME)) {
          const store = db.createObjectStore(OBSERVATION_STORE_NAME, { keyPath: 'id' });
          store.createIndex('cragId', 'cragId');
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

// Observation log (§8.1) - the user's own conditions reports, each with the
// model's view of the same hour. Unlike the caches above this is the user's
// data: never expired. Each one is also emailed to the developer
// (src/api/reports.ts), and `sentAtSec` records when that succeeded.
export async function addObservation(observation: Observation): Promise<void> {
  const db = await getDB();
  await db.put(OBSERVATION_STORE_NAME, observation);
}

export async function markObservationSent(id: string, sentAtSec: number): Promise<void> {
  const db = await getDB();
  const observation = (await db.get(OBSERVATION_STORE_NAME, id)) as Observation | undefined;
  if (observation) await db.put(OBSERVATION_STORE_NAME, { ...observation, sentAtSec });
}

/** Observations for one crag (or all, without an id), newest first. */
export async function listObservations(cragId?: string): Promise<Observation[]> {
  const db = await getDB();
  const all = (
    cragId ? await db.getAllFromIndex(OBSERVATION_STORE_NAME, 'cragId', cragId) : await db.getAll(OBSERVATION_STORE_NAME)
  ) as Observation[];
  return all.sort((a, b) => b.observedAtSec - a.observedAtSec);
}

export function listAllObservations(): Promise<Observation[]> {
  return listObservations();
}

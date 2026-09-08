import { useCallback, useState } from 'react';

// §2 — "Settings that are fine in localStorage: home coordinates,
// pinned crag ids, tuned model parameters, unit preferences."
export interface Settings {
  homeLat: number | null;
  homeLon: number | null;
  pinnedCragIds: string[];
}

const STORAGE_KEY = 'dry-rock:settings';
const MAX_PINNED = 5;

const DEFAULT_SETTINGS: Settings = {
  homeLat: null,
  homeLon: null,
  pinnedCragIds: [],
};

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // localStorage may be unavailable (private mode, quota) — settings just won't persist.
  }
}

export function useSettings() {
  const [settings, setSettings] = useState<Settings>(loadSettings);

  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      saveSettings(next);
      return next;
    });
  }, []);

  const togglePinned = useCallback((cragId: string) => {
    setSettings((prev) => {
      const isPinned = prev.pinnedCragIds.includes(cragId);
      const pinnedCragIds = isPinned
        ? prev.pinnedCragIds.filter((id) => id !== cragId)
        : [...prev.pinnedCragIds, cragId].slice(0, MAX_PINNED);
      const next = { ...prev, pinnedCragIds };
      saveSettings(next);
      return next;
    });
  }, []);

  return { settings, update, togglePinned, maxPinned: MAX_PINNED };
}

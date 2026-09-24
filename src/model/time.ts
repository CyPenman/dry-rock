// Local-time helpers (§3.1). Open-Meteo's `unixtime` values are real instants,
// so across a clock change the hourly series has a 23- or 25-hour local day.
// Days and hour labels are therefore read from the timestamps in Europe/London,
// never from array positions.

const HOUR_FORMAT = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', hourCycle: 'h23' });
const DATE_FORMAT = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

// Memoised: every crag, cell and model shares the same few hundred timestamps,
// and Intl formatting is slow enough to matter at ~100k calls per forecast load.
const hourCache = new Map<number, number>();
const dateKeyCache = new Map<number, string>();

/** Clock hour 0-23 in Europe/London. Reads 01 twice on the October change (BST, then GMT). */
export function hourOfDayLondon(timeSec: number): number {
  let hour = hourCache.get(timeSec);
  if (hour === undefined) {
    hour = Number(HOUR_FORMAT.format(new Date(timeSec * 1000)));
    hourCache.set(timeSec, hour);
  }
  return hour;
}

/** Local calendar date in Europe/London as `YYYY-MM-DD`. */
export function localDateKeyLondon(timeSec: number): string {
  let key = dateKeyCache.get(timeSec);
  if (key === undefined) {
    const parts = DATE_FORMAT.formatToParts(new Date(timeSec * 1000));
    const get = (type: string) => parts.find((p) => p.type === type)!.value;
    key = `${get('year')}-${get('month')}-${get('day')}`;
    dateKeyCache.set(timeSec, key);
  }
  return key;
}

export interface DayBoundary {
  startIdx: number;
  endIdx: number; // inclusive
}

/** A trailing day with fewer hours than this is a partial final day, not a day to score. */
const MIN_HOURS_FOR_FINAL_DAY = 20;

/**
 * Group an hourly series into local calendar days (§3.1). Days may have 23, 24
 * or 25 hours; the first may be short if the series starts after local
 * midnight. A trailing day with fewer than 20 hours is dropped as partial.
 */
export function dayBoundaries(times: number[]): DayBoundary[] {
  const days: DayBoundary[] = [];
  let currentKey: string | null = null;
  for (let i = 0; i < times.length; i++) {
    const key = localDateKeyLondon(times[i]);
    if (key !== currentKey) {
      days.push({ startIdx: i, endIdx: i });
      currentKey = key;
    } else {
      days[days.length - 1].endIdx = i;
    }
  }
  const last = days[days.length - 1];
  if (days.length > 1 && last && last.endIdx - last.startIdx + 1 < MIN_HOURS_FOR_FINAL_DAY) days.pop();
  return days;
}

import type { ModelName } from '../api/request';
import type { CragDayResult } from '../model/dayAggregate';
import type { LimitingFactor } from '../model/wetness';

/** Short display names for the four deterministic models (§3.3). */
export const MODEL_DISPLAY_NAME: Record<ModelName, string> = {
  ukmo_seamless: 'UKMO',
  ecmwf_ifs025: 'ECMWF',
  icon_seamless: 'ICON',
  gfs_seamless: 'GFS',
};

const WEEKDAY_SHORT = new Intl.DateTimeFormat('en-GB', { weekday: 'short' });

/**
 * One line saying which model the headline used for which days (§3.3), e.g.
 * "Headline uses UKMO for Thu-Sat, ECMWF after". `dates` and `models` are
 * parallel, one entry per visible day.
 */
export function formatHeadlineModelCaption(dates: Date[], models: ModelName[]): string {
  const n = Math.min(dates.length, models.length);
  if (n === 0) return '';
  const runs: { model: ModelName; from: number; to: number }[] = [];
  for (let i = 0; i < n; i++) {
    const last = runs[runs.length - 1];
    if (last && last.model === models[i]) last.to = i;
    else runs.push({ model: models[i], from: i, to: i });
  }
  if (runs.length === 1) return `Headline uses ${MODEL_DISPLAY_NAME[runs[0].model]} for every day shown`;
  const span = (r: { from: number; to: number }) =>
    r.from === r.to
      ? WEEKDAY_SHORT.format(dates[r.from])
      : `${WEEKDAY_SHORT.format(dates[r.from])}-${WEEKDAY_SHORT.format(dates[r.to])}`;
  const parts = runs.map((r, i) =>
    i === runs.length - 1 ? `${MODEL_DISPLAY_NAME[r.model]} after` : `${MODEL_DISPLAY_NAME[r.model]} for ${span(r)}`,
  );
  return `Headline uses ${parts.join(', ')}`;
}

export function formatAgeWords(fetchedAt: number): string {
  const mins = Math.round((Date.now() - fetchedAt) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `data is ${mins} minute${mins === 1 ? '' : 's'} old`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `data is ${hours} hour${hours === 1 ? '' : 's'} old`;
  const days = Math.round(hours / 24);
  return `data is ${days} day${days === 1 ? '' : 's'} old`;
}

export function formatDayLabel(date: Date): string {
  return date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

export function formatTimeOfDay(date: Date): string {
  return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

const KM_TO_MILES = 0.621371;

/** Distance is modelled in km internally (§4.9); this converts only for display. */
export function formatDistanceMiles(km: number): string {
  const miles = km * KM_TO_MILES;
  return miles < 10 ? `${miles.toFixed(1)}mi` : `${Math.round(miles)}mi`;
}

function formatClockHour(hour: number): string {
  return `${String(hour % 24).padStart(2, '0')}:00`;
}

/**
 * When a day is dry enough to climb, in the words used on rows and in the
 * breakdown table (§6 Home item 4). "Dry from" only when the dry window runs on
 * to dusk; a window that closes before dusk (evening rain) is given as a range,
 * rather than the old "not dry" next to a decent score.
 */
export function formatDryTiming(
  day: Pick<
    CragDayResult,
    | 'climbableDaylightHours'
    | 'totalDaylightHours'
    | 'dryFromHourOfDay'
    | 'bestWindowStartHour'
    | 'bestWindowEndHour'
    | 'lastDaylightHour'
  >,
): string {
  if (day.totalDaylightHours > 0 && day.climbableDaylightHours >= day.totalDaylightHours) return 'dry all day';
  if (day.bestWindowStartHour == null || day.bestWindowEndHour == null) return 'no dry window';
  const runsToDusk = day.lastDaylightHour != null && day.bestWindowEndHour - 1 === day.lastDaylightHour;
  // Shown from the window's own start: `dryFromHourOfDay` can differ if the
  // rock clears again after dusk, and this is a statement about daylight.
  if (day.dryFromHourOfDay != null && runsToDusk) return `dry from ${formatClockHour(day.bestWindowStartHour)}`;
  return `dry ${formatClockHour(day.bestWindowStartHour)}-${formatClockHour(day.bestWindowEndHour)}`;
}

export const LIMITING_FACTOR_LABEL: Record<LimitingFactor, string> = {
  rain: 'limited by rain',
  seepage: 'limited by seepage',
  condensation: 'limited by condensation',
  snow: 'under snow',
  frozen: 'frozen',
  drying: 'still drying out',
  none: '',
};

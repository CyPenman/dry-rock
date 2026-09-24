import type { ModelName } from '../api/request';
import type { CragDayResult } from '../model/dayAggregate';
import type { FrictionReason } from '../model/friction';
import { confidenceSentence, verdictMessage } from '../model/score';
import { scoreBand } from '../model/scoreBand';
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
 * rather than the old "not dry" next to a decent score. With no fully dry hour
 * but at least an hour of partial credit (rock just damp inside, §4.7) it says
 * "nearly dry", so a small score is never shown next to "no dry window".
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
  > &
    Partial<Pick<CragDayResult, 'effectiveDryDaylightHours'>>,
): string {
  if (day.totalDaylightHours > 0 && day.climbableDaylightHours >= day.totalDaylightHours) return 'dry all day';
  if (day.bestWindowStartHour == null || day.bestWindowEndHour == null)
    return (day.effectiveDryDaylightHours ?? 0) >= 1 ? 'nearly dry' : 'no dry window';
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

/** Why a dry day still scored poorly on friction (§1), in row wording. */
export const FRICTION_REASON_LABEL: Record<FrictionReason, string> = {
  humid: 'humid - greasy',
  near_dew_point: 'on the dew point - may sweat',
  too_warm: 'too warm for good friction',
  too_cold: 'cold rock',
  windy: 'windy',
  sun_baked: 'sun-baked face',
  salt: 'salty in onshore air',
};

/**
 * The one reason a row gives (§1: "why?" in one line): what kept it wet if
 * anything did, else what held friction back, else nothing.
 */
export function dayReason(day: Pick<CragDayResult, 'limitingFactor' | 'frictionReason'>): string | null {
  if (day.limitingFactor !== 'none') return LIMITING_FACTOR_LABEL[day.limitingFactor];
  if (day.frictionReason) return FRICTION_REASON_LABEL[day.frictionReason];
  return null;
}

/** When the face can get direct sun (§4.2 geometry), in the words used on the detail screen. */
export function formatSunOnFace(sun: CragDayResult['sunOnFaceHours']): string {
  if (!sun) return 'no direct sun on this face today';
  return `sun on the face ${formatClockHour(sun.start)}-${formatClockHour(sun.end)} (when it's out)`;
}

const COMPASS_16 = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

/** A bearing as a 16-point compass word, e.g. 225 -> "SW". */
export function compass16(deg: number): string {
  return COMPASS_16[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];
}

function formatRange(min: number, max: number): string {
  const lo = Math.round(min);
  const hi = Math.round(max);
  return lo === hi ? `${lo}` : `${lo}-${hi}`;
}

/** "air 9-14°C · wind 4-7 m/s from the SW · cloud 60%" - daylight weather for one day (§6 crag detail). */
export function formatDaylightWeather(w: NonNullable<CragDayResult['daylightWeather']>): string {
  return [
    `air ${formatRange(w.airTempC.min, w.airTempC.max)}°C`,
    `wind ${formatRange(w.windSpeedMs.min, w.windSpeedMs.max)} m/s from the ${compass16(w.windFromDeg)}`,
    `cloud ${Math.round(w.cloudCoverPct)}%`,
  ].join(' · ');
}

/**
 * One plain sentence for a day, for the top of the detail screen (§1: "why?"
 * in one line): "Sat: dry all day, good friction. 4 of 4 models agree it's a
 * good day." A gated day gives its verdict instead.
 */
export function daySummarySentence(
  day: Pick<
    CragDayResult,
    | 'date'
    | 'verdict'
    | 'score'
    | 'confidence'
    | 'limitingFactor'
    | 'frictionReason'
    | 'climbableDaylightHours'
    | 'totalDaylightHours'
    | 'dryFromHourOfDay'
    | 'bestWindowStartHour'
    | 'bestWindowEndHour'
    | 'lastDaylightHour'
  >,
): string {
  const label = WEEKDAY_SHORT.format(day.date);
  if (day.verdict !== 'scored') return `${label}: ${verdictMessage(day.verdict)}.`;
  const reason = dayReason(day) ?? 'good friction';
  return `${label}: ${formatDryTiming(day)}, ${reason}. ${confidenceSentence(day.confidence, scoreBand(day.score * 100))}.`;
}

/** "~2h10 drive", "~2h drive" or "~45min drive" from an estimated number of minutes (§6 Home row). */
export function formatDriveTime(minutes: number): string {
  if (minutes < 60) return `~${minutes}min drive`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `~${h}h drive` : `~${h}h${String(m).padStart(2, '0')} drive`;
}

/**
 * What the dryness bar is actually made of, in one caption (§6 crag detail).
 * `rockDrynessScore` is 0.5*(dry hours / session) + 0.5*(longest unbroken run /
 * session), each capped at 1, where a session is SESSION_HOURS (6) or the day's
 * daylight if shorter - so two days showing the same number can be one clean
 * window or the same hours in scraps, and the bar alone cannot tell them apart
 * (`computeScoreBreakdown`, score.ts).
 *
 * Both halves count hours of rock just damp inside at part value (§4.7), so the
 * caption does too: the whole dry hours, then how much the nearly dry hours
 * add, and the run as the score counts it - "0 of 12 daylight hours dry (plus
 * about 3h nearly dry) · longest unbroken run about 3h, counting nearly dry
 * hours". Otherwise a nearly dry day read "longest unbroken run 0h" beside a
 * dryness bar of 49.
 */
export function formatDrynessCaption(
  day: Pick<
    CragDayResult,
    | 'totalDaylightHours'
    | 'climbableDaylightHours'
    | 'bestContiguousClimbableHours'
    | 'effectiveDryDaylightHours'
    | 'bestEffectiveRunHours'
    | 'rainChancePct'
  >,
): string {
  const total = Math.round(day.totalDaylightHours);
  if (total === 0) return 'no daylight hours to judge';
  const dry = Math.round(day.climbableDaylightHours);
  const partial = day.effectiveDryDaylightHours - day.climbableDaylightHours;
  const nearly = partial >= 0.5 ? ` (plus about ${Math.round(partial)}h nearly dry)` : '';
  const runHasPartial = day.bestEffectiveRunHours - day.bestContiguousClimbableHours >= 0.5;
  const run = runHasPartial
    ? `longest unbroken run about ${Math.round(day.bestEffectiveRunHours)}h, counting nearly dry hours`
    : `longest unbroken run ${Math.round(day.bestContiguousClimbableHours)}h`;
  return `${dry} of ${total} daylight hours dry${nearly} · ${run} · ${day.rainChancePct}% top hourly rain chance`;
}

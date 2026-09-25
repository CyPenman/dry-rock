import { LIMITING_FACTOR_LABEL } from '../lib/format';
import { OBSERVED_CONDITIONS, type Observation } from '../model/observation';
import type { LimitingFactor } from '../model/wetness';
import { listAllObservations, markObservationSent } from '../storage/db';

// Reports to the developer (spec §8.1, §6 Guide & about): conditions logs and
// general feedback, emailed through FormSubmit's AJAX endpoint. The app has no
// backend, and FormSubmit needs no account or key - the first submission sends
// an "Activate Form" email to the inbox, and nothing is delivered until that
// link is clicked. After activation FormSubmit offers a random alias for the
// address; swap it into REPORT_ENDPOINT to keep the address out of the source.

export const REPORT_EMAIL = 'UKDryRock@gmail.com';
const REPORT_ENDPOINT = `https://formsubmit.co/ajax/${REPORT_EMAIL}`;

/**
 * Every email carries one line starting with this marker followed by the
 * report as single-line JSON, so a pasted email (or a whole inbox export) can
 * be parsed by searching for the marker. Bump the version if the shape changes.
 */
export const REPORT_JSON_MARKER = 'DRYROCK-REPORT-V1';

export type FeedbackTopic = 'general' | 'bug' | 'idea' | 'crag';

export const FEEDBACK_TOPICS: { value: FeedbackTopic; label: string }[] = [
  { value: 'general', label: 'General' },
  { value: 'bug', label: 'Something looks wrong' },
  { value: 'idea', label: 'Idea' },
  { value: 'crag', label: 'Add or fix a crag' },
];

export interface Feedback {
  topic: FeedbackTopic;
  message: string;
  name?: string;
  email?: string;
}

/** The app build that made a report - injected by vite.config.ts. */
export const APP_BUILD: string = typeof __APP_BUILD__ === 'string' ? __APP_BUILD__ : 'dev';

function clientInfo() {
  return {
    appBuild: APP_BUILD,
    userAgent: typeof navigator === 'undefined' ? '' : navigator.userAgent,
    screen: typeof window === 'undefined' ? '' : `${window.innerWidth}x${window.innerHeight}`,
  };
}

/** "2026-09-25 14:05" in UK time - the same clock the app shows. */
function ukTimestamp(sec: number): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(sec * 1000));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`;
}

/** "dry" or "wet, limited by rain" - the model's side of an observation, in words. */
export function modelSaid(snapshot: Observation['snapshot']): string {
  if (snapshot.climbable) return 'dry';
  const reason = LIMITING_FACTOR_LABEL[snapshot.limitingFactor as LimitingFactor];
  return reason ? `wet, ${reason}` : 'wet';
}

function conditionLabel(o: Observation): string {
  return OBSERVED_CONDITIONS.find((c) => c.value === o.condition)?.label ?? o.condition;
}

/**
 * The fields FormSubmit emails for one observation: a readable summary first,
 * then the whole record as JSON behind REPORT_JSON_MARKER. Underscore fields
 * are FormSubmit settings, not content.
 */
export function observationEmailFields(o: Observation): Record<string, string> {
  const crag = o.context?.cragName ?? o.cragId;
  const when = ukTimestamp(o.observedAtSec);
  const day = o.context?.headlineDay;
  const json = { kind: 'observation', ...clientInfo(), observation: { ...o, sentAtSec: undefined } };
  return {
    _subject: `Dry Rock observation | ${crag} | ${conditionLabel(o)} | ${when}`,
    _template: 'table',
    _captcha: 'false',
    Crag: `${crag} (${o.cragId})`,
    When: `${when} UK time`,
    'Climber said': conditionLabel(o) + (o.note ? ` - "${o.note}"` : ''),
    'Model said (that hour)': `${modelSaid(o.snapshot)} · rock ${o.snapshot.Trock.toFixed(1)}°C · dew point ${o.snapshot.dewPointC.toFixed(1)}°C · ${o.snapshot.precipLast24hMm.toFixed(1)}mm rain in last 24h`,
    'Model said (that day)': day
      ? `${Math.round(day.displayScore * 100)}/100 on ${day.model} · ${day.limitingFactor === 'none' ? 'nothing limiting' : `limited by ${day.limitingFactor}`} · ${day.confidence.agreeCount} of ${day.confidence.total} models agree`
      : `score ${Math.round(o.snapshot.dayScore * 100)} on ${o.snapshot.sourceModel}`,
    'App build': APP_BUILD,
    'Report JSON': `${REPORT_JSON_MARKER} ${JSON.stringify(json)}`,
  };
}

export function feedbackEmailFields(f: Feedback, sentAtSec: number): Record<string, string> {
  const topic = FEEDBACK_TOPICS.find((t) => t.value === f.topic)?.label ?? f.topic;
  const json = { kind: 'feedback', ...clientInfo(), sentAtSec, ...f };
  return {
    _subject: `Dry Rock feedback | ${topic} | ${f.name || 'anonymous'}`,
    _template: 'table',
    _captcha: 'false',
    ...(f.email ? { _replyto: f.email } : {}),
    Topic: topic,
    From: [f.name, f.email].filter(Boolean).join(' - ') || 'anonymous',
    Message: f.message,
    Sent: `${ukTimestamp(sentAtSec)} UK time`,
    'App build': APP_BUILD,
    'Report JSON': `${REPORT_JSON_MARKER} ${JSON.stringify(json)}`,
  };
}

/** Posts one report. Throws with FormSubmit's own message when it isn't delivered (offline, or the form not yet activated). */
async function postReport(fields: Record<string, string>): Promise<void> {
  // A dev server never emails - testing would flood the inbox. The report is
  // logged instead and stays queued (the dev origin has its own IndexedDB).
  if (import.meta.env.DEV) {
    console.info('[dry-rock] report not sent from a dev build:', fields);
    throw new Error('reports are not sent from a dev build');
  }
  const res = await fetch(REPORT_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(fields),
  });
  let body: { success?: string | boolean; message?: string } = {};
  try {
    body = await res.json();
  } catch {
    // leave empty - the status code decides
  }
  if (!res.ok || String(body.success) !== 'true') {
    throw new Error(body.message || `the report service answered ${res.status}`);
  }
}

export function sendFeedback(f: Feedback): Promise<void> {
  return postReport(feedbackEmailFields(f, Math.floor(Date.now() / 1000)));
}

let sweep: Promise<number> | null = null;
let sweepAgain = false;

/**
 * Sends every saved observation that hasn't been sent yet, oldest first, and
 * marks each one sent. Stops at the first failure (no signal, most likely) and
 * leaves the rest for next time - it runs on app start, when the browser comes
 * back online, and after each save. Resolves to how many are still waiting.
 */
export function sendPendingObservations(): Promise<number> {
  if (sweep) {
    sweepAgain = true; // something saved mid-sweep gets picked up by a second pass
    return sweep;
  }
  sweep = (async () => {
    let waiting = 0;
    do {
      sweepAgain = false;
      const pending = (await listAllObservations()).filter((o) => o.sentAtSec == null).reverse();
      waiting = pending.length;
      for (const o of pending) {
        try {
          await postReport(observationEmailFields(o));
        } catch {
          return waiting;
        }
        await markObservationSent(o.id, Math.floor(Date.now() / 1000));
        waiting--;
      }
    } while (sweepAgain);
    return waiting;
  })().finally(() => {
    sweep = null;
  });
  return sweep;
}

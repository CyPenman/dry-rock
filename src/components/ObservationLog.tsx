import { useEffect, useState } from 'react';
import { APP_BUILD, modelSaid, sendPendingObservations } from '../api/reports';
import { formatDayLabel, formatTimeOfDay } from '../lib/format';
import type { CragForecastResult } from '../model/dayAggregate';
import {
  buildObservationContext,
  buildObservationSnapshot,
  OBSERVED_CONDITIONS,
  type Observation,
  type ObservedCondition,
} from '../model/observation';
import type { Crag } from '../model/types';
import { addObservation, listObservations } from '../storage/db';

const RECENT_COUNT = 5;

function conditionLabel(condition: ObservedCondition): string {
  return OBSERVED_CONDITIONS.find((c) => c.value === condition)?.label ?? condition;
}

type SendState = 'sending' | 'sent' | 'waiting';

/**
 * "Log conditions" (spec §8.1): what the rock is actually like right now, saved
 * with the model's view of the same hour so the two can be compared later.
 * Kept on the device and emailed to the developer - straight away, or on the
 * next open with signal (`sendPendingObservations`).
 */
export function ObservationLog({
  crag,
  forecast,
  fetchedAt,
}: {
  crag: Crag;
  forecast: CragForecastResult;
  fetchedAt: number | null;
}) {
  const [condition, setCondition] = useState<ObservedCondition | null>(null);
  const [note, setNote] = useState('');
  const [saved, setSaved] = useState<Observation | null>(null);
  const [sendState, setSendState] = useState<SendState | null>(null);
  const [recent, setRecent] = useState<Observation[]>([]);
  const [error, setError] = useState<string | null>(null);

  // "Now" as of opening the screen, to decide whether logging is possible; the
  // saved snapshot is rebuilt at the moment Save is pressed.
  const [openedAtSec] = useState(() => Date.now() / 1000);
  const snapshot = buildObservationSnapshot(crag, forecast, openedAtSec);

  useEffect(() => {
    let cancelled = false;
    listObservations(crag.id)
      .then((list) => !cancelled && setRecent(list.slice(0, RECENT_COUNT)))
      .catch(() => !cancelled && setRecent([]));
    return () => {
      cancelled = true;
    };
  }, [crag.id, saved, sendState]);

  async function save() {
    if (!condition) return;
    const observedAtSec = Math.floor(Date.now() / 1000);
    const current = buildObservationSnapshot(crag, forecast, observedAtSec);
    const context = buildObservationContext(crag, forecast, observedAtSec, fetchedAt, APP_BUILD);
    if (!current) {
      setError("the saved forecast doesn't cover right now - refresh first");
      return;
    }
    const observation: Observation = {
      id: `${crag.id}-${observedAtSec}`,
      cragId: crag.id,
      observedAtSec,
      condition,
      ...(note.trim() ? { note: note.trim() } : {}),
      snapshot: current,
      ...(context ? { context } : {}),
    };
    try {
      await addObservation(observation);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return;
    }
    setSaved(observation);
    setCondition(null);
    setNote('');
    setError(null);
    setSendState('sending');
    const waiting = await sendPendingObservations().catch(() => 1);
    setSendState(waiting === 0 ? 'sent' : 'waiting');
  }

  return (
    <div className="mx-4 mt-4 rounded border p-3" style={{ borderColor: 'var(--border)' }}>
      <h2 className="pb-2 text-xs uppercase tracking-wide" style={{ color: 'var(--text-dim)' }}>
        Log conditions
      </h2>
      {!snapshot && (
        <p className="pb-2 text-sm" style={{ color: 'var(--text-dim)' }}>
          The saved forecast doesn't cover right now, so there's nothing to compare a report against - refresh first.
        </p>
      )}
      <div className="flex flex-wrap gap-1.5">
        {OBSERVED_CONDITIONS.map((c) => (
          <button
            key={c.value}
            type="button"
            disabled={!snapshot}
            onClick={() => setCondition(c.value)}
            className="rounded-full px-3 py-1.5 text-sm disabled:opacity-40"
            style={{
              background: condition === c.value ? 'var(--signal)' : 'var(--ground-raised)',
              color: condition === c.value ? 'var(--ground)' : 'var(--text)',
            }}
          >
            {c.label}
          </button>
        ))}
      </div>
      <div className="mt-2 flex gap-2">
        <input
          type="text"
          value={note}
          disabled={!snapshot}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Note (optional)"
          maxLength={200}
          className="h-11 min-w-0 flex-1 rounded border px-3 text-sm"
          style={{ borderColor: 'var(--border)', background: 'var(--ground-raised)', color: 'var(--text)' }}
        />
        <button
          type="button"
          disabled={!snapshot || !condition}
          onClick={save}
          className="h-11 shrink-0 rounded px-4 text-sm font-medium disabled:opacity-40"
          style={{ background: 'var(--signal)', color: 'var(--ground)' }}
        >
          Save
        </button>
      </div>
      <p className="mt-2 text-xs" style={{ color: 'var(--text-dim)' }}>
        Saved on this phone and sent to Dry Rock's developer, with the forecast for the same hour, to help fix the model.
      </p>
      {saved && (
        <p className="mt-2 text-sm" style={{ color: 'var(--text)' }}>
          Saved - the model said: {modelSaid(saved.snapshot)}.{' '}
          {sendState === 'sending' && 'Sending...'}
          {sendState === 'sent' && 'Sent, thanks.'}
          {sendState === 'waiting' && "Couldn't send yet - it'll go next time you open the app with signal."}
        </p>
      )}
      {error && (
        <p className="mt-2 text-sm" style={{ color: 'var(--warning)' }}>
          Couldn't save: {error}
        </p>
      )}
      {recent.length > 0 && (
        <ul className="mt-3 space-y-1 text-xs" style={{ color: 'var(--text-dim)' }}>
          {recent.map((o) => {
            const when = new Date(o.observedAtSec * 1000);
            return (
              <li key={o.id}>
                {formatDayLabel(when)} {formatTimeOfDay(when)} &middot; you said {conditionLabel(o.condition).toLowerCase()}{' '}
                &middot; the model said {modelSaid(o.snapshot)}
                {o.sentAtSec == null && ' · not sent yet'}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

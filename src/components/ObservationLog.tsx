import { useEffect, useState } from 'react';
import { formatDayLabel, formatTimeOfDay, LIMITING_FACTOR_LABEL } from '../lib/format';
import type { CragForecastResult } from '../model/dayAggregate';
import { buildObservationSnapshot, OBSERVED_CONDITIONS, type Observation, type ObservedCondition } from '../model/observation';
import type { Crag } from '../model/types';
import type { LimitingFactor } from '../model/wetness';
import { addObservation, listObservations } from '../storage/db';

const RECENT_COUNT = 5;

/** "dry" or "wet, limited by rain" - the model's side of an observation, in words. */
function modelSaid(snapshot: Observation['snapshot']): string {
  if (snapshot.climbable) return 'dry';
  const reason = LIMITING_FACTOR_LABEL[snapshot.limitingFactor as LimitingFactor];
  return reason ? `wet, ${reason}` : 'wet';
}

function conditionLabel(condition: ObservedCondition): string {
  return OBSERVED_CONDITIONS.find((c) => c.value === condition)?.label ?? condition;
}

/**
 * "Log conditions" (spec §8.1): what the rock is actually like right now, saved
 * with the model's view of the same hour so the two can be compared later.
 * Stays on the device; exported from the About screen.
 */
export function ObservationLog({ crag, forecast }: { crag: Crag; forecast: CragForecastResult }) {
  const [condition, setCondition] = useState<ObservedCondition | null>(null);
  const [note, setNote] = useState('');
  const [saved, setSaved] = useState<Observation | null>(null);
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
  }, [crag.id, saved]);

  async function save() {
    if (!condition) return;
    const observedAtSec = Math.floor(Date.now() / 1000);
    const current = buildObservationSnapshot(crag, forecast, observedAtSec);
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
    };
    try {
      await addObservation(observation);
      setSaved(observation);
      setCondition(null);
      setNote('');
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
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
      {saved && (
        <p className="mt-2 text-sm" style={{ color: 'var(--text)' }}>
          Saved - the model said: {modelSaid(saved.snapshot)}
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
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

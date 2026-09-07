import { useMemo, useState } from 'react';
import { CRAGS } from '../data/crags';
import type { Discipline, RockType } from '../model/types';

export function SearchScreen({ onSelectCrag, onBack }: { onSelectCrag: (id: string) => void; onBack: () => void }) {
  const [query, setQuery] = useState('');
  const [discipline, setDiscipline] = useState<Discipline | null>(null);
  const [rock, setRock] = useState<RockType | null>(null);

  const disciplines = useMemo(() => [...new Set(CRAGS.flatMap((c) => c.disciplines))].sort(), []);
  const rockTypes = useMemo(() => [...new Set(CRAGS.map((c) => c.rock))].sort(), []);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    return CRAGS.filter((c) => {
      if (discipline && !c.disciplines.includes(discipline)) return false;
      if (rock && c.rock !== rock) return false;
      if (!q) return true;
      return c.name.toLowerCase().includes(q) || c.area.toLowerCase().includes(q);
    });
  }, [query, discipline, rock]);

  return (
    <div className="mx-auto max-w-screen-sm pb-8">
      <header className="sticky top-0 z-10 px-2 py-2" style={{ background: 'var(--ground)' }}>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onBack}
            className="flex h-11 items-center gap-1 rounded px-3 text-base font-medium"
            style={{ color: 'var(--signal)' }}
          >
            <span aria-hidden="true">&larr;</span> Back
          </button>
          <h1 className="text-xl font-medium">Search</h1>
        </div>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Name or area..."
          className="mt-2 h-11 w-full rounded border px-3 text-sm"
          style={{ borderColor: 'var(--border)', background: 'var(--ground-raised)', color: 'var(--text)' }}
        />
        <div className="mt-2 flex flex-wrap gap-1.5">
          {disciplines.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDiscipline(discipline === d ? null : d)}
              className="rounded-full px-3 py-1.5 text-sm capitalize"
              style={{
                background: discipline === d ? 'var(--signal)' : 'var(--ground-raised)',
                color: discipline === d ? 'var(--ground)' : 'var(--text)',
              }}
            >
              {d}
            </button>
          ))}
          {rockTypes.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRock(rock === r ? null : r)}
              className="rounded-full px-3 py-1.5 text-sm capitalize"
              style={{
                background: rock === r ? 'var(--signal)' : 'var(--ground-raised)',
                color: rock === r ? 'var(--ground)' : 'var(--text)',
              }}
            >
              {r}
            </button>
          ))}
        </div>
      </header>

      {results.map((c) => (
        <button
          key={c.id}
          type="button"
          onClick={() => onSelectCrag(c.id)}
          className="flex w-full items-baseline justify-between border-b px-4 py-3 text-left"
          style={{ borderColor: 'var(--border)' }}
        >
          <span className="text-base">{c.name}</span>
          <span className="text-sm" style={{ color: 'var(--text-dim)' }}>
            {c.area}
          </span>
        </button>
      ))}
      {results.length === 0 && (
        <p className="px-4 py-6 text-sm" style={{ color: 'var(--text-dim)' }}>
          No crags match.
        </p>
      )}
    </div>
  );
}

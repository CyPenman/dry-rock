import type { SortMode } from '../model/ranking';

const SORT_LABEL: Record<SortMode, string> = {
  score: 'Score',
  drive: 'Worth the drive',
  az: 'Name A → Z',
  za: 'Name Z → A',
  distance: 'Distance: near to far',
};

/**
 * The "Sort by" dropdown (spec §6 Home, item 5), shared by the Crags and Areas
 * tabs so both read the same. The distance-based options only appear once a
 * home location is set. `id` must differ per tab - both tabs stay mounted.
 */
export function SortControl({
  id,
  value,
  onChange,
  hasHome,
}: {
  id: string;
  value: SortMode;
  onChange: (mode: SortMode) => void;
  hasHome: boolean;
}) {
  return (
    <div className="mt-2 flex items-center gap-2 text-sm" style={{ color: 'var(--text-dim)' }}>
      <label htmlFor={id} className="shrink-0">
        Sort by
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value as SortMode)}
        className="min-w-0 flex-1 rounded border px-2 py-1.5 text-sm"
        style={{ borderColor: 'var(--border)', background: 'var(--ground-raised)', color: 'var(--text)' }}
      >
        <option value="score">{SORT_LABEL.score}</option>
        <option value="az">{SORT_LABEL.az}</option>
        <option value="za">{SORT_LABEL.za}</option>
        {hasHome && <option value="drive">{SORT_LABEL.drive}</option>}
        {hasHome && <option value="distance">{SORT_LABEL.distance}</option>}
      </select>
    </div>
  );
}

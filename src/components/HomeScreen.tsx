import { useMemo, useState } from 'react';
import type { CragWithForecast } from '../hooks/useForecast';
import { formatAgeWords, formatDayLabel } from '../lib/format';
import {
  clampRangeToData,
  dayIndexToDate,
  resolveDateRange,
  toLocalIsoDate,
  type DateRangeSelection,
} from '../model/dateRange';
import { rankCragDays, sortByDistance, sortByName, sortByWorthTheDrive, type RankedCragDay } from '../model/ranking';
import type { Settings } from '../state/settings';
import { CalendarRangePicker } from './CalendarRangePicker';
import { CragRow } from './CragRow';
import { HomeAddressSection } from './HomeAddressSection';

type SortMode = 'score' | 'drive' | 'az' | 'za' | 'distance';

const SORT_LABEL: Record<SortMode, string> = {
  score: 'Score',
  drive: 'Worth the drive',
  az: 'Name A → Z',
  za: 'Name Z → A',
  distance: 'Distance: near to far',
};

export function HomeScreen({
  results,
  loading,
  error,
  fetchedAt,
  stale,
  onRefresh,
  settings,
  updateSettings,
  togglePinned,
  onSelectCrag,
  dateRange,
  onChangeDateRange,
  todayIndex,
  dayCount,
}: {
  results: CragWithForecast[];
  loading: boolean;
  error: string | null;
  fetchedAt: number | null;
  stale: boolean;
  onRefresh: () => void;
  settings: Settings;
  updateSettings: (patch: Partial<Settings>) => void;
  togglePinned: (id: string) => void;
  onSelectCrag: (cragId: string) => void;
  dateRange: DateRangeSelection;
  onChangeDateRange: (range: DateRangeSelection) => void;
  /** Today's day index in the loaded series (from useForecast, derived from the data). */
  todayIndex: number;
  /** Whole days the loaded series covers. */
  dayCount: number;
}) {
  const [sortMode, setSortMode] = useState<SortMode>('score');
  const [pickerOpen, setPickerOpen] = useState(false);

  const maxDayIndex = dayCount - 1;
  const [startIdx, endIdx] = useMemo(() => resolveDateRange(dateRange, todayIndex), [dateRange, todayIndex]);
  // §2: never extrapolate past the saved forecast - a stale cache may not reach
  // the dates asked for, in which case say so rather than silently rank nothing.
  const { range: coveredRange, clamped } = clampRangeToData([startIdx, endIdx], dayCount);
  const outOfData = !loading && dayCount > 0 && coveredRange == null;

  const rangeLabel =
    dateRange.kind === 'weekend'
      ? 'This weekend'
      : startIdx === endIdx
        ? formatDayLabel(dayIndexToDate(startIdx, todayIndex))
        : `${formatDayLabel(dayIndexToDate(startIdx, todayIndex))} to ${formatDayLabel(dayIndexToDate(endIdx, todayIndex))}`;

  const home = settings.homeLat != null && settings.homeLon != null ? { lat: settings.homeLat, lon: settings.homeLon } : null;

  const entries = useMemo(() => results.map(({ crag, forecast }) => ({ crag, days: forecast ? forecast.days : null })), [results]);

  const coveredStart = coveredRange?.[0];
  const coveredEnd = coveredRange?.[1];
  const ranked = useMemo(
    () => (coveredStart != null && coveredEnd != null ? rankCragDays(entries, [coveredStart, coveredEnd], home) : []),
    [entries, coveredStart, coveredEnd, home],
  );
  const scored = ranked.filter((r) => r.day.verdict === 'scored');
  const gated = ranked.filter((r) => r.day.verdict !== 'scored');

  const sorted: RankedCragDay[] = useMemo(() => {
    switch (sortMode) {
      case 'drive':
        return sortByWorthTheDrive(scored);
      case 'az':
        return sortByName(scored, 'asc');
      case 'za':
        return sortByName(scored, 'desc');
      case 'distance':
        return sortByDistance(scored);
      default:
        return scored;
    }
  }, [sortMode, scored]);

  const pinnedRows = settings.pinnedCragIds
    .map((id) => ranked.find((r) => r.crag.id === id))
    .filter((r): r is RankedCragDay => r !== undefined);

  return (
    <div className="mx-auto max-w-screen-sm pb-8">
      <header className="sticky top-0 z-10 px-4 pb-3 pt-4" style={{ background: 'var(--ground)' }}>
        <div className="flex items-baseline justify-between">
          <h1 className="text-xl font-medium tracking-tight">Dry Rock</h1>
          <button type="button" onClick={onRefresh} className="text-sm" style={{ color: 'var(--signal)' }}>
            {loading ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
        <p className="mt-0.5 text-xs" style={{ color: 'var(--text-dim)' }}>
          {fetchedAt ? formatAgeWords(fetchedAt) : 'loading...'}
          {stale && ", showing cached data as we couldn't reach the network"}
        </p>

        <HomeAddressSection settings={settings} updateSettings={updateSettings} />

        <div className="mt-3 flex gap-1.5">
          <button
            type="button"
            onClick={() => onChangeDateRange({ kind: 'weekend' })}
            className="rounded-full px-3 py-1.5 text-sm"
            style={{
              background: dateRange.kind === 'weekend' ? 'var(--signal)' : 'var(--ground-raised)',
              color: dateRange.kind === 'weekend' ? 'var(--ground)' : 'var(--text)',
            }}
          >
            This weekend
          </button>
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            className="rounded-full px-3 py-1.5 text-sm"
            style={{
              background: dateRange.kind === 'custom' ? 'var(--signal)' : 'var(--ground-raised)',
              color: dateRange.kind === 'custom' ? 'var(--ground)' : 'var(--text)',
            }}
          >
            {dateRange.kind === 'custom' ? rangeLabel : 'Choose dates'}
          </button>
        </div>

        <div className="mt-2 flex items-center gap-2 text-sm" style={{ color: 'var(--text-dim)' }}>
          <label htmlFor="sortMode" className="shrink-0">
            Sort by
          </label>
          <select
            id="sortMode"
            value={sortMode}
            onChange={(e) => setSortMode(e.target.value as SortMode)}
            className="min-w-0 flex-1 rounded border px-2 py-1.5 text-sm"
            style={{ borderColor: 'var(--border)', background: 'var(--ground-raised)', color: 'var(--text)' }}
          >
            <option value="score">{SORT_LABEL.score}</option>
            <option value="az">{SORT_LABEL.az}</option>
            <option value="za">{SORT_LABEL.za}</option>
            {home && <option value="drive">{SORT_LABEL.drive}</option>}
            {home && <option value="distance">{SORT_LABEL.distance}</option>}
          </select>
        </div>
      </header>

      {error && (
        <div className="mx-4 mt-2 rounded border px-3 py-2 text-sm" style={{ borderColor: 'var(--warning)', color: 'var(--warning)' }}>
          Couldn't load the forecast: {error}
        </div>
      )}

      {outOfData && (
        <p className="mx-4 mt-3 rounded border px-3 py-2 text-sm" style={{ borderColor: 'var(--warning)', color: 'var(--warning)' }}>
          Your saved forecast doesn't reach these dates - refresh when you have signal.
        </p>
      )}
      {!outOfData && clamped && coveredRange && (
        <p className="mx-4 mt-3 text-sm" style={{ color: 'var(--text-dim)' }}>
          Showing the days the saved forecast covers.
        </p>
      )}

      {pinnedRows.length > 0 && (
        <section>
          <h2 className="px-4 pb-1 pt-3 text-xs uppercase tracking-wide" style={{ color: 'var(--text-dim)' }}>
            Pinned
          </h2>
          {pinnedRows.map((r) => (
            <CragRow key={r.crag.id} ranked={r} pinned onSelect={() => onSelectCrag(r.crag.id)} onTogglePin={() => togglePinned(r.crag.id)} />
          ))}
        </section>
      )}

      <section>
        <h2 className="px-4 pb-1 pt-3 text-xs uppercase tracking-wide" style={{ color: 'var(--text-dim)' }}>
          Ranked
        </h2>
        {!loading && !outOfData && sorted.length === 0 && (
          <p className="px-4 py-6 text-sm" style={{ color: 'var(--text-dim)' }}>
            Nothing qualifies in this window. Check the sheltered venues below: caves and roofs are their whole
            value when the forecast is bad everywhere.
          </p>
        )}
        {sorted.map((r) => (
          <CragRow
            key={r.crag.id}
            ranked={r}
            pinned={settings.pinnedCragIds.includes(r.crag.id)}
            onSelect={() => onSelectCrag(r.crag.id)}
            onTogglePin={() => togglePinned(r.crag.id)}
          />
        ))}
      </section>

      {gated.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer px-4 py-2 text-xs uppercase tracking-wide" style={{ color: 'var(--text-dim)' }}>
            Ruled out ({gated.length})
          </summary>
          {gated.map((r) => (
            <CragRow
              key={r.crag.id}
              ranked={r}
              pinned={settings.pinnedCragIds.includes(r.crag.id)}
              onSelect={() => onSelectCrag(r.crag.id)}
              onTogglePin={() => togglePinned(r.crag.id)}
            />
          ))}
        </details>
      )}

      <p className="px-4 pt-6 text-xs" style={{ color: 'var(--text-dim)' }}>
        Weather data:{' '}
        <a href="https://open-meteo.com/" target="_blank" rel="noopener noreferrer" className="underline" style={{ color: 'var(--text-dim)' }}>
          Open-Meteo.com
        </a>{' '}
        (CC BY 4.0)
      </p>

      {pickerOpen && (
        <CalendarRangePicker
          todayIndex={todayIndex}
          maxDayIndex={maxDayIndex}
          initialStartIdx={Math.min(Math.max(startIdx, todayIndex), maxDayIndex)}
          initialEndIdx={Math.min(Math.max(endIdx, todayIndex), maxDayIndex)}
          onCancel={() => setPickerOpen(false)}
          onApply={(s, e) => {
            onChangeDateRange({
              kind: 'custom',
              startDate: toLocalIsoDate(dayIndexToDate(s, todayIndex)),
              endDate: toLocalIsoDate(dayIndexToDate(e, todayIndex)),
            });
            setPickerOpen(false);
          }}
        />
      )}
    </div>
  );
}

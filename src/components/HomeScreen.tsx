import { useMemo, useState } from 'react';
import type { CragWithForecast } from '../hooks/useForecast';
import { clampRangeToData, resolveDateRange, type DateRangeSelection } from '../model/dateRange';
import { rankCragDays, sortRanked, type RankedCragDay, type SortMode } from '../model/ranking';
import type { Settings } from '../state/settings';
import { CragRow } from './CragRow';
import { DateRangeControls } from './DateRangeControls';
import { ForecastAge, NoForecastNotice } from './ForecastStatus';
import { HomeAddressSection } from './HomeAddressSection';
import { SortControl } from './SortControl';

export function HomeScreen({
  results,
  loading,
  failure,
  fetchedAt,
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
  failure: string | null;
  fetchedAt: number | null;
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
  const [startIdx, endIdx] = useMemo(() => resolveDateRange(dateRange, todayIndex), [dateRange, todayIndex]);
  // §2: never extrapolate past the saved forecast - a stale cache may not reach
  // the dates asked for, in which case say so rather than silently rank nothing.
  const { range: coveredRange, clamped } = clampRangeToData([startIdx, endIdx], dayCount);
  const outOfData = !loading && dayCount > 0 && coveredRange == null;

  const { homeLat, homeLon } = settings;
  const home = useMemo(() => (homeLat != null && homeLon != null ? { lat: homeLat, lon: homeLon } : null), [homeLat, homeLon]);

  const entries = useMemo(() => results.map(({ crag, forecast }) => ({ crag, days: forecast ? forecast.days : null })), [results]);

  const coveredStart = coveredRange?.[0];
  const coveredEnd = coveredRange?.[1];
  const ranked = useMemo(
    () => (coveredStart != null && coveredEnd != null ? rankCragDays(entries, [coveredStart, coveredEnd], home) : []),
    [entries, coveredStart, coveredEnd, home],
  );
  const scored = useMemo(() => ranked.filter((r) => r.day.verdict === 'scored'), [ranked]);
  const gated = useMemo(() => ranked.filter((r) => r.day.verdict !== 'scored'), [ranked]);

  const sorted: RankedCragDay[] = useMemo(() => sortRanked(scored, sortMode), [sortMode, scored]);

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
          <ForecastAge loading={loading} fetchedAt={fetchedAt} failure={failure} />
        </p>

        <HomeAddressSection settings={settings} updateSettings={updateSettings} />

        <DateRangeControls dateRange={dateRange} onChangeDateRange={onChangeDateRange} todayIndex={todayIndex} dayCount={dayCount} />

        <SortControl id="sortMode" value={sortMode} onChange={setSortMode} hasHome={home != null} />
      </header>

      <NoForecastNotice loading={loading} fetchedAt={fetchedAt} failure={failure} />

      {outOfData && (
        <p className="mx-4 mt-3 rounded border px-3 py-2 text-sm" style={{ borderColor: 'var(--warning)', color: 'var(--warning)' }}>
          Your saved forecast doesn't reach these dates. Refresh to get a newer one.
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

      {fetchedAt != null && (
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
      )}

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
        A forecast, not an inspection - check the rock and current access yourself before you climb.
      </p>
      <p className="px-4 pt-1 text-xs" style={{ color: 'var(--text-dim)' }}>
        Weather data:{' '}
        <a href="https://open-meteo.com/" target="_blank" rel="noopener noreferrer" className="underline" style={{ color: 'var(--text-dim)' }}>
          Open-Meteo.com
        </a>{' '}
        (CC BY 4.0)
      </p>
    </div>
  );
}

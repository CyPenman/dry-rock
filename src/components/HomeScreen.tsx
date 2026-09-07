import { useMemo, useState } from 'react';
import { FORECAST_DAYS, PAST_DAYS } from '../api/request';
import type { CragWithForecast } from '../hooks/useForecast';
import { formatAgeWords, formatDayLabel } from '../lib/format';
import { dayIndexToDate, resolveDateRange, type DateRangeSelection } from '../model/dateRange';
import { rankCragDays, sortByWorthTheDrive, type RankedCragDay } from '../model/ranking';
import type { Settings } from '../state/settings';
import { CalendarRangePicker } from './CalendarRangePicker';
import { CragRow } from './CragRow';

type SortMode = 'score' | 'drive';

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
}) {
  const [sortMode, setSortMode] = useState<SortMode>('score');
  const [pickerOpen, setPickerOpen] = useState(false);

  const maxDayIndex = PAST_DAYS + FORECAST_DAYS - 1;
  const [startIdx, endIdx] = useMemo(() => resolveDateRange(dateRange, PAST_DAYS), [dateRange]);

  const rangeLabel =
    dateRange.kind === 'weekend'
      ? 'This weekend'
      : startIdx === endIdx
        ? formatDayLabel(dayIndexToDate(startIdx, PAST_DAYS))
        : `${formatDayLabel(dayIndexToDate(startIdx, PAST_DAYS))} to ${formatDayLabel(dayIndexToDate(endIdx, PAST_DAYS))}`;

  const home = settings.homeLat != null && settings.homeLon != null ? { lat: settings.homeLat, lon: settings.homeLon } : null;

  const entries = useMemo(() => results.map(({ crag, forecast }) => ({ crag, days: forecast ? forecast.days : null })), [results]);

  const ranked = useMemo(() => rankCragDays(entries, [startIdx, endIdx], home), [entries, startIdx, endIdx, home]);
  const scored = ranked.filter((r) => r.day.verdict === 'scored');
  const gated = ranked.filter((r) => r.day.verdict !== 'scored');

  const sorted: RankedCragDay[] = sortMode === 'drive' ? sortByWorthTheDrive(scored) : scored;

  const pinnedRows = settings.pinnedCragIds
    .map((id) => ranked.find((r) => r.crag.id === id))
    .filter((r): r is RankedCragDay => r !== undefined);

  function requestLocation() {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => updateSettings({ homeLat: pos.coords.latitude, homeLon: pos.coords.longitude }),
      () => {
        /* denied or unavailable — leave home unset */
      },
    );
  }

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

        {home === null && (
          <button
            type="button"
            onClick={requestLocation}
            className="mt-2 w-full rounded border px-3 py-2 text-left text-sm"
            style={{ borderColor: 'var(--border)', color: 'var(--text-dim)' }}
          >
            Set home location to see distance and sort by "worth the drive"
          </button>
        )}

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
          <label htmlFor="minWindow">Min dry window</label>
          <input
            id="minWindow"
            type="range"
            min={12}
            max={96}
            step={12}
            value={settings.minWindowHours}
            onChange={(e) => updateSettings({ minWindowHours: Number(e.target.value) })}
            className="h-11 flex-1"
          />
          <span className="w-10 shrink-0 text-right font-mono">{settings.minWindowHours}h</span>
        </div>

        {home && (
          <div className="mt-2 flex gap-1.5 text-sm">
            <button
              type="button"
              onClick={() => setSortMode('score')}
              style={{ color: sortMode === 'score' ? 'var(--signal)' : 'var(--text-dim)' }}
            >
              By score
            </button>
            <span style={{ color: 'var(--text-dim)' }}>&middot;</span>
            <button
              type="button"
              onClick={() => setSortMode('drive')}
              style={{ color: sortMode === 'drive' ? 'var(--signal)' : 'var(--text-dim)' }}
            >
              Worth the drive
            </button>
          </div>
        )}
      </header>

      {error && (
        <div className="mx-4 mt-2 rounded border px-3 py-2 text-sm" style={{ borderColor: 'var(--warning)', color: 'var(--warning)' }}>
          Couldn't load the forecast: {error}
        </div>
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
        {!loading && sorted.length === 0 && (
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

      {pickerOpen && (
        <CalendarRangePicker
          todayIndex={PAST_DAYS}
          maxDayIndex={maxDayIndex}
          initialStartIdx={dateRange.kind === 'custom' ? dateRange.startIdx : startIdx}
          initialEndIdx={dateRange.kind === 'custom' ? dateRange.endIdx : endIdx}
          onCancel={() => setPickerOpen(false)}
          onApply={(s, e) => {
            onChangeDateRange({ kind: 'custom', startIdx: s, endIdx: e });
            setPickerOpen(false);
          }}
        />
      )}
    </div>
  );
}

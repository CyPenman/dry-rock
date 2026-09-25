import { useMemo, useState } from 'react';
import type { CragWithForecast } from '../hooks/useForecast';
import { formatAgeWords, formatDayLabel, formatDistanceMiles } from '../lib/format';
import { nearestKm, sortAreas, summariseAreas, type AreaDay, type AreaSummary } from '../model/areas';
import { clampRangeToData, resolveDateRange, type DateRangeSelection } from '../model/dateRange';
import { rankCragDays, type RankedCragDay, type SortMode } from '../model/ranking';
import { SCORE_BAND_COLOR_VAR, SCORE_BAND_LABEL, type ScoreBand } from '../model/scoreBand';
import type { Region } from '../model/types';
import type { Settings } from '../state/settings';
import { DayStrip, dayStripColumns } from './CragRow';
import { DateRangeControls } from './DateRangeControls';
import { Explain } from './Explain';
import { HomeAddressSection } from './HomeAddressSection';
import { SortControl } from './SortControl';

const DAY_SHORT = new Intl.DateTimeFormat('en-GB', { weekday: 'short' });
const BANDS: ScoreBand[] = ['good', 'fair', 'poor'];

/**
 * How the region's crags split across good / fair / poor that day - a stacked
 * bar in the style of UKC's grade-spread bars.
 */
function SpreadBar({ bands, total }: { bands: AreaDay['bands']; total: number }) {
  return (
    <div className="flex gap-px" style={{ height: 6 }}>
      {total > 0 &&
        BANDS.filter((b) => bands[b] > 0).map((b) => (
          <div key={b} style={{ flexGrow: bands[b], flexBasis: 0, background: SCORE_BAND_COLOR_VAR[b] }} />
        ))}
    </div>
  );
}

/**
 * One cell per day: the best crag's score on top, the band spread in a dark
 * footer under it. Only the top half takes the best day's green fill (as on crag
 * rows) - the bar always sits on dark, or its green "good" segment would vanish
 * into the fill.
 */
function AreaDayStrip({ area }: { area: AreaSummary }) {
  return (
    <div className="mt-2 grid gap-[3px]" style={{ gridTemplateColumns: `repeat(${dayStripColumns(area.days.length)},minmax(0,1fr))` }}>
      {area.days.map((d) => {
        const isBest = d.dayIndex === area.bestDay?.dayIndex;
        const allOut = d.bestScore == null;
        return (
          <div key={d.dayIndex} className="text-center" style={{ border: `1px solid ${isBest ? 'var(--signal)' : 'var(--border)'}` }}>
            <div style={{ background: isBest ? 'var(--signal)' : 'var(--ground-raised)', padding: '5px 2px 4px' }}>
              <div style={{ font: '600 9px/1 ui-monospace,Menlo,monospace', letterSpacing: '0.03em', color: isBest ? 'var(--ground)' : 'var(--text-dim)' }}>
                {DAY_SHORT.format(d.date)}
              </div>
              <div
                style={{
                  font: `600 ${allOut ? '13px' : '15px'}/1.1 ui-monospace,Menlo,monospace`,
                  color: allOut ? 'var(--warning)' : isBest ? 'var(--ground)' : 'var(--text)',
                  marginTop: 3,
                }}
              >
                {allOut ? '×' : Math.round(d.bestScore! * 100)}
              </div>
            </div>
            <div style={{ background: 'var(--ground-sunken)', padding: 3 }}>
              <SpreadBar bands={d.bands} total={d.total} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** The finer area label ("Llandudno"), only where the region's name doesn't already say it ("Peak" in "Peak District"). */
function subArea(r: RankedCragDay): string | null {
  return r.crag.region.includes(r.crag.area) ? null : r.crag.area;
}

function CompactCragRow({ ranked, onSelect }: { ranked: RankedCragDay; onSelect: () => void }) {
  const { crag, day } = ranked;
  const isGated = day.verdict !== 'scored';
  const area = subArea(ranked);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => e.key === 'Enter' && onSelect()}
      className="border-t px-3 py-2.5 active:opacity-70"
      style={{ borderColor: 'var(--border)' }}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="min-w-0 truncate text-sm font-medium">
          {crag.name}
          {area && (
            <span className="ml-1.5 text-xs font-normal" style={{ color: 'var(--text-dim)' }}>
              {area}
            </span>
          )}
        </span>
        {isGated ? (
          <span className="shrink-0 text-xs" style={{ color: 'var(--warning)' }}>
            ruled out
          </span>
        ) : (
          <span className="shrink-0 font-mono text-sm font-medium">
            <span className="mr-1 font-sans text-xs font-normal" style={{ color: 'var(--text-dim)' }}>
              {DAY_SHORT.format(day.date)}
            </span>
            {Math.round(day.displayScore * 100)}
          </span>
        )}
      </div>
      <DayStrip ranked={ranked} compact />
    </div>
  );
}

function AreaCard({
  area,
  expanded,
  onToggle,
  onSelectCrag,
}: {
  area: AreaSummary;
  expanded: boolean;
  onToggle: () => void;
  onSelectCrag: (id: string) => void;
}) {
  const best = area.bestDay;
  const nearest = nearestKm(area);

  return (
    <section className="mx-3 mt-2 border" style={{ borderColor: 'var(--border)', background: 'var(--ground-raised)' }}>
      <button type="button" onClick={onToggle} aria-expanded={expanded} className="block w-full px-3 py-2.5 text-left active:opacity-70">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-base font-medium">
            {area.region}
            <span className="ml-1.5 text-xs" style={{ color: 'var(--text-dim)' }}>
              {expanded ? '▴' : '▾'}
            </span>
          </span>
          {best && <span className="shrink-0 font-mono text-lg font-medium">{Math.round(best.bestScore! * 100)}</span>}
        </div>
        {best ? (
          <div className="mt-0.5 text-sm" style={{ color: 'var(--text-dim)' }}>
            <span style={{ color: 'var(--text)' }}>{formatDayLabel(best.date)}</span> &middot; {best.bestCrag!.crag.name} &middot;{' '}
            {best.bands.good} of {best.total} good
            {nearest != null && <> &middot; nearest {formatDistanceMiles(nearest)}</>}
          </div>
        ) : (
          <div className="mt-0.5 text-sm" style={{ color: 'var(--warning)' }}>
            Every crag ruled out on these dates
          </div>
        )}
        <AreaDayStrip area={area} />
      </button>

      {expanded && (
        <div style={{ background: 'var(--ground)' }}>
          {area.crags.map((r) => (
            <CompactCragRow key={r.crag.id} ranked={r} onSelect={() => onSelectCrag(r.crag.id)} />
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * Areas tab (spec §6 Areas): the ranked crag list condensed into regions, each
 * scored by its best crag per day with the good/fair/poor spread underneath.
 * Tapping a region lists its crags; tapping a crag opens its page on the same
 * shared date range.
 */
export function AreasScreen({
  results,
  loading,
  error,
  fetchedAt,
  stale,
  onRefresh,
  settings,
  updateSettings,
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
  onSelectCrag: (cragId: string) => void;
  dateRange: DateRangeSelection;
  onChangeDateRange: (range: DateRangeSelection) => void;
  todayIndex: number;
  dayCount: number;
}) {
  const [expanded, setExpanded] = useState<ReadonlySet<Region>>(new Set());
  const [sortMode, setSortMode] = useState<SortMode>('score');

  const [startIdx, endIdx] = useMemo(() => resolveDateRange(dateRange, todayIndex), [dateRange, todayIndex]);
  // §2: only the days the saved forecast covers - same rule and wording as the Crags tab.
  const { range: coveredRange, clamped } = clampRangeToData([startIdx, endIdx], dayCount);
  const outOfData = !loading && dayCount > 0 && coveredRange == null;
  const coveredStart = coveredRange?.[0];
  const coveredEnd = coveredRange?.[1];

  const entries = useMemo(() => results.map(({ crag, forecast }) => ({ crag, days: forecast ? forecast.days : null })), [results]);
  // Home comes from the one `settings` held in App (and saved to localStorage), so an
  // address set here or on the Crags tab shows on both. Memoised on the coordinates
  // themselves so the ranking isn't redone on every render.
  const { homeLat, homeLon } = settings;
  const home = useMemo(() => (homeLat != null && homeLon != null ? { lat: homeLat, lon: homeLon } : null), [homeLat, homeLon]);
  const areas = useMemo(
    () => (coveredStart != null && coveredEnd != null ? summariseAreas(rankCragDays(entries, [coveredStart, coveredEnd], home)) : []),
    [entries, coveredStart, coveredEnd, home],
  );
  const sortedAreas = useMemo(() => sortAreas(areas, sortMode), [areas, sortMode]);

  function toggle(region: Region) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(region)) next.delete(region);
      else next.add(region);
      return next;
    });
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

        <HomeAddressSection settings={settings} updateSettings={updateSettings} />

        <DateRangeControls dateRange={dateRange} onChangeDateRange={onChangeDateRange} todayIndex={todayIndex} dayCount={dayCount} />
        <SortControl id="areaSortMode" value={sortMode} onChange={setSortMode} hasHome={home != null} />

        <div className="mt-2.5 flex flex-wrap gap-x-3.5 gap-y-1 text-xs" style={{ color: 'var(--text-dim)' }}>
          {BANDS.map((band) => (
            <span key={band} className="inline-flex items-center gap-1.5">
              <span className="inline-block h-[6px] w-3 shrink-0" style={{ background: SCORE_BAND_COLOR_VAR[band] }} />
              {band === 'poor' ? `${SCORE_BAND_LABEL.poor} or ruled out` : SCORE_BAND_LABEL[band]}
            </span>
          ))}
        </div>
        <Explain>
          Each area's number is its best crag's score that day, so it answers "is there somewhere good here?". The bar
          under it shows how that area's crags split between good, fair and poor, so one sheltered crag on a wet day
          doesn't look like a good day for the whole area. Sorting orders the areas and the crags inside them; by distance,
          an area is as near as its nearest crag. Tap an area to see its crags, and a crag to open its page.
        </Explain>
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

      {sortedAreas.map((a) => (
        <AreaCard key={a.region} area={a} expanded={expanded.has(a.region)} onToggle={() => toggle(a.region)} onSelectCrag={onSelectCrag} />
      ))}

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

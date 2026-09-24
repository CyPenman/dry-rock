import { useRef, useState } from 'react';
import { AboutScreen } from './components/AboutScreen';
import { AreasScreen } from './components/AreasScreen';
import { CragDetailScreen } from './components/CragDetailScreen';
import { CragsMap } from './components/CragsMap';
import { HomeScreen } from './components/HomeScreen';
import { SearchScreen } from './components/SearchScreen';
import { CRAGS } from './data/crags';
import { useForecast } from './hooks/useForecast';
import { DEFAULT_DATE_RANGE, type DateRangeSelection } from './model/dateRange';
import { useSettings } from './state/settings';

type View = { name: 'home' } | { name: 'detail'; cragId: string } | { name: 'search' } | { name: 'about' };
/** Left to right, as in the bottom bar; the swipe track lays the panels out in this order (spec §6). */
const TABS = ['areas', 'crags', 'map'] as const;
type Tab = (typeof TABS)[number];
const TAB_LABEL: Record<Tab, string> = { areas: 'Areas', crags: 'Crags', map: 'Map' };

/** How far (px) and how horizontal a touch move must be to count as a tab-switch swipe - spec §6. */
const SWIPE_THRESHOLD_PX = 60;
const SWIPE_HORIZONTAL_BIAS = 1.5;

function App() {
  const [view, setView] = useState<View>({ name: 'home' });
  const [activeTab, setActiveTab] = useState<Tab>('areas');
  const [dateRange, setDateRange] = useState<DateRangeSelection>(DEFAULT_DATE_RANGE);
  const { settings, update, togglePinned } = useSettings();
  const { loading, error, fetchedAt, stale, results, todayIndex, dayCount, refresh } = useForecast(CRAGS);
  const touchRef = useRef<{ x: number; y: number } | null>(null);

  const activeIndex = TABS.indexOf(activeTab);
  const detailEntry = view.name === 'detail' ? results.find((r) => r.crag.id === view.cragId) : undefined;

  function handleTouchStart(e: React.TouchEvent) {
    const target = e.target as HTMLElement;
    // Ignored entirely for a gesture starting on the map, so Leaflet keeps native pan/pinch
    // control there (spec §6). The bottom nav bar is a sibling outside this handler's subtree
    // entirely, not just excluded here - see the touch-action comment above.
    if (target.closest('.leaflet-container')) {
      touchRef.current = null;
      return;
    }
    const t = e.touches[0];
    touchRef.current = { x: t.clientX, y: t.clientY };
  }

  function handleTouchEnd(e: React.TouchEvent) {
    const start = touchRef.current;
    touchRef.current = null;
    if (!start) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (Math.abs(dx) > SWIPE_THRESHOLD_PX && Math.abs(dx) > Math.abs(dy) * SWIPE_HORIZONTAL_BIAS) {
      const next = activeIndex + (dx < 0 ? 1 : -1);
      if (next >= 0 && next < TABS.length) setActiveTab(TABS[next]);
    }
  }

  return (
    <>
      <div
        className="mx-auto flex max-w-screen-sm flex-col overflow-hidden"
        // 100dvh (not 100vh/h-screen): on Chrome for Android the URL bar stays
        // docked at the top and 100vh sizes against the viewport with the bar
        // hidden, pushing the bottom tab bar off-screen below the fold.
        style={{ background: 'var(--ground)', height: '100dvh', overscrollBehavior: 'none' }}
      >
        <div className="flex shrink-0 justify-end gap-4 px-4 pt-2">
          <button type="button" onClick={() => setView({ name: 'about' })} className="text-sm" style={{ color: 'var(--signal)' }}>
            About
          </button>
          <button type="button" onClick={() => setView({ name: 'search' })} className="text-sm" style={{ color: 'var(--signal)' }}>
            Search
          </button>
        </div>

        {/* `touch-action: pan-y` and the swipe touch handlers live on this panel only, not on
            an ancestor of `nav` below - touch-action is computed by intersecting the touch
            target's value with every ancestor's, so a restrictive value here can never be
            un-restricted by a child (nav's own touch-action, however permissive, would be
            clipped back down to whatever an ancestor declares). Keeping `nav` outside this
            subtree is what actually lets its taps resolve as clicks; nav's own `touch-action:
            manipulation` further down is not enough on its own - see spec §6. */}
        <div
          className="relative min-h-0 flex-1 overflow-hidden"
          style={{ touchAction: 'pan-y' }}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
        >
          <div
            className="flex h-full"
            style={{
              width: `${TABS.length * 100}%`,
              transform: `translateX(-${(activeIndex * 100) / TABS.length}%)`,
              transition: 'transform 280ms ease',
            }}
          >
            <div className="h-full w-1/3 min-w-0 overflow-y-auto">
              <AreasScreen
                results={results}
                loading={loading}
                error={error}
                fetchedAt={fetchedAt}
                stale={stale}
                onRefresh={refresh}
                settings={settings}
                updateSettings={update}
                onSelectCrag={(id) => setView({ name: 'detail', cragId: id })}
                dateRange={dateRange}
                onChangeDateRange={setDateRange}
                todayIndex={todayIndex}
                dayCount={dayCount}
              />
            </div>
            <div className="h-full w-1/3 min-w-0 overflow-y-auto">
              <HomeScreen
                results={results}
                loading={loading}
                error={error}
                fetchedAt={fetchedAt}
                stale={stale}
                onRefresh={refresh}
                settings={settings}
                updateSettings={update}
                togglePinned={togglePinned}
                onSelectCrag={(id) => setView({ name: 'detail', cragId: id })}
                dateRange={dateRange}
                onChangeDateRange={setDateRange}
                todayIndex={todayIndex}
                dayCount={dayCount}
              />
            </div>
            <div className="h-full w-1/3 min-w-0 overflow-hidden">
              <CragsMap
                results={results}
                dateRange={dateRange}
                todayIndex={todayIndex}
                dayCount={dayCount}
                active={activeTab === 'map'}
                loading={loading}
                fetchedAt={fetchedAt}
                stale={stale}
                onRefresh={refresh}
                onSelectCrag={(id) => setView({ name: 'detail', cragId: id })}
              />
            </div>
          </div>
        </div>

        <nav className="flex shrink-0 border-t" style={{ background: 'var(--ground-raised)', borderColor: 'var(--border)', touchAction: 'manipulation' }}>
          {TABS.map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              aria-current={activeTab === tab ? 'page' : undefined}
              className="min-h-11 flex-1 py-3 text-sm"
              style={{ color: activeTab === tab ? 'var(--signal)' : 'var(--text-dim)', fontWeight: activeTab === tab ? 500 : 400 }}
            >
              {TAB_LABEL[tab]}
            </button>
          ))}
        </nav>
      </div>

      {/* Overlaid rather than swapped in, so the Areas/Crags/Map tree behind - its scroll
          position, tab, and map viewport - is never unmounted and is exactly as the
          user left it when they come back. */}
      {view.name === 'search' && (
        <div className="fixed inset-0 z-50 overflow-y-auto" style={{ background: 'var(--ground)' }}>
          <SearchScreen onBack={() => setView({ name: 'home' })} onSelectCrag={(id) => setView({ name: 'detail', cragId: id })} />
        </div>
      )}
      {view.name === 'about' && (
        <div className="fixed inset-0 z-50 overflow-y-auto" style={{ background: 'var(--ground)' }}>
          <AboutScreen onBack={() => setView({ name: 'home' })} />
        </div>
      )}
      {view.name === 'detail' && detailEntry && (
        <div className="fixed inset-0 z-50 overflow-y-auto" style={{ background: 'var(--ground)' }}>
          <CragDetailScreen
            entry={detailEntry}
            pinned={settings.pinnedCragIds.includes(view.cragId)}
            onTogglePin={() => togglePinned(view.cragId)}
            onBack={() => setView({ name: 'home' })}
            dateRange={dateRange}
            todayIndex={todayIndex}
            dayCount={dayCount}
            loading={loading}
            fetchedAt={fetchedAt}
            stale={stale}
            onRefresh={refresh}
            homeSettings={settings}
          />
        </div>
      )}
    </>
  );
}

export default App;

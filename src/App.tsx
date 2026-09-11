import { useRef, useState } from 'react';
import { PAST_DAYS } from './api/request';
import { CragDetailScreen } from './components/CragDetailScreen';
import { CragsMap } from './components/CragsMap';
import { HomeScreen } from './components/HomeScreen';
import { SearchScreen } from './components/SearchScreen';
import { CRAGS } from './data/crags';
import { useForecast } from './hooks/useForecast';
import { DEFAULT_DATE_RANGE, type DateRangeSelection } from './model/dateRange';
import { useSettings } from './state/settings';

type View = { name: 'home' } | { name: 'detail'; cragId: string } | { name: 'search' };
type Tab = 'crags' | 'map';

/** How far (px) and how horizontal a touch move must be to count as a tab-switch swipe - spec §6. */
const SWIPE_THRESHOLD_PX = 60;
const SWIPE_HORIZONTAL_BIAS = 1.5;

function App() {
  const [view, setView] = useState<View>({ name: 'home' });
  const [activeTab, setActiveTab] = useState<Tab>('crags');
  const [dateRange, setDateRange] = useState<DateRangeSelection>(DEFAULT_DATE_RANGE);
  const { settings, update, togglePinned } = useSettings();
  const { loading, error, fetchedAt, stale, results, refresh } = useForecast(CRAGS);
  const touchRef = useRef<{ x: number; y: number } | null>(null);

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
      if (dx < 0 && activeTab === 'crags') setActiveTab('map');
      if (dx > 0 && activeTab === 'map') setActiveTab('crags');
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
        <div className="flex shrink-0 justify-end px-4 pt-2">
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
            style={{ width: '200%', transform: activeTab === 'map' ? 'translateX(-50%)' : 'translateX(0)', transition: 'transform 280ms ease' }}
          >
            <div className="h-full w-1/2 min-w-0 overflow-y-auto">
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
              />
            </div>
            <div className="h-full w-1/2 min-w-0 overflow-hidden">
              <CragsMap
                results={results}
                dateRange={dateRange}
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
          <button
            type="button"
            onClick={() => setActiveTab('crags')}
            className="min-h-11 flex-1 py-3 text-sm"
            style={{ color: activeTab === 'crags' ? 'var(--signal)' : 'var(--text-dim)', fontWeight: activeTab === 'crags' ? 500 : 400 }}
          >
            Crags
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('map')}
            className="min-h-11 flex-1 py-3 text-sm"
            style={{ color: activeTab === 'map' ? 'var(--signal)' : 'var(--text-dim)', fontWeight: activeTab === 'map' ? 500 : 400 }}
          >
            Map
          </button>
        </nav>
      </div>

      {/* Overlaid rather than swapped in, so the Crags/Map tree behind - its scroll
          position, tab, and map viewport - is never unmounted and is exactly as the
          user left it when they come back. */}
      {view.name === 'search' && (
        <div className="fixed inset-0 z-50 overflow-y-auto" style={{ background: 'var(--ground)' }}>
          <SearchScreen onBack={() => setView({ name: 'home' })} onSelectCrag={(id) => setView({ name: 'detail', cragId: id })} />
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
            todayIndex={PAST_DAYS}
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

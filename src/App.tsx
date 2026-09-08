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
  const touchRef = useRef<{ x: number; y: number; onMap: boolean } | null>(null);

  if (view.name === 'search') {
    return (
      <SearchScreen
        onBack={() => setView({ name: 'home' })}
        onSelectCrag={(id) => setView({ name: 'detail', cragId: id })}
      />
    );
  }

  if (view.name === 'detail') {
    const entry = results.find((r) => r.crag.id === view.cragId);
    if (!entry) return null;
    return (
      <CragDetailScreen
        entry={entry}
        pinned={settings.pinnedCragIds.includes(view.cragId)}
        onTogglePin={() => togglePinned(view.cragId)}
        onBack={() => setView({ name: 'home' })}
        dateRange={dateRange}
        todayIndex={PAST_DAYS}
      />
    );
  }

  function handleTouchStart(e: React.TouchEvent) {
    const t = e.touches[0];
    touchRef.current = { x: t.clientX, y: t.clientY, onMap: (e.target as HTMLElement).closest('.leaflet-container') != null };
  }

  function handleTouchEnd(e: React.TouchEvent) {
    const start = touchRef.current;
    touchRef.current = null;
    // Ignored when the gesture started on the map, so Leaflet's own pan/pinch keeps full control there - spec §6.
    if (!start || start.onMap) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (Math.abs(dx) > SWIPE_THRESHOLD_PX && Math.abs(dx) > Math.abs(dy) * SWIPE_HORIZONTAL_BIAS) {
      if (dx < 0 && activeTab === 'crags') setActiveTab('map');
      if (dx > 0 && activeTab === 'map') setActiveTab('crags');
    }
  }

  return (
    <div
      className="mx-auto flex h-screen max-w-screen-sm flex-col overflow-hidden"
      style={{ background: 'var(--ground)' }}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      <div className="flex shrink-0 justify-end px-4 pt-2">
        <button type="button" onClick={() => setView({ name: 'search' })} className="text-sm" style={{ color: 'var(--signal)' }}>
          Search
        </button>
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden">
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
            <CragsMap results={results} dateRange={dateRange} active={activeTab === 'map'} />
          </div>
        </div>
      </div>

      <nav className="flex shrink-0 border-t" style={{ background: 'var(--ground-raised)', borderColor: 'var(--border)' }}>
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
  );
}

export default App;

import { useState } from 'react';
import { PAST_DAYS } from './api/request';
import { CragDetailScreen } from './components/CragDetailScreen';
import { HomeScreen } from './components/HomeScreen';
import { SearchScreen } from './components/SearchScreen';
import { CRAGS } from './data/crags';
import { useForecast } from './hooks/useForecast';
import { DEFAULT_DATE_RANGE, type DateRangeSelection } from './model/dateRange';
import { useSettings } from './state/settings';

type View = { name: 'home' } | { name: 'detail'; cragId: string } | { name: 'search' };

function App() {
  const [view, setView] = useState<View>({ name: 'home' });
  const [dateRange, setDateRange] = useState<DateRangeSelection>(DEFAULT_DATE_RANGE);
  const { settings, update, togglePinned } = useSettings();
  const { loading, error, fetchedAt, stale, results, refresh } = useForecast(CRAGS);

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

  return (
    <div>
      <div className="mx-auto flex max-w-screen-sm justify-end px-4 pt-2">
        <button type="button" onClick={() => setView({ name: 'search' })} className="text-sm" style={{ color: 'var(--signal)' }}>
          Search
        </button>
      </div>
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
  );
}

export default App;

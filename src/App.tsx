import { useState } from 'react';
import { CragDetailScreen } from './components/CragDetailScreen';
import { HomeScreen } from './components/HomeScreen';
import { SearchScreen } from './components/SearchScreen';
import { CRAGS } from './data/crags';
import { useForecast } from './hooks/useForecast';
import { useSettings } from './state/settings';

type View = { name: 'home' } | { name: 'detail'; cragId: string } | { name: 'search' };

function App() {
  const [view, setView] = useState<View>({ name: 'home' });
  const { settings, update, togglePinned } = useSettings();
  const { loading, error, fetchedAt, stale, results, refresh } = useForecast(CRAGS, settings.minWindowHours);

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
      />
    </div>
  );
}

export default App;

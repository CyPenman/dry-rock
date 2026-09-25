import { formatAgeWords } from '../lib/format';

/**
 * The status under each screen's title: how old the forecast is and, when the
 * last load failed, the real reason (`useForecast`'s `failure`). Never
 * "Loading..." once loading has stopped, and never blames the connection for a
 * failure that wasn't the connection's.
 */
export function ForecastAge({ loading, fetchedAt, failure }: { loading: boolean; fetchedAt: number | null; failure: string | null }) {
  if (fetchedAt == null) {
    if (loading) return <>Loading...</>;
    return <span style={{ color: 'var(--warning)' }}>No forecast loaded</span>;
  }
  return (
    <>
      {formatAgeWords(fetchedAt)}
      {failure && !loading && <span style={{ color: 'var(--warning)' }}> &middot; Couldn't update: {failure}</span>}
    </>
  );
}

/** The boxed message when there is no forecast at all to show, with the reason. */
export function NoForecastNotice({ loading, fetchedAt, failure }: { loading: boolean; fetchedAt: number | null; failure: string | null }) {
  if (fetchedAt != null || loading || !failure) return null;
  return (
    <p className="mx-4 mt-2 rounded border px-3 py-2 text-sm" style={{ borderColor: 'var(--warning)', color: 'var(--warning)' }}>
      Couldn't get the forecast: {failure}.
    </p>
  );
}

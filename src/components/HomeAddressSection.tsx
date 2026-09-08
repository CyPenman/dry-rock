import { useState } from 'react';
import { geocodeAddress, reverseGeocode } from '../api/geocode';
import type { Settings } from '../state/settings';

/**
 * Home-address section for the home screen header: shows the saved address
 * (or a prompt to set one) in a bordered box, with a text button styled like
 * the header's Refresh/Search buttons - placed on the opposite side of the
 * row from where those sit. Clicking it opens an inline editor; confirming or
 * closing hands control back to the header, and since distance/"worth the
 * drive" are derived from `settings.homeLat/homeLon` wherever they're used,
 * they recompute on their own once the new coordinates are saved.
 */
export function HomeAddressSection({
  settings,
  updateSettings,
}: {
  settings: Settings;
  updateSettings: (patch: Partial<Settings>) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [input, setInput] = useState(settings.homeAddress ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasAddress = settings.homeAddress != null;

  function openEdit() {
    setInput(settings.homeAddress ?? '');
    setError(null);
    setEditing(true);
  }

  function close() {
    setEditing(false);
    setError(null);
  }

  async function confirmAddress() {
    const query = input.trim();
    if (!query) {
      setError('Enter an address first');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await geocodeAddress(query);
      updateSettings({ homeLat: result.lat, homeLon: result.lon, homeAddress: result.displayName });
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't find that address");
    } finally {
      setBusy(false);
    }
  }

  function useCurrentLocation() {
    if (!navigator.geolocation) {
      setError('Location is not available on this device');
      return;
    }
    setBusy(true);
    setError(null);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;
        try {
          const label = await reverseGeocode(latitude, longitude);
          updateSettings({ homeLat: latitude, homeLon: longitude, homeAddress: label });
          setEditing(false);
        } catch {
          // Coordinates are still good even if the reverse lookup failed - fall back to a plain label.
          updateSettings({ homeLat: latitude, homeLon: longitude, homeAddress: `${latitude.toFixed(4)}, ${longitude.toFixed(4)}` });
          setEditing(false);
        } finally {
          setBusy(false);
        }
      },
      () => {
        setBusy(false);
        setError('Location access was denied or is unavailable');
      },
    );
  }

  return (
    <div className="mt-2 rounded border px-3 py-2" style={{ borderColor: 'var(--border)' }}>
      {!editing ? (
        <div className="flex items-center justify-between gap-3">
          <button type="button" onClick={openEdit} className="shrink-0 text-sm" style={{ color: 'var(--signal)' }}>
            {hasAddress ? 'Change' : 'Set address'}
          </button>
          <span className="truncate text-right text-sm" style={{ color: hasAddress ? 'var(--text)' : 'var(--text-dim)' }}>
            {hasAddress ? settings.homeAddress : 'No home address set'}
          </span>
        </div>
      ) : (
        <div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs uppercase tracking-wide" style={{ color: 'var(--text-dim)' }}>
              Home address
            </span>
            <button type="button" onClick={close} className="shrink-0 text-sm" style={{ color: 'var(--signal)' }}>
              Close
            </button>
          </div>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Street, town or postcode..."
            className="mt-2 h-11 w-full rounded border px-3 text-sm"
            style={{ borderColor: 'var(--border)', background: 'var(--ground-raised)', color: 'var(--text)' }}
          />
          {error && (
            <p className="mt-1 text-sm" style={{ color: 'var(--warning)' }}>
              {error}
            </p>
          )}
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={confirmAddress}
              disabled={busy}
              className="flex-1 rounded px-3 py-2 text-sm font-medium"
              style={{ background: 'var(--signal)', color: 'var(--ground)', opacity: busy ? 0.6 : 1 }}
            >
              {busy ? 'Looking up...' : 'Confirm'}
            </button>
            <button
              type="button"
              onClick={useCurrentLocation}
              disabled={busy}
              className="flex-1 rounded border px-3 py-2 text-sm"
              style={{ borderColor: 'var(--border)', color: 'var(--text)', opacity: busy ? 0.6 : 1 }}
            >
              Use current location
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

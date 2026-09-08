import { divIcon } from 'leaflet';
import { useEffect, useMemo } from 'react';
import { MapContainer, Marker, Popup, TileLayer, useMap } from 'react-leaflet';
import { PAST_DAYS } from '../api/request';
import type { CragWithForecast } from '../hooks/useForecast';
import { resolveDateRange, type DateRangeSelection } from '../model/dateRange';
import { rankCragDays } from '../model/ranking';
import { SCORE_BAND_COLOR_VAR, SCORE_BAND_LABEL, scoreBand } from '../model/scoreBand';

// Centred on England & Wales - spec §6 "Map".
const CENTER: [number, number] = [52.4, -2.9];
const ZOOM = 6.3;

function markerIcon(color: string) {
  return divIcon({
    className: '',
    html: `<div style="width:16px;height:16px;border-radius:50%;background:${color};border:2px solid var(--ground);box-shadow:0 0 0 1px rgba(0,0,0,0.4);"></div>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  });
}

/** Leaflet sizes itself on creation and needs a nudge once its container becomes visible/full-width (§6). */
function MapSizeInvalidator({ active }: { active: boolean }) {
  const map = useMap();
  useEffect(() => {
    if (!active) return;
    const timer = setTimeout(() => map.invalidateSize(), 300);
    return () => clearTimeout(timer);
  }, [active, map]);
  return null;
}

export function CragsMap({
  results,
  dateRange,
  active,
}: {
  results: CragWithForecast[];
  dateRange: DateRangeSelection;
  active: boolean;
}) {
  const [startIdx, endIdx] = useMemo(() => resolveDateRange(dateRange, PAST_DAYS), [dateRange]);
  const entries = useMemo(() => results.map(({ crag, forecast }) => ({ crag, days: forecast ? forecast.days : null })), [results]);
  const ranked = useMemo(() => rankCragDays(entries, [startIdx, endIdx], null), [entries, startIdx, endIdx]);

  return (
    <div className="flex h-full flex-col">
      <header className="px-4 pb-2.5 pt-4" style={{ background: 'var(--ground)' }}>
        <h1 className="text-xl font-medium tracking-tight">Crags Map</h1>
        <div className="mt-2.5 flex gap-3.5 text-xs" style={{ color: 'var(--text-dim)' }}>
          {(['good', 'fair', 'poor'] as const).map((band) => (
            <span key={band} className="inline-flex items-center gap-1.5">
              <span
                className="inline-block h-[9px] w-[9px] shrink-0 rounded-full"
                style={{ background: SCORE_BAND_COLOR_VAR[band], border: '1px solid rgba(0,0,0,0.35)' }}
              />
              {SCORE_BAND_LABEL[band]}
            </span>
          ))}
        </div>
      </header>

      <div className="relative flex-1">
        <MapContainer
          center={CENTER}
          zoom={ZOOM}
          className="absolute inset-0"
          style={{ background: 'var(--ground-sunken)' }}
        >
          <MapSizeInvalidator active={active} />
          <TileLayer url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap contributors" maxZoom={18} />
          {ranked.map((r) => {
            const scorePct = Math.round(r.day.score * 100);
            const isGated = r.day.verdict !== 'scored';
            const band = isGated ? 'poor' : scoreBand(scorePct);
            const color = SCORE_BAND_COLOR_VAR[band];
            return (
              <Marker key={r.crag.id} position={[r.crag.lat, r.crag.lon]} icon={markerIcon(color)}>
                <Popup>
                  <div className="popup-name">{r.crag.name}</div>
                  <div className="popup-area">{r.crag.area}</div>
                  <div className="popup-stats">
                    <span className="popup-score" style={{ color }}>
                      {isGated ? '-' : scorePct}
                    </span>
                    <span>
                      {Math.round(r.day.avgDaylightTempC)}&deg;C &middot; {r.day.rainChancePct}% rain
                    </span>
                  </div>
                </Popup>
              </Marker>
            );
          })}
        </MapContainer>
      </div>
    </div>
  );
}

import { useMemo, useState } from 'react';
import { niceScale } from '../lib/chartScale';
import type { HourResult } from '../model/wetness';
import { Plot, VW, fmt, gridlines, poly, sx } from './chart/kit';
import { Explain } from './Explain';

const DAY_LABEL = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric' });

const PERIOD_OPTIONS = [
  { label: '24h', hours: 24 },
  { label: '3 days', hours: 24 * 3 },
  { label: '7 days', hours: 24 * 7 },
  { label: '14 days', hours: 24 * 14 },
] as const;

// Fixed categorical order for the four water fluxes - validated against the
// app's dark surface with the dataviz skill's palette checker (adjacent CVD
// Delta E, contrast). Deliberately distinct from --signal/--warning, which
// carry fixed status meaning elsewhere and must never double as series colour.
const SERIES = [
  { key: 'rain', label: 'rain', colour: 'var(--chart-water)' },
  { key: 'seepage', label: 'seepage', colour: 'var(--chart-seepage)' },
  { key: 'condensation', label: 'condensation', colour: 'var(--chart-condensation)' },
  { key: 'melt', label: 'snowmelt', colour: 'var(--chart-melt)' },
] as const;

type SeriesKey = (typeof SERIES)[number]['key'];
type Totals = Record<SeriesKey, number>;

function sumFluxes(slice: HourResult[]): Totals {
  return slice.reduce<Totals>(
    (acc, r) => ({
      rain: acc.rain + r.fluxes.rain,
      seepage: acc.seepage + r.fluxes.seepage,
      condensation: acc.condensation + r.fluxes.condensation,
      melt: acc.melt + r.fluxes.melt,
    }),
    { rain: 0, seepage: 0, condensation: 0, melt: 0 },
  );
}

interface DayBucket {
  label: string;
  totals: Totals;
}

/**
 * Water budget - stacked daily totals plus a persistent per-source sparkline
 * strip (design study "Crag Charts", option 2d). The stack keeps daily
 * totals comparable; each source also gets an always-visible hourly shape
 * and total, and tapping a row isolates that source in the bars above.
 * Every period option buckets into daily totals (a single bar for 24h), so
 * the same layout covers the full 24h-14 day range without switching chart
 * types.
 */
export function WaterBudgetChart({ hourly, endIdx }: { hourly: HourResult[]; endIdx: number }) {
  const [periodHours, setPeriodHours] = useState<number>(24);
  const [isolate, setIsolate] = useState<SeriesKey | null>(null);

  const slice = useMemo(() => hourly.slice(Math.max(0, endIdx - periodHours), endIdx), [hourly, endIdx, periodHours]);

  const buckets: DayBucket[] = useMemo(() => {
    const out: DayBucket[] = [];
    for (let i = 0; i < slice.length; i += 24) {
      const chunk = slice.slice(i, i + 24);
      if (chunk.length === 0) continue;
      out.push({ label: DAY_LABEL.format(new Date(chunk[0].time * 1000)), totals: sumFluxes(chunk) });
    }
    return out;
  }, [slice]);

  if (slice.length === 0 || buckets.length === 0) {
    return (
      <p className="text-sm" style={{ color: 'var(--text-dim)' }}>
        Not enough history yet for a water budget.
      </p>
    );
  }

  const scale = niceScale(Math.max(...buckets.map((d) => d.totals.rain + d.totals.seepage + d.totals.condensation + d.totals.melt)));
  const H = 118;
  const pb = H - 2;
  const y = (v: number) => pb - (v / scale.max) * (pb - 4);
  const slot = VW / buckets.length;
  const bw = buckets.length === 1 ? slot * 0.32 : slot * 0.62;
  const active = (k: SeriesKey) => !isolate || isolate === k;
  const seriesTotals = SERIES.map((s) => ({ ...s, total: buckets.reduce((a, d) => a + d.totals[s.key], 0) }));

  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        {PERIOD_OPTIONS.map((opt) => (
          <button
            key={opt.hours}
            type="button"
            onClick={() => {
              setPeriodHours(opt.hours);
              setIsolate(null);
            }}
            className="rounded-full px-3 py-1.5 text-sm"
            style={{
              background: periodHours === opt.hours ? 'var(--signal)' : 'var(--ground-raised)',
              color: periodHours === opt.hours ? 'var(--ground)' : 'var(--text)',
            }}
          >
            {opt.label}
          </button>
        ))}
      </div>

      <div style={{ marginTop: 12 }}>
        <Plot
          h={H}
          gutter={34}
          ariaLabel="Water into the rock, stacked by source"
          yLabels={scale.ticks.map((v) => ({ y: y(v), label: fmt(v) }))}
          xLabels={buckets.map((d, i) => ({ f: (slot * (i + 0.5)) / VW, label: d.label, strong: true }))}
        >
          {gridlines(scale.ticks, y, H)}
          {buckets.map((d, i) => {
            let cursor = pb;
            return (
              <g key={i}>
                {SERIES.map((s) => {
                  const v = d.totals[s.key];
                  if (v <= 0) return null;
                  const top = cursor - (v / scale.max) * (pb - 4);
                  const rt = top + 1.5;
                  const rb = cursor - 1.5;
                  cursor = top;
                  if (rb - rt <= 0) return null;
                  return (
                    <rect
                      key={s.key}
                      x={slot * i + (slot - bw) / 2}
                      width={bw}
                      y={rt}
                      height={rb - rt}
                      fill={s.colour}
                      opacity={active(s.key) ? 1 : 0.16}
                    />
                  );
                })}
              </g>
            );
          })}
        </Plot>
      </div>

      <div style={{ marginTop: 14, borderTop: '1px solid var(--border)' }}>
        {seriesTotals.map((s) => {
          const rowMax = Math.max(...slice.map((r) => r.fluxes[s.key]), 0.0001);
          return (
            <button
              key={s.key}
              type="button"
              onClick={() => setIsolate(isolate === s.key ? null : s.key)}
              style={{
                display: 'grid',
                gridTemplateColumns: '104px minmax(0,1fr) 62px',
                alignItems: 'center',
                gap: 10,
                width: '100%',
                textAlign: 'left',
                background: isolate === s.key ? 'var(--ground-raised)' : 'transparent',
                border: 'none',
                borderBottom: '1px solid var(--border)',
                padding: '8px 6px',
                cursor: 'pointer',
                opacity: active(s.key) ? 1 : 0.4,
              }}
            >
              <span className="flex items-center gap-1.5" style={{ font: '13px/1.2 system-ui,sans-serif', color: 'var(--text)' }}>
                <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: s.colour }} />
                {s.label}
              </span>
              <svg viewBox={`0 0 ${VW} 26`} preserveAspectRatio="none" width="100%" height={26} style={{ display: 'block' }}>
                <line x1={0} x2={VW} y1={25} y2={25} stroke="var(--grid)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
                <polygon
                  points={`0,26 ${poly(slice.map((r, k) => [sx(k, slice.length), 26 - (r.fluxes[s.key] / rowMax) * 24]))} ${VW},26`}
                  fill={s.colour}
                  opacity={0.55}
                />
                <polyline
                  points={poly(slice.map((r, k) => [sx(k, slice.length), 26 - (r.fluxes[s.key] / rowMax) * 24]))}
                  fill="none"
                  stroke={s.colour}
                  strokeWidth={1.75}
                  vectorEffect="non-scaling-stroke"
                />
              </svg>
              <span style={{ font: '600 13px/1.2 ui-monospace,Menlo,monospace', color: 'var(--text)', textAlign: 'right' }}>
                {s.total.toFixed(1)}mm
              </span>
            </button>
          );
        })}
      </div>
      <p style={{ margin: '8px 6px 0', font: '11px/1.4 system-ui,sans-serif', color: 'var(--text-faint)' }}>
        Tap a row to isolate that source in the bars above. Sparklines are hourly over the selected period, each on
        its own scale.
      </p>

      <Explain>
        <p>
          <strong>Rain reaching the face</strong> is precipitation after accounting for the crag's steepness and any
          wind-driven rain onto the aspect, plus drainage arriving from above - all in millimetres.
        </p>
        <p>
          <strong>Seepage</strong> is water rising through the rock from ground saturation, independent of today's
          forecast - this is what makes a crag stay wet through a dry week after a wet spell.
        </p>
        <p>
          <strong>Condensation</strong> is water forming directly on the rock when it's colder than the dew point -
          nothing to do with rainfall.
        </p>
        <p>
          <strong>Snowmelt</strong> is meltwater entering the rock as lying snow thaws.
        </p>
      </Explain>
    </div>
  );
}

import { useEffect, useState } from 'react';
import type { CragHourlyInput, HourResult } from '../model/wetness';
import { Plot, STROKE, VW, dayLabels, dot, gridlines, nightBands, poly, sx } from './chart/kit';
import { Explain } from './Explain';

const TIME_LABEL = new Intl.DateTimeFormat('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false });

/**
 * Rock temperature against the ideal friction band, scrubbed (design study
 * "Crag Charts", option 2j) - new chart, spec §4.8/§11. Night hours are
 * shaded so the overnight cooling that drives dawn condensation is visible
 * directly on the curve, and the ideal band is the same [lo, hi] range that
 * drives the friction score, per rock type.
 */
export function RockTempChart({
  results,
  inputs,
  idealTempC,
  nowIdx,
}: {
  results: HourResult[];
  inputs: CragHourlyInput[];
  idealTempC: [number, number];
  nowIdx: number;
}) {
  const n = results.length;
  const [scrub, setScrub] = useState(() => Math.max(0, Math.min(n - 1, nowIdx)));

  useEffect(() => {
    setScrub(Math.max(0, Math.min(results.length - 1, nowIdx)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results, inputs]);

  if (n === 0) return null;

  const i = Math.max(0, Math.min(n - 1, scrub));
  const cur = results[i];
  const getDate = (idx: number) => new Date(inputs[idx].time * 1000);
  const [idealLo, idealHi] = idealTempC;

  const H = 132;
  const lo = Math.min(0, ...results.map((r) => r.Trock)) - 1;
  const hi = Math.max(...results.map((r) => r.Trock)) + 2;
  const Y = (c: number) => H - 4 - ((c - lo) / (hi - lo)) * (H - 12);
  const ticks: number[] = [];
  for (let c = Math.ceil(lo / 5) * 5; c <= hi; c += 5) ticks.push(c);
  const inBand = cur.Trock >= idealLo && cur.Trock <= idealHi;
  const f = sx(i, n) / VW;
  const isDayFlags = inputs.map((x) => x.isDay);

  const frictionLabel = inBand ? 'in the ideal band' : cur.Trock > idealHi ? 'warm - greasy' : 'cold - hard skin';

  return (
    <div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3,minmax(0,1fr))',
          gap: 1,
          background: 'var(--border)',
          border: '1px solid var(--border)',
          marginBottom: 10,
        }}
      >
        {(
          [
            ['time', TIME_LABEL.format(getDate(i)), 'var(--text)'],
            ['rock temp', `${cur.Trock.toFixed(1)}°C`, inBand ? 'var(--signal)' : 'var(--text)'],
            ['friction', frictionLabel, inBand ? 'var(--signal)' : 'var(--warning)'],
          ] as const
        ).map(([k, v, c], idx) => (
          <div key={idx} style={{ background: 'var(--ground-raised)', padding: '7px 9px' }}>
            <div
              style={{
                font: '600 10px/1 system-ui,sans-serif',
                letterSpacing: '0.07em',
                textTransform: 'uppercase',
                color: 'var(--text-faint)',
              }}
            >
              {k}
            </div>
            <div style={{ font: '600 15px/1.2 ui-monospace,Menlo,monospace', color: c, marginTop: 4 }}>{v}</div>
          </div>
        ))}
      </div>

      <Plot
        h={H}
        gutter={34}
        onScrub={(fr) => setScrub(Math.round(fr * (n - 1)))}
        ariaLabel="Rock temperature against the ideal friction band"
        yLabels={ticks.map((c) => ({ y: Y(c), label: `${c}°` }))}
        xLabels={dayLabels(getDate, n)}
        overlay={
          <>
            <div
              style={{
                position: 'absolute',
                left: 3,
                top: Y(idealHi) - 3,
                transform: 'translateY(-100%)',
                font: '600 10px/1 system-ui,sans-serif',
                letterSpacing: '0.05em',
                color: 'var(--signal)',
                background: 'var(--ground)',
                padding: '2px 4px',
              }}
            >
              IDEAL {idealLo}&ndash;{idealHi}&deg;C
            </div>
            {dot(f, Y(cur.Trock), 'var(--text)', 10, 'd')}
          </>
        }
      >
        {nightBands(isDayFlags, H)}
        <rect x={0} y={Y(idealHi)} width={VW} height={Y(idealLo) - Y(idealHi)} fill="var(--signal)" opacity={0.22} />
        {gridlines(ticks, Y, H)}
        <polyline
          points={poly(results.map((r, k) => [sx(k, n), Y(r.Trock)]))}
          fill="none"
          stroke="var(--text)"
          strokeWidth={3}
          strokeLinejoin="round"
          {...STROKE}
        />
        <line x1={sx(i, n)} x2={sx(i, n)} y1={0} y2={H} stroke="var(--text)" strokeWidth={1.5} {...STROKE} />
      </Plot>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm" style={{ marginTop: 10, marginLeft: 34, color: 'var(--text-dim)' }}>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-3.5" style={{ background: 'var(--text)' }} />
          rock temperature
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: 'var(--signal)' }} />
          ideal {idealLo}&ndash;{idealHi}&deg;C
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: 'var(--ground-sunken)' }} />
          dark hours
        </span>
      </div>

      <Explain>
        <p>
          <strong>Rock temperature</strong> drives friction more than air temperature does - it's what your skin
          actually touches. The shaded band is this rock type's ideal range for grip.
        </p>
        <p>
          <strong>Dark hours</strong> are shaded, so the overnight cooling that drives dawn condensation is visible
          directly on the curve.
        </p>
        <p>Drag anywhere on the chart to read the temperature and friction verdict at a specific hour.</p>
      </Explain>
    </div>
  );
}

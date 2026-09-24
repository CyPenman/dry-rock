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
 *
 * Air temperature is drawn as a thin neutral line so the rock-vs-air lag and
 * the sun-driven surface warming (§4.2) are visible. Dew point is drawn
 * alongside because the GAP between it and the rock curve is
 * what the §4.8 condensation term scores, and it is the usual reason a colder
 * day reads worse than a warmer one. Plotted rather than tabulated: the two
 * lines converging is legible at a glance in a way that two columns of numbers
 * are not, and on a humid day they visibly touch.
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
  const times = inputs.map((x) => x.time);
  const [idealLo, idealHi] = idealTempC;

  const H = 132;
  const dewPoints = inputs.map((x) => x.dewPointC);
  const airTemps = inputs.map((x) => x.tempC);
  // All three series share one axis - they are the same quantity, and the gaps
  // between them are the point (rock against dew point for sweating, rock
  // against air for the thermal lag of §4.2), so they must read off one scale.
  const lo = Math.min(0, ...results.map((r) => r.Trock), ...dewPoints, ...airTemps) - 1;
  const hi = Math.max(...results.map((r) => r.Trock), ...dewPoints, ...airTemps) + 2;
  const Y = (c: number) => H - 4 - ((c - lo) / (hi - lo)) * (H - 12);
  const ticks: number[] = [];
  for (let c = Math.ceil(lo / 5) * 5; c <= hi; c += 5) ticks.push(c);
  const inBand = cur.Trock >= idealLo && cur.Trock <= idealHi;
  const f = sx(i, n) / VW;
  const isDayFlags = inputs.map((x) => x.isDay);

  // Proximity to the dew point outranks the ideal band in the readout: rock
  // sitting on its dew point grips badly at any temperature, so reporting "in
  // the ideal band" for an hour that is about to sweat would be the wrong
  // headline (§4.8 - the condensation term is the model's largest penalty).
  const spreadC = cur.Trock - dewPoints[i];
  const nearDewPoint = spreadC < 2;
  const frictionLabel = nearDewPoint
    ? 'on the dew point'
    : inBand
      ? 'in the ideal band'
      : cur.Trock > idealHi
        ? 'warm - greasy'
        : 'cold - hard skin';

  return (
    <div>
      <div
        style={{
          display: 'grid',
          // auto-fit so the fourth tile wraps to a second row on a narrow
          // phone rather than crushing all four into one.
          gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))',
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
            ['air temp', `${airTemps[i].toFixed(1)}°C`, 'var(--text-dim)'],
            ['dew point', `${dewPoints[i].toFixed(1)}°C`, nearDewPoint ? 'var(--warning)' : 'var(--chart-condensation)'],
            ['friction', frictionLabel, nearDewPoint ? 'var(--warning)' : inBand ? 'var(--signal)' : 'var(--warning)'],
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
        xLabels={dayLabels(getDate, n, times)}
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
          points={poly(airTemps.map((a, k) => [sx(k, n), Y(a)]))}
          fill="none"
          stroke="var(--text-dim)"
          strokeWidth={1.5}
          strokeLinejoin="round"
          {...STROKE}
        />
        <polyline
          points={poly(dewPoints.map((d, k) => [sx(k, n), Y(d)]))}
          fill="none"
          stroke="var(--chart-condensation)"
          strokeWidth={2}
          strokeDasharray="5 4"
          strokeLinejoin="round"
          {...STROKE}
        />
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
          <span className="inline-block h-px w-3.5" style={{ background: 'var(--text-dim)' }} />
          air temperature
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-3.5" style={{ background: 'var(--chart-condensation)' }} />
          dew point
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
          Rock temperature drives friction more than air temperature - it's what your skin touches. The shaded band
          is this rock type's ideal grip range.
        </p>
        <p>
          The dashed line is the dew point. Where it climbs to meet the rock temperature the rock is on the edge of
          sweating and will feel greasy however dry it measures - closer than about 2&deg;C is the warning sign, and
          the two lines touching means condensation. This is why a cooler day can grip worse than a warmer one: what
          matters is the gap, not the height.
        </p>
        <p>
          The thin line is air temperature. The rock lags it and is pushed off it by sun and clear skies: a sunlit face
          runs well above the air in the afternoon, and after a cold spell the rock stays below a warming air mass for
          hours, which is when it sweats.
        </p>
        <p>Dark hours are shaded, so the overnight cooling behind dawn condensation shows directly on the curve.</p>
        <p>Drag the chart to read rock and air temperature, dew point and friction at a specific hour.</p>
      </Explain>
    </div>
  );
}

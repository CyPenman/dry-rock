import { useEffect, useState } from 'react';
import { niceScale } from '../lib/chartScale';
import { PARAMS } from '../model/params';
import type { CragHourlyInput, HourResult } from '../model/wetness';
import { ClimbableRibbon, Plot, STROKE, VW, dayBands, dayLabels, dot, fmt, fmtFine, gridlines, poly, sx } from './chart/kit';
import { Explain } from './Explain';

const TIME_LABEL = new Intl.DateTimeFormat('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false });

/**
 * Hourly conditions - scrubbed small multiples (design study "Crag Charts",
 * option 2a). Drag anywhere on either panel to move a fixed readout bar
 * above the plot, so the current hour's numbers are never covered by your
 * thumb. Replaces the old fixed-size combination chart, whose SVG text and
 * strokes shrank to near-illegibility on a phone-width card.
 */
export function HourlyTimeline({
  results,
  inputs,
  nowIdx,
}: {
  results: HourResult[];
  inputs: CragHourlyInput[];
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
  const curInput = inputs[i];
  const getDate = (idx: number) => new Date(inputs[idx].time * 1000);

  const rainScale = niceScale(Math.max(...inputs.map((x) => x.precipitationMm)));
  const waterScale = niceScale(Math.max(...results.map((r) => Math.max(r.S, r.M))));
  const RH = 66;
  const WH = 92;
  const yR = (mm: number) => RH - (Math.min(mm, rainScale.max) / rainScale.max) * (RH - 4);
  const yW = (mm: number) => WH - (Math.min(mm, waterScale.max) / waterScale.max) * (WH - 6);
  const f = sx(i, n) / VW;
  const climbable = results.map((r) => r.climbable);

  const scrubLine = (h: number) => (
    <line x1={sx(i, n)} x2={sx(i, n)} y1={0} y2={h} stroke="var(--text)" strokeWidth={1.5} {...STROKE} />
  );
  const cursorRail = (
    <div style={{ position: 'absolute', left: `${f * 100}%`, top: 0, bottom: 0, width: 1, background: 'var(--text)', opacity: 0.35, pointerEvents: 'none' }} />
  );
  const onScrub = (fr: number) => setScrub(Math.round(fr * (n - 1)));

  const statusText = cur.climbable
    ? 'Climbable at this hour'
    : cur.S >= PARAMS.S_dry
      ? 'Wet - water on the surface'
      : 'Wet - still damp inside the rock';

  return (
    <div>
      {/* fixed readout bar - above the plot, never under the finger */}
      <div style={{ border: '1px solid var(--border)', marginBottom: 10 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,minmax(0,1fr))', gap: 1, background: 'var(--border)' }}>
          {(
            [
              ['time', TIME_LABEL.format(getDate(i)), 'var(--text)', undefined],
              ['rain', fmt(curInput.precipitationMm), curInput.precipitationMm > 0.05 ? 'var(--chart-water)' : 'var(--text-dim)', 'mm/hr'],
              ['surface', fmtFine(cur.S), 'var(--chart-water)', 'mm'],
              ['inside', fmtFine(cur.M), 'var(--chart-water-soft)', 'mm'],
            ] as const
          ).map(([k, v, c, u], idx) => (
            <div key={idx} style={{ background: 'var(--ground-raised)', padding: '7px 9px' }}>
              <div style={{ font: '600 10px/1 system-ui,sans-serif', letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--text-faint)' }}>{k}</div>
              <div style={{ font: '600 15px/1.2 ui-monospace,SFMono-Regular,Menlo,monospace', color: c, marginTop: 4 }}>
                {v}
                {u && <span style={{ font: '400 10.5px/1 system-ui,sans-serif', color: 'var(--text-faint)', marginLeft: 3 }}>{u}</span>}
              </div>
            </div>
          ))}
        </div>
        <div
          style={{
            background: cur.climbable ? 'var(--signal)' : 'var(--ground-raised)',
            color: cur.climbable ? 'var(--ground)' : 'var(--warning)',
            padding: '5px 9px',
            font: '600 12px/1.3 system-ui,sans-serif',
            borderTop: '1px solid var(--border)',
          }}
        >
          {statusText}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '38px minmax(0,1fr)', alignItems: 'center', marginBottom: 4 }}>
        <div
          style={{
            font: '600 10px/1 system-ui,sans-serif',
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            color: 'var(--text-dim)',
            textAlign: 'right',
            paddingRight: 7,
          }}
        >
          dry
        </div>
        <div style={{ position: 'relative' }}>
          <ClimbableRibbon climbable={climbable} h={16} />
          {cursorRail}
        </div>
      </div>

      <div style={{ font: '600 12px/1 system-ui,sans-serif', color: 'var(--text)', margin: '12px 0 2px 38px' }}>
        Rain <span style={{ color: 'var(--text-dim)', fontWeight: 400 }}>mm/hr</span>
      </div>
      <Plot h={RH} xAxisH={0} onScrub={onScrub} ariaLabel="Hourly rain" yLabels={rainScale.ticks.map((v) => ({ y: yR(v), label: fmt(v) }))} overlay={cursorRail}>
        {dayBands(n, RH)}
        {gridlines(rainScale.ticks, yR, RH)}
        <polygon points={`0,${RH} ${poly(inputs.map((x, k) => [sx(k, n), yR(x.precipitationMm)]))} ${VW},${RH}`} fill="var(--chart-water)" opacity={0.3} />
        <polyline
          points={poly(inputs.map((x, k) => [sx(k, n), yR(x.precipitationMm)]))}
          fill="none"
          stroke="var(--chart-water)"
          strokeWidth={2.5}
          strokeLinejoin="round"
          {...STROKE}
        />
        {scrubLine(RH)}
      </Plot>

      <div style={{ font: '600 12px/1 system-ui,sans-serif', color: 'var(--text)', margin: '14px 0 2px 38px' }}>
        Rock wetness <span style={{ color: 'var(--text-dim)', fontWeight: 400 }}>mm</span>
      </div>
      <Plot
        h={WH}
        onScrub={onScrub}
        ariaLabel="Rock wetness"
        yLabels={waterScale.ticks.map((v) => ({ y: yW(v), label: fmt(v) }))}
        xLabels={dayLabels(getDate, n)}
        overlay={
          <>
            {cursorRail}
            {dot(f, yW(results[i].S), 'var(--chart-water)', 9, 'd1')}
            {dot(f, yW(results[i].M), 'var(--chart-water-soft)', 9, 'd2')}
          </>
        }
      >
        {dayBands(n, WH)}
        {gridlines(waterScale.ticks, yW, WH)}
        <polygon points={`0,${WH} ${poly(results.map((r, k) => [sx(k, n), yW(r.M)]))} ${VW},${WH}`} fill="var(--chart-water-soft)" opacity={0.34} />
        <polyline
          points={poly(results.map((r, k) => [sx(k, n), yW(r.M)]))}
          fill="none"
          stroke="var(--chart-water-soft)"
          strokeWidth={2}
          strokeLinejoin="round"
          {...STROKE}
        />
        <polyline
          points={poly(results.map((r, k) => [sx(k, n), yW(r.S)]))}
          fill="none"
          stroke="var(--chart-water)"
          strokeWidth={3}
          strokeLinejoin="round"
          {...STROKE}
        />
        {scrubLine(WH)}
      </Plot>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm" style={{ color: 'var(--text-dim)' }}>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: 'var(--signal)' }} />
          climbable
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-3.5" style={{ background: 'var(--chart-water)' }} />
          surface film
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: 'var(--chart-water-soft)', opacity: 0.6 }} />
          inside the rock
        </span>
      </div>

      <Explain>
        <p>The green ribbon marks exactly which hours read as climbable. Drag either panel to move the readout above.</p>
        <p>
          Rain here is raw mm/hr, before any adjustment for this crag - the Water in panel below shows the smaller
          (or larger) amount that actually reaches the face, so the two won't match hour-for-hour.
        </p>
        <p>
          Rock wetness has two layers, both in mm: <strong>surface film</strong> (bright line) is what your hands
          touch; <strong>inside the rock</strong> (pale fill) is water held deeper in the outer skin. Both need to be
          low for the rock to read as climbable.
        </p>
      </Explain>
    </div>
  );
}

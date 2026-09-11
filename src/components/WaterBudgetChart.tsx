import { useMemo, useState } from 'react';
import { niceScale } from '../lib/chartScale';
import type { HourResult } from '../model/wetness';
import { Plot, VW, fmt, fmtFine, gridlines, poly, sx } from './chart/kit';
import { Explain } from './Explain';

const DAY_LABEL = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric' });

// The window always *contains* the date range selected on the home screen -
// this used to run independently from "today" out to a fixed number of days,
// which meant it silently covered different days than the Hourly conditions
// panel above it (built from that same selected range). A day with real rain
// in one chart and nothing in the other, purely because they were windowed
// differently, reads as a data bug even though both numbers were individually
// correct - so the two must always agree on which days they're showing.
// History is separately capped at HISTORY_DAYS before the range start, so the
// bars stay dominated by the days actually being planned for.
const HISTORY_DAYS = 3;
const PERIOD_OPTIONS = [
  { label: 'Selected range', extraDays: 0 },
  { label: '+1 day', extraDays: 1 },
  { label: '+5 days', extraDays: 5 },
  { label: '+12 days', extraDays: 12 },
] as const;

// Fixed categorical order for the four water fluxes - validated against the
// app's dark surface with the dataviz skill's palette checker (adjacent CVD
// Delta E, contrast). Deliberately distinct from --signal/--warning, which
// carry fixed status meaning elsewhere and must never double as series colour.
// "rain" here is deliberately labelled "rain at rock" rather than plain
// "rain" - it's the Hourly conditions panel's raw rainfall *after* being
// reduced/increased for the crag's steepness, aspect and wind exposure (see
// wetness.ts fluxes.rain), so it can legitimately read much lower (or
// slightly higher) than that panel's "Rain" line for the same hours. Reusing
// the word "rain" for both was read as a data bug when comparing the two
// charts side by side - they're intentionally different quantities.
const SERIES = [
  { key: 'rain', label: 'rain at rock', colour: 'var(--chart-water)' },
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
  isToday: boolean;
  isPast: boolean;
  isHistory: boolean;
}

/**
 * Water budget - stacked daily totals plus a persistent per-source sparkline
 * strip (design study "Crag Charts", option 2d). The stack keeps daily
 * totals comparable; each source also gets an always-visible hourly shape
 * and total, and tapping a row isolates that source in the bars above.
 *
 * The window always covers the date range selected on the home screen -
 * `rangeStart`/`rangeEnd`, the same range the Hourly conditions panel above
 * it uses - so the two never disagree about which days they're showing.
 * "Selected range" shows exactly that; the other options add extra days
 * beyond the range end, for planning further ahead than what's currently
 * selected. Up to HISTORY_DAYS before the range start are kept for context
 * (so a still-wet crag from a recent rainy spell doesn't look inexplicably
 * dry at the start of the window).
 */
export function WaterBudgetChart({
  hourly,
  todayIndex,
  rangeStart,
  rangeEnd,
}: {
  hourly: HourResult[];
  todayIndex: number;
  rangeStart: number;
  rangeEnd: number;
}) {
  const [extraDays, setExtraDays] = useState<number>(PERIOD_OPTIONS[0].extraDays);
  const [isolate, setIsolate] = useState<SeriesKey | null>(null);

  const historyDays = Math.min(HISTORY_DAYS, rangeStart);
  const windowStartIdx = rangeStart - historyDays;
  const startHour = windowStartIdx * 24;
  const endHour = Math.min(hourly.length, (rangeEnd + 1 + extraDays) * 24);
  const slice = useMemo(() => hourly.slice(Math.max(0, startHour), endHour), [hourly, startHour, endHour]);

  const buckets: DayBucket[] = useMemo(() => {
    const out: DayBucket[] = [];
    for (let i = 0; i < slice.length; i += 24) {
      const chunk = slice.slice(i, i + 24);
      if (chunk.length === 0) continue;
      const dayIndex = windowStartIdx + Math.floor(i / 24);
      out.push({
        label: DAY_LABEL.format(new Date(chunk[0].time * 1000)),
        totals: sumFluxes(chunk),
        isToday: dayIndex === todayIndex,
        isPast: dayIndex < todayIndex,
        isHistory: dayIndex < rangeStart,
      });
    }
    return out;
  }, [slice, windowStartIdx, todayIndex, rangeStart]);

  if (slice.length === 0 || buckets.length === 0) {
    return (
      <p className="text-sm" style={{ color: 'var(--text-dim)' }}>
        Not enough data yet for a water budget.
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
  const seriesTotals = SERIES.map((s) => ({ ...s, total: Math.max(0, buckets.reduce((a, d) => a + d.totals[s.key], 0)) }));

  // One shared scale across all four sparkline rows (rather than each row
  // normalised to its own max) - seepage/condensation/melt are usually much
  // smaller than rain, and a per-row scale was inflating them to fill the same
  // height as rain regardless of their real magnitude, which read as
  // "seepage is a big deal" even on days it barely registered.
  const sparkScale = niceScale(Math.max(...SERIES.flatMap((s) => slice.map((r) => r.fluxes[s.key]))));
  const sparkY = (v: number) => 26 - (v / sparkScale.max) * 24;
  // Rotate day labels once there are enough bars that horizontal labels would
  // start overlapping their neighbours (the longer "+13 days" options routinely
  // have 14-17 bars in view).
  const rotateLabels = buckets.length > 7;
  const todayBucketIdx = buckets.findIndex((d) => d.isToday);

  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        {PERIOD_OPTIONS.map((opt) => (
          <button
            key={opt.extraDays}
            type="button"
            onClick={() => {
              setExtraDays(opt.extraDays);
              setIsolate(null);
            }}
            className="rounded-full px-3 py-1.5 text-sm"
            style={{
              background: extraDays === opt.extraDays ? 'var(--signal)' : 'var(--ground-raised)',
              color: extraDays === opt.extraDays ? 'var(--ground)' : 'var(--text)',
            }}
          >
            {opt.label}
          </button>
        ))}
      </div>
      <p style={{ margin: '6px 2px 0', font: '11px/1.4 system-ui,sans-serif', color: 'var(--text-faint)' }}>
        {historyDays > 0 &&
          `Includes ${historyDays} day${historyDays === 1 ? '' : 's'} of history before the selected range (shaded lighter below) for context. `}
        The bars otherwise match the date range picked above - today is marked below.
      </p>
      <p style={{ margin: '4px 2px 0', font: '11px/1.4 system-ui,sans-serif', color: 'var(--text-faint)' }}>
        "Rain at rock" below is rainfall after adjusting for this crag's steepness and wind exposure, so it won't match
        the raw "Rain" graph in Hourly conditions above hour-for-hour - a steep or sheltered crag can show real rain
        up there and little to none here.
      </p>

      <div style={{ marginTop: 12 }}>
        <Plot
          h={H}
          gutter={34}
          xAxisH={rotateLabels ? 44 : 22}
          xLabelRotateDeg={rotateLabels ? 45 : 0}
          ariaLabel="Water into the rock, stacked by source"
          yLabels={scale.ticks.map((v) => ({ y: y(v), label: fmt(v) }))}
          xLabels={buckets.map((d, i) => ({ f: (slot * (i + 0.5)) / VW, label: d.label, strong: d.isToday }))}
        >
          {gridlines(scale.ticks, y, H)}
          {historyDays > 0 && (
            <>
              <rect x={0} y={0} width={slot * historyDays} height={pb} fill="var(--ground-raised)" opacity={0.4} />
              <line
                x1={slot * historyDays}
                x2={slot * historyDays}
                y1={0}
                y2={pb}
                stroke="var(--border)"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
            </>
          )}
          {todayBucketIdx >= 0 && (
            <line
              x1={slot * todayBucketIdx}
              x2={slot * todayBucketIdx}
              y1={0}
              y2={pb}
              stroke="var(--text-dim)"
              strokeWidth={1}
              strokeDasharray="2,2"
              vectorEffect="non-scaling-stroke"
            />
          )}
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
                      opacity={!active(s.key) ? 0.16 : d.isHistory ? 0.4 : d.isPast ? 0.6 : 1}
                    />
                  );
                })}
              </g>
            );
          })}
        </Plot>
      </div>

      <div style={{ marginTop: 14, borderTop: '1px solid var(--border)' }}>
        {seriesTotals.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => setIsolate(isolate === s.key ? null : s.key)}
            style={{
              display: 'grid',
              gridTemplateColumns: '104px 30px minmax(0,1fr) 62px',
              alignItems: 'center',
              gap: 6,
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
            <span style={{ position: 'relative', height: 26 }}>
              <span
                style={{
                  position: 'absolute',
                  top: 0,
                  right: 2,
                  font: '600 9px/1 ui-monospace,SFMono-Regular,Menlo,monospace',
                  color: 'var(--text-dim)',
                }}
              >
                {fmtFine(sparkScale.max)}
              </span>
              <span
                style={{
                  position: 'absolute',
                  bottom: 0,
                  right: 2,
                  font: '600 9px/1 ui-monospace,SFMono-Regular,Menlo,monospace',
                  color: 'var(--text-dim)',
                }}
              >
                0
              </span>
            </span>
            <svg viewBox={`0 0 ${VW} 26`} preserveAspectRatio="none" width="100%" height={26} style={{ display: 'block' }}>
              <line x1={0} x2={VW} y1={sparkY(0)} y2={sparkY(0)} stroke="var(--grid)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
              <line x1={0} x2={VW} y1={sparkY(sparkScale.max)} y2={sparkY(sparkScale.max)} stroke="var(--grid)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
              <polygon
                points={`0,26 ${poly(slice.map((r, k) => [sx(k, slice.length), sparkY(r.fluxes[s.key])]))} ${VW},26`}
                fill={s.colour}
                opacity={0.55}
              />
              <polyline
                points={poly(slice.map((r, k) => [sx(k, slice.length), sparkY(r.fluxes[s.key])]))}
                fill="none"
                stroke={s.colour}
                strokeWidth={1.75}
                vectorEffect="non-scaling-stroke"
              />
            </svg>
            <span style={{ font: '600 13px/1.2 ui-monospace,Menlo,monospace', color: 'var(--text)', textAlign: 'right' }}>
              {fmtFine(s.total)}mm
            </span>
          </button>
        ))}
      </div>
      <p style={{ margin: '8px 6px 0', font: '11px/1.4 system-ui,sans-serif', color: 'var(--text-faint)' }}>
        Tap a row to isolate that source in the bars above. Sparklines are hourly over the selected period, all four
        sharing one scale (labelled on the right) so their true relative size is comparable.
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

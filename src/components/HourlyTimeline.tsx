import { Explain } from './Explain';
import type { CragHourlyInput, HourResult } from '../model/wetness';

const WIDTH = 400;
const HEIGHT = 260;
const PAD_LEFT = 34;
const PAD_RIGHT = 10;

const DAY_LABEL = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric' });

// Font/stroke sizes here are picked for how this renders in practice: a ~350px-wide
// mobile card, not the 400-unit viewBox literally. Numbers look large in the SVG
// source; that's intentional, so labels stay readable once the browser scales down.
const AXIS_FONT = 13;
const LABEL_FONT = 14;

function scaleX(i: number, n: number): number {
  return PAD_LEFT + (i / Math.max(1, n - 1)) * (WIDTH - PAD_LEFT - PAD_RIGHT);
}

function polyline(points: [number, number][]): string {
  return points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
}

function LegendSwatch({ kind, colour, label }: { kind: 'line' | 'fill' | 'band'; colour: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      {kind === 'line' && <span className="inline-block h-0.5 w-3.5" style={{ background: colour }} />}
      {kind === 'fill' && <span className="inline-block h-3 w-3 rounded-sm" style={{ background: colour, opacity: 0.7 }} />}
      {kind === 'band' && <span className="inline-block h-3 w-3 rounded-sm" style={{ background: colour, opacity: 0.3 }} />}
      {label}
    </span>
  );
}

/**
 * The hourly conditions timeline — spec §6 crag detail, "the most important
 * visual in the app". Rain and rock wetness over the selected date range, with
 * climbable bands and a "now" marker. Sized and coloured for a phone screen
 * first; a longer explanation is tucked behind the "..." disclosure below.
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
  if (n === 0) return null;

  const maxPrecip = Math.max(1, ...inputs.map((i) => i.precipitationMm));
  const maxWater = Math.max(0.3, ...results.map((r) => Math.max(r.S, r.M)));

  const rainTop = 34;
  const rainBottom = rainTop + 46;
  const waterTop = rainBottom + 26;
  const waterBottom = HEIGHT - 46;

  const yWater = (mm: number) => waterBottom - (Math.min(mm, maxWater) / maxWater) * (waterBottom - waterTop);
  const yRain = (mm: number) => rainBottom - (Math.min(mm, maxPrecip) / maxPrecip) * (rainBottom - rainTop);

  const sPoints: [number, number][] = results.map((r, i) => [scaleX(i, n), yWater(r.S)]);
  const mPoints: [number, number][] = results.map((r, i) => [scaleX(i, n), yWater(r.M)]);
  const mArea = `${PAD_LEFT},${waterBottom} ${polyline(mPoints)} ${WIDTH - PAD_RIGHT},${waterBottom}`;

  const rainPoints: [number, number][] = inputs.map((inp, i) => [scaleX(i, n), yRain(inp.precipitationMm)]);
  const rainArea = `${PAD_LEFT},${rainBottom} ${polyline(rainPoints)} ${WIDTH - PAD_RIGHT},${rainBottom}`;

  // Day boundaries and date labels. Assumes index 0 of this slice is local midnight.
  const dayMarks: { x: number; idx: number }[] = [];
  for (let i = 0; i < n; i += 24) dayMarks.push({ x: scaleX(i, n), idx: i });

  const bands: { x0: number; x1: number }[] = [];
  let bandStart: number | null = null;
  for (let i = 0; i < n; i++) {
    if (results[i].climbable && bandStart === null) bandStart = i;
    if (!results[i].climbable && bandStart !== null) {
      bands.push({ x0: scaleX(bandStart, n), x1: scaleX(i - 1, n) });
      bandStart = null;
    }
  }
  if (bandStart !== null) bands.push({ x0: scaleX(bandStart, n), x1: scaleX(n - 1, n) });

  return (
    <div>
      <p className="text-sm" style={{ color: 'var(--text)' }}>
        Rain and rock wetness, hour by hour
      </p>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="mt-1 w-full" role="img" aria-label="Hourly rain and wetness timeline">
        <text x={4} y={rainTop - 10} fontSize={AXIS_FONT} fill="var(--text-dim)">
          Rain
        </text>
        <text x={4} y={waterTop + 12} fontSize={AXIS_FONT} fill="var(--text-dim)">
          Wetness
        </text>

        {dayMarks.map((d, i) => (
          <line key={i} x1={d.x} y1={rainTop - 4} x2={d.x} y2={waterBottom} stroke="var(--border)" strokeWidth={1.5} />
        ))}

        {bands.map((b, i) => (
          <rect key={i} x={b.x0} y={waterTop} width={Math.max(2, b.x1 - b.x0)} height={waterBottom - waterTop} fill="var(--signal)" opacity={0.28} />
        ))}

        {/* rain */}
        <polygon points={rainArea} fill="var(--wet)" opacity={0.8} />
        <line x1={PAD_LEFT} y1={rainBottom} x2={WIDTH - PAD_RIGHT} y2={rainBottom} stroke="var(--border)" strokeWidth={1.5} />

        {/* matrix wetness (M) as a filled area behind the surface curve */}
        <polygon points={mArea} fill="var(--wet)" opacity={0.45} />
        {/* surface wetness (S) */}
        <polyline points={polyline(sPoints)} fill="none" stroke="var(--dry)" strokeWidth={2.5} />

        <line x1={PAD_LEFT} y1={waterBottom} x2={WIDTH - PAD_RIGHT} y2={waterBottom} stroke="var(--border)" strokeWidth={1.5} />

        {/* now marker */}
        {nowIdx >= 0 && nowIdx < n && (
          <line x1={scaleX(nowIdx, n)} y1={rainTop - 4} x2={scaleX(nowIdx, n)} y2={waterBottom} stroke="var(--signal)" strokeWidth={2.5} strokeDasharray="5 4" />
        )}

        {/* day labels along the bottom */}
        {dayMarks.map((d, i) => (
          <text key={i} x={d.x} y={HEIGHT - 26} fontSize={LABEL_FONT} fill="var(--text)" textAnchor="start">
            {DAY_LABEL.format(inputs[d.idx] ? new Date(inputs[d.idx].time * 1000) : new Date())}
          </text>
        ))}
      </svg>

      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1.5 text-sm" style={{ color: 'var(--text-dim)' }}>
        <LegendSwatch kind="fill" colour="var(--wet)" label="rain" />
        <LegendSwatch kind="line" colour="var(--dry)" label="surface film" />
        <LegendSwatch kind="fill" colour="var(--wet)" label="inside the rock" />
        <LegendSwatch kind="band" colour="var(--signal)" label="climbable" />
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-0.5" style={{ background: 'var(--signal)' }} />
          now
        </span>
      </div>

      <Explain>
        <p>
          <strong>Rain</strong> is how hard it's falling that hour. <strong>Wetness</strong> has two layers: the pale
          line is the film of water sitting on the surface, and the shaded area behind it is water held inside the
          rock. Both need to be low, and the green band shows exactly when that's the case, before the rock reads as
          climbable.
        </p>
      </Explain>
    </div>
  );
}

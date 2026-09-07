import type { CragHourlyInput, HourResult } from '../model/wetness';

const WIDTH = 720;
const HEIGHT = 220;
const PAD = 24;

function scaleX(i: number, n: number): number {
  return PAD + (i / Math.max(1, n - 1)) * (WIDTH - PAD * 2);
}

function polyline(points: [number, number][]): string {
  return points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
}

/**
 * The hourly conditions timeline — spec §6 crag detail, "the most important
 * visual in the app". Precipitation bars, S/M wetness curves, climbable bands,
 * day boundaries, and a "now" marker.
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

  const chartTop = 10;
  const chartBottom = HEIGHT - 30;
  const precipBarTop = chartTop;
  const precipBarBottom = chartTop + 30;
  const waterTop = precipBarBottom + 8;
  const waterBottom = chartBottom;

  const yWater = (mm: number) => waterBottom - (Math.min(mm, maxWater) / maxWater) * (waterBottom - waterTop);

  const sPoints: [number, number][] = results.map((r, i) => [scaleX(i, n), yWater(r.S)]);
  const mPoints: [number, number][] = results.map((r, i) => [scaleX(i, n), yWater(r.M)]);
  const mArea = `${PAD},${waterBottom} ${polyline(mPoints)} ${WIDTH - PAD},${waterBottom}`;

  // Day boundaries (every 24 hours) and climbable bands.
  const dayLines: number[] = [];
  for (let i = 0; i < n; i += 24) dayLines.push(scaleX(i, n));

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
    <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="w-full" role="img" aria-label="Hourly conditions timeline">
      {/* night/day would go here in a fuller build; day boundaries stand in for now */}
      {dayLines.map((x, i) => (
        <line key={i} x1={x} y1={chartTop} x2={x} y2={chartBottom} stroke="var(--border)" strokeWidth={1} />
      ))}

      {bands.map((b, i) => (
        <rect key={i} x={b.x0} y={waterTop} width={Math.max(1, b.x1 - b.x0)} height={waterBottom - waterTop} fill="var(--signal)" opacity={0.12} />
      ))}

      {/* precipitation bars */}
      {inputs.map((inp, i) => {
        if (inp.precipitationMm <= 0) return null;
        const h = (inp.precipitationMm / maxPrecip) * (precipBarBottom - precipBarTop);
        const x = scaleX(i, n);
        return <rect key={i} x={x - 1} y={precipBarBottom - h} width={2} height={h} fill="var(--wet)" />;
      })}
      <line x1={PAD} y1={precipBarBottom} x2={WIDTH - PAD} y2={precipBarBottom} stroke="var(--border)" strokeWidth={1} />

      {/* matrix wetness (M) as a filled area behind the surface curve */}
      <polygon points={mArea} fill="var(--wet)" opacity={0.25} />
      {/* surface wetness (S) */}
      <polyline points={polyline(sPoints)} fill="none" stroke="var(--wet)" strokeWidth={2} />

      {/* climbable threshold reference line at the bottom of the water axis */}
      <line x1={PAD} y1={waterBottom} x2={WIDTH - PAD} y2={waterBottom} stroke="var(--dry)" strokeWidth={1} />

      {/* now marker */}
      {nowIdx >= 0 && nowIdx < n && (
        <line x1={scaleX(nowIdx, n)} y1={chartTop} x2={scaleX(nowIdx, n)} y2={chartBottom} stroke="var(--signal)" strokeWidth={2} strokeDasharray="4 3" />
      )}
    </svg>
  );
}

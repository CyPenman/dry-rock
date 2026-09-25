import type { CSSProperties, ReactNode } from 'react';
import { localDateKeyLondon } from '../../model/time';

/**
 * Shared drawing primitives for the redesigned charts (design study "Crag
 * Charts", turn 2). The legibility fix that motivated the redesign: SVG
 * carries geometry only - every tick label, day label and data dot is real
 * HTML at real pixel sizes, so nothing shrinks when the plot stretches to
 * card width. Strokes use vector-effect non-scaling-stroke so a 2px line
 * stays 2px at any width.
 *
 * Geometry, formatting and drawing helpers; the components that use them
 * (`Plot`, `ClimbableRibbon`) are in kit.tsx, so that file only exports
 * components (fast refresh).
 */

export const VW = 1000; // viewBox width; x geometry stretches, y and strokes do not

export const STROKE = { vectorEffect: 'non-scaling-stroke' as const };

export function sx(i: number, n: number): number {
  return n < 2 ? VW / 2 : (i / (n - 1)) * VW;
}

export function poly(pts: readonly (readonly number[])[]): string {
  return pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
}

export function fmtFine(mm: number): string {
  if (mm <= 0) return '0';
  if (mm < 0.01) return '<0.01';
  return mm.toFixed(2);
}

export function fmt(mm: number): string {
  if (mm === 0) return '0';
  if (mm >= 10) return mm.toFixed(0);
  if (mm >= 1) return mm.toFixed(1);
  return mm.toFixed(2).replace(/0$/, '');
}

const DAY_LABEL = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric' });

export interface YLabel {
  y: number;
  label: string;
}

export interface XLabel {
  f: number; // fraction 0-1 along the plot width
  label: string;
  strong?: boolean;
}

/**
 * Shared threshold for rotating x-axis day labels, so every chart with a
 * variable-length day axis (water budget, score-by-day, hourly's day
 * labels) switches to the 45deg layout at the same density instead of each
 * picking its own cutoff. Bumped down from ">7" to ">6": a 7-bar window was
 * still overlapping in practice (e.g. water budget's "Selected range" pill
 * landing on exactly 7 bars while the very next pill, "+1 day", pushed the
 * count to 8 and rotated - same density, inconsistent layout).
 */
export function xAxisRotation(n: number): { xAxisH: number; xLabelRotateDeg: number } {
  const rotate = n > 6;
  return { xAxisH: rotate ? 44 : 22, xLabelRotateDeg: rotate ? 45 : 0 };
}

export function gridlines(ticks: number[], y: (v: number) => number, _h: number): ReactNode[] {
  return ticks.map((v, i) => (
    <line key={`g${i}`} x1={0} x2={VW} y1={y(v)} y2={y(v)} stroke={v === 0 ? 'var(--border)' : 'var(--grid)'} strokeWidth={v === 0 ? 1.5 : 1} {...STROKE} />
  ));
}

/**
 * [start, endExclusive) index ranges of each local day in an hourly series.
 * With `times`, grouped by London calendar date, so a 23- or 25-hour day at a
 * clock change gets its real width (§3.1); without, fixed 24-hour chunks.
 */
function dayRanges(n: number, times?: number[]): [number, number][] {
  const out: [number, number][] = [];
  if (times && times.length >= n) {
    let start = 0;
    for (let i = 1; i <= n; i++) {
      if (i === n || localDateKeyLondon(times[i]) !== localDateKeyLondon(times[start])) {
        out.push([start, i]);
        start = i;
      }
    }
    return out;
  }
  for (let d = 0; d * 24 < n; d++) out.push([d * 24, Math.min(n, (d + 1) * 24)]);
  return out;
}

/** Alternating day columns - the cheapest way to make "which day is this" read. Pass `times` for clock-change-correct days. */
export function dayBands(n: number, h: number, y0 = 0, times?: number[]): ReactNode[] {
  const out: ReactNode[] = [];
  const ranges = dayRanges(n, times);
  for (let d = 0; d < ranges.length; d += 2) {
    const x0 = sx(ranges[d][0], n);
    const x1 = sx(Math.min(n - 1, ranges[d][1]), n);
    out.push(<rect key={`db${d}`} x={x0} y={y0} width={Math.max(1, x1 - x0)} height={h - y0} fill="#ffffff" opacity={0.028} />);
  }
  return out;
}

export function nightBands(isDayFlags: boolean[], h: number): ReactNode[] {
  const n = isDayFlags.length;
  return isDayFlags
    .map((isDay, i) =>
      isDay ? null : <rect key={`n${i}`} x={sx(i - 0.5, n)} y={0} width={VW / n} height={h} fill="var(--ground-sunken)" opacity={0.45} />,
    )
    .filter(Boolean);
}

/** HTML dot - never an SVG circle, which would go elliptical under x-stretch. */
export function dot(f: number, top: number, colour: string, size = 9, key?: string, ring = true): ReactNode {
  return (
    <div
      key={key}
      style={{
        position: 'absolute',
        left: `${f * 100}%`,
        top,
        width: size,
        height: size,
        borderRadius: '50%',
        background: colour,
        boxShadow: ring ? '0 0 0 2px var(--ground)' : 'none',
        transform: 'translate(-50%,-50%)',
        pointerEvents: 'none',
      }}
    />
  );
}

/** One label per day, centred on it. Pass `times` for clock-change-correct days. */
export function dayLabels(getDate: (i: number) => Date, n: number, times?: number[]): XLabel[] {
  return dayRanges(n, times).map(([start, end]) => {
    const mid = Math.min(start + Math.floor((end - start) / 2), n - 1);
    return { f: sx(mid, n) / VW, label: DAY_LABEL.format(getDate(start)), strong: true };
  });
}

export function pillStyle(on: boolean): CSSProperties {
  // All four sides spelled out as longhand (never the `border` shorthand,
  // nor the per-axis borderWidth/Style/Color shorthands) so a caller can
  // safely override just borderLeft* - React warns when a shorthand and its
  // longhand counterpart are both set across a rerender (DayScoreChart's
  // per-model accent pills do exactly that).
  const colour = on ? 'var(--signal)' : 'var(--border)';
  return {
    borderRadius: 3,
    padding: '7px 11px',
    font: '600 12px/1 system-ui,sans-serif',
    background: on ? 'var(--signal)' : 'var(--ground-raised)',
    color: on ? 'var(--ground)' : 'var(--text)',
    borderTopWidth: 1,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderLeftWidth: 1,
    borderTopStyle: 'solid',
    borderRightStyle: 'solid',
    borderBottomStyle: 'solid',
    borderLeftStyle: 'solid',
    borderTopColor: colour,
    borderRightColor: colour,
    borderBottomColor: colour,
    borderLeftColor: colour,
    cursor: 'pointer',
  };
}

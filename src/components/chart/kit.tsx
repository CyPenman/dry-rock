import type { CSSProperties, PointerEvent, ReactNode } from 'react';

/**
 * Shared drawing primitives for the redesigned charts (design study "Crag
 * Charts", turn 2). The legibility fix that motivated the redesign: SVG
 * carries geometry only - every tick label, day label and data dot is real
 * HTML at real pixel sizes, so nothing shrinks when the plot stretches to
 * card width. Strokes use vector-effect non-scaling-stroke so a 2px line
 * stays 2px at any width.
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

/** Grid shell: HTML y-labels | SVG plot, with an HTML x-label row underneath. */
export function Plot({
  h,
  gutter = 38,
  yLabels = [],
  xLabels = [],
  overlay = null,
  children,
  onScrub,
  xAxisH = 22,
  /** Angle (degrees) to rotate x-axis labels, anchored top-right of each tick - for
   * dense day counts where horizontal labels would collide (§6 water budget). */
  xLabelRotateDeg = 0,
  ariaLabel,
}: {
  h: number;
  gutter?: number;
  yLabels?: YLabel[];
  xLabels?: XLabel[];
  overlay?: ReactNode;
  onScrub?: (frac: number) => void;
  xAxisH?: number;
  xLabelRotateDeg?: number;
  ariaLabel: string;
  children: ReactNode;
}) {
  function frac(ev: PointerEvent<HTMLDivElement>): number {
    const r = ev.currentTarget.getBoundingClientRect();
    return Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width));
  }
  const handlers = onScrub
    ? {
        onPointerDown: (ev: PointerEvent<HTMLDivElement>) => {
          ev.currentTarget.setPointerCapture(ev.pointerId);
          onScrub(frac(ev));
        },
        onPointerMove: (ev: PointerEvent<HTMLDivElement>) => {
          if (ev.buttons) onScrub(frac(ev));
        },
      }
    : {};
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `${gutter}px minmax(0,1fr)`, gridTemplateRows: `${h}px ${xAxisH}px` }}>
      <div style={{ position: 'relative' }}>
        {yLabels.map((l, i) => (
          <div
            key={i}
            style={{
              position: 'absolute',
              right: 7,
              top: l.y,
              transform: 'translateY(-50%)',
              font: '600 11px/1 ui-monospace,SFMono-Regular,Menlo,monospace',
              color: 'var(--text-dim)',
              whiteSpace: 'nowrap',
            }}
          >
            {l.label}
          </div>
        ))}
      </div>
      <div {...handlers} style={{ position: 'relative', touchAction: onScrub ? 'none' : undefined, cursor: onScrub ? 'crosshair' : undefined }}>
        <svg
          viewBox={`0 0 ${VW} ${h}`}
          preserveAspectRatio="none"
          width="100%"
          height={h}
          role="img"
          aria-label={ariaLabel}
          style={{ display: 'block', overflow: 'visible' }}
        >
          {children}
        </svg>
        {overlay}
      </div>
      <div />
      <div style={{ position: 'relative' }}>
        {xLabels.map((l, i) => (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: `${l.f * 100}%`,
              top: 3,
              transform: xLabelRotateDeg ? `translateX(-100%) rotate(-${xLabelRotateDeg}deg)` : 'translateX(-50%)',
              transformOrigin: xLabelRotateDeg ? 'top right' : undefined,
              font: `${l.strong ? '600' : '500'} ${l.strong ? 12 : 11}px/1 ui-monospace,SFMono-Regular,Menlo,monospace`,
              color: l.strong ? 'var(--text)' : 'var(--text-dim)',
              whiteSpace: 'nowrap',
            }}
          >
            {l.label}
          </div>
        ))}
      </div>
    </div>
  );
}

export function gridlines(ticks: number[], y: (v: number) => number, _h: number): ReactNode[] {
  return ticks.map((v, i) => (
    <line key={`g${i}`} x1={0} x2={VW} y1={y(v)} y2={y(v)} stroke={v === 0 ? 'var(--border)' : 'var(--grid)'} strokeWidth={v === 0 ? 1.5 : 1} {...STROKE} />
  ));
}

/** Alternating day columns - the cheapest way to make "which day is this" read. */
export function dayBands(n: number, h: number, y0 = 0, hoursPerDay = 24): ReactNode[] {
  const out: ReactNode[] = [];
  const days = Math.ceil(n / hoursPerDay);
  for (let d = 0; d < days; d += 2) {
    const x0 = sx(d * hoursPerDay, n);
    const x1 = sx(Math.min(n - 1, (d + 1) * hoursPerDay), n);
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

export function dayLabels(getDate: (i: number) => Date, n: number, hoursPerDay = 24): XLabel[] {
  const out: XLabel[] = [];
  for (let d = 0; d * hoursPerDay < n; d++) {
    const mid = Math.min(d * hoursPerDay + Math.floor(hoursPerDay / 2), n - 1);
    out.push({ f: sx(mid, n) / VW, label: DAY_LABEL.format(getDate(d * hoursPerDay)), strong: true });
  }
  return out;
}

/** Slim ribbon of climbable/not-climbable bands over the full series. */
export function ClimbableRibbon({ climbable, h = 14 }: { climbable: boolean[]; h?: number }) {
  const n = climbable.length;
  const bands: [number, number][] = [];
  let start: number | null = null;
  climbable.forEach((c, i) => {
    if (c && start === null) start = i;
    if (!c && start !== null) {
      bands.push([start, i - 1]);
      start = null;
    }
  });
  if (start !== null) bands.push([start, n - 1]);
  return (
    <svg viewBox={`0 0 ${VW} ${h}`} preserveAspectRatio="none" width="100%" height={h} style={{ display: 'block' }}>
      <rect x={0} y={0} width={VW} height={h} fill="var(--ground-sunken)" />
      {bands.map(([s, en], i) => (
        <rect key={i} x={sx(s, n)} y={0} width={Math.max(4, sx(en, n) - sx(s, n))} height={h} fill="var(--signal)" />
      ))}
    </svg>
  );
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

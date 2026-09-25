import type { PointerEvent, ReactNode } from 'react';
import { sx, VW, type XLabel, type YLabel } from './draw';

// Chart components - the helpers they draw with are in draw.tsx (design study
// "Crag Charts", turn 2).

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

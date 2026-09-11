import { useState } from 'react';
import type { ModelName } from '../api/request';
import type { CragDayResult } from '../model/dayAggregate';
import type { Verdict } from '../model/score';
import { Plot, STROKE, VW, dot, gridlines, pillStyle, poly, sx, xAxisRotation } from './chart/kit';
import { Explain } from './Explain';

const MODEL_LABELS: Record<ModelName, string> = {
  ukmo_seamless: 'UKMO',
  ecmwf_ifs025: 'ECMWF',
  icon_seamless: 'ICON',
  gfs_seamless: 'GFS',
};

// Fixed categorical order, validated against the app's dark surface with the
// dataviz skill's palette checker (adjacent CVD Delta E + contrast).
const MODEL_COLOURS: Record<ModelName, string> = {
  ukmo_seamless: 'var(--chart-model-1)',
  ecmwf_ifs025: 'var(--chart-model-2)',
  icon_seamless: 'var(--chart-model-3)',
  gfs_seamless: 'var(--chart-model-4)',
};

const GATED_LABEL: Record<Verdict, string> = {
  scored: '',
  under_snow: 'SNOW',
  frozen: 'FROZEN',
  rock_damage: 'DAMAGE',
};

const DAY_LABEL_SHORT = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric' });

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Score by day - consensus band across every resolved model (design study
 * "Crag Charts", option 2g). The spread between models becomes the
 * confidence signal instead of four crossing lines: a wide shaded band means
 * low confidence whatever the number says. Tap a model to pull it out of the
 * consensus and see its own line. Gated days (frozen, snow, rock damage) are
 * hatched rather than plotted at zero.
 */
export function DayScoreChart({
  perModelDays,
  availableModels,
  primaryModel,
  startIdx,
  endIdx,
}: {
  perModelDays: Partial<Record<ModelName, CragDayResult[]>>;
  availableModels: ModelName[];
  primaryModel: ModelName;
  startIdx: number;
  endIdx: number;
}) {
  const [highlight, setHighlight] = useState<ModelName | null>(null);

  const dayCount = endIdx - startIdx + 1;
  if (dayCount < 1 || availableModels.length === 0) return null;

  // Dates and the gating verdict come from the primary model - the one
  // `dayAggregate.ts` already picked for having the longest real coverage -
  // not just availableModels[0], which can be a shorter-horizon model (e.g.
  // UKMO/ICON commonly resolve only ~7 days ahead; buildInputs.ts truncates
  // them there rather than feed the physics model null-derived garbage).
  const referenceDays = (perModelDays[primaryModel] ?? []).slice(startIdx, endIdx + 1);
  const days = referenceDays.map((refDay, i) => {
    // A model with no day at this index simply hasn't resolved that far
    // (excluded from the spread entirely) - distinct from a model that
    // resolved the day and gated it (a real 0, part of the spread, hatched).
    const scores: Partial<Record<ModelName, number>> = {};
    for (const m of availableModels) {
      const d = (perModelDays[m] ?? [])[startIdx + i];
      if (d) scores[m] = d.verdict === 'scored' ? d.score : 0;
    }
    return { date: refDay.date, verdict: refDay.verdict, scores };
  });

  function valuesFor(scores: Partial<Record<ModelName, number>>): number[] {
    const v = Object.values(scores).filter((x): x is number => x != null);
    return v.length > 0 ? v : [0];
  }

  const n = days.length;
  const lo = days.map((d) => Math.min(...valuesFor(d.scores)));
  const hi = days.map((d) => Math.max(...valuesFor(d.scores)));
  const med = days.map((d) => median(valuesFor(d.scores)));

  const H = 130;
  const top = 6;
  const pb = H - 4;
  const Y = (s: number) => pb - s * (pb - top);
  const slot = VW / n;

  const band = `${poly(hi.map((v, i) => [sx(i, n), Y(v) - 2]))} ${poly(
    lo.map((v, i) => [sx(i, n), Y(v) + 2]).reverse(),
  )}`;
  // Wide custom date ranges can put many day columns on one axis - rotate the
  // labels past the same density threshold water budget uses, otherwise the
  // (always-bold) day labels here collide even sooner than that chart's.
  const { xAxisH, xLabelRotateDeg } = xAxisRotation(n);
  const highlightPoints = highlight
    ? days
        .map((d, i) => (d.scores[highlight] != null ? ([sx(i, n), Y(d.scores[highlight]!)] as [number, number]) : null))
        .filter((p): p is [number, number] => p != null)
    : [];

  return (
    <div>
      <p className="text-sm" style={{ color: 'var(--text)' }}>
        Score out of 100 for each day, as the spread across every resolved model
      </p>

      <div style={{ marginTop: 12 }}>
        <Plot
          h={H}
          gutter={34}
          xAxisH={xAxisH}
          xLabelRotateDeg={xLabelRotateDeg}
          ariaLabel="Score by day with model spread"
          yLabels={[0, 25, 50, 75, 100].map((v) => ({ y: Y(v / 100), label: String(v) }))}
          xLabels={days.map((d, i) => ({ f: sx(i, n) / VW, label: DAY_LABEL_SHORT.format(d.date), strong: true }))}
          overlay={
            <>
              {days.map((d, i) =>
                d.verdict !== 'scored' ? (
                  <div
                    key={`gl${i}`}
                    style={{
                      position: 'absolute',
                      left: `${(sx(i, n) / VW) * 100}%`,
                      top: '50%',
                      transform: 'translate(-50%,-50%) rotate(-90deg)',
                      font: '600 10px/1 system-ui,sans-serif',
                      letterSpacing: '0.08em',
                      color: 'var(--warning)',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {GATED_LABEL[d.verdict]}
                  </div>
                ) : null,
              )}
              {days.map((d, i) => {
                const v = highlight ? d.scores[highlight] : med[i];
                return d.verdict === 'scored' && v != null
                  ? dot(sx(i, n) / VW, Y(v), highlight ? MODEL_COLOURS[highlight] : 'var(--chart-model-1)', 10, `d${i}`)
                  : null;
              })}
              {days.map((d, i) => {
                const v = highlight ? d.scores[highlight] : med[i];
                return d.verdict === 'scored' && v != null ? (
                  <div
                    key={`v${i}`}
                    style={{
                      position: 'absolute',
                      left: `${(sx(i, n) / VW) * 100}%`,
                      top: Y(v) - 14,
                      transform: 'translate(-50%,-100%)',
                      font: '600 12px/1 ui-monospace,Menlo,monospace',
                      color: 'var(--text)',
                    }}
                  >
                    {Math.round(v * 100)}
                  </div>
                ) : null;
              })}
            </>
          }
        >
          {gridlines([0, 0.25, 0.5, 0.75, 1], Y, H)}
          {days.map((d, i) =>
            d.verdict !== 'scored' ? (
              <rect key={`g${i}`} x={sx(i, n) - slot / 2} y={top} width={slot} height={pb - top} fill="var(--warning)" opacity={0.14} />
            ) : null,
          )}
          {!highlight ? (
            <polygon points={band} fill="var(--chart-model-1)" opacity={0.32} />
          ) : null}
          {!highlight ? (
            <polyline points={poly(med.map((v, i) => [sx(i, n), Y(v)]))} fill="none" stroke="var(--chart-model-1)" strokeWidth={3} strokeLinejoin="round" {...STROKE} />
          ) : (
            <polyline points={poly(highlightPoints)} fill="none" stroke={MODEL_COLOURS[highlight]} strokeWidth={3} strokeLinejoin="round" {...STROKE} />
          )}
        </Plot>
      </div>

      <div className="flex flex-wrap gap-1.5" style={{ marginTop: 10, marginLeft: 34 }}>
        <button type="button" onClick={() => setHighlight(null)} style={pillStyle(highlight == null)}>
          Consensus
        </button>
        {availableModels.map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setHighlight(m)}
            style={{ ...pillStyle(highlight === m), borderLeftWidth: 4, borderLeftStyle: 'solid', borderLeftColor: MODEL_COLOURS[m] }}
          >
            {MODEL_LABELS[m]}
          </button>
        ))}
      </div>
      <p style={{ margin: '8px 0 0 34px', font: '11px/1.45 system-ui,sans-serif', color: 'var(--text-faint)' }}>
        The shaded band is the full spread between the resolved models; the line is their median. A wide band means
        low confidence whatever the number says.
      </p>

      <Explain>
        <p>Score is 0 to 100, higher is better - see the score breakdown table above for what makes up each number.</p>
        <p>
          Days hatched with a label (frozen, under snow, or rock damage) are ruled out entirely for at least one
          model, not just scored low.
        </p>
      </Explain>
    </div>
  );
}

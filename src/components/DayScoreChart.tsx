import { useState } from 'react';
import type { ModelName } from '../api/request';
import type { CragDayResult } from '../model/dayAggregate';
import { Explain } from './Explain';

const MODEL_LABELS: Record<ModelName, string> = {
  ukmo_seamless: 'UKMO',
  ecmwf_ifs025: 'ECMWF',
  icon_seamless: 'ICON',
  gfs_seamless: 'GFS',
};

const MODEL_COLOURS: Record<ModelName, string> = {
  ukmo_seamless: '#7fb99a',
  ecmwf_ifs025: '#9b8fd6',
  icon_seamless: '#7a9cc6',
  gfs_seamless: '#c9a86a',
};

// Sized for how this actually renders on a phone card, not the viewBox's own units.
const WIDTH = 400;
const HEIGHT = 220;
const PAD_LEFT = 34;
const PAD_RIGHT = 10;
const PAD_TOP = 14;
const PAD_BOTTOM = 30;
const AXIS_FONT = 13;

/**
 * Score-by-day comparison across every resolved model — spec §6 crag detail:
 * "displaying the various models' ranking scores", with a filter for a
 * specific model or all of them together.
 */
export function DayScoreChart({
  perModelDays,
  availableModels,
  startIdx,
  endIdx,
}: {
  perModelDays: Partial<Record<ModelName, CragDayResult[]>>;
  availableModels: ModelName[];
  startIdx: number;
  endIdx: number;
}) {
  const [filter, setFilter] = useState<ModelName | 'all'>('all');

  const dayCount = endIdx - startIdx + 1;
  if (dayCount < 1) return null;

  const visibleModels = filter === 'all' ? availableModels : [filter];
  const plotWidth = WIDTH - PAD_LEFT - PAD_RIGHT;
  const plotHeight = HEIGHT - PAD_TOP - PAD_BOTTOM;

  const x = (dayOffset: number) => PAD_LEFT + (dayCount === 1 ? plotWidth / 2 : (dayOffset / (dayCount - 1)) * plotWidth);
  const y = (score: number) => PAD_TOP + plotHeight - (score / 100) * plotHeight;

  // Thin out day labels so they don't overlap on a narrow screen.
  const labelStride = Math.max(1, Math.ceil(dayCount / 6));

  const referenceDays = perModelDays[availableModels[0]] ?? [];

  return (
    <div>
      <p className="text-sm" style={{ color: 'var(--text)' }}>
        Score out of 100 for each day, one line per model
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => setFilter('all')}
          className="rounded-full px-3 py-1.5 text-sm"
          style={{
            background: filter === 'all' ? 'var(--signal)' : 'var(--ground-raised)',
            color: filter === 'all' ? 'var(--ground)' : 'var(--text)',
          }}
        >
          All models
        </button>
        {availableModels.map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setFilter(m)}
            className="rounded-full px-3 py-1.5 text-sm"
            style={{
              background: filter === m ? 'var(--signal)' : 'var(--ground-raised)',
              color: filter === m ? 'var(--ground)' : 'var(--text)',
            }}
          >
            {MODEL_LABELS[m]}
          </button>
        ))}
      </div>

      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="mt-2 w-full" role="img" aria-label="Score by day, compared across models">
        {[0, 25, 50, 75, 100].map((tick) => (
          <g key={tick}>
            <line x1={PAD_LEFT} y1={y(tick)} x2={WIDTH - PAD_RIGHT} y2={y(tick)} stroke="var(--border)" strokeWidth={1} />
            <text x={2} y={y(tick) + 5} fontSize={AXIS_FONT} fill="var(--text-dim)">
              {tick}
            </text>
          </g>
        ))}

        {referenceDays.slice(startIdx, endIdx + 1).map((d, i) =>
          i % labelStride === 0 ? (
            <text key={i} x={x(i)} y={HEIGHT - 8} fontSize={AXIS_FONT} fill="var(--text)" textAnchor="middle">
              {d.date.getDate()}
            </text>
          ) : null,
        )}

        {visibleModels.map((model) => {
          const days = (perModelDays[model] ?? []).slice(startIdx, endIdx + 1);
          if (days.length === 0) return null;
          const points = days.map((d, i) => `${x(i).toFixed(1)},${y(d.score * 100).toFixed(1)}`).join(' ');
          return (
            <g key={model}>
              <polyline points={points} fill="none" stroke={MODEL_COLOURS[model]} strokeWidth={filter === 'all' ? 2 : 3} opacity={filter === 'all' ? 0.85 : 1} />
              {days.map((d, i) => (
                <circle
                  key={i}
                  cx={x(i)}
                  cy={y(d.score * 100)}
                  r={d.verdict === 'scored' ? 3.5 : 5.5}
                  fill={d.verdict === 'scored' ? MODEL_COLOURS[model] : 'var(--warning)'}
                />
              ))}
            </g>
          );
        })}
      </svg>

      {filter === 'all' && (
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1.5 text-sm" style={{ color: 'var(--text-dim)' }}>
          {availableModels.map((m) => (
            <span key={m} className="flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: MODEL_COLOURS[m] }} />
              {MODEL_LABELS[m]}
            </span>
          ))}
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: 'var(--warning)' }} />
            not climbable
          </span>
        </div>
      )}

      <Explain>
        <p>
          Higher is better, 0 to 100. Where the lines split apart, the models disagree, which is itself useful
          information. A coloured dot sitting on the zero line means that model rules the day out completely (frozen,
          snowed under, or rock damage), not just scoring it low.
        </p>
      </Explain>
    </div>
  );
}

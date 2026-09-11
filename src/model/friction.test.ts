import { describe, expect, it } from 'vitest';
import { bestFrictionBlock, frictionScoreHour } from './friction';

const base = {
  trockC: 12,
  idealTempC: [8, 16] as [number, number],
  dewPointC: 8,
  windSpeedMs: 2,
  gtiFaceWm2: 100,
  aspectDeg: 0, // north-facing - avoids the south-sun overheating rule
  coastal: false,
  rock: 'limestone' as const,
};

describe('frictionScoreHour (§4.8)', () => {
  it('scores near-ideal conditions highly', () => {
    expect(frictionScoreHour(base)).toBeGreaterThan(0.8);
  });

  it('penalises rock temperature outside the ideal band', () => {
    const cold = frictionScoreHour({ ...base, trockC: -5 });
    const hot = frictionScoreHour({ ...base, trockC: 30 });
    expect(cold).toBeLessThan(frictionScoreHour(base));
    expect(hot).toBeLessThan(frictionScoreHour(base));
  });

  it('penalises heavily when the rock is on the edge of condensing (Trock - dewPoint < 2)', () => {
    const onEdge = frictionScoreHour({ ...base, trockC: 9, dewPointC: 8 });
    const clear = frictionScoreHour({ ...base, trockC: 12, dewPointC: 2 });
    expect(onEdge).toBeLessThan(clear);
  });

  it('penalises a high dew point (greasy) more than a low one', () => {
    const greasy = frictionScoreHour({ ...base, dewPointC: 14 });
    const crisp = frictionScoreHour({ ...base, dewPointC: 3 });
    expect(greasy).toBeLessThan(crisp);
  });

  it('penalises strong wind, rewards a light breeze', () => {
    const gale = frictionScoreHour({ ...base, windSpeedMs: 15 });
    const breeze = frictionScoreHour({ ...base, windSpeedMs: 5 });
    const calm = frictionScoreHour({ ...base, windSpeedMs: 0.5 });
    expect(gale).toBeLessThan(calm);
    expect(breeze).toBeGreaterThanOrEqual(calm);
  });

  it('penalises a baking south wall above 20C in strong sun', () => {
    const baking = frictionScoreHour({ ...base, aspectDeg: 180, gtiFaceWm2: 700, trockC: 25 });
    const mildSouth = frictionScoreHour({ ...base, aspectDeg: 180, gtiFaceWm2: 700, trockC: 12 });
    expect(baking).toBeLessThan(mildSouth);
  });

  it('penalises coastal salt friction in humid onshore conditions', () => {
    const salty = frictionScoreHour({ ...base, coastal: true, dewPointC: 12 });
    const dry = frictionScoreHour({ ...base, coastal: true, dewPointC: 4 });
    expect(salty).toBeLessThan(dry);
  });

  it('does not apply the coastal penalty when the wind is offshore', () => {
    // aspectDeg 0 (north-facing); wind FROM the south (180) blows off the back of
    // the face, not onto it - alignment = cos(180-0) = -1, offshore.
    const offshoreCoastal = frictionScoreHour({ ...base, coastal: true, dewPointC: 12, aspectDeg: 0, windDirectionDeg: 180 });
    const notCoastal = frictionScoreHour({ ...base, coastal: false, dewPointC: 12, aspectDeg: 0, windDirectionDeg: 180 });
    expect(offshoreCoastal).toBeCloseTo(notCoastal, 5);
  });

  it('applies the coastal penalty when the wind is onshore', () => {
    // aspectDeg 0, wind FROM the north (0) blows straight onto the face - onshore.
    const onshoreHumid = frictionScoreHour({ ...base, coastal: true, dewPointC: 12, aspectDeg: 0, windDirectionDeg: 0 });
    const onshoreDry = frictionScoreHour({ ...base, coastal: true, dewPointC: 4, aspectDeg: 0, windDirectionDeg: 0 });
    expect(onshoreHumid).toBeLessThan(onshoreDry);
  });

  it('has no discontinuous jumps across the dew point, wind and spread ramps (no cliff edges)', () => {
    const maxStep = (fn: (x: number) => number, from: number, to: number, steps: number) => {
      let max = 0;
      let prev = fn(from);
      for (let i = 1; i <= steps; i++) {
        const x = from + ((to - from) * i) / steps;
        const cur = fn(x);
        max = Math.max(max, Math.abs(cur - prev));
        prev = cur;
      }
      return max;
    };

    const stepSize = 0.2; // sampling interval
    const byDewPoint = maxStep((d) => frictionScoreHour({ ...base, dewPointC: d }), 0, 20, 20 / stepSize);
    const byWind = maxStep((w) => frictionScoreHour({ ...base, windSpeedMs: w }), 0, 20, 20 / stepSize);
    const byTrock = maxStep((t) => frictionScoreHour({ ...base, trockC: t }), -10, 30, 40 / stepSize);

    // A genuine step function would jump by its full magnitude (0.15-0.4) in one
    // sample; a smooth ramp moves by at most a small fraction of the step interval.
    expect(byDewPoint).toBeLessThan(0.1);
    expect(byWind).toBeLessThan(0.1);
    expect(byTrock).toBeLessThan(0.1);
  });

  it('penalises glassy slate in strong summer sun', () => {
    const glassySlate = frictionScoreHour({ ...base, rock: 'slate', gtiFaceWm2: 700, trockC: 25, aspectDeg: 180 });
    const mildSlate = frictionScoreHour({ ...base, rock: 'slate' });
    expect(glassySlate).toBeLessThan(mildSlate);
  });

  it('stays within [0, 1]', () => {
    const s = frictionScoreHour({ ...base, windSpeedMs: 5, dewPointC: 2 });
    expect(s).toBeLessThanOrEqual(1);
    expect(s).toBeGreaterThanOrEqual(0);
  });

  it('penalises wind for bouldering before it penalises the same speed for a roped discipline', () => {
    const windSpeedMs = 10; // inside the boulder penalty ramp (9-13), below the roped one (12-17)
    const boulder = frictionScoreHour({ ...base, windSpeedMs, disciplines: ['boulder'] });
    const sport = frictionScoreHour({ ...base, windSpeedMs, disciplines: ['sport'] });
    expect(boulder).toBeLessThan(sport);
  });

  it('defaults to the (more conservative) boulder wind band when disciplines is omitted', () => {
    const withoutDisciplines = frictionScoreHour({ ...base, windSpeedMs: 10 });
    const boulder = frictionScoreHour({ ...base, windSpeedMs: 10, disciplines: ['boulder'] });
    expect(withoutDisciplines).toBeCloseTo(boulder);
  });

  it('uses the boulder band when a crag serves both bouldering and a roped discipline', () => {
    const mixed = frictionScoreHour({ ...base, windSpeedMs: 10, disciplines: ['sport', 'boulder'] });
    const boulder = frictionScoreHour({ ...base, windSpeedMs: 10, disciplines: ['boulder'] });
    expect(mixed).toBeCloseTo(boulder);
  });
});

describe('bestFrictionBlock', () => {
  it('finds the best 3h contiguous daylight average', () => {
    const scores = [0.1, 0.9, 0.9, 0.9, 0.2, 0.5, 0.5, 0.5];
    const isDay = [true, true, true, true, true, true, true, true];
    expect(bestFrictionBlock(scores, isDay)).toBeCloseTo(0.9);
  });

  it('ignores night hours even if they score well', () => {
    const scores = [1, 1, 1, 0.2, 0.2, 0.2];
    const isDay = [false, false, false, true, true, true];
    expect(bestFrictionBlock(scores, isDay)).toBeCloseTo(0.2);
  });

  it('returns 0 when no full daylight block exists', () => {
    const scores = [1, 1];
    const isDay = [true, true];
    expect(bestFrictionBlock(scores, isDay, 3)).toBe(0);
  });

  it('prefers a typical-hours block over an equally-good dawn block, but still returns its own raw average', () => {
    // 24h day, index = hour of day. Two equally-good 3h blocks: 06:00-09:00 and
    // 12:00-15:00. Only the second overlaps the default 09:00-17:00 window.
    const scores = Array(24).fill(0.3);
    scores[6] = scores[7] = scores[8] = 0.8;
    scores[12] = scores[13] = scores[14] = 0.8;
    const isDay = Array(24).fill(true);
    // Selection prefers the midday block, but the reported value is unaffected
    // (still 0.8, not 0.8 + bonus) since both candidates share the same raw average.
    expect(bestFrictionBlock(scores, isDay, 3, 0)).toBeCloseTo(0.8);
  });

  it('does not let the typical-hours preference override a genuinely better block outside the window', () => {
    const scores = Array(24).fill(0.3);
    scores[6] = scores[7] = scores[8] = 0.95; // dawn, outside typical hours, but clearly the best block
    scores[12] = scores[13] = scores[14] = 0.5; // midday, inside typical hours, but much worse
    const isDay = Array(24).fill(true);
    expect(bestFrictionBlock(scores, isDay, 3, 0)).toBeCloseTo(0.95);
  });

  it('offsets typical-hours selection by startHourOfDay for a non-midnight-aligned slice', () => {
    // Index 0 here corresponds to hour 5, so index 4-6 is hours 9-11 (typical), and
    // index 16-18 is hours 21-23 (not typical) - the reverse of if startHourOfDay were 0.
    const scores = Array(20).fill(0.3);
    scores[4] = scores[5] = scores[6] = 0.8;
    scores[16] = scores[17] = scores[18] = 0.8;
    const isDay = Array(20).fill(true);
    expect(bestFrictionBlock(scores, isDay, 3, 5)).toBeCloseTo(0.8);
  });

  it('gates on the eligibility flags passed in, regardless of whether they represent daylight or dry-and-daylight', () => {
    // Simulates dayAggregate.ts's overlap-aware gating: hours 3-5 are daylight
    // but not climbable (wet), so a caller passing a combined flag should never
    // select a block from them even though their friction score looks great.
    const scores = [0.2, 0.2, 0.2, 0.9, 0.9, 0.9, 0.4, 0.4, 0.4];
    const dryAndDaylight = [true, true, true, false, false, false, true, true, true];
    expect(bestFrictionBlock(scores, dryAndDaylight, 3, 0)).toBeCloseTo(0.4);
  });
});

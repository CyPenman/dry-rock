import { describe, expect, it } from 'vitest';
import { bestFrictionBlock, frictionScoreHour } from './friction';

const base = {
  trockC: 12,
  idealTempC: [8, 16] as [number, number],
  dewPointC: 8,
  windSpeedMs: 2,
  gtiFaceWm2: 100,
  aspectDeg: 0, // north-facing — avoids the south-sun overheating rule
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
});

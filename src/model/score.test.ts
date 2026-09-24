import { describe, expect, it } from 'vitest';
import { CRAGS } from '../data/crags';
import {
  compositeScore,
  computeScoreBreakdown,
  confidenceAdjustedScore,
  confidenceCaveat,
  confidenceSentence,
  confidenceTier,
  dayVerdict,
  hadFreezeThawCycle,
  modelAgreement,
  SESSION_HOURS,
  verdictMessage,
} from './score';
import type { Crag } from './types';
import { runSimulation, type CragHourlyInput, type CragModelConfig } from './wetness';

function crag(id: string): Crag {
  const found = CRAGS.find((c) => c.id === id);
  if (!found) throw new Error(`fixture crag not found: ${id}`);
  return found;
}

function toConfig(c: Crag): CragModelConfig {
  return {
    aspectDeg: c.aspectDeg,
    steepness: c.steepness,
    seepIndex: c.seepIndex,
    tauSeep: c.tauSeep,
    catchmentAbove: c.catchmentAbove,
    windShelter: c.windShelter,
    canopyLight: c.canopyLight,
    tauRock: c.tauRock,
    dryingRate: c.dryingRate,
    Smax: c.Smax,
    Mmax: c.Mmax,
    infiltrationRate: c.infiltrationRate,
    softRock: c.softRock,
  };
}

describe('compositeScore (§4.9)', () => {
  it('weights dryness 0.60, friction 0.40', () => {
    const score = compositeScore({
      climbableDaylightHours: 10,
      totalDaylightHours: 10,
      bestContiguousClimbableHours: 10,
      bestFrictionBlockScore: 1,
    });
    expect(score).toBeCloseTo(0.6 * 1.0 + 0.4 * 1.0);
  });

  it('is zero across the board when nothing qualifies', () => {
    const score = compositeScore({
      climbableDaylightHours: 0,
      totalDaylightHours: 10,
      bestFrictionBlockScore: 0,
    });
    expect(score).toBe(0);
  });
});

describe('rockDrynessScore contiguity blending', () => {
  it('scores an unbroken block higher than the same total hours scattered', () => {
    const scattered = computeScoreBreakdown({
      climbableDaylightHours: 3,
      totalDaylightHours: 10,
      bestContiguousClimbableHours: 1, // three separate 1h gaps
      bestFrictionBlockScore: 1,
    });
    const unbroken = computeScoreBreakdown({
      climbableDaylightHours: 3,
      totalDaylightHours: 10,
      bestContiguousClimbableHours: 3, // one unbroken 3h window
      bestFrictionBlockScore: 1,
    });
    expect(unbroken.rockDrynessScore).toBeGreaterThan(scattered.rockDrynessScore);
    expect(unbroken.total).toBeGreaterThan(scattered.total);
  });

  it('falls back to 0 contiguous credit when omitted, without throwing', () => {
    const breakdown = computeScoreBreakdown({
      climbableDaylightHours: 5,
      totalDaylightHours: 10,
      bestFrictionBlockScore: 1,
    });
    // Against a 6-hour session (P2-14): 5 of 6 hours, and no contiguous credit.
    expect(breakdown.rockDrynessScore).toBeCloseTo(0.5 * (5 / SESSION_HOURS) + 0.5 * 0);
  });
});

describe('rockDrynessScore against a session length (§4.9)', () => {
  it('gives 7 contiguous dry hours on a 16-hour June day full dryness marks', () => {
    const breakdown = computeScoreBreakdown({
      climbableDaylightHours: 7,
      totalDaylightHours: 16,
      bestContiguousClimbableHours: 7,
      bestFrictionBlockScore: 1,
    });
    expect(breakdown.rockDrynessScore).toBe(1);
  });

  it('caps the session at the daylight available in deep winter', () => {
    // 5 daylight hours, all dry and unbroken: a full day's climbing, full marks.
    const breakdown = computeScoreBreakdown({
      climbableDaylightHours: 5,
      totalDaylightHours: 5,
      bestContiguousClimbableHours: 5,
      bestFrictionBlockScore: 1,
    });
    expect(breakdown.rockDrynessScore).toBe(1);
  });

  it('still rewards a longer window up to a session: 3 hours scores half', () => {
    const breakdown = computeScoreBreakdown({
      climbableDaylightHours: 3,
      totalDaylightHours: 16,
      bestContiguousClimbableHours: 3,
      bestFrictionBlockScore: 1,
    });
    expect(breakdown.rockDrynessScore).toBeCloseTo(0.5);
  });
});

describe('confidenceCaveat (§4.10 showery widening)', () => {
  it('is null when precipitation was mostly frontal', () => {
    expect(confidenceCaveat(0.2)).toBeNull();
  });

  it('warns when precipitation was mostly convective', () => {
    expect(confidenceCaveat(0.8)).toMatch(/showery/i);
  });
});

describe('hadFreezeThawCycle', () => {
  it('detects a crossing within the window', () => {
    const trock = [-2, -1, 0.5, 3, 5];
    expect(hadFreezeThawCycle(trock, 4, 48)).toBe(true);
  });

  it('is false when the window never leaves one side of zero', () => {
    const allWarm = [1, 2, 3, 4, 5];
    expect(hadFreezeThawCycle(allWarm, 4, 48)).toBe(false);
    const allFrozen = [-1, -2, -3, -4, -5];
    expect(hadFreezeThawCycle(allFrozen, 4, 48)).toBe(false);
  });

  it('respects the window boundary', () => {
    // The freezing dip is 10h before idx 12, outside a 6h window.
    const trock = [-3, -3, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5];
    expect(hadFreezeThawCycle(trock, 12, 6)).toBe(false);
    expect(hadFreezeThawCycle(trock, 12, 20)).toBe(true);
  });
});

describe('dayVerdict (§4.9 hard gates)', () => {
  it('snow takes priority over everything else', () => {
    expect(
      dayVerdict({ underSnowAnyHour: true, frozenAllDaylightHours: true, softRock: true, freezeThawInPreceding48h: true, softRockNoSafeDaylightHour: false }),
    ).toBe('under_snow');
  });

  it('rock damage takes priority over a frozen verdict', () => {
    expect(
      dayVerdict({ underSnowAnyHour: false, frozenAllDaylightHours: true, softRock: true, freezeThawInPreceding48h: true, softRockNoSafeDaylightHour: false }),
    ).toBe('rock_damage');
  });

  it('frozen applies when the whole day is below freezing', () => {
    expect(
      dayVerdict({ underSnowAnyHour: false, frozenAllDaylightHours: true, softRock: false, freezeThawInPreceding48h: false, softRockNoSafeDaylightHour: false }),
    ).toBe('frozen');
  });

  it('falls through to scored otherwise', () => {
    expect(
      dayVerdict({ underSnowAnyHour: false, frozenAllDaylightHours: false, softRock: true, freezeThawInPreceding48h: false, softRockNoSafeDaylightHour: false }),
    ).toBe('scored');
  });

  it('has a human-readable message for every non-scored verdict', () => {
    expect(verdictMessage('under_snow')).toMatch(/snow/i);
    expect(verdictMessage('frozen')).toMatch(/frozen|verglas/i);
    expect(verdictMessage('rock_damage')).toMatch(/freeze-thaw/i);
    expect(verdictMessage('soft_rock_wet')).toMatch(/soft sandstone/i);
    expect(verdictMessage('scored')).toBe('');
  });
});

describe('confidence (§4.10)', () => {
  it('reports the fraction of models that agree', () => {
    const agreement = modelAgreement([true, true, false, true]);
    expect(agreement).toEqual({ agreeCount: 3, total: 4, fraction: 0.75 });
    expect(confidenceSentence(agreement, 'good')).toBe("3 of 4 models agree it's a good day");
    expect(confidenceSentence(agreement, 'poor')).toBe("3 of 4 models agree it's a poor day");
  });
});

describe('confidenceTier', () => {
  it('is tier 2 (high) at or above 0.75 agreement with non-showery rain', () => {
    expect(confidenceTier(0.75, 0)).toBe(2);
    expect(confidenceTier(1, 0)).toBe(2);
  });

  it('is tier 1 (medium) between 0.5 and 0.75', () => {
    expect(confidenceTier(0.5, 0)).toBe(1);
    expect(confidenceTier(0.74, 0)).toBe(1);
  });

  it('is tier 0 (low) below 0.5', () => {
    expect(confidenceTier(0.49, 0)).toBe(0);
  });

  it('caps a showery day at tier 1 even with perfect model agreement', () => {
    expect(confidenceTier(1, 0.9)).toBe(1);
  });
});

describe('confidenceAdjustedScore', () => {
  it('leaves a high-confidence day unchanged', () => {
    const agreement = modelAgreement([true, true, true, true]);
    expect(confidenceAdjustedScore(0.8, agreement, 0)).toBeCloseTo(0.8);
  });

  it('applies a mild haircut on a low-confidence day', () => {
    const agreement = modelAgreement([true, false, false, false]);
    const adjusted = confidenceAdjustedScore(0.8, agreement, 0);
    expect(adjusted).toBeLessThan(0.8);
    expect(adjusted).toBeGreaterThan(0.8 * 0.8); // gentle - never more than a ~15% cut
  });

  it('never turns a zero score into a non-zero one', () => {
    const agreement = modelAgreement([false, false, false, false]);
    expect(confidenceAdjustedScore(0, agreement, 0)).toBe(0);
  });
});

describe('§8.4 case 8 - Harrison\'s soft rock: blocked with a rock-damage explanation', () => {
  it('blocks climbing 36h after rain when a freeze-thaw cycle occurred, even if the surface reads dry', () => {
    const c = crag('harrisons');
    const config = toConfig(c);

    // Rain, then a freeze-thaw dip, then it dries out per the wetness model -
    // the point of this case is that the hard gate still blocks it.
    const inputs: CragHourlyInput[] = [];
    for (let h = 0; h < 6; h++) {
      inputs.push({
        time: h * 3600,
        precipitationMm: 3,
        snowDepthM: 0,
        tempC: 4,
        dewPointC: 3,
        vpdKpa: 0.1,
        windSpeedMs: 3,
        windDirectionDeg: c.aspectDeg,
        cloudCoverPct: 90,
        visibilityM: 10000,
        isDay: true,
        gtiFaceWm2: 0,
        soilMoistureDeep: null,
      });
    }
    for (let h = 6; h < 36; h++) {
      const hourOfDay = h % 24;
      const cold = hourOfDay < 8 || hourOfDay > 18;
      inputs.push({
        time: h * 3600,
        precipitationMm: 0,
        snowDepthM: 0,
        tempC: cold ? -3 : 4,
        dewPointC: -5,
        vpdKpa: 0.15,
        windSpeedMs: 3,
        windDirectionDeg: c.aspectDeg,
        cloudCoverPct: 40,
        visibilityM: 10000,
        isDay: !cold,
        gtiFaceWm2: cold ? 0 : 150,
        soilMoistureDeep: null,
      });
    }

    const results = runSimulation(inputs, config);
    const trockSeries = results.map((r) => r.Trock);
    const lastIdx = results.length - 1;

    const freezeThaw = hadFreezeThawCycle(trockSeries, lastIdx, 48);
    expect(freezeThaw).toBe(true);

    const verdict = dayVerdict({
      underSnowAnyHour: results.slice(-24).some((r) => r.underSnow),
      frozenAllDaylightHours: false,
      softRock: c.softRock,
      freezeThawInPreceding48h: freezeThaw,
      softRockNoSafeDaylightHour: !results.slice(-24).some((r, i) => inputs[inputs.length - 24 + i].isDay && r.climbable),
    });

    expect(verdict).toBe('rock_damage');
  });
});

describe('§5.5 soft rock: blocked while damp inside, not only after freeze-thaw', () => {
  const isDayHour = (h: number) => h % 24 >= 6 && h % 24 <= 18;

  function hour(h: number, weather: 'rain' | 'overcast' | 'sunny', aspectDeg: number): CragHourlyInput {
    const day = isDayHour(h);
    const sunUp = Math.max(0, Math.sin((Math.PI * ((h % 24) - 6)) / 12));
    const base = {
      time: h * 3600,
      snowDepthM: 0,
      windDirectionDeg: aspectDeg,
      visibilityM: 20000,
      isDay: day,
      soilMoistureDeep: null,
    };
    if (weather === 'rain') {
      return { ...base, precipitationMm: 1, tempC: 11, dewPointC: 10.5, vpdKpa: 0.05, windSpeedMs: 4, cloudCoverPct: 100, gtiFaceWm2: 0 };
    }
    if (weather === 'overcast') {
      return { ...base, precipitationMm: 0, tempC: 12, dewPointC: 10, vpdKpa: 0.2, windSpeedMs: 2, cloudCoverPct: 90, gtiFaceWm2: day ? 40 * sunUp : 0 };
    }
    return { ...base, precipitationMm: 0, tempC: 20, dewPointC: 8, vpdKpa: 1.26, windSpeedMs: 5, cloudCoverPct: 10, gtiFaceWm2: day ? 500 * sunUp : 0 };
  }

  /** 5mm of rain from 06:00, the rest of the day and the next overcast and mild, then `sunnyDays` good drying days. */
  function scenario(c: Crag, sunnyDays: number) {
    const inputs: CragHourlyInput[] = [];
    for (let h = 0; h < 6; h++) inputs.push(hour(h, 'overcast', c.aspectDeg));
    for (let h = 6; h < 11; h++) inputs.push(hour(h, 'rain', c.aspectDeg));
    for (let h = 11; h < 48; h++) inputs.push(hour(h, 'overcast', c.aspectDeg));
    for (let h = 48; h < 48 + sunnyDays * 24; h++) inputs.push(hour(h, 'sunny', c.aspectDeg));
    const results = runSimulation(inputs, toConfig(c));
    const last = inputs.length - 24;
    const lastDay = results.slice(last);
    const verdict = dayVerdict({
      underSnowAnyHour: lastDay.some((r) => r.underSnow),
      frozenAllDaylightHours: false,
      softRock: c.softRock,
      freezeThawInPreceding48h: hadFreezeThawCycle(results.map((r) => r.Trock), results.length - 1, 48),
      softRockNoSafeDaylightHour: c.softRock && !lastDay.some((r, i) => inputs[last + i].isDay && r.climbable),
    });
    const trajectory = results.filter((_, i) => i % 12 === 0).map((r) => +(r.M / c.Mmax).toFixed(3));
    return { verdict, trajectory };
  }

  it("Harrison's, 5mm of rain then 24 mild overcast hours with no freeze: soft_rock_wet", () => {
    const { verdict } = scenario(crag('harrisons'), 0);
    expect(verdict).toBe('soft_rock_wet');
  });

  it("Harrison's after 4 warm, breezy, sunny, dry days following that rain: scored", () => {
    const { verdict, trajectory } = scenario(crag('harrisons'), 4);
    if (verdict !== 'scored') console.log("Harrison's M/Mmax every 12h:", trajectory.join(', '));
    expect(verdict).toBe('scored');
  });

  it('a non-soft crag with identical inputs is never soft_rock_wet', () => {
    const hard = { ...crag('harrisons'), softRock: false };
    expect(scenario(hard, 0).verdict).not.toBe('soft_rock_wet');
    expect(scenario(hard, 4).verdict).not.toBe('soft_rock_wet');
  });

  it('has its own message, distinct from the freeze-thaw one', () => {
    expect(verdictMessage('soft_rock_wet')).toMatch(/damp inside/i);
    expect(verdictMessage('rock_damage')).toMatch(/freeze-thaw/i);
  });
});

import { describe, expect, it } from 'vitest';
import { CRAGS } from '../data/crags';
import {
  compositeScore,
  confidenceSentence,
  dayVerdict,
  hadFreezeThawCycle,
  modelAgreement,
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
  };
}

describe('compositeScore (§4.9)', () => {
  it('weights window 0.40, dryness 0.35, friction 0.25', () => {
    const score = compositeScore({
      windowHours: 96,
      minWindowHours: 48,
      climbableDaylightHours: 10,
      totalDaylightHours: 10,
      bestFrictionBlockScore: 1,
    });
    expect(score).toBeCloseTo(0.4 * 1.0 + 0.35 * 1.0 + 0.25 * 1.0);
  });

  it('is zero across the board when nothing qualifies', () => {
    const score = compositeScore({
      windowHours: 0,
      climbableDaylightHours: 0,
      totalDaylightHours: 10,
      bestFrictionBlockScore: 0,
    });
    expect(score).toBe(0);
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
      dayVerdict({ underSnowAnyHour: true, frozenAllDaylightHours: true, softRock: true, freezeThawInPreceding48h: true }),
    ).toBe('under_snow');
  });

  it('rock damage takes priority over a frozen verdict', () => {
    expect(
      dayVerdict({ underSnowAnyHour: false, frozenAllDaylightHours: true, softRock: true, freezeThawInPreceding48h: true }),
    ).toBe('rock_damage');
  });

  it('frozen applies when the whole day is below freezing', () => {
    expect(
      dayVerdict({ underSnowAnyHour: false, frozenAllDaylightHours: true, softRock: false, freezeThawInPreceding48h: false }),
    ).toBe('frozen');
  });

  it('falls through to scored otherwise', () => {
    expect(
      dayVerdict({ underSnowAnyHour: false, frozenAllDaylightHours: false, softRock: true, freezeThawInPreceding48h: false }),
    ).toBe('scored');
  });

  it('has a human-readable message for every non-scored verdict', () => {
    expect(verdictMessage('under_snow')).toMatch(/snow/i);
    expect(verdictMessage('frozen')).toMatch(/frozen|verglas/i);
    expect(verdictMessage('rock_damage')).toMatch(/damage/i);
    expect(verdictMessage('scored')).toBe('');
  });
});

describe('confidence (§4.10)', () => {
  it('reports the fraction of models that agree', () => {
    const agreement = modelAgreement([true, true, false, true]);
    expect(agreement).toEqual({ agreeCount: 3, total: 4, fraction: 0.75 });
    expect(confidenceSentence(agreement)).toBe('3 of 4 models agree');
  });
});

describe('§8.4 case 8 — Harrison\'s soft rock: blocked with a rock-damage explanation', () => {
  it('blocks climbing 36h after rain when a freeze-thaw cycle occurred, even if the surface reads dry', () => {
    const c = crag('harrisons');
    const config = toConfig(c);

    // Rain, then a freeze-thaw dip, then it dries out per the wetness model —
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
    });

    expect(verdict).toBe('rock_damage');
  });
});

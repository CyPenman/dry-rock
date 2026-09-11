import { describe, expect, it } from 'vitest';
import { windChillC, windChillCaveat, WIND_CHILL_CAVEAT_THRESHOLD_C } from './windChill';

describe('windChillC', () => {
  it('equals air temperature when calm', () => {
    expect(windChillC(2, 0)).toBeCloseTo(2);
  });

  it('equals air temperature above 10C regardless of wind', () => {
    expect(windChillC(15, 15)).toBeCloseTo(15);
  });

  it('drops below air temperature in a cold wind', () => {
    const chill = windChillC(2, 10);
    expect(chill).toBeLessThan(2);
  });

  it('gets colder as wind increases, for a fixed cold temperature', () => {
    const light = windChillC(0, 3);
    const strong = windChillC(0, 15);
    expect(strong).toBeLessThan(light);
  });

  it('matches the standard formula for a known reference point (-5C air, 30 km/h wind)', () => {
    // NWS/Environment Canada formula, hand-computed: 13.12 + 0.6215*(-5) -
    // 11.37*30^0.16 + 0.3965*(-5)*30^0.16 ≈ -13.0C.
    const chill = windChillC(-5, 30 / 3.6);
    expect(chill).toBeCloseTo(-13, 0);
  });
});

describe('windChillCaveat', () => {
  it('is null when there is nothing cold enough to report', () => {
    expect(windChillCaveat(null)).toBeNull();
    expect(windChillCaveat(WIND_CHILL_CAVEAT_THRESHOLD_C)).toBeNull();
    expect(windChillCaveat(5)).toBeNull();
  });

  it('warns when the worst wind chill in the session drops below the threshold', () => {
    expect(windChillCaveat(-3)).toMatch(/cold|hands/i);
  });
});

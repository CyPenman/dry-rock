import { describe, expect, it } from 'vitest';
import { updateRockTemperature, type RockTempInputs } from './rockTemperature';

type Hour = Omit<RockTempInputs, 'prevTsurface' | 'prevTbulk'>;

/** Run `hours` from equilibrium at `startC`, returning the surface temperature after each hour. */
function run(startC: number, hours: Hour[]): number[] {
  let Tsurface = startC;
  let Tbulk = startC;
  return hours.map((h) => {
    ({ Tsurface, Tbulk } = updateRockTemperature({ ...h, prevTsurface: Tsurface, prevTbulk: Tbulk }));
    return Tsurface;
  });
}

const sunnyHour = (windSpeedMs: number, tauRock = 24): Hour => ({
  airTemp: 20,
  gtiFace: 700,
  cloudCoverPct: 0,
  isDay: true,
  windSpeedMs,
  tauRock,
});

// Spec §9 step 4: "a sunlit south face should run several degrees above air by
// mid-afternoon and below it before dawn." Tested as isolated exposures from
// equilibrium (sustained sun, sustained clear night, a warm front) rather than
// one made-up diurnal curve, so each block checks one directional pull. The
// acceptance values are MUST-DO-IMPROVEMENTS P3-16's.
describe('updateRockTemperature (two-layer, §4.2)', () => {
  it('a calm sunlit south face is at least 8°C above air by 15:00', () => {
    // 09:00 to 15:00 inclusive is 7 hourly steps of full sun on a big face.
    const surface = run(20, Array.from({ length: 7 }, () => sunnyHour(0)));
    expect(surface[6] - 20).toBeGreaterThanOrEqual(8);
  });

  it('an 8 m/s wind cuts the sunlit warming to less than half the calm case', () => {
    const calm = run(20, Array.from({ length: 7 }, () => sunnyHour(0)))[6] - 20;
    const windy = run(20, Array.from({ length: 7 }, () => sunnyHour(8)))[6] - 20;
    expect(windy).toBeGreaterThan(0);
    expect(windy).toBeLessThan(calm / 2);
  });

  it('a clear calm night ends 1-4°C below air before dawn', () => {
    const night: Hour = { airTemp: 8, gtiFace: 0, cloudCoverPct: 0, isDay: false, windSpeedMs: 0, tauRock: 9 };
    const surface = run(8, Array.from({ length: 10 }, () => night));
    const belowAir = 8 - surface[9];
    expect(belowAir).toBeGreaterThanOrEqual(1);
    expect(belowAir).toBeLessThanOrEqual(4);
  });

  it('after a warm front the slow bulk holds the surface below the dew point for 3+ hours', () => {
    // Air jumps from 5 to 15°C under a 13°C dew point, overcast - the Kilnsey
    // "cold rock under a warm humid airmass" case.
    const warmFront: Hour = { airTemp: 15, gtiFace: 0, cloudCoverPct: 100, isDay: true, windSpeedMs: 3, tauRock: 24 };
    const surface = run(5, Array.from({ length: 3 }, () => warmFront));
    for (const t of surface) expect(t).toBeLessThan(13);
  });

  it('relaxes toward the target temperature rather than jumping to it', () => {
    const [surface] = run(5, [{ airTemp: 20, gtiFace: 0, cloudCoverPct: 100, isDay: true, windSpeedMs: 2, tauRock: 20 }]);
    expect(surface).toBeGreaterThan(5);
    expect(surface).toBeLessThan(20);
  });
});

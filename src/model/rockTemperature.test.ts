import { describe, expect, it } from 'vitest';
import { updateRockTemperature } from './rockTemperature';

// Spec §9 step 4: "a sunlit south face should run several degrees above air by
// mid-afternoon and below it before dawn." Tested here as two isolated exposures
// (sustained sun, sustained clear-sky night) rather than one arbitrary synthetic
// diurnal curve - the lag constant interacts with day/night length and the prior
// exposure in ways that make a single made-up 24h profile an unreliable check of
// the underlying formula. Each block below tests one directional pull to equilibrium.
describe('updateRockTemperature', () => {
  it('a sustained sunlit face rises several degrees above air (mid-afternoon exposure)', () => {
    const tauRock = 9;
    const airTemp = 12;
    let trock = airTemp; // equilibrium at start of exposure

    for (let h = 0; h < 6; h++) {
      trock = updateRockTemperature({
        prevTrock: trock,
        airTemp,
        gtiFace: 700, // full sun on the face
        cloudCoverPct: 0,
        isDay: true,
        tauRock,
      });
    }

    expect(trock - airTemp).toBeGreaterThan(3);
  });

  it('a sustained clear night cools the rock below air (pre-dawn exposure)', () => {
    const tauRock = 9;
    const airTemp = 8;
    let trock = airTemp; // equilibrium at start of exposure

    for (let h = 0; h < 10; h++) {
      trock = updateRockTemperature({
        prevTrock: trock,
        airTemp,
        gtiFace: 0,
        cloudCoverPct: 0, // clear sky - full radiative loss
        isDay: false,
        tauRock,
      });
    }

    expect(trock - airTemp).toBeLessThan(0);
    expect(airTemp - trock).toBeLessThan(2.5); // can't overshoot kNight's target offset
  });

  it('relaxes toward the target temperature rather than jumping to it', () => {
    const trock = updateRockTemperature({
      prevTrock: 5,
      airTemp: 20,
      gtiFace: 0,
      cloudCoverPct: 100,
      isDay: true,
      tauRock: 20,
    });
    expect(trock).toBeGreaterThan(5);
    expect(trock).toBeLessThan(20);
  });
});

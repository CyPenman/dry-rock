import { PARAMS } from './params';

export interface RockTempInputs {
  prevTrock: number;
  airTemp: number;
  gtiFace: number; // W/m^2, plane-of-array irradiance on the face
  cloudCoverPct: number; // 0-100
  isDay: boolean;
  tauRock: number; // hours, per-crag thermal time constant
}

/**
 * Hourly rock-surface temperature update — spec §4.2. Rock has thermal mass, so it
 * lags the air; this is why a sunlit face runs hot in the afternoon and cold before
 * dawn, and it matters more than air temperature for friction (§4.8).
 */
export function updateRockTemperature(inputs: RockTempInputs): number {
  const { prevTrock, airTemp, gtiFace, cloudCoverPct, isDay, tauRock } = inputs;

  const solarGain = PARAMS.kSolar * (gtiFace / 700);
  const nightLoss = PARAMS.kNight * (1 - cloudCoverPct / 100) * (isDay ? 0 : 1);
  const Ttarget = airTemp + solarGain - nightLoss;

  return prevTrock + (Ttarget - prevTrock) * (1 / tauRock);
}

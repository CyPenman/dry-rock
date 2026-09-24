import { PARAMS } from './params';

export interface RockTempInputs {
  prevTsurface: number; // °C, rock skin last hour - what friction, dew and frost see
  prevTbulk: number; // °C, the rock mass behind it last hour
  airTemp: number;
  gtiFace: number; // W/m^2, plane-of-array irradiance on the face
  cloudCoverPct: number; // 0-100
  isDay: boolean;
  windSpeedMs: number;
  tauRock: number; // hours, per-crag thermal time constant of the BULK
}

export interface RockTemps {
  Tsurface: number;
  Tbulk: number;
}

/**
 * Hourly two-layer rock temperature update - spec §4.2. A single lagged
 * temperature can't be right at both ends: with a 24h lag a sunlit south wall
 * in 20°C air reached only about 23.5°C after eight hours of full sun, when a
 * real sunlit surface runs 10-20°C above the air.
 *
 * So two layers. The slow bulk (lag `tauRock`) is the thermal mass: it keeps
 * cold rock under a warm humid airmass for hours, which is the Kilnsey /
 * cave-sweating case. The fast surface (lag `tauSurface`) sits between the air
 * and the bulk, and is pushed off that balance by sun and by clear-sky
 * radiative loss, so it gets the baking afternoon and the dawn dew right.
 * Wind couples the surface back to the air, damping both pushes - a gale on a
 * sunny face keeps it close to air temperature.
 *
 * Returns the surface as `Tsurface`; it is `Trock` everywhere else (friction,
 * dew, frost, charts).
 */
export function updateRockTemperature(inputs: RockTempInputs): RockTemps {
  const { prevTsurface, prevTbulk, airTemp, gtiFace, cloudCoverPct, isDay, windSpeedMs, tauRock } = inputs;

  const windFactor = 1 / (1 + PARAMS.kWindCoupling * windSpeedMs);
  const solarGain = PARAMS.kSolar * (gtiFace / 700) * windFactor;
  const nightLoss = PARAMS.kNight * (1 - cloudCoverPct / 100) * (isDay ? 0 : 1) * windFactor;
  const surfaceTarget = 0.5 * airTemp + 0.5 * prevTbulk + solarGain - nightLoss;
  const Tsurface = prevTsurface + (surfaceTarget - prevTsurface) / PARAMS.tauSurface;
  const Tbulk = prevTbulk + (Tsurface - prevTbulk) / tauRock;

  return { Tsurface, Tbulk };
}

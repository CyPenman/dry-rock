// Loosely-typed Open-Meteo response shapes. Hourly/daily variable keys are dynamic
// (suffixed per model, §3.3), so they're indexed rather than enumerated.
export interface OpenMeteoHourly {
  time: number[]; // unixtime, per §3.1 timeformat=unixtime
  [variable: string]: number[];
}

export interface OpenMeteoDaily {
  time: number[];
  [variable: string]: number[];
}

export interface OpenMeteoResponse {
  latitude: number;
  longitude: number;
  elevation: number;
  timezone: string;
  hourly: OpenMeteoHourly;
  daily?: OpenMeteoDaily;
}

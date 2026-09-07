// §3.5 — soil moisture depth naming varies by model. Map whatever the response
// contains onto a logical "deep" band (the seepage driver, §4.5); fail soft to
// null so callers can fall back to the precipitation-kernel model.
const DEEP_CANDIDATES = [
  'soil_moisture_28_to_100cm', // ECMWF/GFS/UKMO-family
  'soil_moisture_100_to_255cm',
  'soil_moisture_27_to_81cm', // ICON
  'soil_moisture_9_to_27cm',
];

const SHALLOW_CANDIDATES = [
  'soil_moisture_7_to_28cm', // ECMWF/GFS/UKMO-family
  'soil_moisture_0_to_7cm',
  'soil_moisture_3_to_9cm', // ICON
  'soil_moisture_1_to_3cm',
  'soil_moisture_0_to_1cm',
];

function firstAvailable(vars: Record<string, number[]>, candidates: string[]): number[] | null {
  for (const key of candidates) {
    const v = vars[key];
    if (v && v.length > 0) return v;
  }
  return null;
}

export function getSoilMoistureDeep(modelVars: Record<string, number[]>): number[] | null {
  return firstAvailable(modelVars, DEEP_CANDIDATES);
}

export function getSoilMoistureShallow(modelVars: Record<string, number[]>): number[] | null {
  return firstAvailable(modelVars, SHALLOW_CANDIDATES);
}

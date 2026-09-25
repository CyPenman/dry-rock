// Vapour pressure helpers (§4.3, §4.4). Drying and dew are one process run in
// opposite directions: water leaves the rock when the saturation vapour
// pressure at the rock SURFACE exceeds the air's actual vapour pressure, and
// condenses onto it when the air's is higher.

/**
 * Saturation vapour pressure over water, kPa (Magnus/Tetens). Fitted over water
 * rather than ice, which is the right side for almost all the conditions it is
 * used in. Below freezing, wet rock is gated as frozen (§4.6) and its drying
 * cut to sublimation; on dry rock a few degrees below zero, the over-water
 * value is a few percent high - small next to the other uncertainties here.
 */
export function saturationVapourPressureKpa(tempC: number): number {
  return 0.6108 * Math.exp((17.27 * tempC) / (tempC + 237.3));
}

/**
 * es(rock surface) - e(air), kPa. The air's actual vapour pressure is
 * es(dew point). Positive: the surface is drier than the air can hold, so it
 * dries. Negative: the rock is below the dew point, so dew forms. Unlike the
 * air's VPD, this sees that sun-warmed rock dries faster and cold rock slower.
 */
export function surfaceDeficitKpa(trockC: number, dewPointC: number): number {
  return saturationVapourPressureKpa(trockC) - saturationVapourPressureKpa(dewPointC);
}

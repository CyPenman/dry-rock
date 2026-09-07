import { describe, expect, it } from 'vitest';
import { getSoilMoistureDeep, getSoilMoistureShallow } from './soilMoisture';

describe('soil moisture adapter (§3.5)', () => {
  it('reads the ECMWF/GFS/UKMO-family deep band when present', () => {
    const vars = { soil_moisture_28_to_100cm: [0.3, 0.31], temperature_2m: [10, 11] };
    expect(getSoilMoistureDeep(vars)).toEqual([0.3, 0.31]);
  });

  it('falls back to the ICON-native deep band when the ECMWF-style key is absent', () => {
    const vars = { soil_moisture_27_to_81cm: [0.4, 0.41] };
    expect(getSoilMoistureDeep(vars)).toEqual([0.4, 0.41]);
  });

  it('fails soft to null when no deep band is present', () => {
    const vars = { temperature_2m: [10, 11] };
    expect(getSoilMoistureDeep(vars)).toBeNull();
  });

  it('reads a shallow band independently of the deep band', () => {
    const vars = { soil_moisture_7_to_28cm: [0.2, 0.21] };
    expect(getSoilMoistureShallow(vars)).toEqual([0.2, 0.21]);
  });
});

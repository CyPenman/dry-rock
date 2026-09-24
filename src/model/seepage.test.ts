import { describe, expect, it } from 'vitest';
import { CRAGS } from '../data/crags';
import { computeSeepFluxFallback } from './seepage';

describe('computeSeepFluxFallback', () => {
  it('gives a seepy crag real seepage at a wet-winter precipitation rate (§4.5)', () => {
    // 0.15 mm/hr is about a wet Peak winter's average. With the old 1.0 mm/hr
    // reference the Cornice seeped about 0.0005 mm/hr here - effectively off.
    const cornice = CRAGS.find((c) => c.id === 'cornice')!;
    expect(cornice.seepIndex).toBe(1.0);
    expect(computeSeepFluxFallback(0.15, cornice.seepIndex)).toBeGreaterThanOrEqual(0.05);
  });
});

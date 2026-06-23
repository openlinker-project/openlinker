/**
 * Specs for the pure KSeF status-code → neutral RegulatoryStatus mapping table
 * (#1150 / C6). Exercises the full table including 100/150 (processing), 200
 * (success), 210/410/445 (terminal failures), unknown business codes, and the
 * 5xx transient band (mapped to the `null` retry sentinel).
 *
 * @module libs/integrations/ksef/src/infrastructure/adapters
 */
import { mapKsefStatusToRegulatoryStatus } from '../ksef-clearance-status.mapper';

describe('mapKsefStatusToRegulatoryStatus', () => {
  it.each([
    [100, 'submitted'],
    [150, 'submitted'],
    [200, 'accepted'],
    [210, 'rejected'],
    [410, 'rejected'],
    [445, 'rejected'],
  ])('should map KSeF status %i → %s', (code, expected) => {
    expect(mapKsefStatusToRegulatoryStatus(code)).toBe(expected);
  });

  it('should map an unknown deterministic business code → rejected (terminal)', () => {
    expect(mapKsefStatusToRegulatoryStatus(400)).toBe('rejected');
    expect(mapKsefStatusToRegulatoryStatus(404)).toBe('rejected');
  });

  it.each([500, 502, 503, 599])('should map 5xx (%i) → null transient sentinel', (code) => {
    expect(mapKsefStatusToRegulatoryStatus(code)).toBeNull();
  });
});

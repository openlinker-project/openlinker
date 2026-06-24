/**
 * Specs for the pure KSeF status-code → neutral RegulatoryStatus mapping table
 * (#1150 / C6). Exercises the full range logic: 100/150 (processing) → submitted,
 * 200 (Success) → accepted, any other deterministic business code (e.g. 400) →
 * rejected (terminal), and the 5xx transient band → the `null` retry sentinel.
 *
 * @module libs/integrations/ksef/src/infrastructure/adapters
 */
import { mapKsefStatusToRegulatoryStatus } from '../ksef-clearance-status.mapper';

describe('mapKsefStatusToRegulatoryStatus', () => {
  it.each([
    [100, 'submitted'],
    [150, 'submitted'],
    [199, 'submitted'],
    [200, 'accepted'],
  ])('should map KSeF status %i → %s', (code, expected) => {
    expect(mapKsefStatusToRegulatoryStatus(code)).toBe(expected);
  });

  it.each([
    [400, 'rejected'],
    [404, 'rejected'],
    [410, 'rejected'],
    [445, 'rejected'],
  ])('should map deterministic business code %i → rejected (terminal)', (code, expected) => {
    expect(mapKsefStatusToRegulatoryStatus(code)).toBe(expected);
  });

  it.each([500, 502, 503, 599])('should map 5xx (%i) → null transient sentinel', (code) => {
    expect(mapKsefStatusToRegulatoryStatus(code)).toBeNull();
  });
});

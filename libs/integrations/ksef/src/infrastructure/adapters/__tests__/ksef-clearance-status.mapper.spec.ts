/**
 * Specs for the pure KSeF status-code → neutral RegulatoryStatus mapping table
 * (#1150 / C6). Exercises the explicit known-code map against the real catalogue:
 * 100/150 (processing) → submitted, 200 (Success) → accepted, 400/440/445
 * (validation / business rejection / zero-valid) → rejected (terminal), 550
 * (processing error) → the `null` transient retry sentinel, and the
 * unknown-code default (keep polling, never auto-reject).
 *
 * @module libs/integrations/ksef/src/infrastructure/adapters
 */
import { Logger } from '@openlinker/shared/logging';
import { mapKsefStatusToRegulatoryStatus } from '../ksef-clearance-status.mapper';

describe('mapKsefStatusToRegulatoryStatus', () => {
  it.each([
    [100, 'submitted'],
    [150, 'submitted'],
    [200, 'accepted'],
  ])('should map KSeF status %i → %s', (code, expected) => {
    expect(mapKsefStatusToRegulatoryStatus(code)).toBe(expected);
  });

  it.each([
    [400, 'rejected'],
    [440, 'rejected'],
    [445, 'rejected'],
  ])('should map known business-rejection code %i → rejected (terminal)', (code, expected) => {
    expect(mapKsefStatusToRegulatoryStatus(code)).toBe(expected);
  });

  it('should map the processing-error code (550) → null transient sentinel', () => {
    expect(mapKsefStatusToRegulatoryStatus(550)).toBeNull();
  });

  it('should NOT auto-reject an unknown code — keep polling (submitted) and warn', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    const result = mapKsefStatusToRegulatoryStatus(999);

    expect(result).toBe('submitted');
    expect(result).not.toBe('rejected');
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});

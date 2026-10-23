/**
 * Subiekt Regulatory-Status Mapper — unit tests (#753)
 *
 * Full bridge KSeF -> neutral mapping table.
 *
 * @module libs/integrations/subiekt/src/infrastructure/mappers/__tests__
 */
import { toNeutralRegulatoryStatus } from '../subiekt-regulatory-status.mapper';

describe('toNeutralRegulatoryStatus', () => {
  it("maps 'none' -> 'not-applicable'", () => {
    expect(toNeutralRegulatoryStatus('none')).toBe('not-applicable');
  });

  // #3351: 'queued' (GT 1/2, not yet sent) and 'error' (GT 8, comms failure
  // on a send attempt) both mean KSeF has NOT received the document, so both
  // route to core's 'pending-submission' — never the old false 'submitted'.
  it("maps 'queued' -> 'pending-submission'", () => {
    expect(toNeutralRegulatoryStatus('queued')).toBe('pending-submission');
  });

  it("maps 'error' -> 'pending-submission'", () => {
    expect(toNeutralRegulatoryStatus('error')).toBe('pending-submission');
  });

  it("maps 'sent' -> 'submitted'", () => {
    expect(toNeutralRegulatoryStatus('sent')).toBe('submitted');
  });

  it("maps 'accepted' -> 'accepted'", () => {
    expect(toNeutralRegulatoryStatus('accepted')).toBe('accepted');
  });

  it("maps 'rejected' -> 'rejected'", () => {
    expect(toNeutralRegulatoryStatus('rejected')).toBe('rejected');
  });
});

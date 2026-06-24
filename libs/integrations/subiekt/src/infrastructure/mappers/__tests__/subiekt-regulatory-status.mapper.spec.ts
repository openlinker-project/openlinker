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

  it("maps 'pending' -> 'submitted'", () => {
    expect(toNeutralRegulatoryStatus('pending')).toBe('submitted');
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

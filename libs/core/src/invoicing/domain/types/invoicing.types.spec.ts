/**
 * Invoicing domain types — unit tests
 *
 * Pins the neutral `as const` vocabularies (ADR-026) so an accidental
 * reorder/removal — or a country-specific value sneaking in — fails the build.
 *
 * @module libs/core/src/invoicing/domain/types
 */
import {
  BuyerTypeValues,
  DocumentTypeValues,
  InvoiceStatusValues,
  RegulatoryStatusValues,
} from './invoicing.types';

describe('invoicing.types', () => {
  it('exposes the well-known neutral document types', () => {
    expect([...DocumentTypeValues]).toEqual([
      'invoice',
      'receipt',
      'credit-note',
      'corrected',
      'proforma',
      'prepayment',
    ]);
  });

  it('exposes the issuance lifecycle states', () => {
    expect([...InvoiceStatusValues]).toEqual(['pending', 'issued', 'failed']);
  });

  it('exposes the neutral CTC clearance lifecycle', () => {
    expect([...RegulatoryStatusValues]).toEqual([
      'not-applicable',
      'submitted',
      'cleared',
      'accepted',
      'rejected',
    ]);
  });

  it('exposes the neutral B2B/B2C buyer axis', () => {
    expect([...BuyerTypeValues]).toEqual(['company', 'private']);
  });

  it('carries no country-specific document type', () => {
    // Agnosticism guard (ADR-026): no faktura/paragon/Rechnung in the vocab.
    for (const v of DocumentTypeValues) {
      expect(v).not.toMatch(/faktura|paragon|rechnung|nip|ksef/i);
    }
  });
});

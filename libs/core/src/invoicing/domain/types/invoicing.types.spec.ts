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
  InvoiceFailureCodeValues,
  InvoiceFailureModeValues,
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
    // `issuing` (#1200) is the in-flight CAS-claim state between pending and terminal.
    expect([...InvoiceStatusValues]).toEqual(['pending', 'issuing', 'issued', 'failed']);
  });

  it('exposes the neutral failure-mode discriminator (#1200)', () => {
    expect([...InvoiceFailureModeValues]).toEqual(['rejected', 'in-doubt']);
  });

  it('exposes the closed neutral failure-code taxonomy (W1)', () => {
    expect([...InvoiceFailureCodeValues]).toEqual([
      'buyer-tax-id-invalid',
      'provider-rejected',
      'transport-timeout',
      'provider-error',
    ]);
  });

  it('carries no country-specific failure code', () => {
    // Agnosticism guard (ADR-026): no nip/ksef/vat/faktura in the code vocab.
    for (const v of InvoiceFailureCodeValues) {
      expect(v).not.toMatch(/faktura|paragon|rechnung|nip|ksef|vat/i);
    }
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

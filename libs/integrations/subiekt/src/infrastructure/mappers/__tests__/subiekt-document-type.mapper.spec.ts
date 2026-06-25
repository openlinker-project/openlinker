/**
 * Subiekt Document-Type Mapper — unit tests (#753)
 *
 * Covers the NIP -> faktura/paragon derivation matrix and the neutral ->
 * bridge-native map.
 *
 * @module libs/integrations/subiekt/src/infrastructure/mappers/__tests__
 */
import { BuyerProfile } from '@openlinker/core/invoicing';
import type { BuyerAddress, TaxIdentifier } from '@openlinker/core/invoicing';
import {
  deriveNeutralDocumentType,
  isCorrectionDocumentType,
  toBridgeCorrectionDocumentType,
  toBridgeDocumentType,
} from '../subiekt-document-type.mapper';
import { SubiektUnsupportedDocumentTypeError } from '../../../domain/exceptions/subiekt-unsupported-document-type.exception';

const ADDRESS: BuyerAddress = {
  line1: 'ul. Przykładowa 1',
  line2: null,
  city: 'Warszawa',
  postalCode: '00-001',
  countryIso2: 'PL',
};

function buyer(taxId: TaxIdentifier | null, type: 'company' | 'private' = 'company'): BuyerProfile {
  return new BuyerProfile('Acme', taxId, ADDRESS, type);
}

describe('deriveNeutralDocumentType', () => {
  it('honours an explicit command.documentType verbatim', () => {
    expect(deriveNeutralDocumentType(buyer(null), 'credit-note')).toBe('credit-note');
    // Even when a NIP is present, an explicit value wins.
    expect(
      deriveNeutralDocumentType(buyer({ scheme: 'pl-nip', value: '1234567890' }), 'proforma'),
    ).toBe('proforma');
  });

  it("derives 'invoice' when buyer has a non-empty pl-nip tax id", () => {
    expect(deriveNeutralDocumentType(buyer({ scheme: 'pl-nip', value: '1234567890' }))).toBe(
      'invoice',
    );
  });

  it("derives 'receipt' when buyer has no tax id", () => {
    expect(deriveNeutralDocumentType(buyer(null))).toBe('receipt');
  });

  it("derives 'receipt' when buyer tax id scheme is not pl-nip", () => {
    expect(deriveNeutralDocumentType(buyer({ scheme: 'eu-vat', value: 'PL1234567890' }))).toBe(
      'receipt',
    );
  });

  it("derives 'receipt' when pl-nip value is empty", () => {
    expect(deriveNeutralDocumentType(buyer({ scheme: 'pl-nip', value: '' }))).toBe('receipt');
  });

  it('does NOT use isCompany as the trigger (company with no nip -> receipt)', () => {
    expect(deriveNeutralDocumentType(buyer(null, 'company'))).toBe('receipt');
  });
});

describe('toBridgeDocumentType', () => {
  it("maps 'invoice' -> 'FV'", () => {
    expect(toBridgeDocumentType('invoice')).toBe('FV');
  });

  it("maps 'receipt' -> 'PA'", () => {
    expect(toBridgeDocumentType('receipt')).toBe('PA');
  });

  it('throws SubiektUnsupportedDocumentTypeError for an unsupported neutral type', () => {
    expect(() => toBridgeDocumentType('proforma')).toThrow(SubiektUnsupportedDocumentTypeError);
  });

  it('rejects correction types on the plain issue path (they use the correction path)', () => {
    expect(() => toBridgeDocumentType('credit-note')).toThrow(SubiektUnsupportedDocumentTypeError);
    expect(() => toBridgeDocumentType('corrected')).toThrow(SubiektUnsupportedDocumentTypeError);
  });
});

describe('isCorrectionDocumentType', () => {
  it('recognises the correction neutral document types', () => {
    expect(isCorrectionDocumentType('credit-note')).toBe(true);
    expect(isCorrectionDocumentType('corrected')).toBe(true);
  });

  it('does not treat plain issue types as corrections', () => {
    expect(isCorrectionDocumentType('invoice')).toBe(false);
    expect(isCorrectionDocumentType('receipt')).toBe(false);
    expect(isCorrectionDocumentType('proforma')).toBe(false);
  });
});

describe('toBridgeCorrectionDocumentType', () => {
  it("maps both correction neutral types onto the bridge-native 'FK'", () => {
    expect(toBridgeCorrectionDocumentType('credit-note')).toBe('FK');
    expect(toBridgeCorrectionDocumentType('corrected')).toBe('FK');
  });

  it('throws SubiektUnsupportedDocumentTypeError for a non-correction type', () => {
    expect(() => toBridgeCorrectionDocumentType('invoice')).toThrow(
      SubiektUnsupportedDocumentTypeError,
    );
  });
});

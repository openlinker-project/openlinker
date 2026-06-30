/**
 * FA(3) Buyer-ID Mapper — Unit Specs
 *
 * Pins the `Podmiot2` resolution: NIP / EU-VAT / foreign / BrakID branches plus
 * malformed-input throws.
 *
 * @module libs/integrations/ksef/src/infrastructure/fa3/domain
 */
import type { TaxIdentifier } from '@openlinker/core/invoicing';
import { InvalidBuyerIdentificationException } from '../../../domain/exceptions/fa3-builder.exception';
import { resolveBuyerIdentity } from './fa3-buyer-id.mapper';

describe('resolveBuyerIdentity', () => {
  it('should resolve null taxId (B2C) to { kind: "none" }', () => {
    expect(resolveBuyerIdentity(null)).toEqual({ kind: 'none' });
  });

  it('should resolve pl-nip to a NIP identity', () => {
    const taxId: TaxIdentifier = { scheme: 'pl-nip', value: '1234567890' };
    expect(resolveBuyerIdentity(taxId)).toEqual({ kind: 'nip', nip: '1234567890' });
  });

  it('should resolve eu-vat to a VAT identity', () => {
    const taxId: TaxIdentifier = { scheme: 'eu-vat', value: 'DE123456789' };
    expect(resolveBuyerIdentity(taxId)).toEqual({
      kind: 'vat',
      countryCode: 'DE',
      vatNumber: '123456789',
    });
  });

  it('should resolve an unknown foreign scheme to a country + NrID identity', () => {
    const taxId: TaxIdentifier = { scheme: 'us-ein', value: 'US123456' };
    expect(resolveBuyerIdentity(taxId)).toEqual({
      kind: 'other',
      countryCode: 'US',
      id: '123456',
    });
  });

  it('should throw on a malformed NIP (wrong length)', () => {
    const taxId: TaxIdentifier = { scheme: 'pl-nip', value: '123' };
    expect(() => resolveBuyerIdentity(taxId)).toThrow(InvalidBuyerIdentificationException);
  });

  it('should throw on an EU-VAT missing its country prefix', () => {
    const taxId: TaxIdentifier = { scheme: 'eu-vat', value: '123456789' };
    expect(() => resolveBuyerIdentity(taxId)).toThrow(InvalidBuyerIdentificationException);
  });

  it('should throw on a foreign identifier missing its country prefix', () => {
    const taxId: TaxIdentifier = { scheme: 'us-ein', value: '123456' };
    expect(() => resolveBuyerIdentity(taxId)).toThrow(InvalidBuyerIdentificationException);
  });
});

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

  // #3224 — core may not mint a `scheme` (ADR-073 decision 1), so an untagged
  // identifier reaches this mapper and it has to place one of three mutually
  // exclusive FA(3) elements.
  it('should resolve an UNTAGGED 10-digit value to a domestic NIP identity (#3224)', () => {
    const taxId: TaxIdentifier = { value: '5213796333' };
    expect(resolveBuyerIdentity(taxId)).toEqual({ kind: 'nip', nip: '5213796333' });
  });

  it('should trim an untagged value before resolving it (#3224)', () => {
    expect(resolveBuyerIdentity({ value: '  5213796333  ' })).toEqual({
      kind: 'nip',
      nip: '5213796333',
    });
  });

  // <KodUE>+<NrVatUE> and <KodKraju>+<NrID> are structurally identical, so the
  // scheme is the ONLY thing that tells them apart. Guessing would file the
  // buyer under the wrong element of a document sent to a tax authority, so an
  // untagged non-NIP is refused rather than placed by a coin flip.
  it('should REFUSE an untagged foreign identifier rather than guess its element (#3224)', () => {
    expect(() => resolveBuyerIdentity({ value: 'DE123456789' })).toThrow(
      InvalidBuyerIdentificationException,
    );
  });

  it('should refuse an untagged value that is neither a NIP nor country-prefixed (#3224)', () => {
    expect(() => resolveBuyerIdentity({ value: '123' })).toThrow(
      InvalidBuyerIdentificationException,
    );
  });

  // A caller that knows the answer never reaches the inference at all.
  it('should keep honouring an explicit scheme on a value the inference would refuse (#3224)', () => {
    expect(resolveBuyerIdentity({ scheme: 'eu-vat', value: 'DE123456789' })).toEqual({
      kind: 'vat',
      countryCode: 'DE',
      vatNumber: '123456789',
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

/**
 * Subiekt Buyer Mapper — unit tests (#753)
 *
 * @module libs/integrations/subiekt-nexo/src/infrastructure/mappers/__tests__
 */
import { BuyerProfile } from '@openlinker/core/invoicing';
import type { BuyerAddress, TaxIdentifier } from '@openlinker/core/invoicing';
import { toBridgeBuyer } from '../subiekt-buyer.mapper';

const ADDRESS: BuyerAddress = {
  line1: 'ul. Przykładowa 1',
  line2: 'lok. 5',
  city: 'Warszawa',
  postalCode: '00-001',
  countryIso2: 'PL',
};

function buyer(taxId: TaxIdentifier | null, type: 'company' | 'private' = 'company'): BuyerProfile {
  return new BuyerProfile('Acme Sp. z o.o.', taxId, ADDRESS, type);
}

describe('toBridgeBuyer', () => {
  it('maps nip from taxId.value only when scheme is pl-nip', () => {
    expect(toBridgeBuyer(buyer({ scheme: 'pl-nip', value: '1234567890' })).nip).toBe('1234567890');
  });

  it('sets nip to null when taxId is absent or scheme is not pl-nip', () => {
    expect(toBridgeBuyer(buyer(null)).nip).toBeNull();
    expect(toBridgeBuyer(buyer({ scheme: 'eu-vat', value: 'PL1234567890' })).nip).toBeNull();
    expect(toBridgeBuyer(buyer({ scheme: 'pl-nip', value: '' })).nip).toBeNull();
  });

  // #3224 — Subiekt nexo has exactly one tax-number slot, so an untagged
  // identifier has only one possible placement. Requiring the tag would drop
  // the buyer's NIP from every auto-issued document.
  it('maps nip from an UNTAGGED taxId (#3224)', () => {
    expect(toBridgeBuyer(buyer({ value: '5213796333' })).nip).toBe('5213796333');
  });

  it('still sets nip to null for an untagged EMPTY value (#3224)', () => {
    expect(toBridgeBuyer(buyer({ value: '' })).nip).toBeNull();
  });

  it('maps address countryIso2 -> countryCode', () => {
    expect(toBridgeBuyer(buyer(null)).address?.countryCode).toBe('PL');
  });

  it('maps neutral address onto the bridge Polish AddressDto fields', () => {
    const address = toBridgeBuyer(buyer(null)).address;
    // line1 (street + number) -> ulica; line2 -> nrLokalu; city -> miejscowosc;
    // postalCode -> kodPocztowy.
    expect(address?.ulica).toBe('ul. Przykładowa 1');
    expect(address?.nrLokalu).toBe('lok. 5');
    expect(address?.miejscowosc).toBe('Warszawa');
    expect(address?.kodPocztowy).toBe('00-001');
  });

  it("sets isCompany from buyer.type === 'company'", () => {
    expect(toBridgeBuyer(buyer(null, 'company')).isCompany).toBe(true);
    expect(toBridgeBuyer(buyer(null, 'private')).isCompany).toBe(false);
  });
});

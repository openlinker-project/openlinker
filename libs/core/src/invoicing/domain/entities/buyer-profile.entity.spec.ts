/**
 * BuyerProfile entity — unit tests
 *
 * @module libs/core/src/invoicing/domain/entities
 */
import { BuyerProfile } from './buyer-profile.entity';
import type { BuyerAddress } from '../types/invoicing.types';

const address: BuyerAddress = {
  line1: 'ul. Przykładowa 1',
  line2: null,
  city: 'Warszawa',
  postalCode: '00-001',
  countryIso2: 'PL',
};

describe('BuyerProfile', () => {
  describe('isCompany', () => {
    it('returns true for a company buyer', () => {
      const buyer = new BuyerProfile('Acme Sp. z o.o.', { scheme: 'pl-nip', value: '1234567890' }, address, 'company');
      expect(buyer.isCompany).toBe(true);
    });

    it('returns false for a private buyer', () => {
      const buyer = new BuyerProfile('Jan Kowalski', null, address, 'private');
      expect(buyer.isCompany).toBe(false);
    });
  });

  it('carries a scheme-tagged tax id (no bare nip field)', () => {
    const buyer = new BuyerProfile('Acme', { scheme: 'eu-vat', value: 'PL1234567890' }, address, 'company');
    expect(buyer.taxId).toEqual({ scheme: 'eu-vat', value: 'PL1234567890' });
  });

  describe('email', () => {
    it('defaults to null when omitted (#1797)', () => {
      const buyer = new BuyerProfile('Jan Kowalski', null, address, 'private');
      expect(buyer.email).toBeNull();
    });

    it('is assigned verbatim when provided (#1797)', () => {
      const buyer = new BuyerProfile('Jan Kowalski', null, address, 'private', 'jan@example.com');
      expect(buyer.email).toBe('jan@example.com');
    });
  });
});

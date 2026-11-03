import type { ShoperTax } from '../../../domain/types/shoper-api.types';
import {
  expectedOrderSum,
  findShoperTaxForRate,
  mapShoperOrderAddress,
  resolveGrossUnitPrice,
} from '../shoper-order.mapper';

const TAXES = new Map<string, ShoperTax>([
  ['1', { tax_id: '1', value: '23', name: '23%' }],
  ['3', { tax_id: '3', value: '0', name: '0%' }],
  ['4', { tax_id: '4', value: '0', name: 'zw.' }],
  ['5', { tax_id: '5', value: '0', name: 'np.' }],
]);

describe('shoper-order.mapper', () => {
  describe('mapShoperOrderAddress', () => {
    it('should map the neutral address and upper-case the ISO country', () => {
      expect(
        mapShoperOrderAddress({
          firstName: 'Jan',
          lastName: 'Kowalski',
          company: 'ACME',
          address1: 'Prosta 1',
          address2: 'm. 2',
          city: 'Warszawa',
          postalCode: '00-001',
          country: 'pl',
          phone: '600',
          taxId: '5252556107',
        }),
      ).toEqual({
        firstname: 'Jan',
        lastname: 'Kowalski',
        company: 'ACME',
        street1: 'Prosta 1',
        street2: 'm. 2',
        city: 'Warszawa',
        postcode: '00-001',
        state: '',
        country_code: 'PL',
        phone: '600',
        tax_identification_number: '5252556107',
      });
    });

    it('should use the fallback phone only when the address has none', () => {
      const base = { address1: 'a', city: 'c', postalCode: 'p', country: 'PL' };

      expect(mapShoperOrderAddress({ ...base, phone: '111' }, '222').phone).toBe('111');
      expect(mapShoperOrderAddress({ ...base, phone: ' ' }, '222').phone).toBe('222');
      expect(mapShoperOrderAddress(base).phone).toBe('');
    });

    it('should send no country code for a value that is not ISO-2', () => {
      expect(
        mapShoperOrderAddress({ address1: 'a', city: 'c', postalCode: 'p', country: 'Polska' }).country_code,
      ).toBe('');
    });
  });

  describe('resolveGrossUnitPrice', () => {
    it.each([
      [{ price: 50 }, 'inclusive', 50],
      [{ price: 50 }, undefined, 50],
      [{ price: 100, unitPriceGross: 123 }, 'exclusive', 123],
      [{ price: 100 }, 'exclusive', null],
    ] as const)('should resolve %p (%s) to %p', (item, treatment, expected) => {
      expect(resolveGrossUnitPrice(item, treatment)).toBe(expected);
    });
  });

  describe('findShoperTaxForRate', () => {
    it.each([
      ['23', '1'],
      ['0', '3'],
      ['zw', '4'],
      ['np', '5'],
    ])('should find rate %s at tax %s, telling the 0%% rows apart by name', (code, taxId) => {
      expect(findShoperTaxForRate(TAXES, code)?.tax_id).toBe(taxId);
    });

    it('should return null for a rate the shop does not have', () => {
      expect(findShoperTaxForRate(TAXES, '5')).toBeNull();
    });
  });

  it('should sum lines and shipping in cents', () => {
    expect(expectedOrderSum([{ price: 0.1, quantity: 3 }, { price: 10, quantity: 1 }], 12.2)).toBe(22.5);
  });
});

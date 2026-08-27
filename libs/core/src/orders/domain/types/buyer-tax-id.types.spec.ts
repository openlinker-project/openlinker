/**
 * Buyer tax id rules — unit tests
 *
 * The whole point of this module is that three states never collapse into two,
 * so every case below is about telling "unknown" apart from "has none".
 *
 * @module libs/core/src/orders/domain/types
 */
import type { Address } from './order.types';
import {
  buyerHasTaxId,
  decodeBuyerTaxIdColumn,
  encodeBuyerTaxIdColumn,
  readBuyerTaxId,
  readSourceBuyerTaxId,
} from './buyer-tax-id.types';

function address(overrides: Partial<Address> = {}): Address {
  return { address1: 'ul. Testowa 1', city: 'Poznan', postalCode: '60-001', country: 'PL', ...overrides };
}

describe('readBuyerTaxId', () => {
  it('should return the billing tax id when the billing address asserts one', () => {
    expect(
      readBuyerTaxId({
        billingAddress: address({ taxId: '1234567890' }),
        shippingAddress: address({ taxId: '9999999999' }),
      })
    ).toBe('1234567890');
  });

  it('should return null when billing asserted the buyer has none, without falling back to shipping', () => {
    expect(
      readBuyerTaxId({
        billingAddress: address({ taxId: null }),
        shippingAddress: address({ taxId: '9999999999' }),
      })
    ).toBeNull();
  });

  it('should fall back to shipping when billing asserted nothing', () => {
    expect(
      readBuyerTaxId({ billingAddress: address(), shippingAddress: address({ taxId: '5555555555' }) })
    ).toBe('5555555555');
  });

  it('should return undefined when the order carries no address at all', () => {
    expect(readBuyerTaxId({})).toBeUndefined();
  });
});

describe('buyerHasTaxId', () => {
  it('should return undefined when nothing was asserted', () => {
    expect(buyerHasTaxId(undefined)).toBeUndefined();
  });

  it('should return false only when the source asserted the buyer has none', () => {
    expect(buyerHasTaxId(null)).toBe(false);
  });

  it('should return true when a tax id is present', () => {
    expect(buyerHasTaxId('1234567890')).toBe(true);
  });
});

describe('encodeBuyerTaxIdColumn / decodeBuyerTaxIdColumn', () => {
  it('should round-trip all three states', () => {
    expect(decodeBuyerTaxIdColumn(encodeBuyerTaxIdColumn(undefined))).toBeUndefined();
    expect(decodeBuyerTaxIdColumn(encodeBuyerTaxIdColumn(null))).toBeNull();
    expect(decodeBuyerTaxIdColumn(encodeBuyerTaxIdColumn('1234567890'))).toBe('1234567890');
  });

  it('should encode unknown as NULL and asserted-none as the empty string', () => {
    expect(encodeBuyerTaxIdColumn(undefined)).toBeNull();
    expect(encodeBuyerTaxIdColumn(null)).toBe('');
  });

  it('should encode a whitespace-only value as asserted-none', () => {
    expect(encodeBuyerTaxIdColumn('   ')).toBe('');
  });

  it('should trim surrounding whitespace without otherwise normalising the identifier', () => {
    expect(encodeBuyerTaxIdColumn('  PL 123-456-78-90  ')).toBe('PL 123-456-78-90');
  });

  it('should decode a missing column as unknown', () => {
    expect(decodeBuyerTaxIdColumn(undefined)).toBeUndefined();
  });
});

describe('readSourceBuyerTaxId', () => {
  it('should read a field the source did not return as unknown', () => {
    expect(readSourceBuyerTaxId(undefined)).toBeUndefined();
  });

  it('should read an explicit null or a blank as asserted-none', () => {
    expect(readSourceBuyerTaxId(null)).toBeNull();
    expect(readSourceBuyerTaxId('')).toBeNull();
    expect(readSourceBuyerTaxId('  ')).toBeNull();
  });

  it('should carry a value verbatim apart from trimming', () => {
    expect(readSourceBuyerTaxId(' 1234567890 ')).toBe('1234567890');
  });
});

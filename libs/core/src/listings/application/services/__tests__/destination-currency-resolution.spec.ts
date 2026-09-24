/**
 * Destination Currency Resolution — pure resolver spec (#3203)
 *
 * @module libs/core/src/listings/application/services/__tests__
 */
import {
  resolveOfferDestinationCurrency,
  resolveShopDestinationCurrency,
} from '../destination-currency-resolution';
import type { OfferManagerPort } from '../../../domain/ports/offer-manager.port';
import type { ShopProductManagerPort } from '../../../domain/ports/shop-product-manager.port';

describe('resolveOfferDestinationCurrency', () => {
  it('returns the declared value when the adapter implements OfferCurrencyDeclarer', () => {
    const adapter = {
      updateOfferQuantity: jest.fn(),
      getDestinationCurrency: () => 'PLN',
    } as unknown as OfferManagerPort;

    expect(resolveOfferDestinationCurrency(adapter)).toBe('PLN');
  });

  it('returns null when the adapter declares nothing', () => {
    const adapter = { updateOfferQuantity: jest.fn() } as unknown as OfferManagerPort;

    expect(resolveOfferDestinationCurrency(adapter)).toBeNull();
  });

  it('returns null when the adapter declares the capability but reports unknown', () => {
    const adapter = {
      updateOfferQuantity: jest.fn(),
      getDestinationCurrency: () => null,
    } as unknown as OfferManagerPort;

    expect(resolveOfferDestinationCurrency(adapter)).toBeNull();
  });
});

describe('resolveShopDestinationCurrency', () => {
  it('returns the declared value when the adapter implements ShopCurrencyDeclarer', async () => {
    // `ShopCurrencyDeclarer.getDestinationCurrency` is ASYNC (#3159
    // review, SUGGESTION) — a real implementer typically needs a live read
    // (e.g. a WooCommerce store-settings call), unlike the marketplace
    // sibling's fixed-constant case.
    const adapter = {
      publishProduct: jest.fn(),
      getDescriptionFormat: jest.fn(),
      getDestinationCurrency: () => Promise.resolve('USD'),
    } as unknown as ShopProductManagerPort;

    await expect(resolveShopDestinationCurrency(adapter)).resolves.toBe('USD');
  });

  it('returns null when the adapter declares nothing', async () => {
    const adapter = {
      publishProduct: jest.fn(),
      getDescriptionFormat: jest.fn(),
    } as unknown as ShopProductManagerPort;

    await expect(resolveShopDestinationCurrency(adapter)).resolves.toBeNull();
  });
});

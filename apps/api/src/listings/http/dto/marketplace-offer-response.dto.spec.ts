/**
 * MarketplaceOfferResponseDto mapping tests (#1482) - verifies the
 * `fromDomain` passthrough of the filled-parameter values and productSet
 * linkage, and that adapters without parameter data keep the previous shape
 * (fields absent).
 */
import type { MarketplaceOffer } from '@openlinker/core/listings';

import { MarketplaceOfferResponseDto } from './marketplace-offer-response.dto';

const baseOffer: MarketplaceOffer = {
  externalId: '7781562863',
  title: 'Vintage Camera Lens 50mm f/1.4',
  description: 'Mint condition lens.',
  imageUrl: 'https://a.allegroimg.com/lens-1.jpg',
  price: { amount: '249.00', currency: 'PLN' },
  availableQuantity: 3,
  status: 'ACTIVE',
  category: { id: '12345', name: 'Lenses' },
  marketplaceUrl: 'https://allegro.pl/oferta/7781562863',
  endsAt: '2026-05-15T12:00:00Z',
};

describe('MarketplaceOfferResponseDto.fromDomain (#1482)', () => {
  it('should pass filled parameters and productSet linkage through when present', () => {
    const dto = MarketplaceOfferResponseDto.fromDomain({
      ...baseOffer,
      parameters: [
        {
          id: '11323',
          name: 'Stan',
          values: ['Nowy'],
          valuesIds: ['11323_1'],
          section: 'offer',
        },
        {
          id: '224017',
          values: [],
          rangeValue: { from: '10', to: '20' },
          section: 'offer',
        },
        {
          id: '17448',
          name: 'Marka',
          values: ['Canon'],
          valuesIds: ['17448_2'],
          section: 'product',
        },
      ],
      productSet: [{ productId: 'product-card-1', quantity: 1 }],
    });

    expect(dto.parameters).toEqual([
      {
        id: '11323',
        name: 'Stan',
        values: ['Nowy'],
        valuesIds: ['11323_1'],
        rangeValue: undefined,
        section: 'offer',
      },
      {
        id: '224017',
        name: undefined,
        values: [],
        valuesIds: undefined,
        rangeValue: { from: '10', to: '20' },
        section: 'offer',
      },
      {
        id: '17448',
        name: 'Marka',
        values: ['Canon'],
        valuesIds: ['17448_2'],
        rangeValue: undefined,
        section: 'product',
      },
    ]);
    expect(dto.productSet).toEqual([{ productId: 'product-card-1', quantity: 1 }]);
  });

  it('should leave parameters and productSet absent when the domain offer carries neither', () => {
    const dto = MarketplaceOfferResponseDto.fromDomain(baseOffer);

    expect(dto.parameters).toBeUndefined();
    expect(dto.productSet).toBeUndefined();
    // Previous shape untouched — existing consumers unaffected.
    expect(dto).toMatchObject({
      externalId: '7781562863',
      title: 'Vintage Camera Lens 50mm f/1.4',
      price: { amount: '249.00', currency: 'PLN' },
      availableQuantity: 3,
      status: 'ACTIVE',
      category: { id: '12345', name: 'Lenses' },
    });
  });
});

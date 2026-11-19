/**
 * Amazon listing composer tests (#4181)
 *
 * @module libs/integrations/amazon/src/infrastructure/mappers/__tests__
 */
import type { CreateOfferCommand } from '@openlinker/core/listings';

import { AmazonNotSupportedException } from '../../../domain/exceptions/amazon-not-supported.exception';
import { composeFullListing, composeOfferOnlyListing, resolveAmazonSku } from '../amazon-listing-composer';

const FR = 'A13V1IB3VIYZZH';
const DE = 'A1PA6795UKMFR9';
const PL = 'A1C3SOZRARQ6R3';

const command = (overrides: Partial<CreateOfferCommand> = {}): CreateOfferCommand => ({
  internalVariantId: 'ol_variant_fce2df4d853f4499b955a6bb1a212bd1',
  connectionId: 'conn-amz',
  price: { amount: 19.99, currency: 'EUR' },
  stock: 4,
  publishImmediately: true,
  ...overrides,
});

describe('resolveAmazonSku', () => {
  it('should derive a stable SKU within Amazon limit from the variant id', () => {
    const sku = resolveAmazonSku(command());
    expect(sku).toBe('OL-fce2df4d853f4499b955a6bb1a212bd1');
    expect(sku.length).toBeLessThanOrEqual(40);
  });

  it('should prefer the operator SKU and refuse one Amazon would reject', () => {
    expect(resolveAmazonSku(command({ overrides: { platformParams: { sku: ' MUG-1 ' } } }))).toBe('MUG-1');
    expect(() => resolveAmazonSku(command({ overrides: { platformParams: { sku: 'x'.repeat(41) } } }))).toThrow(
      AmazonNotSupportedException,
    );
  });
});

describe('composeOfferOnlyListing', () => {
  it('should list the ASIN on every marketplace selling in the price currency', () => {
    const plan = composeOfferOnlyListing({
      cmd: command({ condition: 'used' }),
      asin: 'B0MUG00001',
      productType: 'KITCHEN',
      marketplaceIds: [DE, FR, PL],
    });

    expect(plan.marketplaceIds).toEqual([DE, FR]);
    expect(plan.body).toEqual({
      productType: 'KITCHEN',
      requirements: 'LISTING_OFFER_ONLY',
      attributes: {
        merchant_suggested_asin: [
          { value: 'B0MUG00001', marketplace_id: DE },
          { value: 'B0MUG00001', marketplace_id: FR },
        ],
        condition_type: [
          { value: 'used_good', marketplace_id: DE },
          { value: 'used_good', marketplace_id: FR },
        ],
        purchasable_offer: [
          { marketplace_id: DE, currency: 'EUR', our_price: [{ schedule: [{ value_with_tax: 19.99 }] }] },
          { marketplace_id: FR, currency: 'EUR', our_price: [{ schedule: [{ value_with_tax: 19.99 }] }] },
        ],
        fulfillment_availability: [{ fulfillment_channel_code: 'DEFAULT', quantity: 4 }],
      },
    });
  });

  it('should fall back to the generic product type and refuse a currency no marketplace sells in', () => {
    expect(
      composeOfferOnlyListing({ cmd: command(), asin: 'B0', productType: null, marketplaceIds: [DE] }).body.productType,
    ).toBe('PRODUCT');
    expect(() =>
      composeOfferOnlyListing({
        cmd: command({ price: { amount: 10, currency: 'USD' } }),
        asin: 'B0',
        productType: null,
        marketplaceIds: [DE],
      }),
    ).toThrow(AmazonNotSupportedException);
  });
});

describe('composeFullListing', () => {
  it('should write the content in each marketplace language with images and attributes', () => {
    const plan = composeFullListing({
      cmd: command({ price: { amount: 79, currency: 'PLN' } }),
      productType: 'KITCHEN',
      marketplaceIds: [DE, PL],
      content: {
        title: 'Kubek niebieski',
        brand: 'Acme',
        ean: '5901234123457',
        description: '<p>Duży &amp; trwały</p><p>350 ml</p>',
        imageUrls: ['https://shop.example/1.jpg', 'http://shop.example/insecure.jpg', 'https://shop.example/2.jpg'],
        parameters: [
          { id: 'color', values: ['Niebieski'], section: 'product' },
          { id: 'material', values: [], section: 'product' },
        ],
      },
    });

    expect(plan.marketplaceIds).toEqual([PL]);
    expect(plan.body.requirements).toBe('LISTING');
    expect(plan.body.attributes).toMatchObject({
      item_name: [{ value: 'Kubek niebieski', language_tag: 'pl_PL', marketplace_id: PL }],
      brand: [{ value: 'Acme', language_tag: 'pl_PL', marketplace_id: PL }],
      externally_assigned_product_identifier: [{ type: 'ean', value: '5901234123457', marketplace_id: PL }],
      product_description: [{ value: 'Duży & trwały\n350 ml', language_tag: 'pl_PL', marketplace_id: PL }],
      main_product_image_locator: [{ media_location: 'https://shop.example/1.jpg', marketplace_id: PL }],
      other_product_image_locator_1: [{ media_location: 'https://shop.example/2.jpg', marketplace_id: PL }],
      color: [{ value: 'Niebieski', language_tag: 'pl_PL', marketplace_id: PL }],
    });
    expect(plan.body.attributes).not.toHaveProperty('material');
  });

  it('should write each product type attribute to every marketplace the listing goes to', () => {
    const plan = composeFullListing({
      cmd: command({ price: { amount: 19.99, currency: 'EUR' } }),
      productType: 'KITCHEN',
      marketplaceIds: [DE, FR],
      content: {
        title: 'Becher',
        brand: 'Acme',
        ean: '5901234123457',
        description: null,
        imageUrls: [],
        parameters: [
          { id: 'color', values: ['Blau'], section: 'product' },
          { id: 'material', valuesIds: ['ceramic'], section: 'product' },
        ],
      },
    });

    expect(plan.marketplaceIds).toEqual([DE, FR]);
    expect(plan.body.attributes['color']).toEqual([
      { value: 'Blau', language_tag: 'de_DE', marketplace_id: DE },
      { value: 'Blau', language_tag: 'fr_FR', marketplace_id: FR },
    ]);
    expect(plan.body.attributes['material']).toEqual([
      { value: 'ceramic', marketplace_id: DE },
      { value: 'ceramic', marketplace_id: FR },
    ]);
  });
});

describe('product tax code', () => {
  it('should send the tax code on every marketplace of an offer-only listing', () => {
    const plan = composeOfferOnlyListing({
      cmd: command(),
      asin: 'B0ABCDEFGH',
      productType: null,
      marketplaceIds: [FR, DE, PL],
      taxCode: 'A_GEN_STANDARD',
    });
    expect(plan.body.attributes.product_tax_code).toEqual([
      { value: 'A_GEN_STANDARD', marketplace_id: FR },
      { value: 'A_GEN_STANDARD', marketplace_id: DE },
    ]);
  });

  it('should leave the tax code out when none is resolved', () => {
    const plan = composeOfferOnlyListing({ cmd: command(), asin: 'B0ABCDEFGH', productType: null, marketplaceIds: [DE] });
    expect(plan.body.attributes.product_tax_code).toBeUndefined();
  });
});

/**
 * Amazon product mapper tests (#4182)
 *
 * @module libs/integrations/amazon/src/infrastructure/mappers/__tests__
 */
import type { AmazonListingItem } from '../../../domain/types/amazon-listing.types';
import { mapAmazonProduct, mapAmazonVariant, variationLinks } from '../amazon-product.mapper';

const DE = 'A1PA6795UKMFR9';

const listing: AmazonListingItem = {
  sku: 'MUG-BLUE',
  summaries: [{ marketplaceId: DE, asin: 'B0MUG00001', productType: 'KITCHEN', status: ['BUYABLE'], itemName: 'Summary name' }],
  attributes: {
    item_name: [{ value: 'Blaue Tasse', marketplace_id: DE, language_tag: 'de_DE' }],
    brand: [{ value: 'Acme', marketplace_id: DE }],
    bullet_point: [{ value: '350 ml', marketplace_id: DE }, { value: 'Spülmaschinenfest & robust', marketplace_id: DE }],
    product_description: [{ value: 'Eine blaue Tasse.', marketplace_id: DE }],
    main_product_image_locator: [{ media_location: 'https://m.media-amazon.com/main.jpg', marketplace_id: DE }],
    other_product_image_locator_1: [{ media_location: 'https://m.media-amazon.com/side.jpg', marketplace_id: DE }],
    externally_assigned_product_identifier: [{ type: 'ean', value: '5901234123457', marketplace_id: DE }],
    purchasable_offer: [
      { marketplace_id: DE, currency: 'EUR', our_price: [{ schedule: [{ value_with_tax: 19.99 }] }] },
    ],
    item_package_weight: [{ value: 0.4, unit: 'kilograms', marketplace_id: DE }],
    color: [{ value: 'Blau', marketplace_id: DE }],
  },
};

const ctx = { marketplaceId: DE, currency: 'EUR' };

describe('mapAmazonProduct', () => {
  it('should map the seller listing with its own content first', () => {
    expect(mapAmazonProduct(listing, ctx)).toEqual({
      id: '',
      name: 'Blaue Tasse',
      sku: 'MUG-BLUE',
      price: 19.99,
      description: '<ul><li>350 ml</li><li>Spülmaschinenfest &amp; robust</li></ul><p>Eine blaue Tasse.</p>',
      images: ['https://m.media-amazon.com/main.jpg', 'https://m.media-amazon.com/side.jpg'],
      currency: 'EUR',
      weight: 0.4,
      categories: ['KITCHEN'],
      categoryBreadcrumb: [{ id: 'KITCHEN', name: 'KITCHEN' }],
      features: [{ name: 'Brand', value: 'Acme' }],
    });
  });

  it('should fill only what the listing lacks from the catalogue entry', () => {
    const bare: AmazonListingItem = { sku: 'BARE', summaries: [{ marketplaceId: DE, productType: 'KITCHEN', status: [] }] };
    const product = mapAmazonProduct(bare, {
      ...ctx,
      catalog: { asin: 'B0', name: 'Catalogue name', brand: 'Acme', productType: 'KITCHEN', ean: null, images: ['https://m.media-amazon.com/c.jpg'] },
    });

    expect(product).toMatchObject({ name: 'Catalogue name', images: ['https://m.media-amazon.com/c.jpg'], price: null });
  });
});

describe('mapAmazonVariant and variationLinks', () => {
  it('should read the variation theme and the child attributes', () => {
    const parent: AmazonListingItem = {
      sku: 'MUG',
      attributes: { variation_theme: [{ name: 'COLOR_NAME/SIZE_NAME', marketplace_id: DE }] },
      relationships: [
        { marketplaceId: DE, relationships: [{ type: 'VARIATION', childSkus: ['MUG-RED', 'MUG-BLUE'] }] },
      ],
    };
    const links = variationLinks(parent, DE);

    expect(links).toEqual({ parentSku: null, childSkus: ['MUG-BLUE', 'MUG-RED'], themeAttributes: ['color', 'size'] });
    expect(mapAmazonVariant(listing, 'ol_product_1', links.themeAttributes, ctx)).toEqual({
      id: '',
      productId: 'ol_product_1',
      sku: 'MUG-BLUE',
      attributes: { color: 'Blau' },
      ean: '5901234123457',
      gtin: '5901234123457',
      price: 19.99,
      images: ['https://m.media-amazon.com/main.jpg', 'https://m.media-amazon.com/side.jpg'],
      weightGrams: 400,
    });
  });

  it('should name the parent of a child listing', () => {
    const child: AmazonListingItem = {
      sku: 'MUG-RED',
      relationships: [{ marketplaceId: DE, relationships: [{ type: 'VARIATION', parentSkus: ['MUG'] }] }],
    };
    expect(variationLinks(child, DE).parentSku).toBe('MUG');
  });
});

/**
 * Mirakl Master Product Mapper: unit tests (#4284)
 *
 * @module libs/integrations/mirakl/src/infrastructure/adapters/catalog-master
 */
import type { MiraklOffer } from '../../../../domain/types/mirakl-offer.types';
import { mapMiraklOfferToProduct, mapMiraklOfferToVariant } from '../mirakl-master-product.mapper';

const OFFER: MiraklOffer = {
  shop_sku: 'SKU-1',
  product_title: 'Ksiazka',
  product_description: '<p>Opis</p>',
  product_brand: 'Wydawnictwo',
  product_references: [
    { reference_type: 'SHOP_ID', reference: 'X1' },
    { reference_type: 'EAN', reference: '9788377585061' },
  ],
  category_code: 'CAT_1',
  category_label: 'Ksiazki',
  price: 39.9,
  currency_iso_code: 'PLN',
  quantity: 5,
};

describe('mapMiraklOfferToProduct', () => {
  it('should map an offer to a product without images or a tax rate', () => {
    expect(mapMiraklOfferToProduct(OFFER, 'ol_product_1')).toEqual({
      id: 'ol_product_1',
      name: 'Ksiazka',
      sku: 'SKU-1',
      price: 39.9,
      description: '<p>Opis</p>',
      images: null,
      currency: 'PLN',
      categories: ['CAT_1'],
      categoryBreadcrumb: [{ id: 'CAT_1', name: 'Ksiazki' }],
      features: [{ name: 'Brand', value: 'Wydawnictwo' }],
    });
  });

  it('should fall back to the sku for the name and leave absent fields out', () => {
    const product = mapMiraklOfferToProduct({ shop_sku: 'SKU-2' }, 'ol_product_2');

    expect(product).toEqual({
      id: 'ol_product_2',
      name: 'SKU-2',
      sku: 'SKU-2',
      price: null,
      description: null,
      images: null,
      currency: null,
    });
    expect(product).not.toHaveProperty('gpsr');
    expect(product).not.toHaveProperty('taxRate');
  });

  it('should leave out a description that is only the card page CSS', () => {
    const product = mapMiraklOfferToProduct(
      {
        ...OFFER,
        product_description: '#empilp-z {\n\tmax-width: 830px;\n}\n#empilp-z img {\n\tdisp',
      },
      'ol_product_1'
    );

    expect(product.description).toBeNull();
  });
});

describe('mapMiraklOfferToVariant', () => {
  it('should map the single variant with the barcode', () => {
    expect(mapMiraklOfferToVariant(OFFER, 'ol_product_1', 'ol_variant_1')).toEqual({
      id: 'ol_variant_1',
      productId: 'ol_product_1',
      sku: 'SKU-1',
      attributes: null,
      ean: '9788377585061',
      gtin: '9788377585061',
      price: 39.9,
    });
  });
});

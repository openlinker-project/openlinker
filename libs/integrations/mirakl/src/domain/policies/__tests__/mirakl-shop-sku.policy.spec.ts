/**
 * Mirakl Shop SKU Policy: unit tests
 *
 * @module libs/integrations/mirakl/src/domain/policies
 */
import { deriveMiraklCatalogCode, deriveMiraklShopSku } from '../mirakl-shop-sku.policy';

describe('deriveMiraklShopSku', () => {
  it('should derive a short, stable SKU from the OL variant id', () => {
    const sku = deriveMiraklShopSku('ol_variant_E4B98E91340A44EDB4892905DB8810B1');

    expect(sku).toBe('OL-e4b98e91340a44edb4892905db8810b1');
    expect(sku).toHaveLength(35);
    expect(deriveMiraklShopSku('ol_variant_e4b98e91340a44edb4892905db8810b1')).toBe(sku);
  });
});

describe('deriveMiraklCatalogCode', () => {
  it('should cut the SKU to the operator limit and keep a short one as it is', () => {
    const sku = 'OL-e4b98e91340a44edb4892905db8810b1';

    expect(deriveMiraklCatalogCode(sku, 26)).toBe('OL-e4b98e91340a44edb48929');
    expect(deriveMiraklCatalogCode(sku, 26)).toHaveLength(26);
    expect(deriveMiraklCatalogCode('OL-1', 26)).toBe('OL-1');
  });
});

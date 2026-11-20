import {
  PRODUCT_STATUS_UPDATE_MUTATION,
  VARIANT_PRICE_UPDATE_MUTATION,
} from '../shopify-product-publish.graphql';

describe('shopify product publish documents', () => {
  it('should not select a code on the plain UserError that productUpdate returns', () => {
    // Shopify answers "Field 'code' doesn't exist on type 'UserError'" and the whole
    // hide/show of a product fails, which left a master-deleted product on sale (#3962).
    expect(PRODUCT_STATUS_UPDATE_MUTATION).toContain('productUpdate(');
    expect(PRODUCT_STATUS_UPDATE_MUTATION).not.toMatch(/userErrors\s*\{[^}]*\bcode\b/);
  });

  it('should keep the code on the variant bulk update, whose error type declares one', () => {
    expect(VARIANT_PRICE_UPDATE_MUTATION).toMatch(/userErrors\s*\{[^}]*\bcode\b/);
  });
});

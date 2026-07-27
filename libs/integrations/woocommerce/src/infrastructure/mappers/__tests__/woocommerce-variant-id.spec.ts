/**
 * Unit tests for the WooCommerce variant-id helpers.
 *
 * Locks the synthetic-variant marker contract relied on by the product-master,
 * inventory-master, and order-processor adapters: a simple product maps to a
 * deterministic `product:{wcId}` external id, and every call site agrees on how
 * to build and detect it (mirrors prestashop-variant-id.spec.ts).
 *
 * @module libs/integrations/woocommerce/src/infrastructure/mappers
 */
import {
  WOOCOMMERCE_SYNTHETIC_VARIANT_PREFIX,
  buildSyntheticVariantExternalId,
  isSyntheticVariantExternalId,
} from '../woocommerce-variant-id';

describe('woocommerce-variant-id', () => {
  describe('buildSyntheticVariantExternalId', () => {
    it('should build a product:{wcId} marker from a numeric WC product id', () => {
      expect(buildSyntheticVariantExternalId(25)).toBe('product:25');
    });

    it('should build a product:{wcId} marker from a string WC product id', () => {
      expect(buildSyntheticVariantExternalId('460')).toBe('product:460');
    });

    it('should be deterministic — the same product id yields the same marker', () => {
      expect(buildSyntheticVariantExternalId(7)).toBe(buildSyntheticVariantExternalId(7));
    });

    it('should use the shared prefix constant', () => {
      expect(buildSyntheticVariantExternalId(1)).toBe(
        `${WOOCOMMERCE_SYNTHETIC_VARIANT_PREFIX}1`,
      );
    });
  });

  describe('isSyntheticVariantExternalId', () => {
    it('should return true for a synthetic marker', () => {
      expect(isSyntheticVariantExternalId('product:25')).toBe(true);
    });

    it('should return true for a marker built by buildSyntheticVariantExternalId', () => {
      expect(isSyntheticVariantExternalId(buildSyntheticVariantExternalId(99))).toBe(true);
    });

    it('should return false for a real numeric WC variation id', () => {
      expect(isSyntheticVariantExternalId('460')).toBe(false);
    });

    it('should return false for undefined', () => {
      expect(isSyntheticVariantExternalId(undefined)).toBe(false);
    });

    it('should return false for null', () => {
      expect(isSyntheticVariantExternalId(null)).toBe(false);
    });

    it('should return false for an empty string', () => {
      expect(isSyntheticVariantExternalId('')).toBe(false);
    });
  });
});

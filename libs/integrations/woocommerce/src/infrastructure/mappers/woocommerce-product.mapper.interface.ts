/**
 * WooCommerce Product Mapper Interface
 *
 * Contract for mapping WooCommerce REST API product and variation shapes
 * to the OpenLinker unified Product and ProductVariant domain entities.
 * Separated from the implementation so WooCommerceProductMasterAdapter
 * can depend on the interface, enabling clean mocking in unit tests.
 *
 * @module libs/integrations/woocommerce/src/infrastructure/mappers
 * @see {@link WooCommerceProductMapper} for the implementation
 */
import type { Product, ProductVariant } from '@openlinker/core/products';
import type {
  WooCommerceProduct,
  WooCommerceProductVariation,
  WooCommerceMetaEntry,
} from '../adapters/product-master/woocommerce-product.types';

export interface IWooCommerceProductMapper {
  mapProduct(product: WooCommerceProduct): Omit<Product, 'id'>;
  mapVariation(
    variation: WooCommerceProductVariation,
    productId: string,
  ): Omit<ProductVariant, 'id'>;
  /**
   * Extract and normalise EAN-13 barcode from product meta_data.
   * Returns null when no recognised EAN key is present or the value is blank.
   */
  extractEan(metaData: WooCommerceMetaEntry[]): string | null;
  /**
   * Extract and normalise GTIN barcode from product meta_data.
   * Returns null when no recognised GTIN key is present or the value is blank.
   */
  extractGtin(metaData: WooCommerceMetaEntry[]): string | null;
}

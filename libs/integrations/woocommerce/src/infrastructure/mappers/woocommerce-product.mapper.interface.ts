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
} from '../adapters/product-master/woocommerce-product.types';

export interface IWooCommerceProductMapper {
  mapProduct(product: WooCommerceProduct): Omit<Product, 'id'>;
  mapVariation(
    variation: WooCommerceProductVariation,
    productId: string,
  ): Omit<ProductVariant, 'id'>;
}

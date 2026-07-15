/**
 * WooCommerce Variant Mapper
 *
 * Maps WooCommerce product-variation data to the OpenLinker ProductVariant
 * schema. The mapping logic lives on WooCommerceProductMapper (mapVariation);
 * this alias mirrors the PrestaShop layout (prestashop-variant.mapper.ts) so the
 * variant-mapping seam has a named home.
 *
 * @module libs/integrations/woocommerce/src/infrastructure/mappers
 */
export { WooCommerceProductMapper as WooCommerceVariantMapper } from './woocommerce-product.mapper';

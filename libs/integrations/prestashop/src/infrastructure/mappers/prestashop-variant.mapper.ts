/**
 * PrestaShop Variant Mapper
 *
 * Maps PrestaShop combination (variant) data to OpenLinker ProductVariant schema.
 * Extracted to separate file for clarity, but uses PrestashopProductMapper
 * for the actual mapping logic.
 *
 * @module libs/integrations/prestashop/src/infrastructure/mappers
 */
export { PrestashopProductMapper as PrestashopVariantMapper } from './prestashop-product.mapper';


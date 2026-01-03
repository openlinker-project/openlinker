/**
 * Products Module Exports
 *
 * Public API for the products module. Exports ports, types, and domain entities
 * for use by other modules and adapters.
 *
 * @module libs/core/src/products
 */

// Ports
export {
  ProductMasterPort,
  Product,
  ProductVariant,
  Category,
} from './domain/ports/product-master.port';

// Types
export {
  ProductFilters,
  ProductCreate,
  ProductUpdate,
  ProductVariantCreate,
} from './domain/types/product.types';




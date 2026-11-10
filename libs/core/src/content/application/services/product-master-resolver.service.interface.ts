/**
 * Product Master Resolver Service Interface
 *
 * @module libs/core/src/content/application/services
 * @see {@link ProductMasterResolverService}
 */
import type { ProductMasterPort } from '@openlinker/core/products';

export interface IProductMasterResolverService {
  /**
   * The `ProductMaster` adapter of the connection the product comes from.
   *
   * @throws NoProductMasterAdapterException when no active ProductMaster
   *         connection claims the product.
   * @throws AmbiguousProductMasterException when more than one does.
   */
  resolve(productId: string, fieldKey: string): Promise<ProductMasterPort>;
}

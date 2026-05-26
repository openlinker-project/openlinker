/**
 * Order Item Ref Resolver Service Interface
 *
 * Defines the contract for resolving external-only IncomingOrder item references
 * (offer / product / variant / sku) to internal OpenLinker product and variant IDs.
 *
 * @module libs/core/src/orders/application/interfaces
 */
import type { IncomingOrderItemRef } from '../../domain/types/incoming-order.types';
import type {
  ItemResolutionResult,
  ResolvedOrderItemProduct,
} from '../services/order-item-ref-resolver.types';

export interface IOrderItemRefResolverService {
  /**
   * Resolve an item reference, swallowing missing-mapping failures.
   *
   * Returns `{ resolved: true, ... }` on success, or `{ resolved: false, ... }`
   * when the underlying mapping is missing. Non-mapping errors propagate.
   */
  tryResolve(
    connectionId: string,
    productRef: IncomingOrderItemRef
  ): Promise<ItemResolutionResult>;

  /**
   * Resolve an item reference to internal product/variant IDs.
   *
   * @throws MissingOrderItemMappingError when no mapping exists for the reference.
   */
  resolve(
    connectionId: string,
    productRef: IncomingOrderItemRef
  ): Promise<ResolvedOrderItemProduct>;
}

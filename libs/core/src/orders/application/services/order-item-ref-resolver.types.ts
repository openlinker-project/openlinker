/**
 * Order Item Ref Resolver Types
 *
 * Types for OrderItemRefResolverService resolution results.
 *
 * @module libs/core/src/orders/application/services
 */
import type { IncomingOrderItemRef } from '../../domain/types/incoming-order.types';

export interface ResolvedOrderItemProduct {
  internalProductId: string;
  internalVariantId?: string;
}

export type ItemResolutionResult =
  | ({ resolved: true } & ResolvedOrderItemProduct)
  | { resolved: false; productRef: IncomingOrderItemRef; reason: string };

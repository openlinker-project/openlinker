/**
 * Order Tag Repository Port (#3532)
 *
 * @module libs/core/src/orders/domain/ports
 */
import type {
  BulkAssignOrderTagResult,
  CreateOrderTagInput,
  OrderTag,
  OrderTagWithCount,
  UpdateOrderTagInput,
} from '../types/order-tag.types';

export interface OrderTagRepositoryPort {
  /** The whole workspace vocabulary, each with its live order count, name-ordered. */
  findAllWithCounts(): Promise<OrderTagWithCount[]>;

  findById(id: string): Promise<OrderTag | null>;

  findByName(name: string): Promise<OrderTag | null>;

  count(): Promise<number>;

  create(input: CreateOrderTagInput): Promise<OrderTag>;

  update(id: string, patch: UpdateOrderTagInput): Promise<OrderTag>;

  /** Deletes the tag AND every assignment naming it, in one transaction. */
  delete(id: string): Promise<void>;

  /** Tag ids currently assigned to one order. */
  findTagIdsForOrder(internalOrderId: string): Promise<string[]>;

  /** Tag ids currently assigned to a PAGE of orders — batched, never per-row. */
  findTagIdsForOrders(internalOrderIds: readonly string[]): Promise<Map<string, string[]>>;

  assign(tagId: string, internalOrderId: string, assignedByUserId: string): Promise<void>;

  unassign(tagId: string, internalOrderId: string): Promise<void>;

  /**
   * Assigns ONE tag to every named order, idempotently — an order that
   * already carries it is counted in `alreadyTagged`, not re-inserted.
   */
  bulkAssign(
    tagId: string,
    internalOrderIds: readonly string[],
    assignedByUserId: string
  ): Promise<BulkAssignOrderTagResult>;
}

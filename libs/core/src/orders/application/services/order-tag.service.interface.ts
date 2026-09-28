/**
 * Order Tag Service Interface (#3532, D34)
 *
 * @module libs/core/src/orders/application/services
 */
import type {
  BulkAssignOrderTagResult,
  OrderTag,
  OrderTagColor,
  OrderTagWithCount,
} from '../../domain/types/order-tag.types';

export interface IOrderTagService {
  listAll(): Promise<OrderTagWithCount[]>;

  /**
   * @throws {OrderTagLimitReachedError} the workspace already holds
   *   `ORDER_TAG_WORKSPACE_LIMIT` tags.
   */
  create(name: string, color: OrderTagColor): Promise<OrderTag>;

  /** @throws {OrderTagNotFoundError} */
  update(id: string, patch: { name?: string; color?: OrderTagColor }): Promise<OrderTag>;

  /** @throws {OrderTagNotFoundError} */
  delete(id: string): Promise<void>;

  listForOrder(internalOrderId: string): Promise<string[]>;

  /** Batched read for the orders list row (tags are the 3rd line of the identity cell). */
  getForOrders(internalOrderIds: readonly string[]): Promise<Map<string, string[]>>;

  /** @throws {OrderTagNotFoundError} */
  assign(tagId: string, internalOrderId: string, assignedByUserId: string): Promise<void>;

  unassign(tagId: string, internalOrderId: string): Promise<void>;

  /** @throws {OrderTagNotFoundError} */
  bulkAssign(
    tagId: string,
    internalOrderIds: readonly string[],
    assignedByUserId: string
  ): Promise<BulkAssignOrderTagResult>;
}

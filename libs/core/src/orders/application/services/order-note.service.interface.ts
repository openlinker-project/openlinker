/**
 * Order Note Service Interface (#3531)
 *
 * @module libs/core/src/orders/application/services
 */
import type {
  OrderNote,
  OrderNoteTimelineEntry,
  UpdateOrderNoteInput,
} from '../../domain/types/order-note.types';

export interface IOrderNoteService {
  listForOrder(internalOrderId: string): Promise<OrderNote[]>;

  create(
    internalOrderId: string,
    authorUserId: string,
    authorUsername: string,
    body: string,
    showToPacker: boolean
  ): Promise<OrderNote>;

  /**
   * @throws {OrderNoteNotFoundError} no such note.
   * @throws {OrderNoteNotAuthoredError} caller is neither the author nor `isAdmin`.
   */
  update(
    noteId: string,
    callerUserId: string,
    isAdmin: boolean,
    patch: UpdateOrderNoteInput
  ): Promise<OrderNote>;

  /**
   * @throws {OrderNoteNotFoundError} no such note.
   * @throws {OrderNoteNotAuthoredError} caller is neither the author nor `isAdmin` (D33).
   */
  delete(noteId: string, callerUserId: string, isAdmin: boolean): Promise<void>;

  /** Batched read for the `/orders` page and the pack bench — see the port. */
  getPackerVisibleForOrders(
    internalOrderIds: readonly string[]
  ): Promise<Map<string, OrderNote[]>>;

  listTimelineForOrder(internalOrderId: string): Promise<OrderNoteTimelineEntry[]>;
}

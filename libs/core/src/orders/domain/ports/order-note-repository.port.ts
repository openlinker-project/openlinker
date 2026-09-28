/**
 * Order Note Repository Port (#3531)
 *
 * @module libs/core/src/orders/domain/ports
 */
import type {
  CreateOrderNoteInput,
  OrderNote,
  OrderNoteTimelineEntry,
  UpdateOrderNoteInput,
} from '../types/order-note.types';

export interface OrderNoteRepositoryPort {
  /** Non-deleted notes for an order, oldest first. */
  findByOrderId(internalOrderId: string): Promise<OrderNote[]>;

  findById(id: string): Promise<OrderNote | null>;

  create(input: CreateOrderNoteInput): Promise<OrderNote>;

  /**
   * Applies an edit: writes a REVISION row capturing the pre-edit text FIRST,
   * then overwrites the note row and stamps `editedAt`. One transaction — a
   * revision without the edit it explains, or an edit with no preserved prior
   * text, would both be a partial write the AC forbids.
   */
  applyEdit(id: string, patch: UpdateOrderNoteInput, editedAt: Date): Promise<OrderNote>;

  /** Soft-delete: blanks `body`, stamps `deletedAt`. The row and its revisions survive. */
  softDelete(id: string, deletedAt: Date): Promise<OrderNote>;

  /**
   * Every note flagged `showToPacker` for a PAGE of order ids — the pack
   * bench's own read. Absent from the map means no packer-visible note for
   * that order.
   */
  findPackerVisibleForOrders(
    internalOrderIds: readonly string[]
  ): Promise<Map<string, OrderNote[]>>;

  /** Timeline entries for one order — creation, each edit, each flag change, deletion. */
  findTimelineForOrder(internalOrderId: string): Promise<OrderNoteTimelineEntry[]>;
}

/**
 * Order Note Service (#3531)
 *
 * @module libs/core/src/orders/application/services
 * @implements {IOrderNoteService}
 */
import { Inject, Injectable } from '@nestjs/common';
import { OrderNoteRepositoryPort } from '../../domain/ports/order-note-repository.port';
import { OrderNoteNotFoundError } from '../../domain/exceptions/order-note-not-found.error';
import { OrderNoteNotAuthoredError } from '../../domain/exceptions/order-note-not-authored.error';
import type {
  OrderNote,
  OrderNoteTimelineEntry,
  UpdateOrderNoteInput,
} from '../../domain/types/order-note.types';
import type { IOrderNoteService } from './order-note.service.interface';
import { ORDER_NOTE_REPOSITORY_TOKEN } from '../../orders.tokens';

@Injectable()
export class OrderNoteService implements IOrderNoteService {
  constructor(
    @Inject(ORDER_NOTE_REPOSITORY_TOKEN)
    private readonly repository: OrderNoteRepositoryPort
  ) {}

  async listForOrder(internalOrderId: string): Promise<OrderNote[]> {
    return this.repository.findByOrderId(internalOrderId);
  }

  async create(
    internalOrderId: string,
    authorUserId: string,
    authorUsername: string,
    body: string,
    showToPacker: boolean
  ): Promise<OrderNote> {
    return this.repository.create({
      internalOrderId,
      authorUserId,
      authorUsername,
      body,
      showToPacker,
    });
  }

  async update(
    noteId: string,
    callerUserId: string,
    _isAdmin: boolean,
    patch: UpdateOrderNoteInput
  ): Promise<OrderNote> {
    // D33 — only the author may EDIT (unlike delete, an admin may not edit
    // someone else's note text on their behalf; the AC names only the two
    // delete actors). `_isAdmin` is carried on the signature only so the
    // interface stays symmetric with `delete`'s — it is intentionally unused
    // here.
    const existing = await this.repository.findById(noteId);
    if (!existing || existing.deletedAt) {
      throw new OrderNoteNotFoundError(noteId);
    }
    if (existing.authorUserId !== callerUserId) {
      throw new OrderNoteNotAuthoredError(noteId);
    }
    return this.repository.applyEdit(noteId, patch, new Date());
  }

  async delete(noteId: string, callerUserId: string, isAdmin: boolean): Promise<void> {
    const existing = await this.repository.findById(noteId);
    if (!existing || existing.deletedAt) {
      throw new OrderNoteNotFoundError(noteId);
    }
    // D33 — the author deletes their own; an admin may delete any.
    if (existing.authorUserId !== callerUserId && !isAdmin) {
      throw new OrderNoteNotAuthoredError(noteId);
    }
    await this.repository.softDelete(noteId, new Date());
  }

  async getPackerVisibleForOrders(
    internalOrderIds: readonly string[]
  ): Promise<Map<string, OrderNote[]>> {
    return this.repository.findPackerVisibleForOrders(internalOrderIds);
  }

  async listTimelineForOrder(internalOrderId: string): Promise<OrderNoteTimelineEntry[]> {
    return this.repository.findTimelineForOrder(internalOrderId);
  }
}

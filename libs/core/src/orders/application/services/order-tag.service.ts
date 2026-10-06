/**
 * Order Tag Service (#3532, D34)
 *
 * @module libs/core/src/orders/application/services
 * @implements {IOrderTagService}
 */
import { Inject, Injectable } from '@nestjs/common';
import { OrderTagRepositoryPort } from '../../domain/ports/order-tag-repository.port';
import { OrderTagLimitReachedError } from '../../domain/exceptions/order-tag-limit-reached.error';
import { OrderTagNotFoundError } from '../../domain/exceptions/order-tag-not-found.error';
import {
  ORDER_TAG_WORKSPACE_LIMIT,
  type BulkAssignOrderTagResult,
  type OrderTag,
  type OrderTagColor,
  type OrderTagWithCount,
} from '../../domain/types/order-tag.types';
import type { IOrderTagService } from './order-tag.service.interface';
import { ORDER_TAG_REPOSITORY_TOKEN } from '../../orders.tokens';

@Injectable()
export class OrderTagService implements IOrderTagService {
  constructor(
    @Inject(ORDER_TAG_REPOSITORY_TOKEN)
    private readonly repository: OrderTagRepositoryPort
  ) {}

  async listAll(): Promise<OrderTagWithCount[]> {
    return this.repository.findAllWithCounts();
  }

  async create(name: string, color: OrderTagColor): Promise<OrderTag> {
    // D34 — refused with a named reason past the workspace limit, checked
    // just before the write. Not perfectly race-free against a concurrent
    // create (no unique constraint enforces the COUNT), but the limit is an
    // operator-facing guideline against vocabulary sprawl, not a security
    // boundary — a rare off-by-one under concurrent creation is an accepted
    // cost for not adding a table-level lock to a rarely-written table.
    const existing = await this.repository.count();
    if (existing >= ORDER_TAG_WORKSPACE_LIMIT) {
      throw new OrderTagLimitReachedError();
    }
    return this.repository.create({ name, color });
  }

  async update(id: string, patch: { name?: string; color?: OrderTagColor }): Promise<OrderTag> {
    const existing = await this.repository.findById(id);
    if (!existing) {
      throw new OrderTagNotFoundError(id);
    }
    return this.repository.update(id, patch);
  }

  async delete(id: string): Promise<void> {
    const existing = await this.repository.findById(id);
    if (!existing) {
      throw new OrderTagNotFoundError(id);
    }
    await this.repository.delete(id);
  }

  async listForOrder(internalOrderId: string): Promise<string[]> {
    return this.repository.findTagIdsForOrder(internalOrderId);
  }

  async getForOrders(internalOrderIds: readonly string[]): Promise<Map<string, string[]>> {
    return this.repository.findTagIdsForOrders(internalOrderIds);
  }

  async assign(tagId: string, internalOrderId: string, assignedByUserId: string): Promise<void> {
    const existing = await this.repository.findById(tagId);
    if (!existing) {
      throw new OrderTagNotFoundError(tagId);
    }
    await this.repository.assign(tagId, internalOrderId, assignedByUserId);
  }

  async unassign(tagId: string, internalOrderId: string): Promise<void> {
    await this.repository.unassign(tagId, internalOrderId);
  }

  async bulkAssign(
    tagId: string,
    internalOrderIds: readonly string[],
    assignedByUserId: string
  ): Promise<BulkAssignOrderTagResult> {
    const existing = await this.repository.findById(tagId);
    if (!existing) {
      throw new OrderTagNotFoundError(tagId);
    }
    return this.repository.bulkAssign(tagId, internalOrderIds, assignedByUserId);
  }
}

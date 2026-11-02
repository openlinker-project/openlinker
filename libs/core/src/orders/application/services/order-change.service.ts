/**
 * Order Change Service (#2333, ADR-044)
 *
 * Owns the one policy the repository cannot: **lazy TTL expiry** of an
 * unanswered proposal. Everything else passes through, because only the caller
 * knows what its remote call did.
 *
 * @module libs/core/src/orders/application/services
 * @implements {IOrderChangeService}
 */
import { Inject, Injectable } from '@nestjs/common';
import { Logger } from '@openlinker/shared/logging';
import type { OrderChange } from '../../domain/entities/order-change.entity';
import { OrderChangeRepositoryPort } from '../../domain/ports/order-change-repository.port';
import {
  OrderAmendmentRequestKindValues,
  OrderChangeKindValues,
  isOrderCorrectionChangeKind,
  type CreateOrderChangeInput,
  type OrderChangeKind,
} from '../../domain/types/order-change.types';
import { resolveOrderChangeOpenTtlMs } from '../../domain/types/order-change-ttl.types';
import { ORDER_CHANGE_REPOSITORY_TOKEN } from '../../orders.tokens';
import type {
  IOrderChangeService,
  OpenOrderChangeResult,
  OrderChangeListItem,
} from './order-change.service.interface';

@Injectable()
export class OrderChangeService implements IOrderChangeService {
  private readonly logger = new Logger(OrderChangeService.name);

  constructor(
    @Inject(ORDER_CHANGE_REPOSITORY_TOKEN)
    private readonly repository: OrderChangeRepositoryPort
  ) {}

  async openOrReuse(input: CreateOrderChangeInput): Promise<OpenOrderChangeResult> {
    const existing = await this.repository.findOpenByTarget(
      input.internalOrderId,
      input.targetRef
    );

    let expiredStale = false;
    if (existing !== null) {
      if (!this.isStale(existing, input.requestedAt)) {
        this.logger.debug(
          `Reusing open order change ${existing.id} (kind: ${existing.kind}, order: ${input.internalOrderId}, target: ${input.targetRef})`
        );
        return { change: existing, opened: false, expiredStale: false };
      }

      // ADR-044's mandated terminal path, applied lazily. `expire` is
      // conditional, so a peer that got here first simply wins and the insert
      // below finds — or loses to — its fresh row.
      expiredStale = await this.repository.expire(existing.id, input.requestedAt);
      this.logger.warn(
        `Expired stale open order change ${existing.id} (kind: ${existing.kind}, order: ${input.internalOrderId}, target: ${input.targetRef}, requestedAt: ${existing.requestedAt.toISOString()})`
      );
    }

    // The repository REPORTS whether it inserted, rather than the caller
    // inferring it from the returned row: only the opener may issue the remote
    // request, and an inference that silently answered "not mine" would stop
    // every request being sent, invisibly.
    const { change, inserted: opened } = await this.repository.insertRequested(input);
    if (!opened) {
      this.logger.debug(
        `Lost the open-change race for order ${input.internalOrderId} target ${input.targetRef}; reusing ${change.id}`
      );
    }

    return { change, opened, expiredStale };
  }

  async confirm(id: string, confirmedBy: string | null): Promise<boolean> {
    return this.repository.confirm(id, new Date(), confirmedBy);
  }

  async decline(id: string, reason: string): Promise<boolean> {
    return this.repository.decline(id, new Date(), reason);
  }

  async abandon(id: string, reason?: string): Promise<boolean> {
    // `expire`, not `decline`: nobody was asked, so there is no authority
    // refusal to record. See the interface docblock.
    return reason === undefined
      ? this.repository.expire(id, new Date())
      : this.repository.expire(id, new Date(), reason);
  }

  async claimApplied(id: string): Promise<boolean> {
    return this.repository.claimApplied(id, new Date());
  }

  async findOpenByOrder(internalOrderId: string): Promise<OrderChange[]> {
    return this.repository.findOpenByOrder(internalOrderId, this.openSince());
  }

  async findOrderIdsWithOpenAmendment(
    internalOrderIds: readonly string[]
  ): Promise<Set<string>> {
    return this.repository.findOrderIdsWithOpenChanges(
      internalOrderIds,
      OrderAmendmentRequestKindValues,
      this.openSince()
    );
  }

  async listOperatorChangesByOrder(internalOrderId: string): Promise<OrderChangeListItem[]> {
    const changes = await this.repository.listByOrder(
      internalOrderId,
      OrderChangeKindValues.filter((kind) => kind.startsWith('order.'))
    );
    const now = new Date();
    return changes.map((change) => ({
      change,
      open: change.isOpen() && !this.isStale(change, now),
    }));
  }

  async findById(id: string): Promise<OrderChange | null> {
    return this.repository.findById(id);
  }

  async findLatestByTarget(
    internalOrderId: string,
    targetRef: string,
    kind: OrderChangeKind
  ): Promise<OrderChange | null> {
    return this.repository.findLatestByTarget(internalOrderId, targetRef, kind);
  }

  private isStale(change: OrderChange, now: Date): boolean {
    // A correction proposal is NOT a request waiting for a channel: nobody was
    // asked, so there is no unanswered question to time out (B-17, #3540). It
    // waits for the operator to confirm or abandon it, however long that takes.
    if (isOrderCorrectionChangeKind(change.kind)) {
      return false;
    }
    return now.getTime() - change.requestedAt.getTime() >= resolveOrderChangeOpenTtlMs();
  }

  /**
   * The instant a row must have been requested AFTER to still count as open.
   * Expiry is lazy (only `openOrReuse` moves a stale row to `expired`), so a read
   * that trusted `status` alone would report a change nobody will ever answer as
   * open for ever.
   */
  private openSince(): Date {
    return new Date(Date.now() - resolveOrderChangeOpenTtlMs());
  }
}

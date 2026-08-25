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
import type {
  CreateOrderChangeInput,
  OrderChangeKind,
} from '../../domain/types/order-change.types';
import { ORDER_CHANGE_REPOSITORY_TOKEN } from '../../orders.tokens';
import type {
  IOrderChangeService,
  OpenOrderChangeResult,
} from './order-change.service.interface';

/**
 * How long an unanswered proposal may hold its target's slot.
 *
 * Clamped rather than trusted, following `OL_WEBHOOK_SKEW_WINDOW_MS`: a zero or
 * negative value would expire every proposal the instant it was opened —
 * turning the double-call guard off silently — and an unbounded one would
 * reinstate the permanent lock ADR-044 requires `EXPIRED` to prevent.
 */
const OPEN_TTL_DEFAULT_MS = 15 * 60 * 1000;
const OPEN_TTL_MIN_MS = 60 * 1000;
const OPEN_TTL_MAX_MS = 24 * 60 * 60 * 1000;

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

  async claimApplied(id: string): Promise<boolean> {
    return this.repository.claimApplied(id, new Date());
  }

  async findLatestByTarget(
    internalOrderId: string,
    targetRef: string,
    kind: OrderChangeKind
  ): Promise<OrderChange | null> {
    return this.repository.findLatestByTarget(internalOrderId, targetRef, kind);
  }

  private isStale(change: OrderChange, now: Date): boolean {
    return now.getTime() - change.requestedAt.getTime() >= this.resolveTtlMs();
  }

  private resolveTtlMs(): number {
    const raw = Number(process.env.OL_ORDER_CHANGE_OPEN_TTL_MS);
    if (!Number.isFinite(raw) || raw <= 0) {
      return OPEN_TTL_DEFAULT_MS;
    }
    return Math.min(Math.max(raw, OPEN_TTL_MIN_MS), OPEN_TTL_MAX_MS);
  }
}

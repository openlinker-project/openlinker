/**
 * Order Refund Relay Service
 *
 * Mirrors a refund a source channel made onto every destination copy of the
 * order that can refund it. Direction rule (ADR-056): channel -> destination
 * only. The source is never asked to move money, and the observed refund
 * record stays the single record of the movement - the destination's own
 * refund is a mirror of it, so nothing is written to `refund_records` here and
 * a destination refund can never be observed back as a second one.
 *
 * Reuses the refund path rather than a parallel one: the destination is asked
 * through the same `RefundExecutor` capability the returns flow uses, under the
 * same per-order refund lock, with a deterministic key derived from the
 * observed one so a re-poll recomputes it and the executor answers from the
 * refund it already made instead of refunding twice. The refund ceiling is not
 * re-evaluated: the observed record already passed (or acknowledged) it, and
 * the destination enforces its own maximum.
 *
 * Amount only. The channel's refund lines are not mapped to the destination's
 * order lines, so the destination refunds money without restocking or naming
 * lines; the note says so.
 *
 * A destination that holds a copy but has no executor (or the executor is
 * switched off for it) is reported at warn with the reason, never skipped
 * silently.
 *
 * @module application/services
 * @implements {IOrderRefundRelayService}
 */
import { Inject, Injectable } from '@nestjs/common';
import { Logger } from '@openlinker/shared/logging';
import {
  INTEGRATIONS_SERVICE_TOKEN,
  type IIntegrationsService,
} from '@openlinker/core/integrations';
import type { OrderProcessorManagerPort } from '../../domain/ports/order-processor-manager.port';
import {
  isRefundExecutor,
  type RefundExecutor,
} from '../../domain/ports/capabilities/refund-executor.capability';
import type { ExecuteRefundCommand } from '../../domain/types/refund-execution.types';
import { ORDER_REFUND_SERVICE_TOKEN } from '../../orders.tokens';
import { IOrderRefundService } from '../interfaces/order-refund.service.interface';
import type {
  IOrderRefundRelayService,
  RefundRelayResult,
  RelayObservedRefundsInput,
} from '../interfaces/order-refund-relay.service.interface';

// Covers the executor's outbound call: the lock is single-shot with no
// heartbeat, so it must outlive the call it protects.
const RELAY_LOCK_TTL_MS = 120_000;

export function buildRelayedRefundIdempotencyKey(
  observedKey: string,
  destinationConnectionId: string
): string {
  return `${observedKey}:to:${destinationConnectionId}`;
}

@Injectable()
export class OrderRefundRelayService implements IOrderRefundRelayService {
  private readonly logger = new Logger(OrderRefundRelayService.name);
  // Warn once per (order, destination); later polls repeat the same fact at debug.
  private readonly warnedUnresolved = new Set<string>();

  constructor(
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrationsService: IIntegrationsService,
    @Inject(ORDER_REFUND_SERVICE_TOKEN)
    private readonly refunds: IOrderRefundService
  ) {}

  async relayObservedRefunds(input: RelayObservedRefundsInput): Promise<RefundRelayResult> {
    const result: RefundRelayResult = {
      relayed: 0,
      unsupportedDestinations: 0,
      denied: 0,
      failed: 0,
    };
    if (input.observations.length === 0) return result;

    // A destination holds a copy only once it synced with an external id.
    const holders = input.destinations.filter(
      (row) =>
        row.status === 'synced' &&
        typeof row.externalOrderId === 'string' &&
        row.externalOrderId.length > 0 &&
        row.destinationConnectionId !== input.sourceConnectionId
    );

    for (const holder of holders) {
      const executor = await this.resolveExecutor(holder.destinationConnectionId, input, result);
      if (executor === null) continue;
      for (const observation of input.observations) {
        await this.relayOne(
          executor,
          holder.destinationConnectionId,
          holder.externalOrderId as string,
          input,
          observation,
          result
        );
      }
    }
    return result;
  }

  private async resolveExecutor(
    destinationConnectionId: string,
    input: RelayObservedRefundsInput,
    result: RefundRelayResult
  ): Promise<RefundExecutor | null> {
    try {
      const adapter = await this.integrationsService.getCapabilityAdapter<OrderProcessorManagerPort>(
        destinationConnectionId,
        'OrderProcessorManager'
      );
      if (isRefundExecutor(adapter)) return adapter;
      result.unsupportedDestinations += 1;
      // Expected for destinations that cannot refund (PrestaShop, WooCommerce) and
      // repeated on every poll, so it is debug, never warn.
      this.logger.debug(
        `Refund observed on order ${input.internalOrderId} was not relayed to destination ` +
          `${destinationConnectionId}: it holds a copy but cannot refund it (no refund capability, ` +
          'or refunding through it is not enabled on the connection).'
      );
    } catch (error) {
      result.unsupportedDestinations += 1;
      const key = `${input.internalOrderId}:${destinationConnectionId}`;
      const message =
        `Refund observed on order ${input.internalOrderId} was not relayed to destination ` +
        `${destinationConnectionId}: its adapter could not be resolved (${errorMessage(error)}).`;
      if (this.warnedUnresolved.has(key)) {
        this.logger.debug(message);
      } else {
        this.warnedUnresolved.add(key);
        this.logger.warn(message);
      }
    }
    return null;
  }

  private async relayOne(
    executor: RefundExecutor,
    destinationConnectionId: string,
    destinationExternalOrderId: string,
    input: RelayObservedRefundsInput,
    observation: RelayObservedRefundsInput['observations'][number],
    result: RefundRelayResult
  ): Promise<void> {
    const command: ExecuteRefundCommand = {
      externalOrderId: destinationExternalOrderId,
      externalReturnId: null,
      amount: observation.amount,
      currency: observation.currency,
      reason: 'other',
      note: `Mirrors refund ${observation.externalRefundId} made on the source channel (amount only, lines not mapped)`,
      idempotencyKey: buildRelayedRefundIdempotencyKey(
        `observed:${input.sourceConnectionId}:${observation.externalRefundId}`,
        destinationConnectionId
      ),
    };
    try {
      const outcome = await this.refunds.runUnderOrderRefundLock(
        input.internalOrderId,
        () => executor.executeRefund(command),
        { lockTtlMs: RELAY_LOCK_TTL_MS }
      );
      if (outcome.outcome === 'denied') {
        result.denied += 1;
        this.logger.warn(
          `Destination ${destinationConnectionId} refused the mirrored refund ` +
            `${observation.externalRefundId} for order ${input.internalOrderId}: ` +
            `${outcome.providerMessage ?? 'no message'}`
        );
        return;
      }
      result.relayed += 1;
    } catch (error) {
      // An indeterminate outcome is retried by the next poll under the same key,
      // which the executor answers from the refund it may already have made.
      result.failed += 1;
      this.logger.warn(
        `Could not relay refund ${observation.externalRefundId} of order ${input.internalOrderId} ` +
          `to destination ${destinationConnectionId}: ${errorMessage(error)}`
      );
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

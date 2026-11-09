/**
 * Payment Writeback Service (#3963)
 *
 * Mirrors a payment that arrived after an order reached a destination shop
 * onto that shop, once per (order, destination), through the lifecycle relay's
 * `paid` event, and records per destination whether it worked.
 *
 * Two halves:
 * - `planAfterSync` runs inside ingestion and only DECIDES: it records the
 *   states that need no send and enqueues one `order.paymentWriteback.push`
 *   job per destination that needs one. It never talks to a shop, so a slow
 *   shop cannot stall ingestion.
 * - `push` runs inside that job: it re-checks the guards against the freshest
 *   record (an order can be cancelled or refunded between the two), claims the
 *   destination, relays `paid` to that one shop, and records the outcome. A
 *   transient failure reports `retrying` so the job runner's ladder backs off;
 *   the last attempt records `not-sent` instead.
 *
 * @module libs/core/src/orders/application/services
 * @implements {IPaymentWritebackService}
 */
import { Inject, Injectable } from '@nestjs/common';
import { readPaymentWritebackConfig } from '@openlinker/core/identifier-mapping';
import { IIntegrationsService, INTEGRATIONS_SERVICE_TOKEN } from '@openlinker/core/integrations';
import { SYNC_JOB_QUEUE_TOKEN, type SyncJobQueuePort } from '@openlinker/core/sync';
import { Logger } from '@openlinker/shared/logging';

import { OrderRecordRepositoryPort } from '../../domain/ports/order-record-repository.port';
import { RefundRecordRepositoryPort } from '../../domain/ports/refund-record-repository.port';
import {
  decidePaymentWriteback,
  isCashOnDeliveryOrder,
  isPaymentWritebackProblem,
  paymentWritebackBlock,
  type PaymentWritebackDestinationInput,
  type PaymentWritebackEntry,
  type PaymentWritebackMode,
} from '../../domain/types/payment-writeback.types';
import {
  ORDER_LIFECYCLE_RELAY_SERVICE_TOKEN,
  ORDER_RECORD_REPOSITORY_TOKEN,
  ORDER_REFUND_RECORD_REPOSITORY_TOKEN,
} from '../../orders.tokens';
import { IOrderLifecycleRelayService } from '../interfaces/order-lifecycle-relay.service.interface';
import type {
  IPaymentWritebackService,
  PlanPaymentWritebackInput,
  PushPaymentWritebackInput,
  PushPaymentWritebackOutcome,
} from '../interfaces/payment-writeback.service.interface';

/** A `sending` claim older than this belongs to a crashed attempt and may be re-claimed. */
const STALE_CLAIM_MS = 15 * 60 * 1000;

export function paymentWritebackDedupeKey(internalOrderId: string, destinationConnectionId: string): string {
  return `payment:${internalOrderId}:${destinationConnectionId}`;
}

@Injectable()
export class PaymentWritebackService implements IPaymentWritebackService {
  private readonly logger = new Logger(PaymentWritebackService.name);

  constructor(
    @Inject(ORDER_RECORD_REPOSITORY_TOKEN)
    private readonly records: OrderRecordRepositoryPort,
    @Inject(ORDER_REFUND_RECORD_REPOSITORY_TOKEN)
    private readonly refunds: RefundRecordRepositoryPort,
    @Inject(ORDER_LIFECYCLE_RELAY_SERVICE_TOKEN)
    private readonly relay: IOrderLifecycleRelayService,
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrations: IIntegrationsService,
    @Inject(SYNC_JOB_QUEUE_TOKEN)
    private readonly jobQueue: SyncJobQueuePort
  ) {}

  async planAfterSync(input: PlanPaymentWritebackInput): Promise<void> {
    try {
      await this.plan(input);
    } catch (error) {
      this.logger.warn(
        `Payment writeback planning failed for order ${input.order.id}: ${this.message(error)}`
      );
    }
  }

  private async plan({ order, existing, sourceConnectionId, results }: PlanPaymentWritebackInput): Promise<void> {
    const createdNow = new Map<string, boolean>();
    for (const result of results) {
      if (result.status === 'success') createdNow.set(result.destinationConnectionId, result.created === true);
    }
    const syncedBefore = new Set(
      (existing?.syncStatus ?? [])
        .filter((row) => row.status === 'synced')
        .map((row) => row.destinationConnectionId)
    );
    const connectionIds = [...new Set([...createdNow.keys(), ...syncedBefore])];
    if (connectionIds.length === 0) return;

    const paid = order.paymentStatus === 'paid';
    const cod = isCashOnDeliveryOrder({
      paymentStatus: order.paymentStatus,
      paymentMethod: order.paymentMethod,
      storedPaymentStatus: existing?.paymentStatus,
      storedPaymentMethod: existing?.paymentMethod ?? undefined,
    });
    // Only a paid, non-COD order can reach a send, so only then is it worth a
    // refund read and a connection-config read per destination.
    const needsSendChecks = paid && !cod;
    const hasRefund = needsSendChecks ? await this.hasRefund(order.id) : false;

    const destinations: PaymentWritebackDestinationInput[] = [];
    for (const connectionId of connectionIds) {
      destinations.push({
        connectionId,
        synced: true,
        createdNow: createdNow.get(connectionId) === true,
        mode: needsSendChecks ? await this.modeFor(connectionId) : 'mark-paid',
      });
    }

    const decisions = decidePaymentWriteback({
      paymentStatus: order.paymentStatus,
      paymentMethod: order.paymentMethod,
      storedPaymentStatus: existing?.paymentStatus,
      storedPaymentMethod: existing?.paymentMethod ?? undefined,
      hadRecord: existing !== null,
      isCancelled: order.status === 'cancelled' || existing?.isCancelled === true,
      hasRefund,
      destinations,
      existing: existing?.paymentWriteback ?? {},
    });

    const now = new Date().toISOString();
    for (const decision of decisions) {
      const prior = existing?.paymentWriteback[decision.connectionId];
      if (decision.action === 'record') {
        await this.records.recordPaymentWriteback(order.id, decision.connectionId, {
          state: decision.state,
          at: now,
          attempts: prior?.attempts ?? 0,
          ...(decision.reason ? { reason: decision.reason } : {}),
        });
        continue;
      }
      // A destination provisioned before #3963 has no entry yet. Stamp it
      // `awaiting` so the job's own re-check sees a waiting shop, not "no record".
      if (prior === undefined) {
        await this.records.recordPaymentWriteback(order.id, decision.connectionId, {
          state: 'awaiting',
          at: now,
          attempts: 0,
        });
      }
      await this.enqueue(order.id, decision.connectionId, sourceConnectionId, paymentWritebackDedupeKey(order.id, decision.connectionId));
    }
  }

  async push(input: PushPaymentWritebackInput): Promise<PushPaymentWritebackOutcome> {
    const { internalOrderId, destinationConnectionId } = input;
    const record = await this.records.findById(internalOrderId);
    if (!record) return 'skipped';

    const entry = record.paymentWriteback[destinationConnectionId];
    if (!entry || !['awaiting', 'retrying', 'sending'].includes(entry.state)) {
      // Settled, or never waiting: nothing to send for this shop.
      return 'skipped';
    }

    const block = paymentWritebackBlock({
      cod: isCashOnDeliveryOrder({ paymentStatus: record.paymentStatus, storedPaymentMethod: record.paymentMethod ?? undefined }),
      isCancelled: record.isCancelled,
      hasRefund: await this.hasRefund(internalOrderId),
      mode: await this.modeFor(destinationConnectionId),
    });
    if (block !== null) {
      await this.record(internalOrderId, destinationConnectionId, entry, block.state, block.reason);
      return 'done';
    }
    if (record.paymentStatus !== 'paid') {
      // The source no longer reports it paid (a reversal between ingestion and
      // this job). Leave it waiting; a later ingestion decides again.
      return 'skipped';
    }

    const totals = record.nativeTotals;
    if (!totals || !Number.isFinite(totals.amount) || totals.amount <= 0 || !totals.currency) {
      // Without a known total the event would tell the shop "0 paid" (Shoper
      // stores that as the paid amount). Stop and show it, never send a guess.
      await this.record(internalOrderId, destinationConnectionId, entry, 'not-sent', 'no-total');
      return 'done';
    }

    const claimed = await this.records.claimPaymentWriteback(
      internalOrderId,
      destinationConnectionId,
      new Date(Date.now() - STALE_CLAIM_MS)
    );
    if (!claimed) return 'skipped';

    const relayed = await this.relay.relay({
      internalOrderId,
      originConnectionId: input.sourceConnectionId,
      onlyConnectionIds: [destinationConnectionId],
      event: {
        type: 'paid',
        amount: totals.amount,
        currency: totals.currency,
        paidOn: await this.connectionName(input.sourceConnectionId),
      },
    });
    const target = relayed.targets.find((t) => t.connectionId === destinationConnectionId);
    const attempts = entry.attempts + 1;

    if (!target) {
      // The shop holds no mapping for this order any more; put it back to
      // waiting rather than claim a send that never happened.
      await this.records.recordPaymentWriteback(internalOrderId, destinationConnectionId, {
        state: 'awaiting',
        at: new Date().toISOString(),
        attempts: entry.attempts,
      });
      return 'skipped';
    }
    if (target.outcome === 'applied') {
      await this.write(internalOrderId, destinationConnectionId, { state: 'paid-in-shop', attempts, detail: target.detail });
      return 'done';
    }
    if (target.outcome === 'unsupported' && target.unsupportedReason !== 'adapter-unresolved') {
      await this.write(internalOrderId, destinationConnectionId, { state: 'not-tracked', attempts, detail: target.detail });
      return 'done';
    }
    const transient =
      (target.outcome === 'unsupported' && target.unsupportedReason === 'adapter-unresolved') ||
      (target.outcome === 'rejected' && target.adapterThrew === true);
    if (transient && !input.isLastAttempt) {
      await this.write(internalOrderId, destinationConnectionId, { state: 'retrying', attempts, detail: target.detail });
      return 'retrying';
    }
    await this.write(internalOrderId, destinationConnectionId, {
      state: 'not-sent',
      reason: transient ? 'retries-exhausted' : 'rejected',
      attempts,
      detail: target.detail,
    });
    return 'done';
  }

  async retry(internalOrderIds: readonly string[]): Promise<number> {
    const records = await this.records.findByIds([...internalOrderIds]);
    let enqueued = 0;
    const stamp = Date.now();
    for (const record of records) {
      for (const [connectionId, entry] of Object.entries(record.paymentWriteback)) {
        if (!isPaymentWritebackProblem(entry) && entry.state !== 'retrying') continue;
        // Mark it retrying before the enqueue (the job skips an entry that is not
        // waiting), and put the previous entry back if the enqueue fails, so a
        // row never says "retrying" with no job behind it. One failure must not
        // stop the rest of a bulk retry.
        await this.records.recordPaymentWriteback(record.internalOrderId, connectionId, {
          state: 'retrying',
          at: new Date().toISOString(),
          attempts: entry.attempts,
        });
        try {
          await this.enqueue(
            record.internalOrderId,
            connectionId,
            record.sourceConnectionId,
            `${paymentWritebackDedupeKey(record.internalOrderId, connectionId)}:manual:${stamp}`
          );
        } catch (error) {
          this.logger.warn(
            `Payment writeback retry not queued for order ${record.internalOrderId} / shop ${connectionId}: ` +
              this.message(error)
          );
          await this.records.recordPaymentWriteback(record.internalOrderId, connectionId, entry);
          continue;
        }
        enqueued += 1;
      }
    }
    return enqueued;
  }

  async markHandled(internalOrderIds: readonly string[]): Promise<number> {
    return this.records.markPaymentWritebackHandled(internalOrderIds);
  }

  private async enqueue(
    internalOrderId: string,
    destinationConnectionId: string,
    sourceConnectionId: string,
    dedupeKey: string
  ): Promise<void> {
    await this.jobQueue.enqueue({
      type: 'order.paymentWriteback.push',
      connectionId: destinationConnectionId,
      payload: { schemaVersion: 1, internalOrderId, sourceConnectionId },
      options: { dedupeKey },
    });
  }

  private async record(
    internalOrderId: string,
    destinationConnectionId: string,
    prior: PaymentWritebackEntry,
    state: PaymentWritebackEntry['state'],
    reason: PaymentWritebackEntry['reason']
  ): Promise<void> {
    await this.write(internalOrderId, destinationConnectionId, {
      state,
      attempts: prior.attempts,
      ...(reason ? { reason } : {}),
    });
  }

  private async write(
    internalOrderId: string,
    destinationConnectionId: string,
    entry: Omit<PaymentWritebackEntry, 'at'>
  ): Promise<void> {
    await this.records.recordPaymentWriteback(internalOrderId, destinationConnectionId, {
      ...entry,
      at: new Date().toISOString(),
      ...(entry.detail ? { detail: entry.detail.slice(0, 500) } : {}),
    });
  }

  private async hasRefund(internalOrderId: string): Promise<boolean> {
    return (await this.refunds.findByOrderId(internalOrderId)).length > 0;
  }

  private async modeFor(connectionId: string): Promise<PaymentWritebackMode> {
    try {
      const { connection } = await this.integrations.getAdapter(connectionId);
      return readPaymentWritebackConfig(connection.config).mode;
    } catch (error) {
      // A connection we cannot read keeps the default; the send itself will
      // surface a real failure through the relay.
      this.logger.warn(`Payment writeback: could not read config of ${connectionId}: ${this.message(error)}`);
      return 'mark-paid';
    }
  }

  private async connectionName(connectionId: string): Promise<string> {
    try {
      const { connection } = await this.integrations.getAdapter(connectionId);
      return connection.name;
    } catch {
      return 'the marketplace';
    }
  }

  private message(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}

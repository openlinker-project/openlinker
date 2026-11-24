/**
 * Payment Writeback Service interface (#3963)
 *
 * Mirrors a payment that arrived after an order reached a destination shop
 * onto that shop, once per (order, destination), and records per destination
 * whether it worked. See `payment-writeback.types.ts` for the rule and the
 * record, and the implementation for the send path.
 *
 * @module libs/core/src/orders/application/interfaces
 */
import type { Order } from '../../domain/types/order.types';
import type { OrderRecord } from '../../domain/entities/order-record.entity';
import type { OrderSyncResult } from './order-sync.service.interface';

export interface PlanPaymentWritebackInput {
  /** The order as ingested in this run. */
  order: Order;
  /** The record as it stood BEFORE this ingestion persisted the new snapshot. */
  existing: OrderRecord | null;
  sourceConnectionId: string;
  /** This run's per-destination sync results. */
  results: readonly OrderSyncResult[];
}

export interface PushPaymentWritebackInput {
  internalOrderId: string;
  destinationConnectionId: string;
  sourceConnectionId: string;
  /** This is the last attempt the job runner will make. */
  isLastAttempt: boolean;
}

/** `retrying` tells the job handler to throw so the runner backs off and tries again. */
export type PushPaymentWritebackOutcome = 'done' | 'retrying' | 'skipped';

export interface IPaymentWritebackService {
  /**
   * Called by ingestion after the destination sync settled. Records what needs
   * no send (awaiting, created paid, cash on delivery, cancelled, refunded,
   * left to the operator) and enqueues one writeback job per destination that
   * holds the order unpaid while it is now paid. Never throws: the payment
   * mirror is best-effort and must not fail an ingestion.
   */
  planAfterSync(input: PlanPaymentWritebackInput): Promise<void>;

  /** One send attempt for one destination, run by the writeback job. */
  push(input: PushPaymentWritebackInput): Promise<PushPaymentWritebackOutcome>;

  /**
   * Re-open problem and retrying entries on these orders and enqueue a fresh
   * send for each. Returns how many sends were enqueued.
   */
  retry(internalOrderIds: readonly string[]): Promise<number>;

  /** Operator dealt with it in the shop. Returns how many orders changed. */
  markHandled(internalOrderIds: readonly string[]): Promise<number>;
}

/**
 * Amazon Refunding Order Source Adapters (#4184)
 *
 * The Amazon `OrderSource` of a connection that opted in to refunds
 * (`refundsEnabled`): everything the plain or the queued (#4179) adapter does,
 * plus `RefundExecutor`, delegated to `AmazonRefundExecutor`. Separate classes
 * rather than a flag, because core finds a refund executor by the presence of
 * `executeRefund` and a queue reader by `receiveInboundMessages`; a connection
 * without the opt-in or without a queue must have neither. The two optional
 * capabilities make four classes; the refund half is shared through
 * `AmazonRefundSlot`.
 *
 * @module libs/integrations/amazon/src/infrastructure/adapters/order-source
 * @implements {RefundExecutor}
 */
import type { ExecuteRefundCommand, RefundExecutionResult, RefundExecutor } from '@openlinker/core/orders';

import type { AmazonOrder } from '../../../domain/types/amazon-order.types';
import type { AmazonRefundExecutor } from '../returns/amazon-refund-executor';
import { AmazonOrderSourceAdapter } from './amazon-order-source.adapter';
import { AmazonQueuedOrderSourceAdapter } from './amazon-queued-order-source.adapter';

export type AmazonOrderReader = (orderId: string) => Promise<AmazonOrder>;

/** Holds the executor the factory attaches; the same for both refunding classes. */
class AmazonRefundSlot {
  private executor?: AmazonRefundExecutor;

  attach(executor: AmazonRefundExecutor): void {
    this.executor = executor;
  }

  executeRefund(command: ExecuteRefundCommand): Promise<RefundExecutionResult> {
    if (this.executor === undefined) {
      // Thrown before anything reached Amazon; core treats a throw as unknown,
      // which is the safe reading for a wiring fault.
      return Promise.reject(new Error('Amazon refund executor is not attached'));
    }
    return this.executor.executeRefund(command);
  }
}

export class AmazonRefundingOrderSourceAdapter extends AmazonOrderSourceAdapter implements RefundExecutor {
  private readonly refunds = new AmazonRefundSlot();

  /** Set once by the factory, which builds the executor around this adapter's order read. */
  attachRefundExecutor(build: (readOrder: AmazonOrderReader) => AmazonRefundExecutor): this {
    this.refunds.attach(build((orderId) => this.readOrder(orderId)));
    return this;
  }

  executeRefund(command: ExecuteRefundCommand): Promise<RefundExecutionResult> {
    return this.refunds.executeRefund(command);
  }
}

export class AmazonQueuedRefundingOrderSourceAdapter extends AmazonQueuedOrderSourceAdapter implements RefundExecutor {
  private readonly refunds = new AmazonRefundSlot();

  /** Set once by the factory, which builds the executor around this adapter's order read. */
  attachRefundExecutor(build: (readOrder: AmazonOrderReader) => AmazonRefundExecutor): this {
    this.refunds.attach(build((orderId) => this.readOrder(orderId)));
    return this;
  }

  executeRefund(command: ExecuteRefundCommand): Promise<RefundExecutionResult> {
    return this.refunds.executeRefund(command);
  }
}

/**
 * Order Refund Service
 *
 * Thin delegation to `RefundRecordRepositoryPort` (#2036), plus the one piece
 * of business logic that belongs above the repository: rejecting a refund
 * whose currency doesn't match an order's prior refunds, since
 * `RefundSummary.totalAmount` sums across every refund for an order assuming
 * a single shared currency. Validation that an order *exists* stays at the
 * controller layer (mirroring `InvoicingController.issueInvoice`), since that
 * check needs `IOrderRecordService`, not this repository.
 *
 * @module application/services
 * @implements {IOrderRefundService}
 */
import { Inject, Injectable } from '@nestjs/common';
import { SYNC_LOCK_TOKEN, type SyncLockPort } from '@openlinker/core/sync';
import { Logger } from '@openlinker/shared/logging';

import type { RefundRecord } from '../../domain/entities/refund-record.entity';
import { decideRefundCeiling } from '../../domain/domain-services/refund-ceiling.domain-service';
import { RefundRecordContendedException } from '../../domain/exceptions/refund-record-contended.exception';
import { RefundCurrencyMismatchException } from '../../domain/exceptions/refund-currency-mismatch.exception';
import { RefundRecordRepositoryPort } from '../../domain/ports/refund-record-repository.port';
import {
  assertRefundAmountPrecision,
  describeRefundCeilingVerdict,
  evaluateRefundCeiling,
  REFUND_CEILING_ACKNOWLEDGED_LOG_TOKEN,
  REFUND_CEILING_UNKNOWN_LOG_TOKEN,
} from '../../domain/types/refund-ceiling.types';
import type { CreateRefundRecordInput, RefundSummary } from '../../domain/types/refund-record.types';
import { IOrderRecordService } from '../interfaces/order-record.service.interface';
import type {
  IOrderRefundService,
  RecordRefundOptions,
} from '../interfaces/order-refund.service.interface';
import { ORDER_REFUND_LOCK_TTL_MS, orderRefundLockKey } from './order-refund-lock';
import {
  ORDER_RECORD_SERVICE_TOKEN,
  ORDER_REFUND_RECORD_REPOSITORY_TOKEN,
} from '../../orders.tokens';

@Injectable()
export class OrderRefundService implements IOrderRefundService {
  private readonly logger = new Logger(OrderRefundService.name);

  constructor(
    @Inject(ORDER_REFUND_RECORD_REPOSITORY_TOKEN)
    private readonly refundRepository: RefundRecordRepositoryPort,
    @Inject(ORDER_RECORD_SERVICE_TOKEN)
    private readonly orderRecords: IOrderRecordService,
    @Inject(SYNC_LOCK_TOKEN)
    private readonly lock: SyncLockPort,
  ) {}

  async recordRefund(
    rawInput: CreateRefundRecordInput,
    options?: RecordRefundOptions
  ): Promise<RefundRecord> {
    // One spelling per currency in the table (R-17): the ceiling sums refunds
    // by currency, and "pln" next to "PLN" would read as a second currency.
    const input: CreateRefundRecordInput = {
      ...rawInput,
      currency: rawInput.currency.trim().toUpperCase(),
    };
    assertRefundAmountPrecision(input.amount, input.currency);
    if (options?.orderLockHeld === true) {
      return this.recordRefundLocked(input);
    }
    return this.runUnderOrderRefundLock(input.internalOrderId, () =>
      this.recordRefundLocked(input)
    );
  }

  async runUnderOrderRefundLock<T>(
    internalOrderId: string,
    work: () => Promise<T>
  ): Promise<T> {
    // The ceiling is a read-then-write, so it is serialized per order (#3289,
    // the #2047 invoice-issue-lock reasoning): unlocked, two concurrent writes
    // both read the old refunded sum and both pass.
    const lockKey = orderRefundLockKey(internalOrderId);
    const token = await this.lock.acquire(lockKey, ORDER_REFUND_LOCK_TTL_MS);
    if (token === null) {
      throw new RefundRecordContendedException(internalOrderId);
    }
    try {
      return await work();
    } finally {
      await this.lock.release(lockKey, token);
    }
  }

  private async recordRefundLocked(input: CreateRefundRecordInput): Promise<RefundRecord> {
    const existing = await this.refundRepository.findByOrderId(input.internalOrderId);
    const existingCurrency = existing[0]?.currency;
    // Normalised like the ceiling predicate (B-3): "pln" and "PLN" are one currency.
    if (
      existingCurrency &&
      existingCurrency.trim().toUpperCase() !== input.currency.trim().toUpperCase()
    ) {
      throw new RefundCurrencyMismatchException(
        input.internalOrderId,
        existingCurrency,
        input.currency
      );
    }

    await this.enforceRefundCeiling(input);

    const refund = await this.refundRepository.create(input);
    this.logger.log(
      `Recorded refund ${refund.id} for order ${input.internalOrderId}: ` +
        `${input.amount} ${input.currency} (${input.reason})`
    );
    return refund;
  }

  /**
   * Enforcement point B (#3289): defence in depth behind the returns
   * pre-flight, and the only guard on the direct `POST /orders/:id/refunds`
   * route. Reads the SAME predicate the returns path does. See
   * `refund-ceiling.types.ts` for the `in_doubt` gap this cannot see.
   */
  private async enforceRefundCeiling(input: CreateRefundRecordInput): Promise<void> {
    const [order, summaries] = await Promise.all([
      this.orderRecords.getOrderRecord(input.internalOrderId),
      this.refundRepository.summarizeByOrderIds([input.internalOrderId]),
    ]);
    const verdict = evaluateRefundCeiling({
      context: {
        order:
          order === null
            ? null
            : {
                totalAmount: order.totalAmount,
                currency: order.currency,
                taxTreatment: order.taxTreatment,
                totalTaxTreatment: order.totalTaxTreatment,
              },
        alreadyRefunded: summaries.get(input.internalOrderId) ?? null,
      },
      requestedAmount: input.amount,
      requestedCurrency: input.currency,
    });
    const disposition = decideRefundCeiling(
      input.internalOrderId,
      verdict,
      input.acknowledgeAboveCeiling
    );
    const facts = describeRefundCeilingVerdict(input.internalOrderId, verdict);
    if (disposition === 'acknowledged') {
      this.logger.warn(`${REFUND_CEILING_ACKNOWLEDGED_LOG_TOKEN}: ${facts}`);
    } else if (disposition === 'unknown') {
      this.logger.warn(`${REFUND_CEILING_UNKNOWN_LOG_TOKEN}: ${facts} - proceeding unchecked`);
    }
  }

  async getRefundsForOrder(internalOrderId: string): Promise<RefundRecord[]> {
    return this.refundRepository.findByOrderId(internalOrderId);
  }

  async getRefundsForReturn(returnId: string): Promise<RefundRecord[]> {
    return this.refundRepository.findByReturnId(returnId);
  }

  async getRefundSummariesForOrders(
    internalOrderIds: string[],
  ): Promise<Map<string, RefundSummary>> {
    return this.refundRepository.summarizeByOrderIds(internalOrderIds);
  }
}

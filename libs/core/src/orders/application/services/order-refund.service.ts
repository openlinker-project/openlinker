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
import { Logger } from '@openlinker/shared/logging';

import type { RefundRecord } from '../../domain/entities/refund-record.entity';
import { decideRefundCeiling } from '../../domain/domain-services/refund-ceiling.domain-service';
import { RefundCurrencyMismatchException } from '../../domain/exceptions/refund-currency-mismatch.exception';
import { RefundRecordRepositoryPort } from '../../domain/ports/refund-record-repository.port';
import {
  describeRefundCeilingVerdict,
  evaluateRefundCeiling,
  REFUND_CEILING_ACKNOWLEDGED_LOG_TOKEN,
  REFUND_CEILING_UNKNOWN_LOG_TOKEN,
} from '../../domain/types/refund-ceiling.types';
import type { CreateRefundRecordInput, RefundSummary } from '../../domain/types/refund-record.types';
import { IOrderRecordService } from '../interfaces/order-record.service.interface';
import type { IOrderRefundService } from '../interfaces/order-refund.service.interface';
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
  ) {}

  async recordRefund(input: CreateRefundRecordInput): Promise<RefundRecord> {
    const existing = await this.refundRepository.findByOrderId(input.internalOrderId);
    const existingCurrency = existing[0]?.currency;
    if (existingCurrency && existingCurrency !== input.currency) {
      throw new RefundCurrencyMismatchException(
        input.internalOrderId,
        existingCurrency,
        input.currency,
      );
    }

    await this.enforceRefundCeiling(input);

    const refund = await this.refundRepository.create(input);
    this.logger.log(
      `Recorded refund ${refund.id} for order ${input.internalOrderId}: ` +
        `${input.amount} ${input.currency} (${input.reason})`,
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

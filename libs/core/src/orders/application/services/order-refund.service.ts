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
import { RefundCurrencyMismatchException } from '../../domain/exceptions/refund-currency-mismatch.exception';
import { RefundRecordRepositoryPort } from '../../domain/ports/refund-record-repository.port';
import type { CreateRefundRecordInput, RefundSummary } from '../../domain/types/refund-record.types';
import type { IOrderRefundService } from '../interfaces/order-refund.service.interface';
import { ORDER_REFUND_RECORD_REPOSITORY_TOKEN } from '../../orders.tokens';

@Injectable()
export class OrderRefundService implements IOrderRefundService {
  private readonly logger = new Logger(OrderRefundService.name);

  constructor(
    @Inject(ORDER_REFUND_RECORD_REPOSITORY_TOKEN)
    private readonly refundRepository: RefundRecordRepositoryPort,
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

    const refund = await this.refundRepository.create(input);
    this.logger.log(
      `Recorded refund ${refund.id} for order ${input.internalOrderId}: ` +
        `${input.amount} ${input.currency} (${input.reason})`,
    );
    return refund;
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

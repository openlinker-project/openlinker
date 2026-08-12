/**
 * Order Refund Service
 *
 * Thin delegation to `RefundRecordRepositoryPort` (#2036). No business logic
 * beyond straight delegation is needed for v1 — this is a capture, not a
 * processing, primitive; validation that an order exists lives at the
 * controller layer (mirroring `InvoicingController.issueInvoice`), not here.
 *
 * @module application/services
 * @implements {IOrderRefundService}
 */
import { Inject, Injectable } from '@nestjs/common';

import type { RefundRecord } from '../../domain/entities/refund-record.entity';
import { RefundRecordRepositoryPort } from '../../domain/ports/refund-record-repository.port';
import type { CreateRefundRecordInput, RefundSummary } from '../../domain/types/refund-record.types';
import type { IOrderRefundService } from '../interfaces/order-refund.service.interface';
import { ORDER_REFUND_RECORD_REPOSITORY_TOKEN } from '../../orders.tokens';

@Injectable()
export class OrderRefundService implements IOrderRefundService {
  constructor(
    @Inject(ORDER_REFUND_RECORD_REPOSITORY_TOKEN)
    private readonly refundRepository: RefundRecordRepositoryPort,
  ) {}

  async recordRefund(input: CreateRefundRecordInput): Promise<RefundRecord> {
    return this.refundRepository.create(input);
  }

  async getRefundsForOrder(internalOrderId: string): Promise<RefundRecord[]> {
    return this.refundRepository.findByOrderId(internalOrderId);
  }

  async getRefundSummariesForOrders(
    internalOrderIds: string[],
  ): Promise<Map<string, RefundSummary>> {
    return this.refundRepository.summarizeByOrderIds(internalOrderIds);
  }
}

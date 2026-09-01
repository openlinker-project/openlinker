import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import type { IOrderRefundService, IOrderRecordService, OrderRecord, RefundRecord } from '@openlinker/core/orders';
import {
  DuplicateRefundRecordException,
  RefundCurrencyMismatchException,
  ORDER_REFUND_SERVICE_TOKEN,
  ORDER_RECORD_SERVICE_TOKEN,
} from '@openlinker/core/orders';
import { RefundsController } from './refunds.controller';
import type { RecordRefundRequestDto } from './dto/record-refund-request.dto';

describe('RefundsController', () => {
  let controller: RefundsController;
  let refundService: jest.Mocked<IOrderRefundService>;
  let orderRecordService: jest.Mocked<IOrderRecordService>;

  const sampleRefund: RefundRecord = {
    id: 'a1b2c3d4-0000-0000-0000-000000000000',
    internalOrderId: 'ol_order_abc123',
    amount: '49.99',
    currency: 'PLN',
    reason: 'withdrawal',
    note: null,
    recordedAt: new Date('2026-01-15T10:00:00Z'),
    createdAt: new Date('2026-01-15T10:00:00Z'),
    updatedAt: new Date('2026-01-15T10:00:00Z'),
  } as RefundRecord;

  beforeEach(async () => {
    const mockRefundService: jest.Mocked<IOrderRefundService> = {
      recordRefund: jest.fn(),
      getRefundsForOrder: jest.fn(),
      getRefundsForReturn: jest.fn(),
      getRefundSummariesForOrders: jest.fn(),
    };
    const mockOrderRecordService: jest.Mocked<IOrderRecordService> = {
      persistOrder: jest.fn(),
      updateSyncStatus: jest.fn(),
      persistIncomingSnapshot: jest.fn(),
      getOrderRecord: jest.fn(),
      findMany: jest.fn(),
      findByIds: jest.fn(),
      updateFulfillmentState: jest.fn(),
      markCancelled: jest.fn(),
      markSalesDocumentBlock: jest.fn(),
      markFulfillmentBlock: jest.fn(),
      getEarliestOrderDateByConnection: jest.fn(),
      markItemResolutionFailure: jest.fn(),
      getFailedSyncValueSummary: jest.fn(),
      markPacked: jest.fn(),
      clearPacked: jest.fn(),
      recordAmendment: jest.fn(),
      getSalesAndChannelAnalytics: jest.fn(),
      getTopProducts: jest.fn(),
      findDispatchDeadlineCandidates: jest.fn(),
      countOrdersWithOmsAttention: jest.fn(),
      discoverSalesDocumentMarkets: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [RefundsController],
      providers: [
        { provide: ORDER_REFUND_SERVICE_TOKEN, useValue: mockRefundService },
        { provide: ORDER_RECORD_SERVICE_TOKEN, useValue: mockOrderRecordService },
      ],
    }).compile();

    controller = module.get<RefundsController>(RefundsController);
    refundService = module.get(ORDER_REFUND_SERVICE_TOKEN);
    orderRecordService = module.get(ORDER_RECORD_SERVICE_TOKEN);
  });

  describe('recordRefund', () => {
    const dto: RecordRefundRequestDto = {
      amount: '49.99',
      currency: 'PLN',
      reason: 'withdrawal',
    };

    it('should throw NotFoundException when the order does not exist', async () => {
      orderRecordService.getOrderRecord.mockResolvedValue(null);

      await expect(controller.recordRefund('ol_order_missing', dto)).rejects.toThrow(
        NotFoundException,
      );
      expect(refundService.recordRefund).not.toHaveBeenCalled();
    });

    it('should record the refund and return its DTO projection when the order exists', async () => {
      orderRecordService.getOrderRecord.mockResolvedValue({} as OrderRecord);
      refundService.recordRefund.mockResolvedValue(sampleRefund);

      const result = await controller.recordRefund('ol_order_abc123', dto);

      expect(refundService.recordRefund).toHaveBeenCalledWith(
        expect.objectContaining({
          internalOrderId: 'ol_order_abc123',
          amount: '49.99',
          currency: 'PLN',
          reason: 'withdrawal',
          note: null,
        }),
      );
      expect(result.id).toBe(sampleRefund.id);
      expect(result.amount).toBe('49.99');
    });

    it('should default recordedAt to now when the DTO omits it', async () => {
      orderRecordService.getOrderRecord.mockResolvedValue({} as OrderRecord);
      refundService.recordRefund.mockResolvedValue(sampleRefund);

      await controller.recordRefund('ol_order_abc123', dto);

      const passedInput = refundService.recordRefund.mock.calls[0][0];
      expect(passedInput.recordedAt).toBeInstanceOf(Date);
    });

    it('should pass idempotencyKey through, defaulting to null when omitted', async () => {
      orderRecordService.getOrderRecord.mockResolvedValue({} as OrderRecord);
      refundService.recordRefund.mockResolvedValue(sampleRefund);

      await controller.recordRefund('ol_order_abc123', { ...dto, idempotencyKey: 'retry-1' });

      expect(refundService.recordRefund).toHaveBeenCalledWith(
        expect.objectContaining({ idempotencyKey: 'retry-1' }),
      );

      await controller.recordRefund('ol_order_abc123', dto);

      expect(refundService.recordRefund).toHaveBeenLastCalledWith(
        expect.objectContaining({ idempotencyKey: null }),
      );
    });

    it('should map DuplicateRefundRecordException to 409 Conflict', async () => {
      orderRecordService.getOrderRecord.mockResolvedValue({} as OrderRecord);
      refundService.recordRefund.mockRejectedValue(
        new DuplicateRefundRecordException('ol_order_abc123', 'retry-1'),
      );

      await expect(controller.recordRefund('ol_order_abc123', dto)).rejects.toThrow(
        ConflictException,
      );
    });

    it('should map RefundCurrencyMismatchException to 409 Conflict', async () => {
      orderRecordService.getOrderRecord.mockResolvedValue({} as OrderRecord);
      refundService.recordRefund.mockRejectedValue(
        new RefundCurrencyMismatchException('ol_order_abc123', 'PLN', 'EUR'),
      );

      await expect(controller.recordRefund('ol_order_abc123', dto)).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('listRefunds', () => {
    it('should map the service result to response DTOs', async () => {
      refundService.getRefundsForOrder.mockResolvedValue([sampleRefund]);

      const result = await controller.listRefunds('ol_order_abc123');

      expect(refundService.getRefundsForOrder).toHaveBeenCalledWith('ol_order_abc123');
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(sampleRefund.id);
    });

    it('should return an empty array for an order with no refunds', async () => {
      refundService.getRefundsForOrder.mockResolvedValue([]);

      const result = await controller.listRefunds('ol_order_no_refunds');

      expect(result).toEqual([]);
    });
  });
});

import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';

import { RefundRecord } from '../../domain/entities/refund-record.entity';
import { RefundCurrencyMismatchException } from '../../domain/exceptions/refund-currency-mismatch.exception';
import type { RefundRecordRepositoryPort } from '../../domain/ports/refund-record-repository.port';
import type { CreateRefundRecordInput } from '../../domain/types/refund-record.types';
import { ORDER_REFUND_RECORD_REPOSITORY_TOKEN } from '../../orders.tokens';
import { OrderRefundService } from './order-refund.service';

describe('OrderRefundService', () => {
  let service: OrderRefundService;
  let refundRepository: jest.Mocked<RefundRecordRepositoryPort>;

  const sampleRefund = new RefundRecord(
    'a1b2c3d4-0000-0000-0000-000000000000',
    'ol_order_abc123',
    '49.99',
    'PLN',
    'withdrawal',
    null,
    new Date('2026-01-15T10:00:00Z'),
    new Date('2026-01-15T10:00:00Z'),
    new Date('2026-01-15T10:00:00Z'),
  );

  beforeEach(async () => {
    const mockRefundRepository: jest.Mocked<RefundRecordRepositoryPort> = {
      create: jest.fn(),
      findByOrderId: jest.fn(),
      findByReturnId: jest.fn(),
      summarizeByOrderIds: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrderRefundService,
        {
          provide: ORDER_REFUND_RECORD_REPOSITORY_TOKEN,
          useValue: mockRefundRepository,
        },
      ],
    }).compile();

    service = module.get<OrderRefundService>(OrderRefundService);
    refundRepository = module.get(ORDER_REFUND_RECORD_REPOSITORY_TOKEN);
  });

  describe('recordRefund', () => {
    it('should delegate to the repository create method when no prior refund exists', async () => {
      const input: CreateRefundRecordInput = {
        internalOrderId: 'ol_order_abc123',
        amount: '49.99',
        currency: 'PLN',
        reason: 'withdrawal',
        note: null,
        recordedAt: new Date('2026-01-15T10:00:00Z'),
      };
      refundRepository.findByOrderId.mockResolvedValue([]);
      refundRepository.create.mockResolvedValue(sampleRefund);

      const result = await service.recordRefund(input);

      expect(refundRepository.create).toHaveBeenCalledWith(input);
      expect(result).toBe(sampleRefund);
    });

    it('should delegate to create when the currency matches a prior refund on the order', async () => {
      const input: CreateRefundRecordInput = {
        internalOrderId: 'ol_order_abc123',
        amount: '10.00',
        currency: 'PLN',
        reason: 'defective',
        note: null,
        recordedAt: new Date('2026-01-15T10:00:00Z'),
      };
      refundRepository.findByOrderId.mockResolvedValue([sampleRefund]); // sampleRefund.currency === 'PLN'
      refundRepository.create.mockResolvedValue(sampleRefund);

      await service.recordRefund(input);

      expect(refundRepository.create).toHaveBeenCalledWith(input);
    });

    it('should reject with RefundCurrencyMismatchException when the currency differs from a prior refund', async () => {
      const input: CreateRefundRecordInput = {
        internalOrderId: 'ol_order_abc123',
        amount: '10.00',
        currency: 'EUR',
        reason: 'defective',
        note: null,
        recordedAt: new Date('2026-01-15T10:00:00Z'),
      };
      refundRepository.findByOrderId.mockResolvedValue([sampleRefund]); // sampleRefund.currency === 'PLN'

      await expect(service.recordRefund(input)).rejects.toBeInstanceOf(
        RefundCurrencyMismatchException,
      );
      expect(refundRepository.create).not.toHaveBeenCalled();
    });
  });

  describe('getRefundsForOrder', () => {
    it('should delegate to the repository findByOrderId method', async () => {
      refundRepository.findByOrderId.mockResolvedValue([sampleRefund]);

      const result = await service.getRefundsForOrder('ol_order_abc123');

      expect(refundRepository.findByOrderId).toHaveBeenCalledWith('ol_order_abc123');
      expect(result).toEqual([sampleRefund]);
    });
  });

  describe('getRefundSummariesForOrders', () => {
    it('should delegate to the repository summarizeByOrderIds method', async () => {
      const summaryMap = new Map([
        ['ol_order_abc123', { count: 1, totalAmount: '49.99', currency: 'PLN' }],
      ]);
      refundRepository.summarizeByOrderIds.mockResolvedValue(summaryMap);

      const result = await service.getRefundSummariesForOrders(['ol_order_abc123']);

      expect(refundRepository.summarizeByOrderIds).toHaveBeenCalledWith(['ol_order_abc123']);
      expect(result).toBe(summaryMap);
    });
  });
});

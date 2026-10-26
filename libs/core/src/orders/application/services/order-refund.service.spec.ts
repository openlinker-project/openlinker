import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';

import { RefundRecord } from '../../domain/entities/refund-record.entity';
import { RefundCurrencyMismatchException } from '../../domain/exceptions/refund-currency-mismatch.exception';
import type { RefundRecordRepositoryPort } from '../../domain/ports/refund-record-repository.port';
import type { CreateRefundRecordInput } from '../../domain/types/refund-record.types';
import {
  ORDER_RECORD_SERVICE_TOKEN,
  ORDER_REFUND_RECORD_REPOSITORY_TOKEN,
} from '../../orders.tokens';
import { SYNC_LOCK_TOKEN } from '@openlinker/core/sync';
import { RefundRecordContendedException } from '../../domain/exceptions/refund-record-contended.exception';
import { RefundCeilingExceededException } from '../../domain/exceptions/refund-ceiling-exceeded.exception';
import type { IOrderRecordService } from '../interfaces/order-record.service.interface';
import { OrderRefundService } from './order-refund.service';

describe('OrderRefundService', () => {
  let service: OrderRefundService;
  let refundRepository: jest.Mocked<RefundRecordRepositoryPort>;
  let orderRecords: { getOrderRecord: jest.Mock };
  let lock: { acquire: jest.Mock; release: jest.Mock };

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

    lock = { acquire: jest.fn().mockResolvedValue('tok'), release: jest.fn().mockResolvedValue(undefined) };
    orderRecords = { getOrderRecord: jest.fn().mockResolvedValue(null) };
    mockRefundRepository.summarizeByOrderIds.mockResolvedValue(new Map());

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrderRefundService,
        {
          provide: ORDER_REFUND_RECORD_REPOSITORY_TOKEN,
          useValue: mockRefundRepository,
        },
        { provide: SYNC_LOCK_TOKEN, useValue: lock },
        {
          provide: ORDER_RECORD_SERVICE_TOKEN,
          useValue: orderRecords as unknown as IOrderRecordService,
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

  describe('recordRefund - refund ceiling (#3289)', () => {
    const input: CreateRefundRecordInput = {
      internalOrderId: 'ol_order_abc123',
      amount: '60.00',
      currency: 'PLN',
      reason: 'withdrawal',
      note: null,
      recordedAt: new Date('2026-01-15T10:00:00Z'),
    };

    beforeEach(() => {
      orderRecords.getOrderRecord.mockResolvedValue({
        totalAmount: 100,
        currency: 'PLN',
        taxTreatment: null,
        totalTaxTreatment: null,
      });
      refundRepository.findByOrderId.mockResolvedValue([]);
      refundRepository.create.mockResolvedValue(sampleRefund);
      refundRepository.summarizeByOrderIds.mockResolvedValue(
        new Map([['ol_order_abc123', { count: 1, totalAmount: '50.00', currency: 'PLN' }]]),
      );
    });

    it('should throw RefundRecordContendedException without writing when the order lock is held', async () => {
      lock.acquire.mockResolvedValue(null);

      await expect(service.recordRefund(input)).rejects.toBeInstanceOf(
        RefundRecordContendedException,
      );
      expect(refundRepository.create).not.toHaveBeenCalled();
      expect(lock.release).not.toHaveBeenCalled();
    });

    it('should release the lock after a successful write', async () => {
      await service.recordRefund({ ...input, amount: '10.00' });

      expect(lock.acquire).toHaveBeenCalledWith('order:refund:ol_order_abc123', expect.any(Number));
      expect(lock.release).toHaveBeenCalledWith('order:refund:ol_order_abc123', 'tok');
    });

    it('should release the lock when the ceiling refuses the refund', async () => {
      await expect(service.recordRefund(input)).rejects.toBeInstanceOf(
        RefundCeilingExceededException,
      );
      expect(lock.release).toHaveBeenCalledWith('order:refund:ol_order_abc123', 'tok');
    });

    it('should refuse a second refund that pushes the order past its total', async () => {
      await expect(service.recordRefund(input)).rejects.toBeInstanceOf(
        RefundCeilingExceededException,
      );
      expect(refundRepository.create).not.toHaveBeenCalled();
    });

    it('should record the same refund when acknowledgeAboveCeiling is set', async () => {
      const warn = jest.spyOn(
        (service as unknown as { logger: { warn: (m: string) => void } }).logger,
        'warn',
      );

      await service.recordRefund({ ...input, acknowledgeAboveCeiling: true });

      expect(refundRepository.create).toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('refund_ceiling_exceeded_acknowledged'),
      );
    });

    it('should proceed and warn refund_ceiling_unknown when the order has no total', async () => {
      orderRecords.getOrderRecord.mockResolvedValue({
        totalAmount: null,
        currency: null,
        taxTreatment: null,
        totalTaxTreatment: null,
      });
      const warn = jest.spyOn(
        (service as unknown as { logger: { warn: (m: string) => void } }).logger,
        'warn',
      );

      await service.recordRefund(input);

      expect(refundRepository.create).toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('refund_ceiling_unknown'));
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

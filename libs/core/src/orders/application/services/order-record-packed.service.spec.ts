/**
 * OrderRecordService packed-fact unit tests (#2287)
 *
 * Covers the one piece of policy the service owns: the guarded repository
 * write reports `false` both for an idempotent replay and for a missing row,
 * and only the re-read tells them apart.
 *
 * @module application/services
 */
import { OrderRecordService } from './order-record.service';
import type { OrderRecordRepositoryPort } from '../../domain/ports/order-record-repository.port';
import { OrderRecord } from '../../domain/entities/order-record.entity';
import { OrderRecordNotFoundException } from '../../domain/exceptions/order-record-not-found.exception';
import type { IOrderFxStampService } from '../interfaces/order-fx-stamp.service.interface';
import type { OrderLineItemRepositoryPort } from '../../domain/ports/order-line-item-repository.port';
import type { IReportingCurrencySettingsService } from '@openlinker/core/currency';
import type { IAutomationTriggerEmissionService } from '@openlinker/core/automation';

const ORDER_ID = 'ol_order_packed_001';

function buildRecord(packedAt: Date | null, packedByUserId: string | null): OrderRecord {
  return new OrderRecord(
    ORDER_ID,
    'ol_customer_001',
    'conn-source-001',
    'event-001',
    {},
    [],
    'ready',
    new Date('2026-04-01T00:00:00Z'),
    new Date('2026-04-01T00:00:00Z'),
    [],
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    packedAt,
    packedByUserId
  );
}

describe('OrderRecordService — packed fact (#2287)', () => {
  let repository: jest.Mocked<Pick<OrderRecordRepositoryPort, 'markPacked' | 'clearPacked' | 'findById'>>;
  let service: OrderRecordService;
  let automationEmission: IAutomationTriggerEmissionService;

  beforeEach(() => {
    repository = {
      markPacked: jest.fn(),
      clearPacked: jest.fn(),
      findById: jest.fn(),
    };

    const fxStamp = {
      stampOnIngestion: jest.fn(),
    } as unknown as IOrderFxStampService;

    // #1985/#2124 collaborators: this suite exercises only the packed-fact
    // path, which touches neither, so inert stubs keep the constructor honest
    // without implying they participate.
    const lineItemRepository = {} as unknown as OrderLineItemRepositoryPort;
    const reportingCurrencySettings = {} as unknown as IReportingCurrencySettingsService;
    automationEmission = {
      emit: jest.fn().mockResolvedValue({
        firedRuleIds: [],
        alreadyFiredRuleIds: [],
        evaluatedRuleCount: 0,
      }),
    } as unknown as IAutomationTriggerEmissionService;

    service = new OrderRecordService(
      repository as unknown as OrderRecordRepositoryPort,
      fxStamp,
      lineItemRepository,
      reportingCurrencySettings,
      automationEmission
    );
  });

  describe('markPacked', () => {
    it('should stamp the actor and return the re-read record when the order was unpacked', async () => {
      const stamped = buildRecord(new Date('2026-04-02T09:30:00Z'), 'user-op-001');
      repository.markPacked.mockResolvedValue(true);
      repository.findById.mockResolvedValue(stamped);

      const result = await service.markPacked(ORDER_ID, 'user-op-001');

      expect(repository.markPacked).toHaveBeenCalledWith(
        ORDER_ID,
        expect.any(Date),
        'user-op-001'
      );
      expect(result).toBe(stamped);
    });

    it('should stamp the instant itself rather than accept one from the caller', async () => {
      // The signature carries no timestamp at all — an operator action is OL's
      // own observation, so an audit fact can never be backdated by a client.
      repository.markPacked.mockResolvedValue(true);
      repository.findById.mockResolvedValue(buildRecord(new Date(), 'user-op-001'));

      const before = Date.now();
      await service.markPacked(ORDER_ID, 'user-op-001');

      const stampedAt = repository.markPacked.mock.calls[0][1];
      expect(stampedAt.getTime()).toBeGreaterThanOrEqual(before);
      expect(stampedAt.getTime()).toBeLessThanOrEqual(Date.now());
    });

    it('should return the ORIGINAL stamp and actor on a repeat mark', async () => {
      const original = buildRecord(new Date('2026-04-02T09:30:00Z'), 'user-op-001');
      repository.markPacked.mockResolvedValue(false);
      repository.findById.mockResolvedValue(original);

      const result = await service.markPacked(ORDER_ID, 'user-op-002');

      expect(result.packedByUserId).toBe('user-op-001');
      expect(result.packedAt).toEqual(new Date('2026-04-02T09:30:00Z'));
    });

    it('should throw OrderRecordNotFoundException when no such order exists', async () => {
      repository.markPacked.mockResolvedValue(false);
      repository.findById.mockResolvedValue(null);

      await expect(service.markPacked(ORDER_ID, 'user-op-001')).rejects.toBeInstanceOf(
        OrderRecordNotFoundException
      );
    });
  });

  describe('clearPacked', () => {
    it('should return the cleared record', async () => {
      const cleared = buildRecord(null, null);
      repository.clearPacked.mockResolvedValue(true);
      repository.findById.mockResolvedValue(cleared);

      const result = await service.clearPacked(ORDER_ID);

      expect(repository.clearPacked).toHaveBeenCalledWith(ORDER_ID);
      expect(result.packedAt).toBeNull();
      expect(result.packedByUserId).toBeNull();
    });

    it('should be a no-op returning the record when the order is already unpacked', async () => {
      const unpacked = buildRecord(null, null);
      repository.clearPacked.mockResolvedValue(false);
      repository.findById.mockResolvedValue(unpacked);

      await expect(service.clearPacked(ORDER_ID)).resolves.toBe(unpacked);
    });

    it('should throw OrderRecordNotFoundException when no such order exists', async () => {
      repository.clearPacked.mockResolvedValue(false);
      repository.findById.mockResolvedValue(null);

      await expect(service.clearPacked(ORDER_ID)).rejects.toBeInstanceOf(
        OrderRecordNotFoundException
      );
    });
  });

  describe('T5 automation emission (#2360)', () => {
    it('should emit order.packed exactly once, on the transition', async () => {
      repository.markPacked.mockResolvedValue(true);
      repository.findById.mockResolvedValue(buildRecord(new Date(), 'user-op-001'));
      await service.markPacked(ORDER_ID, 'user-op-001');
      expect(automationEmission.emit).toHaveBeenCalledTimes(1);
      expect(automationEmission.emit).toHaveBeenCalledWith(
        expect.objectContaining({ trigger: 'order.packed' })
      );
    });

    it('should NOT re-emit when an already-set packedAt is re-written', async () => {
      // Spec §5.2: re-buying a label because someone fixed a typo is exactly the
      // failure this prevents. The repository guard reports `false`; that IS the
      // signal, and no new state is needed to honour it.
      repository.markPacked.mockResolvedValue(false);
      repository.findById.mockResolvedValue(buildRecord(new Date(), 'user-op-001'));
      await service.markPacked(ORDER_ID, 'user-op-001');
      expect(automationEmission.emit).not.toHaveBeenCalled();
    });

    it('should never let an emission failure fail the pack', async () => {
      // The operator physically packed a box; an automation that cannot run is
      // not a reason to refuse to record that.
      repository.markPacked.mockResolvedValue(true);
      repository.findById.mockResolvedValue(buildRecord(new Date(), 'user-op-001'));
      (automationEmission.emit as jest.Mock).mockRejectedValue(new Error('automation down'));
      await expect(service.markPacked(ORDER_ID, 'user-op-001')).resolves.toBeDefined();
    });
  });
});
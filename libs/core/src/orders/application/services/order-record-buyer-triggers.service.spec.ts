/**
 * OrderRecordService buyer-email trigger tests (#3554)
 *
 * T9 `order.received`, T10 `order.shipped` and T11 `order.document_issued` fire
 * from this service, best-effort, and `order.shipped` only on the guarded
 * transition write.
 *
 * @module application/services
 */
import { OrderRecordService } from './order-record.service';
import type { OrderRecordRepositoryPort } from '../../domain/ports/order-record-repository.port';
import { OrderRecord } from '../../domain/entities/order-record.entity';
import type { IOrderFxStampService } from '../interfaces/order-fx-stamp.service.interface';
import type { OrderLineItemRepositoryPort } from '../../domain/ports/order-line-item-repository.port';
import type { IReportingCurrencySettingsService } from '@openlinker/core/currency';
import type { IAutomationTriggerEmissionService } from '@openlinker/core/automation';
import type { OrderCancellationSignalRepositoryPort } from '../../domain/ports/order-cancellation-signal-repository.port';

const ORDER_ID = 'ol_order_buyer_triggers_001';

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

describe('OrderRecordService — buyer-email triggers (#3554)', () => {
  let repository: jest.Mocked<
    Pick<OrderRecordRepositoryPort, 'updateFulfillmentState' | 'findById'>
  >;
  let emit: jest.Mock;
  let service: OrderRecordService;

  beforeEach(() => {
    repository = { updateFulfillmentState: jest.fn(), findById: jest.fn() };
    emit = jest
      .fn()
      .mockResolvedValue({ firedRuleIds: [], alreadyFiredRuleIds: [], evaluatedRuleCount: 0 });
    service = new OrderRecordService(
      repository as unknown as OrderRecordRepositoryPort,
      { stampOnIngestion: jest.fn() } as unknown as IOrderFxStampService,
      {} as unknown as OrderLineItemRepositoryPort,
      {} as unknown as IReportingCurrencySettingsService,
      { emit } as unknown as IAutomationTriggerEmissionService,
      { record: jest.fn(), consume: jest.fn() } as unknown as OrderCancellationSignalRepositoryPort
    );
  });

  it('should fire order.shipped when the write moved the order into a shipped state', async () => {
    repository.updateFulfillmentState.mockResolvedValue(true);
    repository.findById.mockResolvedValue(buildRecord(null, null));

    await service.updateFulfillmentState(ORDER_ID, 'dispatched');

    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        trigger: 'order.shipped',
        facts: expect.objectContaining({ subjectKind: 'order', subjectId: ORDER_ID }),
      })
    );
  });

  it('should not fire order.shipped when the order was already shipped', async () => {
    repository.updateFulfillmentState.mockResolvedValue(false);

    await service.updateFulfillmentState(ORDER_ID, 'delivered');

    expect(emit).not.toHaveBeenCalled();
  });

  it('should swallow a failed emission so the shipment projection is not failed', async () => {
    repository.updateFulfillmentState.mockResolvedValue(true);
    repository.findById.mockResolvedValue(buildRecord(null, null));
    emit.mockRejectedValue(new Error('rules table down'));

    await expect(service.updateFulfillmentState(ORDER_ID, 'dispatched')).resolves.toBeUndefined();
  });

  it('should fire order.received with the ingestion instant', async () => {
    const at = new Date('2026-10-29T10:00:00Z');

    await service.notifyOrderReceived(buildRecord(null, null), at);

    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({ trigger: 'order.received', now: at })
    );
  });

  it('should fire order.document_issued for an existing order and do nothing for a missing one', async () => {
    const at = new Date('2026-10-29T11:00:00Z');
    repository.findById.mockResolvedValueOnce(buildRecord(null, null)).mockResolvedValueOnce(null);

    await service.notifyDocumentIssued(ORDER_ID, at);
    await service.notifyDocumentIssued('ol_order_missing', at);

    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({ trigger: 'order.document_issued', now: at })
    );
  });
});

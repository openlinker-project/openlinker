import type { IIntegrationsService } from '@openlinker/core/integrations';
import type { IIdentifierMappingService } from '@openlinker/core/identifier-mapping';
import { DuplicateRefundRecordException } from '../../domain/exceptions/duplicate-refund-record.exception';
import type { SourceRefundObservation } from '../../domain/types/source-refund-observation.types';
import type { IOrderRecordService } from '../interfaces/order-record.service.interface';
import type { IOrderRefundRelayService } from '../interfaces/order-refund-relay.service.interface';
import type { IOrderRefundService } from '../interfaces/order-refund.service.interface';
import { OrderRefundObservationService } from './order-refund-observation.service';

const observation = (id: string, amount = '317.22'): SourceRefundObservation => ({
  externalRefundId: id,
  amount,
  currency: 'PLN',
  occurredAt: new Date('2026-11-16T20:44:36.650Z'),
});

describe('OrderRefundObservationService', () => {
  let listRefunds: jest.Mock;
  let integrations: jest.Mocked<Pick<IIntegrationsService, 'getCapabilityAdapter'>>;
  let mapping: jest.Mocked<Pick<IIdentifierMappingService, 'getInternalId'>>;
  let orderRecords: jest.Mocked<Pick<IOrderRecordService, 'getOrderRecord'>>;
  let refunds: jest.Mocked<Pick<IOrderRefundService, 'recordRefund'>>;
  let relay: { relayObservedRefunds: jest.Mock };
  let service: OrderRefundObservationService;
  const paidRecord = { sourceConnectionId: 'c1', paymentStatus: 'paid', syncStatus: [] };

  beforeEach(() => {
    listRefunds = jest.fn().mockResolvedValue([observation('r1')]);
    integrations = {
      getCapabilityAdapter: jest.fn().mockResolvedValue({ listRefunds }),
    } as never;
    mapping = { getInternalId: jest.fn().mockResolvedValue('ol_order_1') };
    orderRecords = { getOrderRecord: jest.fn().mockResolvedValue(paidRecord) } as never;
    refunds = { recordRefund: jest.fn().mockResolvedValue({}) };
    relay = { relayObservedRefunds: jest.fn().mockResolvedValue({}) };
    service = new OrderRefundObservationService(
      integrations as unknown as IIntegrationsService,
      mapping as unknown as IIdentifierMappingService,
      orderRecords as unknown as IOrderRecordService,
      refunds as unknown as IOrderRefundService,
      relay as unknown as IOrderRefundRelayService
    );
  });

  it('should record an observed refund out of band under a connection-scoped key', async () => {
    const result = await service.observeSourceRefunds('c1', 'ext-1');

    expect(result).toEqual({ observed: 1, recorded: 1, alreadyRecorded: 0, rejected: 0 });
    expect(refunds.recordRefund).toHaveBeenCalledWith(
      expect.objectContaining({
        internalOrderId: 'ol_order_1',
        amount: '317.22',
        currency: 'PLN',
        idempotencyKey: 'observed:c1:r1',
        executedBy: 'operator_out_of_band',
      })
    );
  });

  it('should count a duplicate as already recorded when the poll sees the same refund again', async () => {
    refunds.recordRefund.mockRejectedValue(new DuplicateRefundRecordException('ol_order_1', 'k'));

    const result = await service.observeSourceRefunds('c1', 'ext-1');

    expect(result).toEqual({ observed: 1, recorded: 0, alreadyRecorded: 1, rejected: 0 });
  });

  it('should keep going and count a rejection when one refund cannot be recorded', async () => {
    listRefunds.mockResolvedValue([observation('r1'), observation('r2', '1.00')]);
    refunds.recordRefund.mockRejectedValueOnce(new Error('currency mismatch'));

    const result = await service.observeSourceRefunds('c1', 'ext-1');

    expect(result).toEqual({ observed: 2, recorded: 1, alreadyRecorded: 0, rejected: 1 });
  });

  it('should not call the channel when the order is unknown, unpaid or from another source', async () => {
    mapping.getInternalId.mockResolvedValueOnce(null);
    await service.observeSourceRefunds('c1', 'ext-1');
    orderRecords.getOrderRecord.mockResolvedValueOnce({
      sourceConnectionId: 'c1',
      paymentStatus: 'awaiting',
    } as never);
    await service.observeSourceRefunds('c1', 'ext-1');
    orderRecords.getOrderRecord.mockResolvedValueOnce({
      sourceConnectionId: 'other',
      paymentStatus: 'paid',
    } as never);
    await service.observeSourceRefunds('c1', 'ext-1');

    expect(integrations.getCapabilityAdapter).not.toHaveBeenCalled();
  });

  it('should do nothing when the source cannot report refunds', async () => {
    integrations.getCapabilityAdapter.mockResolvedValue({} as never);

    const result = await service.observeSourceRefunds('c1', 'ext-1');

    expect(result.observed).toBe(0);
    expect(refunds.recordRefund).not.toHaveBeenCalled();
  });

  it('should relay both newly recorded and already recorded refunds, so a missed relay is retried', async () => {
    listRefunds.mockResolvedValue([observation('r1'), observation('r2')]);
    refunds.recordRefund
      .mockResolvedValueOnce({} as never)
      .mockRejectedValueOnce(new DuplicateRefundRecordException('ol_order_1', 'k'));

    await service.observeSourceRefunds('c1', 'ext-1');

    expect(relay.relayObservedRefunds).toHaveBeenCalledWith(
      expect.objectContaining({
        internalOrderId: 'ol_order_1',
        sourceConnectionId: 'c1',
        observations: [
          expect.objectContaining({ externalRefundId: 'r1' }),
          expect.objectContaining({ externalRefundId: 'r2' }),
        ],
      })
    );
  });

  it('should not relay a refund that could not be recorded', async () => {
    refunds.recordRefund.mockRejectedValue(new Error('currency mismatch'));

    await service.observeSourceRefunds('c1', 'ext-1');

    expect(relay.relayObservedRefunds).not.toHaveBeenCalled();
  });

  it('should still report the observation when the relay throws', async () => {
    relay.relayObservedRefunds.mockRejectedValue(new Error('boom'));

    const result = await service.observeSourceRefunds('c1', 'ext-1');

    expect(result.recorded).toBe(1);
  });
});

import type { IIntegrationsService } from '@openlinker/core/integrations';
import type { SourceRefundObservation } from '../../domain/types/source-refund-observation.types';
import type { OrderSyncStatus } from '../../domain/types/order-sync.types';
import type { IOrderRefundService } from '../interfaces/order-refund.service.interface';
import type { RelayObservedRefundsInput } from '../interfaces/order-refund-relay.service.interface';
import { OrderRefundRelayService } from './order-refund-relay.service';

const observation = (id: string): SourceRefundObservation => ({
  externalRefundId: id,
  amount: '317.22',
  currency: 'PLN',
  occurredAt: null,
});
const synced = (id: string, externalOrderId = `ext-${id}`): OrderSyncStatus => ({
  destinationConnectionId: id,
  status: 'synced',
  externalOrderId,
});

describe('OrderRefundRelayService', () => {
  let executeRefund: jest.Mock;
  let getCapabilityAdapter: jest.Mock;
  let runUnderLock: jest.Mock;
  let service: OrderRefundRelayService;

  beforeEach(() => {
    executeRefund = jest.fn().mockResolvedValue({ outcome: 'refunded' });
    getCapabilityAdapter = jest.fn().mockResolvedValue({ executeRefund });
    runUnderLock = jest.fn((_id: string, work: () => Promise<unknown>) => work());
    service = new OrderRefundRelayService(
      { getCapabilityAdapter } as unknown as IIntegrationsService,
      { runUnderOrderRefundLock: runUnderLock } as unknown as IOrderRefundService
    );
  });

  const input = (
    destinations: OrderSyncStatus[],
    observations: SourceRefundObservation[] = [observation('r1')]
  ): RelayObservedRefundsInput => ({
    internalOrderId: 'ol_order_1',
    sourceConnectionId: 'src',
    destinations,
    observations,
  });

  it('should refund the destination copy once under a key derived from the observed one', async () => {
    const result = await service.relayObservedRefunds(input([synced('d1')]));

    expect(result.relayed).toBe(1);
    expect(runUnderLock).toHaveBeenCalledWith(
      'ol_order_1',
      expect.any(Function),
      expect.any(Object)
    );
    expect(executeRefund).toHaveBeenCalledWith(
      expect.objectContaining({
        externalOrderId: 'ext-d1',
        externalReturnId: null,
        amount: '317.22',
        currency: 'PLN',
        idempotencyKey: 'observed:src:r1:to:d1',
      })
    );
  });

  it('should recompute the same key on a re-poll so the executor can dedupe', async () => {
    await service.relayObservedRefunds(input([synced('d1')]));
    await service.relayObservedRefunds(input([synced('d1')]));

    const keys = (executeRefund.mock.calls as Array<[{ idempotencyKey: string }]>).map(
      ([command]) => command.idempotencyKey
    );
    expect(new Set(keys).size).toBe(1);
  });

  it('should report a destination without a refund capability and not call anything', async () => {
    getCapabilityAdapter.mockResolvedValue({});

    const result = await service.relayObservedRefunds(input([synced('d1')]));

    expect(result).toEqual({ relayed: 0, unsupportedDestinations: 1, denied: 0, failed: 0 });
    expect(executeRefund).not.toHaveBeenCalled();
  });

  it('should ignore destinations that hold no copy and never relay to the source', async () => {
    const result = await service.relayObservedRefunds(
      input([
        { destinationConnectionId: 'd1', status: 'failed' },
        { destinationConnectionId: 'd2', status: 'synced' },
        synced('src'),
      ])
    );

    expect(result.relayed).toBe(0);
    expect(getCapabilityAdapter).not.toHaveBeenCalled();
  });

  it('should count a terminal denial and keep relaying the other destinations', async () => {
    executeRefund
      .mockResolvedValueOnce({ outcome: 'denied', providerMessage: 'nope' })
      .mockResolvedValueOnce({ outcome: 'accepted' });

    const result = await service.relayObservedRefunds(input([synced('d1'), synced('d2')]));

    expect(result).toEqual({ relayed: 1, unsupportedDestinations: 0, denied: 1, failed: 0 });
  });

  it('should count a throw as failed without stopping later refunds', async () => {
    executeRefund
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce({ outcome: 'refunded' });

    const result = await service.relayObservedRefunds(
      input([synced('d1')], [observation('r1'), observation('r2')])
    );

    expect(result).toEqual({ relayed: 1, unsupportedDestinations: 0, denied: 0, failed: 1 });
  });

  it('should report a destination whose adapter cannot be resolved', async () => {
    getCapabilityAdapter.mockRejectedValue(new Error('disabled'));

    const result = await service.relayObservedRefunds(input([synced('d1')]));

    expect(result.unsupportedDestinations).toBe(1);
  });
});

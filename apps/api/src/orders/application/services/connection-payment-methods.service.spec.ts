/**
 * Connection Payment Methods Service - unit tests (#3774)
 *
 * @module apps/api/src/orders/application/services
 */
import { ConnectionNotFoundException } from '@openlinker/core/identifier-mapping';
import type { IOrderRecordService } from '@openlinker/core/orders';
import type { IIntegrationsService } from '@openlinker/core/integrations';
import { ConnectionPaymentMethodsService } from './connection-payment-methods.service';

describe('ConnectionPaymentMethodsService', () => {
  const observed = [
    { sourcePaymentMethod: 'payu', orderCount: 3, lastSeenAt: new Date('2026-07-01T00:00:00Z') },
    { sourcePaymentMethod: 'cod', orderCount: 1, lastSeenAt: new Date('2026-07-02T00:00:00Z') },
  ];
  let orderRecords: jest.Mocked<Pick<IOrderRecordService, 'listObservedSourcePaymentMethods'>>;
  let integrations: jest.Mocked<Pick<IIntegrationsService, 'getAdapter' | 'getCapabilityAdapter'>>;
  let service: ConnectionPaymentMethodsService;

  const connection = (config: Record<string, unknown> = {}): { connection: unknown } => ({
    connection: { id: 'c1', config },
  });

  beforeEach(() => {
    orderRecords = { listObservedSourcePaymentMethods: jest.fn().mockResolvedValue(observed) };
    integrations = { getAdapter: jest.fn(), getCapabilityAdapter: jest.fn() };
    service = new ConnectionPaymentMethodsService(
      orderRecords as unknown as IOrderRecordService,
      integrations as unknown as IIntegrationsService
    );
  });

  it('should classify through the adapter and the operator map when supported', async () => {
    integrations.getAdapter.mockResolvedValue(
      connection({ paymentMethodMap: { PayU: 'online' } }) as never
    );
    integrations.getCapabilityAdapter.mockResolvedValue({
      classifyPlatformPaymentMethod: (id: string) =>
        id === 'cod' ? 'cash_on_delivery' : 'unknown',
    } as never);

    const view = await service.listObserved('c1');

    expect(view.mapSupport).toBe('supported');
    expect(view.windowDays).toBe(90);
    expect(view.items[0]).toMatchObject({
      sourcePaymentMethod: 'payu',
      platformMethod: 'unknown',
      operatorMethod: 'online',
      resolvedMethod: 'online',
      resolvedBy: 'operator',
    });
    expect(view.items[1]).toMatchObject({
      platformMethod: 'cash_on_delivery',
      operatorMethod: null,
      resolvedBy: 'platform',
    });
  });

  it('should report unsupported, with null resolved fields, when the adapter has no classifier', async () => {
    integrations.getAdapter.mockResolvedValue(connection() as never);
    integrations.getCapabilityAdapter.mockResolvedValue({} as never);

    const view = await service.listObserved('c1');

    expect(view.mapSupport).toBe('unsupported');
    expect(view.items).toHaveLength(2);
    expect(view.items[0]).toMatchObject({
      platformMethod: null,
      resolvedMethod: null,
      resolvedBy: null,
    });
  });

  it('should report unknown, still returning observed ids, when the adapter cannot be resolved', async () => {
    integrations.getAdapter.mockResolvedValue(connection() as never);
    integrations.getCapabilityAdapter.mockRejectedValue(new Error('credentials'));

    const view = await service.listObserved('c1');

    expect(view.mapSupport).toBe('unknown');
    expect(view.items).toHaveLength(2);
  });

  it('should report unknown when the connection itself cannot be loaded (e.g. disabled)', async () => {
    integrations.getAdapter.mockRejectedValue(new Error('disabled'));

    const view = await service.listObserved('c1');

    expect(view.mapSupport).toBe('unknown');
    expect(view.items).toHaveLength(2);
  });

  it('should rethrow a missing connection', async () => {
    integrations.getAdapter.mockRejectedValue(new ConnectionNotFoundException('c1'));

    await expect(service.listObserved('c1')).rejects.toBeInstanceOf(ConnectionNotFoundException);
  });

  it('should fail, not return an empty list, when the orders read fails', async () => {
    integrations.getAdapter.mockResolvedValue(connection() as never);
    integrations.getCapabilityAdapter.mockResolvedValue({} as never);
    orderRecords.listObservedSourcePaymentMethods.mockRejectedValue(new Error('db'));

    await expect(service.listObserved('c1')).rejects.toThrow('db');
  });
});

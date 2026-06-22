/**
 * Order Lifecycle Relay Service — unit tests (#1158 / ADR-027)
 *
 * @module libs/core/src/orders/application/services/__tests__
 */
import { OrderLifecycleRelayService } from '../order-lifecycle-relay.service';
import { CapabilityNotSupportedException, type IIntegrationsService } from '@openlinker/core/integrations';
import type { IIdentifierMappingService } from '@openlinker/core/identifier-mapping';

const origin = 'allegro-conn';

const mapping = (connectionId: string, externalId: string) => ({
  connectionId,
  externalId,
  platformType: 'x',
  entityType: 'Order',
});

describe('OrderLifecycleRelayService', () => {
  let service: OrderLifecycleRelayService;
  let integrations: jest.Mocked<IIntegrationsService>;
  let identifierMapping: jest.Mocked<IIdentifierMappingService>;

  beforeEach(() => {
    integrations = {
      getCapabilityAdapter: jest.fn(),
      getAdapter: jest.fn(),
      listCapabilityAdapters: jest.fn(),
    } as unknown as jest.Mocked<IIntegrationsService>;
    identifierMapping = {
      getExternalIds: jest.fn(),
    } as unknown as jest.Mocked<IIdentifierMappingService>;
    service = new OrderLifecycleRelayService(integrations, identifierMapping);
  });

  it('writes the event to each non-origin participant and collects outcomes', async () => {
    identifierMapping.getExternalIds.mockResolvedValue([
      mapping(origin, 'allegro-1'),
      mapping('ps-conn', 'ps-7'),
    ]);
    const adapter = { write: jest.fn().mockResolvedValue({ outcome: 'applied' }) };
    integrations.getCapabilityAdapter.mockResolvedValue(adapter);

    const result = await service.relay({
      internalOrderId: 'ol_order_1',
      originConnectionId: origin,
      event: { type: 'cancelled', reason: 'buyer-cancel' },
    });

    expect(integrations.getCapabilityAdapter).toHaveBeenCalledTimes(1);
    expect(integrations.getCapabilityAdapter).toHaveBeenCalledWith('ps-conn', 'OrderProcessorManager');
    expect(adapter.write).toHaveBeenCalledWith({
      type: 'cancelled',
      externalOrderId: 'ps-7',
      reason: 'buyer-cancel',
    });
    expect(result.targets).toEqual([
      { connectionId: 'ps-conn', outcome: 'applied', detail: undefined },
    ]);
  });

  it('maps a dispatched event with tracking + carrier through to the participant', async () => {
    identifierMapping.getExternalIds.mockResolvedValue([mapping('ps-conn', 'ps-7')]);
    const adapter = { write: jest.fn().mockResolvedValue({ outcome: 'applied' }) };
    integrations.getCapabilityAdapter.mockResolvedValue(adapter);

    await service.relay({
      internalOrderId: 'ol_order_1',
      originConnectionId: origin,
      event: { type: 'dispatched', trackingNumber: 'TRK1', carrier: { platformType: 'inpost' } },
    });

    expect(adapter.write).toHaveBeenCalledWith({
      type: 'dispatched',
      externalOrderId: 'ps-7',
      trackingNumber: 'TRK1',
      carrier: { platformType: 'inpost' },
    });
  });

  it('excludes the origin participant (self-echo suppression)', async () => {
    identifierMapping.getExternalIds.mockResolvedValue([mapping(origin, 'allegro-1')]);

    const result = await service.relay({
      internalOrderId: 'ol_order_1',
      originConnectionId: origin,
      event: { type: 'cancelled' },
    });

    expect(integrations.getCapabilityAdapter).not.toHaveBeenCalled();
    expect(result.targets).toEqual([]);
  });

  it('reports unsupported when the participant does not implement OrderStatusWriteback', async () => {
    identifierMapping.getExternalIds.mockResolvedValue([mapping('ps-conn', 'ps-7')]);
    integrations.getCapabilityAdapter.mockResolvedValue({ createOrder: jest.fn() });

    const result = await service.relay({
      internalOrderId: 'ol_order_1',
      originConnectionId: origin,
      event: { type: 'cancelled' },
    });

    expect(result.targets[0]).toMatchObject({ connectionId: 'ps-conn', outcome: 'unsupported' });
  });

  it('reports unsupported when the participant adapter cannot be resolved', async () => {
    identifierMapping.getExternalIds.mockResolvedValue([mapping('ps-conn', 'ps-7')]);
    integrations.getCapabilityAdapter.mockRejectedValue(new Error('no adapter'));

    const result = await service.relay({
      internalOrderId: 'ol_order_1',
      originConnectionId: origin,
      event: { type: 'cancelled' },
    });

    expect(result.targets[0]).toMatchObject({ connectionId: 'ps-conn', outcome: 'unsupported' });
  });

  it('reports rejected and continues to the next participant when a write throws', async () => {
    identifierMapping.getExternalIds.mockResolvedValue([
      mapping('ps-a', 'a'),
      mapping('ps-b', 'b'),
    ]);
    integrations.getCapabilityAdapter
      .mockResolvedValueOnce({ write: jest.fn().mockRejectedValue(new Error('boom')) })
      .mockResolvedValueOnce({ write: jest.fn().mockResolvedValue({ outcome: 'applied' }) });

    const result = await service.relay({
      internalOrderId: 'ol_order_1',
      originConnectionId: origin,
      event: { type: 'cancelled' },
    });

    expect(result.targets).toEqual([
      { connectionId: 'ps-a', outcome: 'rejected', detail: 'boom' },
      { connectionId: 'ps-b', outcome: 'applied', detail: undefined },
    ]);
  });

  it('surfaces a rejected outcome returned by the adapter (e.g. already shipped)', async () => {
    identifierMapping.getExternalIds.mockResolvedValue([mapping('ps-conn', 'ps-7')]);
    integrations.getCapabilityAdapter.mockResolvedValue({
      write: jest.fn().mockResolvedValue({ outcome: 'rejected', detail: 'order already shipped' }),
    });

    const result = await service.relay({
      internalOrderId: 'ol_order_1',
      originConnectionId: origin,
      event: { type: 'cancelled' },
    });

    expect(result.targets[0]).toEqual({
      connectionId: 'ps-conn',
      outcome: 'rejected',
      detail: 'order already shipped',
    });
  });

  it('returns no targets when the order has only the origin participant', async () => {
    identifierMapping.getExternalIds.mockResolvedValue([mapping(origin, 'allegro-1')]);

    const result = await service.relay({
      internalOrderId: 'ol_order_1',
      originConnectionId: origin,
      event: { type: 'cancelled' },
    });

    expect(result.targets).toEqual([]);
  });

  it('resolves a source-role participant (OrderSource) when it is not an OrderProcessorManager (#1159)', async () => {
    identifierMapping.getExternalIds.mockResolvedValue([mapping('allegro-dest', 'cf-9')]);
    const adapter = { write: jest.fn().mockResolvedValue({ outcome: 'applied' }) };
    integrations.getCapabilityAdapter.mockImplementation((_conn: string, capability: string) =>
      capability === 'OrderSource'
        ? Promise.resolve(adapter)
        : Promise.reject(new CapabilityNotSupportedException('allegro.publicapi.v1', capability))
    );

    const result = await service.relay({
      internalOrderId: 'ol_order_1',
      originConnectionId: origin,
      event: { type: 'cancelled', reason: 'buyer-cancel' },
    });

    // Destination tried first, then the source role — guard-dispatched, no platform branching.
    expect(integrations.getCapabilityAdapter).toHaveBeenCalledWith('allegro-dest', 'OrderProcessorManager');
    expect(integrations.getCapabilityAdapter).toHaveBeenCalledWith('allegro-dest', 'OrderSource');
    expect(adapter.write).toHaveBeenCalledWith({
      type: 'cancelled',
      externalOrderId: 'cf-9',
      reason: 'buyer-cancel',
    });
    expect(result.targets).toEqual([
      { connectionId: 'allegro-dest', outcome: 'applied', detail: undefined },
    ]);
  });

  it('surfaces a connection-level resolution failure as "adapter unresolved" without trying further roles (#1159)', async () => {
    identifierMapping.getExternalIds.mockResolvedValue([mapping('ps-conn', 'ps-7')]);
    // A non-capability error (e.g. connection disabled) must not be swallowed as a
    // capability mismatch — it short-circuits the role loop and surfaces.
    integrations.getCapabilityAdapter.mockRejectedValue(new Error('connection disabled'));

    const result = await service.relay({
      internalOrderId: 'ol_order_1',
      originConnectionId: origin,
      event: { type: 'cancelled' },
    });

    expect(integrations.getCapabilityAdapter).toHaveBeenCalledTimes(1);
    expect(result.targets[0]).toEqual({
      connectionId: 'ps-conn',
      outcome: 'unsupported',
      detail: 'adapter unresolved',
    });
  });
});

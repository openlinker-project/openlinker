/**
 * Inbound Routing Policy Service Unit Tests
 *
 * @module libs/core/src/sync/application/services/__tests__
 */
import type { CanonicalInboundEvent } from '@openlinker/core/integrations';
import type { Connection } from '@openlinker/core/identifier-mapping';
import { InboundRoutingPolicyService } from '../inbound-routing-policy.service';
import type { JobEnqueuePort } from '../../../domain/ports/job-enqueue.port';

describe('InboundRoutingPolicyService', () => {
  let service: InboundRoutingPolicyService;
  let jobEnqueue: jest.Mocked<JobEnqueuePort>;

  const connection = (enabled: string[]): Connection =>
    ({
      id: 'conn-1',
      platformType: 'prestashop',
      adapterKey: 'prestashop.webservice.v1',
      enabledCapabilities: enabled,
    }) as unknown as Connection;

  const event = (overrides: Partial<CanonicalInboundEvent>): CanonicalInboundEvent => ({
    domain: 'order',
    externalId: '42',
    eventType: 'created',
    occurredAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  });

  beforeEach(() => {
    jobEnqueue = { enqueueJob: jest.fn().mockResolvedValue({ jobId: 'job-1', isExisting: false }) };
    service = new InboundRoutingPolicyService(jobEnqueue);
  });

  it('should route an order event to marketplace.order.sync when OrderSource is supported and enabled', async () => {
    const outcome = await service.route(
      event({ domain: 'order' }),
      connection(['OrderSource']),
      ['OrderSource'],
      'evt-9'
    );

    expect(outcome).toEqual({ status: 'enqueued', jobId: 'job-1', jobType: 'marketplace.order.sync' });
    expect(jobEnqueue.enqueueJob).toHaveBeenCalledWith({
      jobType: 'marketplace.order.sync',
      connectionId: 'conn-1',
      payload: {
        schemaVersion: 1,
        externalOrderId: '42',
        sourceEventId: 'evt-9',
        eventType: 'created',
        occurredAt: '2026-01-01T00:00:00.000Z',
      },
      idempotencyKey: 'prestashop:conn-1:evt-9',
    });
  });

  it('should coerce an unknown order eventType to updated', async () => {
    await service.route(
      event({ domain: 'order', eventType: 'refunded' }),
      connection(['OrderSource']),
      ['OrderSource'],
      'evt-9'
    );

    const enqueued = jobEnqueue.enqueueJob.mock.calls[0][0];
    expect((enqueued.payload as { eventType: string }).eventType).toBe('updated');
  });

  it('should route an inventory event to master.inventory.syncByExternalId with objectType Inventory', async () => {
    const outcome = await service.route(
      event({ domain: 'inventory', eventType: 'stock.changed' }),
      connection(['InventoryMaster']),
      ['InventoryMaster'],
      'evt-9'
    );

    expect(outcome.status).toBe('enqueued');
    expect(jobEnqueue.enqueueJob).toHaveBeenCalledWith(
      expect.objectContaining({
        jobType: 'master.inventory.syncByExternalId',
        payload: { schemaVersion: 1, externalId: '42', objectType: 'Inventory' },
      })
    );
  });

  it('should route a product event to master.product.syncByExternalId with objectType Product', async () => {
    const outcome = await service.route(
      event({ domain: 'product', eventType: 'product.saved' }),
      connection(['ProductMaster']),
      ['ProductMaster'],
      'evt-9'
    );

    expect(outcome.status).toBe('enqueued');
    expect(jobEnqueue.enqueueJob).toHaveBeenCalledWith(
      expect.objectContaining({
        jobType: 'master.product.syncByExternalId',
        payload: { schemaVersion: 1, externalId: '42', objectType: 'Product' },
      })
    );
  });

  it('should route a shipment event to marketplace.shipment.syncByExternalId gated on ShippingProviderManager', async () => {
    const outcome = await service.route(
      event({ domain: 'shipment', eventType: 'tracking' }),
      connection(['ShippingProviderManager']),
      ['ShippingProviderManager'],
      'evt-9'
    );

    expect(outcome.status).toBe('enqueued');
    expect(jobEnqueue.enqueueJob).toHaveBeenCalledWith(
      expect.objectContaining({
        jobType: 'marketplace.shipment.syncByExternalId',
        payload: { schemaVersion: 1, externalId: '42' },
      })
    );
  });

  it('should not enqueue a shipment event when ShippingProviderManager is not enabled', async () => {
    const outcome = await service.route(
      event({ domain: 'shipment', eventType: 'tracking' }),
      connection([]),
      ['ShippingProviderManager'],
      'evt-9'
    );

    expect(outcome).toEqual({
      status: 'ungated',
      domain: 'shipment',
      requiredCapability: 'ShippingProviderManager',
    });
    expect(jobEnqueue.enqueueJob).not.toHaveBeenCalled();
  });

  it('should not enqueue and return ungated when the capability is supported but not enabled', async () => {
    const outcome = await service.route(
      event({ domain: 'order' }),
      connection([]),
      ['OrderSource'],
      'evt-9'
    );

    expect(outcome).toEqual({ status: 'ungated', domain: 'order', requiredCapability: 'OrderSource' });
    expect(jobEnqueue.enqueueJob).not.toHaveBeenCalled();
  });

  it('should not enqueue and return ungated when the capability is enabled but not adapter-supported', async () => {
    const outcome = await service.route(
      event({ domain: 'order' }),
      connection(['OrderSource']),
      [],
      'evt-9'
    );

    expect(outcome.status).toBe('ungated');
    expect(jobEnqueue.enqueueJob).not.toHaveBeenCalled();
  });
});

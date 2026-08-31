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

  it('should route a product deletion to the same re-read job, which owns the deletion decision', async () => {
    // A deletion webhook is a trigger, not an assertion (#2647): it routes the
    // ordinary re-read, and the master's not-found answer is what stales the
    // variants and pauses the offers (#1599 / #1688 / #1689).
    const outcome = await service.route(
      event({ domain: 'product', eventType: 'product.deleted' }),
      connection(['ProductMaster']),
      ['ProductMaster'],
      'evt-10'
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

  it('should route an invoicing event to invoicing.regulatoryStatus.reconcile gated on Invoicing', async () => {
    const outcome = await service.route(
      event({ domain: 'invoicing', eventType: 'send_to_ksef_success', externalId: 'inv-1' }),
      connection(['Invoicing']),
      ['Invoicing'],
      'evt-9'
    );

    expect(outcome.status).toBe('enqueued');
    expect(jobEnqueue.enqueueJob).toHaveBeenCalledWith(
      expect.objectContaining({
        jobType: 'invoicing.regulatoryStatus.reconcile',
        payload: { schemaVersion: 1, limit: 50 },
      })
    );
  });

  it('should route an invoice-payment event to invoicing.paymentStatus.refreshByExternalId gated on Invoicing', async () => {
    const outcome = await service.route(
      event({ domain: 'invoice-payment', eventType: 'invoice_marked_as_paid', externalId: 'inv-42' }),
      connection(['Invoicing']),
      ['Invoicing'],
      'evt-10'
    );

    expect(outcome.status).toBe('enqueued');
    expect(jobEnqueue.enqueueJob).toHaveBeenCalledWith(
      expect.objectContaining({
        jobType: 'invoicing.paymentStatus.refreshByExternalId',
        payload: { schemaVersion: 1, externalInvoiceId: 'inv-42' },
      })
    );
  });

  it('should not enqueue an invoice-payment event when Invoicing is not enabled', async () => {
    const outcome = await service.route(
      event({ domain: 'invoice-payment', eventType: 'invoice_marked_as_paid' }),
      connection([]),
      ['Invoicing'],
      'evt-10'
    );

    expect(outcome).toEqual({
      status: 'ungated',
      domain: 'invoice-payment',
      requiredCapability: 'Invoicing',
    });
    expect(jobEnqueue.enqueueJob).not.toHaveBeenCalled();
  });

  it('should not enqueue an invoicing event when Invoicing is not enabled', async () => {
    const outcome = await service.route(
      event({ domain: 'invoicing', eventType: 'send_to_ksef_success' }),
      connection([]),
      ['Invoicing'],
      'evt-9'
    );

    expect(outcome).toEqual({ status: 'ungated', domain: 'invoicing', requiredCapability: 'Invoicing' });
    expect(jobEnqueue.enqueueJob).not.toHaveBeenCalled();
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

  // ---- #2400: the two new inbound domains -------------------------------

  describe('fulfillment domain (#2400)', () => {
    it('should route a fulfillment event to fulfillment.work.statusSync when FulfillmentExecutor is supported and enabled', async () => {
      const outcome = await service.route(
        event({ domain: 'fulfillment', externalId: 'vendor-work-7', eventType: 'picked' }),
        connection(['FulfillmentExecutor']),
        ['FulfillmentExecutor'],
        'evt-11'
      );

      expect(outcome).toEqual({
        status: 'enqueued',
        jobId: 'job-1',
        jobType: 'fulfillment.work.statusSync',
      });
      expect(jobEnqueue.enqueueJob).toHaveBeenCalledWith({
        jobType: 'fulfillment.work.statusSync',
        connectionId: 'conn-1',
        payload: {
          schemaVersion: 1,
          externalWorkId: 'vendor-work-7',
          sourceEventId: 'evt-11',
          eventType: 'picked',
          occurredAt: '2026-01-01T00:00:00.000Z',
        },
        idempotencyKey: 'prestashop:conn-1:evt-11',
      });
    });

    it('should carry NO progress deltas in the payload, because a webhook body is never a source of truth', async () => {
      // Guards the #904 discipline structurally. A future change that "makes the
      // handler work" by widening the payload to carry quantities would move
      // real fulfilment counters off an unauthenticated body; this fails first.
      await service.route(
        event({ domain: 'fulfillment', externalId: 'vendor-work-7' }),
        connection(['FulfillmentExecutor']),
        ['FulfillmentExecutor'],
        'evt-11'
      );

      const payload = jobEnqueue.enqueueJob.mock.calls[0][0].payload;
      expect(Object.keys(payload).sort()).toEqual([
        'eventType',
        'externalWorkId',
        'occurredAt',
        'schemaVersion',
        'sourceEventId',
      ]);
    });

    it('should resolve ungated when FulfillmentExecutor is absent — TODAY\'S REAL CASE on every shipped deployment', async () => {
      // No shipped adapter manifest advertises `FulfillmentExecutor`, so this is
      // what actually happens in production right now. It gets its own named
      // test so the arm is never mistaken for working end-to-end.
      const outcome = await service.route(
        event({ domain: 'fulfillment', externalId: 'vendor-work-7' }),
        connection([]),
        [],
        'evt-11'
      );

      expect(outcome).toEqual({
        status: 'ungated',
        domain: 'fulfillment',
        requiredCapability: 'FulfillmentExecutor',
      });
      expect(jobEnqueue.enqueueJob).not.toHaveBeenCalled();
    });
  });

  describe('return domain (#2400)', () => {
    it('should route a return event to the existing marketplace.return.sync job', async () => {
      const outcome = await service.route(
        event({ domain: 'return', externalId: 'ret-5' }),
        connection(['OrderSource']),
        ['OrderSource'],
        'evt-12'
      );

      expect(outcome).toEqual({
        status: 'enqueued',
        jobId: 'job-1',
        jobType: 'marketplace.return.sync',
      });
      expect(jobEnqueue.enqueueJob).toHaveBeenCalledWith({
        jobType: 'marketplace.return.sync',
        connectionId: 'conn-1',
        payload: {
          schemaVersion: 1,
          externalReturnId: 'ret-5',
          eventKey: 'evt-12',
          occurredAt: '2026-01-01T00:00:00.000Z',
        },
        idempotencyKey: 'prestashop:conn-1:evt-12',
      });
    });

    it('should gate on OrderSource and NEVER on ReturnSourceReader (the #2085 trap)', async () => {
      // `ReturnSourceReader` is guard-only: it is absent from
      // `CoreCapabilityValues`, which both connection DTOs `@IsIn`-validate
      // against, so `enabledCapabilities` can never contain it. Gating on it
      // would leave this arm permanently `ungated` for every connection.
      const outcome = await service.route(
        event({ domain: 'return', externalId: 'ret-5' }),
        connection(['ReturnSourceReader']),
        ['ReturnSourceReader'],
        'evt-12'
      );

      expect(outcome).toEqual({
        status: 'ungated',
        domain: 'return',
        requiredCapability: 'OrderSource',
      });
    });
  });

});

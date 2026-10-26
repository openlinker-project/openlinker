/**
 * Source Fulfillment Status Service Tests
 *
 * @module apps/api/src/orders/application/services
 */
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import {
  ORDER_RECORD_SERVICE_TOKEN,
  OrderRecordNotFoundException,
  unsupportedSourceFulfillmentReadback,
} from '@openlinker/core/orders';
import {
  IDENTIFIER_MAPPING_SERVICE_TOKEN,
  CORE_ENTITY_TYPE,
} from '@openlinker/core/identifier-mapping';
import { INTEGRATIONS_SERVICE_TOKEN } from '@openlinker/core/integrations';
import { SourceFulfillmentStatusService } from './source-fulfillment-status.service';
import { SOURCE_FULFILLMENT_STATUS_SERVICE_TOKEN } from '../interfaces/source-fulfillment-status.service.interface';

describe('SourceFulfillmentStatusService (#3365)', () => {
  let service: SourceFulfillmentStatusService;
  let orderRecords: { getOrderRecord: jest.Mock };
  let identifierMapping: { getExternalIds: jest.Mock };
  let integrations: { getCapabilityAdapter: jest.Mock; getAdapter: jest.Mock };

  const ORDER_ID = 'ol_order_1';
  const SOURCE = 'conn-source';

  function record(overrides: Record<string, unknown> = {}): unknown {
    return { internalOrderId: ORDER_ID, sourceConnectionId: SOURCE, ...overrides };
  }

  beforeEach(async () => {
    orderRecords = { getOrderRecord: jest.fn().mockResolvedValue(record()) };
    identifierMapping = {
      getExternalIds: jest
        .fn()
        .mockResolvedValue([{ connectionId: SOURCE, externalId: 'cf-1', entityType: 'Order' }]),
    };
    integrations = {
      getCapabilityAdapter: jest.fn(),
      getAdapter: jest.fn().mockResolvedValue({ connection: { name: 'Allegro (sandbox)' } }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SourceFulfillmentStatusService,
        {
          provide: SOURCE_FULFILLMENT_STATUS_SERVICE_TOKEN,
          useExisting: SourceFulfillmentStatusService,
        },
        { provide: ORDER_RECORD_SERVICE_TOKEN, useValue: orderRecords },
        { provide: IDENTIFIER_MAPPING_SERVICE_TOKEN, useValue: identifierMapping },
        { provide: INTEGRATIONS_SERVICE_TOKEN, useValue: integrations },
      ],
    }).compile();

    service = module.get(SourceFulfillmentStatusService);
  });

  it("should return the marketplace's own answer when the source reports one", async () => {
    integrations.getCapabilityAdapter.mockResolvedValue({
      readFulfillment: jest
        .fn()
        .mockResolvedValue({ outcome: 'read', rawStatus: 'SENT', dispatched: true, waybills: null }),
    });

    const view = await service.read(ORDER_ID);

    expect(view.externalOrderId).toBe('cf-1');
    expect(view.readback).toMatchObject({ outcome: 'read', rawStatus: 'SENT', dispatched: true });
    expect(view.unmappedReason).toBeNull();
    expect(view.sourceConnectionName).toBe('Allegro (sandbox)');
  });

  // The order-side mapping is resolved on the order's OWN source connection.
  // An order legitimately carries destination mappings too, and asking a
  // destination about a source's fulfilment answers a different question with
  // a confident-looking number.
  it('should ignore a destination mapping and ask only the source', async () => {
    identifierMapping.getExternalIds.mockResolvedValue([
      { connectionId: 'conn-destination', externalId: 'ps-99', entityType: 'Order' },
      { connectionId: SOURCE, externalId: 'cf-1', entityType: 'Order' },
    ]);
    const readFulfillment = jest
      .fn()
      .mockResolvedValue({ outcome: 'read', rawStatus: 'SENT', dispatched: true, waybills: null });
    integrations.getCapabilityAdapter.mockResolvedValue({ readFulfillment });

    await service.read(ORDER_ID);

    expect(identifierMapping.getExternalIds).toHaveBeenCalledWith(
      CORE_ENTITY_TYPE.Order,
      ORDER_ID
    );
    expect(readFulfillment).toHaveBeenCalledWith({ externalOrderId: 'cf-1' });
    expect(integrations.getCapabilityAdapter).toHaveBeenCalledWith(SOURCE, 'OrderSource');
  });

  // Three different operator actions, so three different states. An order with
  // no external id was never asked about; folding it into `unavailable` would
  // say the marketplace was asked and stayed silent.
  it('should report an unmapped order as no-source-mapping, never as unavailable', async () => {
    identifierMapping.getExternalIds.mockResolvedValue([]);

    const view = await service.read(ORDER_ID);

    expect(view.unmappedReason).toBe('no-source-mapping');
    expect(view.readback).toBeNull();
    expect(view.externalOrderId).toBeNull();
    expect(integrations.getCapabilityAdapter).not.toHaveBeenCalled();
  });

  it('should report a source with no readback as unsupported', async () => {
    integrations.getCapabilityAdapter.mockResolvedValue({ listOrderFeed: jest.fn() });

    const view = await service.read(ORDER_ID);

    expect(view.readback).toMatchObject(
      expect.objectContaining({ outcome: 'unsupported', rawStatus: null, dispatched: null })
    );
    expect(view.unmappedReason).toBeNull();
  });

  it('should report an unresolvable adapter as unavailable, not as unsupported', async () => {
    integrations.getCapabilityAdapter.mockRejectedValue(new Error('connection is disabled'));

    const view = await service.read(ORDER_ID);

    expect(view.readback?.outcome).toBe('unavailable');
  });

  // The capability's contract forbids throwing for a marketplace-side
  // condition, but an out-of-tree adapter is not bound by a docblock and this
  // is a read surface.
  it('should survive an adapter that throws instead of reporting an outcome', async () => {
    integrations.getCapabilityAdapter.mockResolvedValue({
      readFulfillment: jest.fn().mockRejectedValue(new Error('boom')),
    });

    const view = await service.read(ORDER_ID);

    expect(view.readback?.outcome).toBe('unavailable');
  });

  it('should still answer when the connection name cannot be resolved', async () => {
    integrations.getAdapter.mockRejectedValue(new Error('disabled'));
    integrations.getCapabilityAdapter.mockResolvedValue({
      readFulfillment: jest
        .fn()
        .mockResolvedValue(unsupportedSourceFulfillmentReadback('no readback')),
    });

    const view = await service.read(ORDER_ID);

    expect(view.sourceConnectionName).toBeNull();
    expect(view.sourceConnectionId).toBe(SOURCE);
  });

  it('should throw OrderRecordNotFoundException for an order that does not exist', async () => {
    orderRecords.getOrderRecord.mockResolvedValue(null);

    await expect(service.read('ol_order_missing')).rejects.toBeInstanceOf(
      OrderRecordNotFoundException
    );
  });

  // The read must never be mistakable for an action: it writes nothing and
  // touches no order state.
  it('should write nothing anywhere', async () => {
    integrations.getCapabilityAdapter.mockResolvedValue({
      readFulfillment: jest
        .fn()
        .mockResolvedValue({ outcome: 'read', rawStatus: 'NEW', dispatched: false, waybills: null }),
    });

    await service.read(ORDER_ID);

    expect(Object.keys(orderRecords)).toEqual(['getOrderRecord']);
    expect(Object.keys(identifierMapping)).toEqual(['getExternalIds']);
  });
});

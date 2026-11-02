/**
 * BenchLabelService (#3654)
 */
import type { FulfillmentWorkView } from '@openlinker/core/fulfillment';
import {
  CapabilityNotEnabledException,
  type IIntegrationsService,
} from '@openlinker/core/integrations';
import type { IOrderRecordService } from '@openlinker/core/orders';
import type {
  IShipmentCancellationService,
  IShipmentDispatchService,
  IShipmentQueryService,
  Shipment,
} from '@openlinker/core/shipping';
import type { SyncLockPort } from '@openlinker/core/sync';
import { orderFromReadySnapshot } from '@openlinker/core/orders';

import type {
  AutoDispatchPlanContext,
  IAutoDispatchPlanContextLoader,
} from '../../../fulfillment/application/services/auto-dispatch-plan-context.loader';
import type { IBenchParcelService } from '../interfaces/bench-parcel.service.interface';
import { BenchLabelService, BenchLabelShipmentNotFoundError } from '../services/bench-label.service';
import { BenchParcelNotAtThisBenchError } from '../services/bench-parcel.service';

jest.mock('@openlinker/core/orders', () => ({
  ...jest.requireActual<Record<string, unknown>>('@openlinker/core/orders'),
  orderFromReadySnapshot: jest.fn(),
}));

function shipment(overrides: Partial<Shipment> = {}): Shipment {
  return {
    id: 'ship-1',
    orderId: 'ol_order_1',
    connectionId: 'conn-carrier',
    status: 'generated',
    providerShipmentId: 'prov-1',
    createdAt: new Date('2026-09-01T10:00:00Z'),
    ...overrides,
  } as Shipment;
}

const work = (o: Partial<FulfillmentWorkView> = {}): FulfillmentWorkView =>
  ({ id: 'work-1', orderId: 'ol_order_1', assignedConnectionId: 'conn-oms', completedAt: null, ...o }) as FulfillmentWorkView;

/** A work with one line, plus everything the shared decision reads, by default fully deliverable. */
const workWithLine = (o: Partial<FulfillmentWorkView> = {}): FulfillmentWorkView =>
  work({
    lines: [{ productVariantId: 'v1', totalQuantity: 1, cancelledQuantity: 0 }],
    ...o,
  } as Partial<FulfillmentWorkView>);

function planContextFor(overrides: Partial<AutoDispatchPlanContext> = {}): AutoDispatchPlanContext {
  return {
    record: { sourceConnectionId: 'src', sourceDeliveryMethodId: 'dm' },
    order: {
      customerEmail: 'a@b.pl',
      shipping: { methodId: 'courier', methodName: 'Courier' },
      shippingAddress: {
        firstName: 'A', lastName: 'B', phone: '500', address1: 'Street 1', city: 'City',
        postalCode: '00-001', country: 'PL',
      },
    },
    parcelProfile: null,
    variantWeightGrams: new Map([['v1', 700]]),
    requirementsFor: () => null,
    ...overrides,
  } as unknown as AutoDispatchPlanContext;
}

describe('BenchLabelService', () => {
  let parcels: jest.Mocked<IBenchParcelService>;
  let shipments: jest.Mocked<IShipmentQueryService>;
  let cancellation: jest.Mocked<IShipmentCancellationService>;
  let dispatch: jest.Mocked<IShipmentDispatchService>;
  let orderRecords: jest.Mocked<IOrderRecordService>;
  let integrations: jest.Mocked<IIntegrationsService>;
  let lock: jest.Mocked<SyncLockPort>;
  let planContext: jest.Mocked<IAutoDispatchPlanContextLoader>;
  let service: BenchLabelService;

  const input = (parcel: Parameters<BenchLabelService['replaceLabel']>[0]['parcel']) => ({
    workId: 'work-1',
    parcel,
    actorUserId: 'user-1',
  });

  beforeEach(() => {
    parcels = { getWorkForDocuments: jest.fn().mockResolvedValue(work()) } as unknown as jest.Mocked<IBenchParcelService>;
    shipments = {
      findByFulfillmentWorkIds: jest.fn().mockResolvedValue(new Map([['work-1', [shipment()]]])),
    } as unknown as jest.Mocked<IShipmentQueryService>;
    cancellation = {
      cancel: jest.fn().mockResolvedValue({ shipment: shipment({ status: 'cancelled' }), cancelledAfterDispatch: false }),
    } as unknown as jest.Mocked<IShipmentCancellationService>;
    dispatch = {
      dispatch: jest.fn().mockResolvedValue({ kind: 'dispatched', shipment: shipment({ id: 'ship-2' }) }),
    } as unknown as jest.Mocked<IShipmentDispatchService>;
    orderRecords = {
      getOrderRecord: jest.fn().mockResolvedValue({ sourceConnectionId: 'src', sourceDeliveryMethodId: 'dm' }),
    } as unknown as jest.Mocked<IOrderRecordService>;
    integrations = {
      getCapabilityAdapter: jest.fn().mockResolvedValue({ cancelShipment: jest.fn() }),
      getAdapter: jest.fn().mockResolvedValue({ connection: { config: { autoDispatch: { enabled: true, parcelTemplate: 'small' } } } }),
    } as unknown as jest.Mocked<IIntegrationsService>;
    lock = {
      acquire: jest.fn().mockResolvedValue('tok'),
      release: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<SyncLockPort>;
    (orderFromReadySnapshot as jest.Mock).mockReturnValue({
      customerEmail: 'a@b.pl',
      shipping: { methodId: 'courier', methodName: 'Courier' },
      shippingAddress: {
        firstName: 'A', lastName: 'B', phone: '500', address1: 'Street 1', city: 'City',
        postalCode: '00-001', country: 'PL',
      },
    });
    planContext = { load: jest.fn().mockResolvedValue(planContextFor()) };
    service = new BenchLabelService(
      parcels,
      shipments,
      cancellation,
      dispatch,
      orderRecords,
      integrations,
      lock,
      planContext
    );
  });

  it('should cancel the old label and buy a new one with the packer parcel when everything allows it', async () => {
    const result = await service.replaceLabel(input({ kind: 'template', template: 'large' }));

    expect(result).toEqual({
      outcome: 'replaced', cancelledShipmentId: 'ship-1', newShipmentId: 'ship-2', cancelledAfterDispatch: false,
      keptTemplate: null,
    });
    expect(cancellation.cancel).toHaveBeenCalledWith('ship-1');
    const arg = dispatch.dispatch.mock.calls[0][0];
    expect(arg.parcel).toEqual({ template: 'large' });
    expect(arg.fulfillmentWorkId).toBe('work-1');
    expect(arg.recipient.email).toBe('a@b.pl');
    expect(lock.release).toHaveBeenCalledWith('bench:label-replace:work:work-1', 'tok');
  });

  it('should build a box parcel from dimensions and weight', async () => {
    await service.replaceLabel(input({ kind: 'box', lengthMm: 300, widthMm: 200, heightMm: 100, weightGrams: 900 }));
    expect(dispatch.dispatch.mock.calls[0][0].parcel).toEqual({
      dimensions: { length: 300, width: 200, height: 100 }, weightGrams: 900,
    });
  });

  it('should keep the configured size when only the weight is corrected', async () => {
    await service.replaceLabel(input({ kind: 'weight', weightGrams: 1200 }));
    expect(dispatch.dispatch.mock.calls[0][0].parcel).toEqual({ template: 'small', weightGrams: 1200 });
  });

  it('should report the configured size it bought with when only the weight is corrected', async () => {
    const result = await service.replaceLabel(input({ kind: 'weight', weightGrams: 1200 }));
    expect(result).toMatchObject({ outcome: 'replaced', keptTemplate: 'small' });
  });

  it('should report no kept size when the packer named a size or measured the box', async () => {
    expect(
      await service.replaceLabel(input({ kind: 'template', template: 'large' }))
    ).toMatchObject({
      keptTemplate: null,
    });
    expect(
      await service.replaceLabel(
        input({ kind: 'box', lengthMm: 1, widthMm: 1, heightMm: 1, weightGrams: 1 })
      )
    ).toMatchObject({ keptTemplate: null });
  });

  it('should refuse parcel-size-unknown without cancelling when weight-only has no configured size', async () => {
    integrations.getAdapter.mockResolvedValue({ connection: { config: {} } } as never);
    const result = await service.replaceLabel(input({ kind: 'weight', weightGrams: 1200 }));
    expect(result).toEqual({ outcome: 'refused', reason: 'parcel-size-unknown' });
    expect(cancellation.cancel).not.toHaveBeenCalled();
  });

  it('should refuse parcel-completed without side effects when the box is already completed', async () => {
    parcels.getWorkForDocuments.mockResolvedValue(work({ completedAt: new Date() }));
    const result = await service.replaceLabel(input({ kind: 'template', template: 'a' }));
    expect(result).toEqual({ outcome: 'refused', reason: 'parcel-completed' });
    expect(cancellation.cancel).not.toHaveBeenCalled();
    expect(dispatch.dispatch).not.toHaveBeenCalled();
  });

  it.each(['delivered', 'in-transit'])('should refuse already-handed-over when the shipment is %s', async (status) => {
    shipments.findByFulfillmentWorkIds.mockResolvedValue(new Map([['work-1', [shipment({ status: status as never })]]]));
    const result = await service.replaceLabel(input({ kind: 'template', template: 'a' }));
    expect(result).toEqual({ outcome: 'refused', reason: 'already-handed-over' });
    expect(cancellation.cancel).not.toHaveBeenCalled();
  });

  it('should refuse cannot-cancel when the provider has no ShipmentCanceller', async () => {
    integrations.getCapabilityAdapter.mockResolvedValue({} as never);
    const result = await service.replaceLabel(input({ kind: 'template', template: 'a' }));
    expect(result).toEqual({ outcome: 'refused', reason: 'cannot-cancel' });
    expect(cancellation.cancel).not.toHaveBeenCalled();
    expect(dispatch.dispatch).not.toHaveBeenCalled();
  });

  it('should refuse cannot-cancel when the connection does not carry the shipping capability', async () => {
    integrations.getCapabilityAdapter.mockRejectedValue(
      new CapabilityNotEnabledException('conn-carrier', 'inpost', 'ShippingProviderManager')
    );
    const result = await service.replaceLabel(input({ kind: 'template', template: 'a' }));
    expect(result).toEqual({ outcome: 'refused', reason: 'cannot-cancel' });
    expect(cancellation.cancel).not.toHaveBeenCalled();
  });

  it('should refuse adapter-unresolved, not cannot-cancel, when the connection cannot be resolved right now', async () => {
    integrations.getCapabilityAdapter.mockRejectedValue(
      new Error('connection conn-carrier is disabled')
    );
    const result = await service.replaceLabel(input({ kind: 'template', template: 'a' }));
    expect(result).toEqual({ outcome: 'refused', reason: 'adapter-unresolved' });
    expect(cancellation.cancel).not.toHaveBeenCalled();
    expect(dispatch.dispatch).not.toHaveBeenCalled();
  });

  it('should refuse recipient-unavailable before cancelling when the order has no deliverable address', async () => {
    (orderFromReadySnapshot as jest.Mock).mockReturnValue({ customerEmail: undefined, shipping: undefined });
    const result = await service.replaceLabel(input({ kind: 'template', template: 'a' }));
    expect(result).toEqual({ outcome: 'refused', reason: 'recipient-unavailable' });
    expect(cancellation.cancel).not.toHaveBeenCalled();
  });

  it('should refuse no-label when the only shipment never got a provider label', async () => {
    shipments.findByFulfillmentWorkIds.mockResolvedValue(new Map([['work-1', [shipment({ providerShipmentId: null })]]]));
    const result = await service.replaceLabel(input({ kind: 'template', template: 'a' }));
    expect(result).toEqual({ outcome: 'refused', reason: 'no-label' });
  });

  it('should throw BenchLabelShipmentNotFoundError when the work has no shipment', async () => {
    shipments.findByFulfillmentWorkIds.mockResolvedValue(new Map());
    await expect(service.replaceLabel(input({ kind: 'template', template: 'a' }))).rejects.toBeInstanceOf(
      BenchLabelShipmentNotFoundError
    );
  });

  it('should propagate the scoping error when the work is not a parcel of this bench', async () => {
    parcels.getWorkForDocuments.mockRejectedValue(new BenchParcelNotAtThisBenchError('work-1'));
    await expect(service.replaceLabel(input({ kind: 'template', template: 'a' }))).rejects.toBeInstanceOf(
      BenchParcelNotAtThisBenchError
    );
    expect(lock.acquire).not.toHaveBeenCalled();
  });

  it('should report cancelled-not-replaced when the re-buy fails after a successful cancel', async () => {
    dispatch.dispatch.mockRejectedValue(new Error('carrier down'));
    const result = await service.replaceLabel(input({ kind: 'template', template: 'a' }));
    expect(result).toEqual({
      outcome: 'cancelled-not-replaced',
      cancelledShipmentId: 'ship-1',
      cancelledAfterDispatch: false,
      voidState: 'confirmed',
      keptTemplate: null,
    });
    expect(lock.release).toHaveBeenCalled();
  });

  it('should report the void as in-doubt and buy nothing when the cancel itself throws', async () => {
    cancellation.cancel.mockRejectedValue(new Error('carrier timeout'));
    const result = await service.replaceLabel(input({ kind: 'weight', weightGrams: 1200 }));
    expect(result).toEqual({
      outcome: 'cancelled-not-replaced',
      cancelledShipmentId: 'ship-1',
      cancelledAfterDispatch: false,
      voidState: 'in-doubt',
      keptTemplate: 'small',
    });
    expect(dispatch.dispatch).not.toHaveBeenCalled();
    expect(lock.release).toHaveBeenCalledWith('bench:label-replace:work:work-1', 'tok');
  });

  it('should carry the dispatched state into an in-doubt void when the old label was already dispatched', async () => {
    shipments.findByFulfillmentWorkIds.mockResolvedValue(
      new Map([['work-1', [shipment({ status: 'dispatched' as never })]]])
    );
    cancellation.cancel.mockRejectedValue(new Error('carrier timeout'));
    const result = await service.replaceLabel(input({ kind: 'template', template: 'a' }));
    expect(result).toMatchObject({
      outcome: 'cancelled-not-replaced',
      voidState: 'in-doubt',
      cancelledAfterDispatch: true,
    });
  });

  it('should refuse replace-in-progress and touch nothing when the per-work lock is held', async () => {
    lock.acquire.mockResolvedValue(null as never);
    const result = await service.replaceLabel(input({ kind: 'template', template: 'a' }));
    expect(result).toEqual({ outcome: 'refused', reason: 'replace-in-progress' });
    expect(cancellation.cancel).not.toHaveBeenCalled();
    expect(lock.release).not.toHaveBeenCalled();
  });

  describe('generateLabel (#2729, D46)', () => {
    const generate = () => service.generateLabel({ workId: 'work-1', actorUserId: 'user-1' });

    beforeEach(() => {
      // The state D46 is for: automatic labels OFF, a fallback weight configured, no label yet.
      parcels.getWorkForDocuments.mockResolvedValue(workWithLine());
      integrations.getAdapter.mockResolvedValue({
        connection: { config: { autoDispatch: { enabled: false, defaultWeightGrams: 300 } } },
      } as never);
      shipments.findByFulfillmentWorkIds.mockResolvedValue(new Map([['work-1', []]]));
    });

    it('should buy the label from the catalogue weight and the order recipient, typing nothing', async () => {
      const result = await generate();

      expect(result).toEqual({ outcome: 'generated', shipmentId: 'ship-2' });
      const arg = dispatch.dispatch.mock.calls[0][0];
      expect(arg.parcel).toEqual({ weightGrams: 700 });
      expect(arg.fulfillmentWorkId).toBe('work-1');
      expect(arg.recipient.email).toBe('a@b.pl');
      expect(lock.release).toHaveBeenCalledWith('bench:label-generate:work:work-1', 'tok');
    });

    it('should resolve the parcel from the configured defaults even though auto-dispatch is off', async () => {
      planContext.load.mockResolvedValue(planContextFor({ variantWeightGrams: new Map() }));

      await generate();

      // No catalogue weight: the connection's fallback (read regardless of `enabled`) is used.
      expect(dispatch.dispatch.mock.calls[0][0].parcel).toEqual({ weightGrams: 300 });
    });

    it('should refuse auto-dispatch-on and buy nothing while automatic labels are enabled', async () => {
      integrations.getAdapter.mockResolvedValue({
        connection: { config: { autoDispatch: { enabled: true } } },
      } as never);

      expect(await generate()).toEqual({ outcome: 'refused', reason: 'auto-dispatch-on' });
      expect(dispatch.dispatch).not.toHaveBeenCalled();
    });

    it('should refuse already-has-label when a shipment already reached the provider', async () => {
      shipments.findByFulfillmentWorkIds.mockResolvedValue(new Map([['work-1', [shipment()]]]));

      expect(await generate()).toEqual({ outcome: 'refused', reason: 'already-has-label' });
      expect(dispatch.dispatch).not.toHaveBeenCalled();
    });

    it('should not count a shipment that never got a provider id as a label', async () => {
      shipments.findByFulfillmentWorkIds.mockResolvedValue(
        new Map([['work-1', [shipment({ providerShipmentId: null })]]])
      );

      expect(await generate()).toMatchObject({ outcome: 'generated' });
    });

    it.each([
      ['no-weight', planContextFor({ variantWeightGrams: new Map() }), {}],
      ['no-address', planContextFor({ order: { customerEmail: '' } as never }), { defaultWeightGrams: 300 }],
      ['no-dimensions', planContextFor({ requirementsFor: () => ({ requiresDimensions: true }) }), { defaultWeightGrams: 300 }],
    ])('should refuse %s from the shared decision, before the carrier is called', async (reason, context, defaults) => {
      integrations.getAdapter.mockResolvedValue({
        connection: { config: { autoDispatch: { enabled: false, ...defaults } } },
      } as never);
      planContext.load.mockResolvedValue(context);

      expect(await generate()).toEqual({ outcome: 'refused', reason });
      expect(dispatch.dispatch).not.toHaveBeenCalled();
    });

    it('should accept a configured default box for a carrier that requires dimensions', async () => {
      integrations.getAdapter.mockResolvedValue({
        connection: {
          config: { autoDispatch: { enabled: false, lengthMm: 300, widthMm: 200, heightMm: 100 } },
        },
      } as never);
      planContext.load.mockResolvedValue(
        planContextFor({ requirementsFor: () => ({ requiresDimensions: true }) })
      );

      await generate();

      expect(dispatch.dispatch.mock.calls[0][0].parcel.dimensions).toEqual({
        length: 300,
        width: 200,
        height: 100,
      });
    });

    it('should refuse order-unreadable when the order cannot be read', async () => {
      planContext.load.mockResolvedValue(planContextFor({ order: null }));
      expect(await generate()).toEqual({ outcome: 'refused', reason: 'order-unreadable' });

      planContext.load.mockResolvedValue(null);
      expect(await generate()).toEqual({ outcome: 'refused', reason: 'order-unreadable' });
    });

    it('should refuse holder-unresolved when the work has no holder or its connection fails', async () => {
      parcels.getWorkForDocuments.mockResolvedValue(workWithLine({ assignedConnectionId: null }));
      expect(await generate()).toEqual({ outcome: 'refused', reason: 'holder-unresolved' });

      parcels.getWorkForDocuments.mockResolvedValue(workWithLine());
      integrations.getAdapter.mockRejectedValue(new Error('connection disabled'));
      expect(await generate()).toEqual({ outcome: 'refused', reason: 'holder-unresolved' });
      expect(dispatch.dispatch).not.toHaveBeenCalled();
    });

    it('should refuse no-label-processor when routing resolves to a processor that buys no label', async () => {
      dispatch.dispatch.mockResolvedValue({ kind: 'omp-fulfilled' } as never);

      expect(await generate()).toEqual({ outcome: 'refused', reason: 'no-label-processor' });
    });

    it('should answer carrier-refused, not throw, when the carrier rejects the label', async () => {
      dispatch.dispatch.mockRejectedValue(new Error('carrier said no'));

      expect(await generate()).toEqual({ outcome: 'refused', reason: 'carrier-refused' });
    });

    it('should refuse generate-in-progress and touch nothing when the per-work lock is held', async () => {
      lock.acquire.mockResolvedValue(null as never);

      expect(await generate()).toEqual({ outcome: 'refused', reason: 'generate-in-progress' });
      expect(dispatch.dispatch).not.toHaveBeenCalled();
      expect(lock.release).not.toHaveBeenCalled();
    });

    it('should let a work outside this bench surface as the scoping error, before anything else', async () => {
      parcels.getWorkForDocuments.mockRejectedValue(new BenchParcelNotAtThisBenchError('work-1'));

      await expect(generate()).rejects.toBeInstanceOf(BenchParcelNotAtThisBenchError);
      expect(lock.acquire).not.toHaveBeenCalled();
    });
  });
});

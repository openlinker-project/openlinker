/**
 * BenchLabelService (#3654)
 */
import type { FulfillmentWorkView } from '@openlinker/core/fulfillment';
import type { IIntegrationsService } from '@openlinker/core/integrations';
import type { IOrderRecordService } from '@openlinker/core/orders';
import type {
  IShipmentCancellationService,
  IShipmentDispatchService,
  IShipmentQueryService,
  Shipment,
} from '@openlinker/core/shipping';
import type { SyncLockPort } from '@openlinker/core/sync';
import { orderFromReadySnapshot } from '@openlinker/core/orders';

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

describe('BenchLabelService', () => {
  let parcels: jest.Mocked<IBenchParcelService>;
  let shipments: jest.Mocked<IShipmentQueryService>;
  let cancellation: jest.Mocked<IShipmentCancellationService>;
  let dispatch: jest.Mocked<IShipmentDispatchService>;
  let orderRecords: jest.Mocked<IOrderRecordService>;
  let integrations: jest.Mocked<IIntegrationsService>;
  let lock: jest.Mocked<SyncLockPort>;
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
    service = new BenchLabelService(parcels, shipments, cancellation, dispatch, orderRecords, integrations, lock);
  });

  it('should cancel the old label and buy a new one with the packer parcel when everything allows it', async () => {
    const result = await service.replaceLabel(input({ kind: 'template', template: 'large' }));

    expect(result).toEqual({
      outcome: 'replaced', cancelledShipmentId: 'ship-1', newShipmentId: 'ship-2', cancelledAfterDispatch: false,
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
      outcome: 'cancelled-not-replaced', cancelledShipmentId: 'ship-1', cancelledAfterDispatch: false,
    });
    expect(lock.release).toHaveBeenCalled();
  });

  it('should refuse replace-in-progress and touch nothing when the per-work lock is held', async () => {
    lock.acquire.mockResolvedValue(null as never);
    const result = await service.replaceLabel(input({ kind: 'template', template: 'a' }));
    expect(result).toEqual({ outcome: 'refused', reason: 'replace-in-progress' });
    expect(cancellation.cancel).not.toHaveBeenCalled();
    expect(lock.release).not.toHaveBeenCalled();
  });
});

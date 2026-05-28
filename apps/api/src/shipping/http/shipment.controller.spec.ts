/**
 * Shipment Controller unit tests (#846).
 *
 * Mocks the three `I*Service` seams and asserts: list filter/pagination
 * mapping (incl. date coercion + hasTracking), active/by-id 404s, generate-label
 * delegation + both result kinds, cancel delegation, and the domain→HTTP
 * exception mapping.
 */

import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  type IShipmentCancellationService,
  type IShipmentDispatchNotificationService,
  type IShipmentDispatchService,
  type IShipmentQueryService,
  Shipment,
  ShipmentCancellationNotSupportedException,
  ShipmentNotCancellableException,
  ShipmentNotFoundException,
  UndispatchableResolutionException,
} from '@openlinker/core/shipping';

import type { IOrderRecordService, OrderRecord } from '@openlinker/core/orders';

import { ShipmentController } from './shipment.controller';
import type { GenerateLabelDto } from './dto/generate-label.dto';
import type { ListShipmentsQueryDto } from './dto/list-shipments-query.dto';

function makeShipment(overrides: Partial<Shipment> = {}): Shipment {
  return new Shipment(
    overrides.id ?? 'ol_shipment_1',
    overrides.orderId ?? 'ol_order_1',
    overrides.connectionId ?? 'b3f1c2d4-0000-4000-8000-000000000001',
    overrides.shippingMethod ?? 'paczkomat',
    overrides.status ?? 'generated',
    overrides.providerShipmentId ?? 'shipx-1',
    overrides.paczkomatId ?? 'POZ08A',
    overrides.trackingNumber ?? '6800000001',
    overrides.labelPdfRef ?? 'shipx:label:1',
    null,
    null,
    null,
    null,
    null,
    new Date('2026-05-20T10:00:00.000Z'),
    new Date('2026-05-20T10:00:00.000Z'),
    overrides.sourceDeliveryMethodId ?? null,
    overrides.carrier ?? null,
  );
}

function makeGenerateLabelDto(overrides: Partial<GenerateLabelDto> = {}): GenerateLabelDto {
  return {
    sourceConnectionId: 'a1b2c3d4-0000-4000-8000-000000000002',
    orderId: 'ol_order_1',
    shippingMethod: 'kurier',
    recipient: { email: 'buyer@example.com', phone: '+48500600700' },
    parcel: { template: 'medium' },
    ...overrides,
  } as GenerateLabelDto;
}

describe('ShipmentController', () => {
  let query: jest.Mocked<IShipmentQueryService>;
  let dispatch: jest.Mocked<IShipmentDispatchService>;
  let cancellation: jest.Mocked<IShipmentCancellationService>;
  let notification: jest.Mocked<IShipmentDispatchNotificationService>;
  let orders: jest.Mocked<IOrderRecordService>;
  let controller: ShipmentController;

  beforeEach(() => {
    query = {
      list: jest.fn(),
      getById: jest.fn(),
      getActiveByOrderId: jest.fn(),
    };
    dispatch = { dispatch: jest.fn() };
    cancellation = { cancel: jest.fn() };
    notification = { notifyDispatched: jest.fn() };
    orders = {
      persistOrder: jest.fn(),
      updateSyncStatus: jest.fn(),
      persistIncomingSnapshot: jest.fn(),
      // Default: order/customer unknown → customerId resolves to null.
      getOrderRecord: jest.fn().mockResolvedValue(null),
    };
    controller = new ShipmentController(query, dispatch, cancellation, notification, orders);
  });

  describe('list', () => {
    it('should map filters (with date coercion + hasTracking) and echo pagination', async () => {
      query.list.mockResolvedValue({ items: [makeShipment()], total: 1 });
      const dto: ListShipmentsQueryDto = {
        status: 'generated',
        hasTracking: false,
        createdFrom: '2026-05-01T00:00:00.000Z',
        createdTo: '2026-05-31T23:59:59.000Z',
        limit: 10,
        offset: 20,
      };

      const result = await controller.list(dto);

      expect(query.list).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'generated',
          hasTracking: false,
          createdFrom: new Date('2026-05-01T00:00:00.000Z'),
          createdTo: new Date('2026-05-31T23:59:59.000Z'),
        }),
        { limit: 10, offset: 20 },
      );
      expect(result.total).toBe(1);
      expect(result.limit).toBe(10);
      expect(result.offset).toBe(20);
      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe('ol_shipment_1');
    });

    it('should default limit/offset and leave undefined date bounds undefined', async () => {
      query.list.mockResolvedValue({ items: [], total: 0 });

      await controller.list({});

      expect(query.list).toHaveBeenCalledWith(
        expect.objectContaining({ createdFrom: undefined, createdTo: undefined }),
        { limit: 20, offset: 0 },
      );
    });

    it("should resolve each row's customerId from its order (deduped) and set it on the DTO", async () => {
      query.list.mockResolvedValue({
        items: [
          makeShipment({ id: 'ol_shipment_1', orderId: 'ol_order_1' }),
          makeShipment({ id: 'ol_shipment_2', orderId: 'ol_order_1' }), // same order → deduped
          makeShipment({ id: 'ol_shipment_3', orderId: 'ol_order_2' }),
        ],
        total: 3,
      });
      orders.getOrderRecord.mockImplementation((orderId: string) =>
        Promise.resolve(
          orderId === 'ol_order_1'
            ? ({ customerId: 'ol_customer_a' } as OrderRecord)
            : ({ customerId: null } as OrderRecord),
        ),
      );

      const result = await controller.list({});

      expect(result.items[0].customerId).toBe('ol_customer_a');
      expect(result.items[1].customerId).toBe('ol_customer_a');
      expect(result.items[2].customerId).toBeNull();
      // Deduped: 2 distinct order ids → 2 lookups, not 3.
      expect(orders.getOrderRecord).toHaveBeenCalledTimes(2);
    });

    it('should degrade customerId to null (not 500) when an order lookup fails', async () => {
      query.list.mockResolvedValue({ items: [makeShipment({ orderId: 'ol_order_x' })], total: 1 });
      orders.getOrderRecord.mockRejectedValue(new Error('db blip'));

      const result = await controller.list({});

      expect(result.items).toHaveLength(1);
      expect(result.items[0].customerId).toBeNull();
    });
  });

  describe('getActive', () => {
    it('should throw BadRequest when orderId is missing', async () => {
      await expect(controller.getActive(undefined)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('should throw NotFound when no active shipment exists', async () => {
      query.getActiveByOrderId.mockResolvedValue(null);
      await expect(controller.getActive('ol_order_1')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('should return the active shipment', async () => {
      query.getActiveByOrderId.mockResolvedValue(makeShipment());
      const result = await controller.getActive('ol_order_1');
      expect(result.id).toBe('ol_shipment_1');
    });
  });

  describe('getById', () => {
    it('should throw NotFound when absent', async () => {
      query.getById.mockResolvedValue(null);
      await expect(controller.getById('missing')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('should return the shipment DTO', async () => {
      query.getById.mockResolvedValue(makeShipment());
      const result = await controller.getById('ol_shipment_1');
      expect(result.trackingNumber).toBe('6800000001');
    });
  });

  describe('generateLabel', () => {
    it('should build the dispatch input (null source method) and return the dispatched result', async () => {
      const shipment = makeShipment();
      dispatch.dispatch.mockResolvedValue({ kind: 'dispatched', shipment });

      const result = await controller.generateLabel(makeGenerateLabelDto());

      expect(dispatch.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({ sourceDeliveryMethodId: null, orderId: 'ol_order_1' }),
      );
      expect(result.kind).toBe('dispatched');
      expect(result.shipment?.id).toBe('ol_shipment_1');
    });

    it('should return omp_fulfilled with no shipment', async () => {
      dispatch.dispatch.mockResolvedValue({ kind: 'omp_fulfilled' });
      const result = await controller.generateLabel(makeGenerateLabelDto());
      expect(result.kind).toBe('omp_fulfilled');
      expect(result.shipment).toBeUndefined();
    });

    it('should map UndispatchableResolutionException to 422', async () => {
      dispatch.dispatch.mockRejectedValue(new UndispatchableResolutionException('no connection'));
      await expect(controller.generateLabel(makeGenerateLabelDto())).rejects.toBeInstanceOf(
        UnprocessableEntityException,
      );
    });

    it('should map a provider failure to 502', async () => {
      dispatch.dispatch.mockRejectedValue(new Error('paczkomat unavailable'));
      await expect(controller.generateLabel(makeGenerateLabelDto())).rejects.toBeInstanceOf(
        BadGatewayException,
      );
    });
  });

  describe('cancel', () => {
    it('should return the cancelled shipment', async () => {
      cancellation.cancel.mockResolvedValue(makeShipment({ status: 'cancelled' }));
      const result = await controller.cancel('ol_shipment_1');
      expect(result.status).toBe('cancelled');
    });

    it('should map ShipmentNotFoundException to 404', async () => {
      cancellation.cancel.mockRejectedValue(new ShipmentNotFoundException('missing'));
      await expect(controller.cancel('missing')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('should map ShipmentNotCancellableException to 409', async () => {
      cancellation.cancel.mockRejectedValue(
        new ShipmentNotCancellableException('ol_shipment_1', 'status is dispatched'),
      );
      await expect(controller.cancel('ol_shipment_1')).rejects.toBeInstanceOf(ConflictException);
    });

    it('should map ShipmentCancellationNotSupportedException to 422', async () => {
      cancellation.cancel.mockRejectedValue(
        new ShipmentCancellationNotSupportedException('ol_shipment_1', 'conn-x'),
      );
      await expect(controller.cancel('ol_shipment_1')).rejects.toBeInstanceOf(
        UnprocessableEntityException,
      );
    });
  });

  describe('notifyDispatched (#769)', () => {
    it('should delegate to the notification service and return the result DTO on the notified path', async () => {
      notification.notifyDispatched.mockResolvedValue({
        shipmentId: 'ol_shipment_1',
        outcome: 'notified',
        source: 'ok',
        destinations: [
          { connectionId: 'conn-ps', status: 'ok' },
          { connectionId: 'conn-ps-2', status: 'failed' },
        ],
      });

      const response = await controller.notifyDispatched('ol_shipment_1');

      expect(notification.notifyDispatched).toHaveBeenCalledWith({ shipmentId: 'ol_shipment_1' });
      expect(response.shipmentId).toBe('ol_shipment_1');
      expect(response.outcome).toBe('notified');
      expect(response.source).toBe('ok');
      expect(response.destinations).toEqual([
        { connectionId: 'conn-ps', status: 'ok' },
        { connectionId: 'conn-ps-2', status: 'failed' },
      ]);
    });

    it('should pass-through skipped-not-generated as a 200 (idempotent no-op, not an error)', async () => {
      notification.notifyDispatched.mockResolvedValue({
        shipmentId: 'ol_shipment_2',
        outcome: 'skipped-not-generated',
        source: 'absent',
        destinations: [],
      });

      const response = await controller.notifyDispatched('ol_shipment_2');

      expect(response.outcome).toBe('skipped-not-generated');
      expect(response.source).toBe('absent');
      expect(response.destinations).toEqual([]);
    });

    it('should map shipment-not-found to a 404 NotFoundException', async () => {
      notification.notifyDispatched.mockResolvedValue({
        shipmentId: 'missing',
        outcome: 'shipment-not-found',
        source: 'absent',
        destinations: [],
      });

      await expect(controller.notifyDispatched('missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});

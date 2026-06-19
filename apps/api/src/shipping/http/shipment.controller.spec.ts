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
  InternalServerErrorException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  type IBulkShipmentDispatchService,
  type IShipmentCancellationService,
  type IShipmentDispatchNotificationService,
  type IShipmentDispatchService,
  type IShipmentLabelService,
  type IShipmentQueryService,
  type LabelDocument,
  DispatchProtocolNotSupportedException,
  InvalidProtocolBatchException,
  LabelDocumentNotSupportedException,
  LabelNotAvailableException,
  Shipment,
  ShipmentCancellationNotSupportedException,
  ShipmentNotCancellableException,
  ShipmentNotFoundException,
  ShippingProviderAuthException,
  ShippingProviderRejectionException,
  UndispatchableResolutionException,
  OrderNotDispatchablePaymentStatusException,
} from '@openlinker/core/shipping';

import type { IOrderRecordService, OrderRecord } from '@openlinker/core/orders';
import type { Response } from 'express';

import { ShipmentController, extensionForContentType } from './shipment.controller';
import type { BulkGenerateLabelsDto } from './dto/bulk-generate-labels.dto';
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
    overrides.deliveryIntent ?? null,
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
  let bulkDispatch: jest.Mocked<IBulkShipmentDispatchService>;
  let cancellation: jest.Mocked<IShipmentCancellationService>;
  let notification: jest.Mocked<IShipmentDispatchNotificationService>;
  let labelService: jest.Mocked<IShipmentLabelService>;
  let orders: jest.Mocked<IOrderRecordService>;
  let controller: ShipmentController;

  beforeEach(() => {
    query = {
      list: jest.fn(),
      getById: jest.fn(),
      getActiveByOrderId: jest.fn(),
    };
    dispatch = { dispatch: jest.fn() };
    bulkDispatch = { dispatchBulk: jest.fn(), generateProtocol: jest.fn() };
    cancellation = { cancel: jest.fn() };
    notification = { notifyDispatched: jest.fn() };
    labelService = { fetchLabel: jest.fn() };
    orders = {
      persistOrder: jest.fn(),
      updateSyncStatus: jest.fn(),
      persistIncomingSnapshot: jest.fn(),
      // Default: order/customer unknown → customerId resolves to null.
      getOrderRecord: jest.fn().mockResolvedValue(null),
      findMany: jest.fn(),
      updateFulfillmentState: jest.fn(),
    };
    controller = new ShipmentController(
      query,
      dispatch,
      bulkDispatch,
      cancellation,
      notification,
      labelService,
      orders,
    );
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

    it('should pass deliveryIntent through to the dispatch input (#979)', async () => {
      dispatch.dispatch.mockResolvedValue({ kind: 'dispatched', shipment: makeShipment() });

      await controller.generateLabel(
        makeGenerateLabelDto({ deliveryIntent: 'pickup_point', shippingMethod: undefined }),
      );

      expect(dispatch.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({ deliveryIntent: 'pickup_point' }),
      );
    });

    it('should pass COD through to the dispatch input when supplied (#966)', async () => {
      dispatch.dispatch.mockResolvedValue({ kind: 'dispatched', shipment: makeShipment() });

      await controller.generateLabel(makeGenerateLabelDto({ cod: { amount: '129.90', currency: 'PLN' } }));

      expect(dispatch.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({ cod: { amount: '129.90', currency: 'PLN' } }),
      );
    });

    it('should leave cod undefined on the dispatch input when not supplied', async () => {
      dispatch.dispatch.mockResolvedValue({ kind: 'dispatched', shipment: makeShipment() });

      await controller.generateLabel(makeGenerateLabelDto());

      expect((dispatch.dispatch.mock.calls[0][0] as { cod?: unknown }).cod).toBeUndefined();
    });

    it('should map UndispatchableResolutionException to 422', async () => {
      dispatch.dispatch.mockRejectedValue(new UndispatchableResolutionException('no connection'));
      await expect(controller.generateLabel(makeGenerateLabelDto())).rejects.toBeInstanceOf(
        UnprocessableEntityException,
      );
    });

    it('should map OrderNotDispatchablePaymentStatusException to 422', async () => {
      dispatch.dispatch.mockRejectedValue(
        new OrderNotDispatchablePaymentStatusException('ol_order_1', 'awaiting'),
      );
      await expect(controller.generateLabel(makeGenerateLabelDto())).rejects.toBeInstanceOf(
        UnprocessableEntityException,
      );
    });

    it('should map ShippingProviderRejectionException to 502', async () => {
      dispatch.dispatch.mockRejectedValue(
        new ShippingProviderRejectionException('inpost', 'PARCEL_TOO_LARGE', 'parcel exceeds size'),
      );
      await expect(controller.generateLabel(makeGenerateLabelDto())).rejects.toBeInstanceOf(
        BadGatewayException,
      );
    });

    it('should map a ShippingProviderAuthException (carrier 401/403) to 502, not the 500 "Unclassified" path', async () => {
      // Regression: a carrier rejecting OUR credentials previously fell through
      // to 500 + an "Unclassified shipping-command error" log (it was a
      // plugin-private exception the controller couldn't see). It now maps to a
      // deliberate 502.
      dispatch.dispatch.mockRejectedValue(
        new ShippingProviderAuthException('dpd', 'DPDServices … failed (401)'),
      );
      await expect(controller.generateLabel(makeGenerateLabelDto())).rejects.toBeInstanceOf(
        BadGatewayException,
      );
    });

    it('should map an unclassified Error to 500', async () => {
      // Until adapters opt in to ShippingProviderRejectionException, untyped
      // errors fall through to 500 — correct for "we don't know what this is"
      // (DB drop, programming bug, missing config). The controller logs them
      // with stack so triage doesn't lose information.
      dispatch.dispatch.mockRejectedValue(new Error('something broke'));
      await expect(controller.generateLabel(makeGenerateLabelDto())).rejects.toBeInstanceOf(
        InternalServerErrorException,
      );
    });
  });

  describe('bulkGenerateLabels (#964)', () => {
    function makeBulkDto(): BulkGenerateLabelsDto {
      return {
        sourceConnectionId: 'a1b2c3d4-0000-4000-8000-000000000002',
        items: [
          {
            orderId: 'ol_order_1',
            shippingMethod: 'kurier',
            recipient: { email: 'a@example.com', phone: '+48500600700' },
            parcel: { weightGrams: 1000 },
          },
          {
            orderId: 'ol_order_2',
            sourceDeliveryMethodId: 'dm-9',
            shippingMethod: 'kurier',
            recipient: { email: 'b@example.com', phone: '+48500600701' },
            parcel: { weightGrams: 1500 },
          },
        ],
      } as BulkGenerateLabelsDto;
    }

    it('should map each item (defaulting source method to null) and return the per-order results', async () => {
      bulkDispatch.dispatchBulk.mockResolvedValue({
        results: [
          { kind: 'dispatched', orderId: 'ol_order_1', shipment: makeShipment({ orderId: 'ol_order_1' }) },
          { kind: 'failed', orderId: 'ol_order_2', error: 'carrier rejected' },
        ],
      });

      const result = await controller.bulkGenerateLabels(makeBulkDto());

      const call = bulkDispatch.dispatchBulk.mock.calls[0][0];
      expect(call.sourceConnectionId).toBe('a1b2c3d4-0000-4000-8000-000000000002');
      expect(call.items[0]).toMatchObject({ orderId: 'ol_order_1', sourceDeliveryMethodId: null });
      expect(call.items[1]).toMatchObject({ orderId: 'ol_order_2', sourceDeliveryMethodId: 'dm-9' });
      expect(result.results).toHaveLength(2);
      expect(result.results[0]).toMatchObject({ kind: 'dispatched', orderId: 'ol_order_1' });
      expect(result.results[1]).toMatchObject({ kind: 'failed', orderId: 'ol_order_2', error: 'carrier rejected' });
    });
  });

  describe('downloadProtocol (#964)', () => {
    function makeRes(): { res: Response; setHeader: jest.Mock; send: jest.Mock } {
      const setHeader = jest.fn();
      const send = jest.fn();
      const res = { setHeader, send } as unknown as Response;
      return { res, setHeader, send };
    }

    it('should stream the protocol PDF with attachment disposition', async () => {
      bulkDispatch.generateProtocol.mockResolvedValue({
        contentType: 'application/pdf',
        body: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
      });
      const { res, setHeader, send } = makeRes();

      await controller.downloadProtocol({ shipmentIds: ['ol_shipment_1', 'ol_shipment_2'] }, res);

      expect(bulkDispatch.generateProtocol).toHaveBeenCalledWith({
        shipmentIds: ['ol_shipment_1', 'ol_shipment_2'],
      });
      expect(setHeader).toHaveBeenCalledWith('Content-Type', 'application/pdf');
      expect(setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        'attachment; filename="ol-handover-protocol.pdf"',
      );
      expect(send).toHaveBeenCalled();
    });

    it('should map InvalidProtocolBatchException to 400', async () => {
      bulkDispatch.generateProtocol.mockRejectedValue(new InvalidProtocolBatchException('mixed carriers'));
      const { res } = makeRes();

      await expect(controller.downloadProtocol({ shipmentIds: ['x'] }, res)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('should map DispatchProtocolNotSupportedException to 422', async () => {
      bulkDispatch.generateProtocol.mockRejectedValue(new DispatchProtocolNotSupportedException('conn-x'));
      const { res } = makeRes();

      await expect(controller.downloadProtocol({ shipmentIds: ['x'] }, res)).rejects.toBeInstanceOf(
        UnprocessableEntityException,
      );
    });

    it('should map ShippingProviderRejectionException to 502', async () => {
      bulkDispatch.generateProtocol.mockRejectedValue(
        new ShippingProviderRejectionException('dpd', 'PROTOCOL_ERROR', 'boom'),
      );
      const { res } = makeRes();

      await expect(controller.downloadProtocol({ shipmentIds: ['x'] }, res)).rejects.toBeInstanceOf(
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

  describe('downloadLabel', () => {
    function makeRes(): {
      res: Response;
      setHeader: jest.Mock;
      send: jest.Mock;
    } {
      const setHeader = jest.fn();
      const send = jest.fn();
      const res = { setHeader, send } as unknown as Response;
      return { res, setHeader, send };
    }

    it('should stream the bytes with content-type + attachment disposition', async () => {
      const doc: LabelDocument = {
        contentType: 'application/pdf',
        body: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
      };
      labelService.fetchLabel.mockResolvedValue(doc);
      const { res, setHeader, send } = makeRes();

      await controller.downloadLabel('ol_shipment_1', res);

      expect(labelService.fetchLabel).toHaveBeenCalledWith('ol_shipment_1');
      expect(setHeader).toHaveBeenCalledWith('Content-Type', 'application/pdf');
      expect(setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        'attachment; filename="ol-shipment-ol_shipment_1.pdf"',
      );
      expect(send).toHaveBeenCalledWith(Buffer.from(doc.body));
    });

    it('should use the content-type-derived extension for a non-PDF document', async () => {
      labelService.fetchLabel.mockResolvedValue({
        contentType: 'application/zpl',
        body: new Uint8Array([0x5e, 0x58, 0x41]),
      });
      const { res, setHeader } = makeRes();

      await controller.downloadLabel('ol_shipment_1', res);

      expect(setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        'attachment; filename="ol-shipment-ol_shipment_1.zpl"',
      );
    });

    it('should map ShipmentNotFoundException to 404', async () => {
      labelService.fetchLabel.mockRejectedValue(new ShipmentNotFoundException('missing'));
      const { res } = makeRes();

      await expect(controller.downloadLabel('missing', res)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('should map LabelNotAvailableException to 422', async () => {
      labelService.fetchLabel.mockRejectedValue(new LabelNotAvailableException('ol_shipment_1'));
      const { res } = makeRes();

      await expect(controller.downloadLabel('ol_shipment_1', res)).rejects.toBeInstanceOf(
        UnprocessableEntityException,
      );
    });

    it('should map LabelDocumentNotSupportedException to 422', async () => {
      labelService.fetchLabel.mockRejectedValue(
        new LabelDocumentNotSupportedException('ol_shipment_1', 'conn-1'),
      );
      const { res } = makeRes();

      await expect(controller.downloadLabel('ol_shipment_1', res)).rejects.toBeInstanceOf(
        UnprocessableEntityException,
      );
    });

    it('should map ShippingProviderRejectionException to 502', async () => {
      labelService.fetchLabel.mockRejectedValue(
        new ShippingProviderRejectionException('inpost', 'api.http-500', 'boom'),
      );
      const { res } = makeRes();

      await expect(controller.downloadLabel('ol_shipment_1', res)).rejects.toBeInstanceOf(
        BadGatewayException,
      );
    });
  });

  describe('extensionForContentType', () => {
    it.each([
      ['application/pdf', 'pdf'],
      ['application/pdf; charset=binary', 'pdf'],
      ['image/png', 'png'],
      ['application/zpl', 'zpl'],
      ['application/x-zpl', 'zpl'],
      ['application/epl', 'epl'],
      ['', 'bin'],
      ['application/octet-stream', 'bin'],
    ])('maps %s → %s', (ct, ext) => {
      expect(extensionForContentType(ct)).toBe(ext);
    });
  });
});

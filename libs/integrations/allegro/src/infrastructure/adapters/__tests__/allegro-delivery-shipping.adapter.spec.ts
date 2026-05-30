/**
 * Allegro Delivery Shipping Adapter — unit tests (#833)
 *
 * HTTP client fully mocked; the bounded poll runs with zero delays so the
 * async create/cancel command flow is exercised without real waits.
 *
 * @module libs/integrations/allegro/src/infrastructure/adapters/__tests__
 */
import type { Connection } from '@openlinker/core/identifier-mapping';
import type { GenerateLabelCommand, ShippingMethod } from '@openlinker/core/shipping';

import { AllegroApiException } from '../../../domain/exceptions/allegro-api.exception';
import { AllegroShipmentPendingException } from '../../../domain/exceptions/allegro-shipment-pending.exception';
import type {
  AllegroShipmentCommandResult,
  AllegroShipmentResource,
} from '../../../domain/types/allegro-shipment.types';
import type {
  AllegroHttpResponse,
  IAllegroHttpClient,
} from '../../http/allegro-http-client.interface';
import { AllegroDeliveryShippingAdapter } from '../allegro-delivery-shipping.adapter';

const CREATE_PATH = '/shipment-management/shipments/create-commands';
const CANCEL_PATH = '/shipment-management/shipments/cancel-commands';

function ok<T>(data: T, headers: Record<string, string> = {}): AllegroHttpResponse<T> {
  return { data, status: 200, headers };
}

function makeHttp(): jest.Mocked<IAllegroHttpClient> {
  return {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    patch: jest.fn(),
    postBinary: jest.fn(),
    postMultipart: jest.fn(),
    postExpectingBinary: jest.fn(),
  } as unknown as jest.Mocked<IAllegroHttpClient>;
}

function makeCommand(overrides: Partial<GenerateLabelCommand> = {}): GenerateLabelCommand {
  return {
    shipmentId: 'ol_shipment_1',
    orderId: 'ol_order_1',
    connectionId: 'conn-allegro',
    shippingMethod: 'kurier',
    deliveryMethodId: 'allegro-courier-uuid',
    recipient: {
      firstName: 'Jan',
      lastName: 'Kowalski',
      email: 'buyer@allegromail.pl',
      phone: '+48500600700',
      address: {
        street: 'Krakowska',
        buildingNumber: '12',
        city: 'Poznań',
        postCode: '60-001',
        countryCode: 'PL',
      },
    },
    parcel: { dimensions: { length: 200, width: 150, height: 100 }, weightGrams: 1200 },
    ...overrides,
  };
}

describe('AllegroDeliveryShippingAdapter', () => {
  let http: jest.Mocked<IAllegroHttpClient>;
  let adapter: AllegroDeliveryShippingAdapter;

  beforeEach(() => {
    http = makeHttp();
    adapter = new AllegroDeliveryShippingAdapter('conn-allegro', http, {} as Connection, {
      initialDelayMs: 0,
      maxDelayMs: 0,
      backoffFactor: 1,
      maxAttempts: 3,
    });
  });

  describe('getSupportedMethods', () => {
    it('declares the paczkomat and kurier modalities', () => {
      expect(adapter.getSupportedMethods()).toEqual(['paczkomat', 'kurier']);
    });
  });

  describe('generateLabel', () => {
    it('creates the shipment via an async command and returns an opaque label ref', async () => {
      http.post.mockResolvedValue(ok({}));
      http.get.mockResolvedValue(
        ok<AllegroShipmentCommandResult>({
          commandId: 'c1',
          status: 'SUCCESS',
          shipmentId: 'allegro-ship-1',
        }),
      );

      const result = await adapter.generateLabel(makeCommand());

      expect(result).toEqual({
        providerShipmentId: 'allegro-ship-1',
        trackingNumber: null,
        labelPdfRef: 'allegro-delivery:label:allegro-ship-1',
      });
      expect(http.post).toHaveBeenCalledWith(
        CREATE_PATH,
        expect.objectContaining({
          commandId: expect.any(String),
          input: expect.objectContaining({ deliveryMethodId: 'allegro-courier-uuid' }),
        }),
      );
    });

    it('polls through IN_PROGRESS until the command resolves SUCCESS', async () => {
      http.post.mockResolvedValue(ok({}));
      http.get
        .mockResolvedValueOnce(ok<AllegroShipmentCommandResult>({ commandId: 'c1', status: 'IN_PROGRESS' }))
        .mockResolvedValueOnce(
          ok<AllegroShipmentCommandResult>({ commandId: 'c1', status: 'SUCCESS', shipmentId: 'allegro-ship-2' }),
        );

      const result = await adapter.generateLabel(makeCommand());

      expect(result.providerShipmentId).toBe('allegro-ship-2');
      expect(http.get).toHaveBeenCalledTimes(2);
    });

    it('throws a readable rejection when the create command resolves ERROR', async () => {
      http.post.mockResolvedValue(ok({}));
      http.get.mockResolvedValue(
        ok<AllegroShipmentCommandResult>({
          commandId: 'c1',
          status: 'ERROR',
          errors: [
            {
              code: 'ALLEGRO_ONE_OUT_OF_AREA',
              userMessage: 'Sender zip outside the Allegro One service area',
            },
          ],
        }),
      );

      await expect(adapter.generateLabel(makeCommand())).rejects.toMatchObject({
        name: 'ShippingProviderRejectionException',
        providerName: 'allegro',
        providerCode: 'ALLEGRO_ONE_OUT_OF_AREA',
        message: expect.stringContaining('Sender zip outside the Allegro One service area'),
        providerDetails: expect.objectContaining({ errors: expect.any(Array) }),
      });
    });

    it('throws AllegroShipmentPendingException when the poll budget exhausts while IN_PROGRESS', async () => {
      http.post.mockResolvedValue(ok({}));
      http.get.mockResolvedValue(ok<AllegroShipmentCommandResult>({ commandId: 'c1', status: 'IN_PROGRESS' }));

      await expect(adapter.generateLabel(makeCommand())).rejects.toBeInstanceOf(
        AllegroShipmentPendingException,
      );
      expect(http.get).toHaveBeenCalledTimes(3); // maxAttempts
    });

    it('rejects an unsupported shipping method without calling the API (#885)', async () => {
      await expect(
        adapter.generateLabel(makeCommand({ shippingMethod: 'air-freight' as ShippingMethod })),
      ).rejects.toMatchObject({
        name: 'ShippingProviderRejectionException',
        providerName: 'allegro',
        providerCode: 'preflight.unsupported-method',
      });
      expect(http.post).not.toHaveBeenCalled();
    });

    it('wraps an Allegro 4xx API failure on create as api.http-400 (#885)', async () => {
      http.post.mockRejectedValue(
        new AllegroApiException('DELIVERY_METHOD_NOT_AVAILABLE', 400),
      );

      await expect(adapter.generateLabel(makeCommand())).rejects.toMatchObject({
        name: 'ShippingProviderRejectionException',
        providerName: 'allegro',
        providerCode: 'api.http-400',
        message: expect.stringContaining('DELIVERY_METHOD_NOT_AVAILABLE'),
      });
    });

    it('wraps an Allegro 5xx API failure on create as api.http-500 (#885)', async () => {
      http.post.mockRejectedValue(
        new AllegroApiException('Service Unavailable', 503),
      );

      await expect(adapter.generateLabel(makeCommand())).rejects.toMatchObject({
        name: 'ShippingProviderRejectionException',
        providerName: 'allegro',
        providerCode: 'api.http-503',
      });
    });

    it('falls back to api.http-unknown when status is undefined (#885)', async () => {
      http.post.mockRejectedValue(new AllegroApiException('timeout'));

      await expect(adapter.generateLabel(makeCommand())).rejects.toMatchObject({
        name: 'ShippingProviderRejectionException',
        providerName: 'allegro',
        providerCode: 'api.http-unknown',
      });
    });

    it('rejects (before any API call) when no provider deliveryMethodId was resolved (#885)', async () => {
      await expect(
        adapter.generateLabel(makeCommand({ deliveryMethodId: undefined })),
      ).rejects.toMatchObject({
        name: 'ShippingProviderRejectionException',
        providerName: 'allegro',
        providerCode: 'preflight.missing-delivery-method-id',
      });
      expect(http.post).not.toHaveBeenCalled();
    });
  });

  describe('getTracking', () => {
    it('maps a carrier-waybill shipment to dispatched', async () => {
      http.get.mockResolvedValue(
        ok<AllegroShipmentResource>({
          id: 'allegro-ship-1',
          packages: [{ transportingInfo: [{ carrierId: 'INPOST', carrierWaybill: '6800000001' }] }],
        }),
      );

      await expect(adapter.getTracking({ providerShipmentId: 'allegro-ship-1' })).resolves.toEqual({
        status: 'dispatched',
        providerStatus: 'waybill-assigned',
        trackingNumber: '6800000001',
        carrier: 'inpost',
      });
    });

    it('populates trackingNumber from transportingInfo.carrierWaybill (#838)', async () => {
      http.get.mockResolvedValue(
        ok<AllegroShipmentResource>({
          id: 'allegro-ship-2',
          packages: [{ transportingInfo: [{ carrierId: 'INPOST', carrierWaybill: 'NEW-WAYBILL' }] }],
        }),
      );
      const snapshot = await adapter.getTracking({ providerShipmentId: 'allegro-ship-2' });
      expect(snapshot.trackingNumber).toBe('NEW-WAYBILL');
    });

    it('populates carrier from transportingInfo.carrierId in canonical-form (#769)', async () => {
      http.get.mockResolvedValue(
        ok<AllegroShipmentResource>({
          id: 'allegro-ship-2b',
          packages: [{ transportingInfo: [{ carrierId: 'DPD', carrierWaybill: 'NEW-WAYBILL' }] }],
        }),
      );
      const snapshot = await adapter.getTracking({ providerShipmentId: 'allegro-ship-2b' });
      expect(snapshot.carrier).toBe('dpd');
    });

    it('leaves trackingNumber + carrier undefined when no carrier waybill has been assigned yet', async () => {
      http.get.mockResolvedValue(ok<AllegroShipmentResource>({ id: 'allegro-ship-3', packages: [{}] }));
      const snapshot = await adapter.getTracking({ providerShipmentId: 'allegro-ship-3' });
      expect(snapshot.trackingNumber).toBeUndefined();
      expect(snapshot.carrier).toBeUndefined();
    });

    it('maps a canceled shipment to cancelled', async () => {
      http.get.mockResolvedValue(
        ok<AllegroShipmentResource>({ id: 'allegro-ship-1', canceledDate: '2026-05-26T10:00:00Z' }),
      );

      await expect(
        adapter.getTracking({ providerShipmentId: 'allegro-ship-1' }),
      ).resolves.toMatchObject({ status: 'cancelled' });
    });

    it('maps a freshly-created shipment to generated', async () => {
      http.get.mockResolvedValue(ok<AllegroShipmentResource>({ id: 'allegro-ship-1', packages: [{}] }));

      await expect(
        adapter.getTracking({ providerShipmentId: 'allegro-ship-1' }),
      ).resolves.toMatchObject({ status: 'generated' });
    });
  });

  describe('cancelShipment', () => {
    it('posts a cancel command and resolves on SUCCESS', async () => {
      http.post.mockResolvedValue(ok({}));
      http.get.mockResolvedValue(ok<AllegroShipmentCommandResult>({ commandId: 'c1', status: 'SUCCESS' }));

      await expect(adapter.cancelShipment({ providerShipmentId: 'allegro-ship-1' })).resolves.toBeUndefined();
      expect(http.post).toHaveBeenCalledWith(
        CANCEL_PATH,
        expect.objectContaining({ input: { shipmentId: 'allegro-ship-1' } }),
      );
    });

    it('throws a typed rejection when the cancel command resolves ERROR (#885)', async () => {
      http.post.mockResolvedValue(ok({}));
      http.get.mockResolvedValue(
        ok<AllegroShipmentCommandResult>({
          commandId: 'c1',
          status: 'ERROR',
          errors: [{ code: 'SHIPMENT_ALREADY_DISPATCHED', message: 'Shipment already dispatched' }],
        }),
      );

      await expect(
        adapter.cancelShipment({ providerShipmentId: 'allegro-ship-1' }),
      ).rejects.toMatchObject({
        name: 'ShippingProviderRejectionException',
        providerName: 'allegro',
        providerCode: 'SHIPMENT_ALREADY_DISPATCHED',
      });
    });
  });

  describe('fetchLabel', () => {
    it('POSTs the label request with the shipment id + page size and returns the bytes', async () => {
      const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // %PDF
      http.postExpectingBinary.mockResolvedValue({
        data: bytes,
        contentType: 'application/pdf',
        status: 200,
        headers: { 'content-type': 'application/pdf' },
      });

      const result = await adapter.fetchLabel({ providerShipmentId: 'allegro-ship-1' });

      expect(http.postExpectingBinary).toHaveBeenCalledWith('/shipment-management/label', {
        shipmentIds: ['allegro-ship-1'],
        pageSize: 'A6',
      });
      expect(result).toEqual({ contentType: 'application/pdf', body: bytes });
    });

    it('passes a non-PDF content type through unchanged (ZPL per seller setting)', async () => {
      http.postExpectingBinary.mockResolvedValue({
        data: new Uint8Array([0x5e, 0x58, 0x41]), // ^XA (ZPL)
        contentType: 'application/zpl',
        status: 200,
        headers: { 'content-type': 'application/zpl' },
      });

      const result = await adapter.fetchLabel({ providerShipmentId: 'allegro-ship-1' });

      expect(result.contentType).toBe('application/zpl');
    });

    it('defaults to application/pdf only when the response carries no content type', async () => {
      http.postExpectingBinary.mockResolvedValue({
        data: new Uint8Array([1, 2]),
        contentType: '',
        status: 200,
        headers: {},
      });

      const result = await adapter.fetchLabel({ providerShipmentId: 'allegro-ship-1' });

      expect(result.contentType).toBe('application/pdf');
    });

    it('wraps an Allegro API failure into a typed ShippingProviderRejectionException', async () => {
      http.postExpectingBinary.mockRejectedValue(
        new AllegroApiException('Label not found', 404, 'body', 'url'),
      );

      await expect(
        adapter.fetchLabel({ providerShipmentId: 'allegro-ship-1' }),
      ).rejects.toMatchObject({
        name: 'ShippingProviderRejectionException',
        providerName: 'allegro',
        providerCode: 'api.http-404',
      });
    });
  });
});

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
import { AllegroShipmentRejectedException } from '../../../domain/exceptions/allegro-shipment-rejected.exception';
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
          errors: [{ userMessage: 'Sender zip outside the Allegro One service area' }],
        }),
      );

      await expect(adapter.generateLabel(makeCommand())).rejects.toMatchObject({
        name: 'AllegroShipmentRejectedException',
        message: expect.stringContaining('Sender zip outside the Allegro One service area'),
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

    it('rejects an unsupported shipping method without calling the API', async () => {
      await expect(
        adapter.generateLabel(makeCommand({ shippingMethod: 'air-freight' as ShippingMethod })),
      ).rejects.toBeInstanceOf(AllegroShipmentRejectedException);
      expect(http.post).not.toHaveBeenCalled();
    });

    it('wraps an Allegro API failure on create into a readable rejection', async () => {
      http.post.mockRejectedValue(
        new AllegroApiException('DELIVERY_METHOD_NOT_AVAILABLE', 400),
      );

      await expect(adapter.generateLabel(makeCommand())).rejects.toMatchObject({
        name: 'AllegroShipmentRejectedException',
        message: expect.stringContaining('DELIVERY_METHOD_NOT_AVAILABLE'),
      });
    });

    it('rejects (before any API call) when no provider deliveryMethodId was resolved', async () => {
      await expect(
        adapter.generateLabel(makeCommand({ deliveryMethodId: undefined })),
      ).rejects.toBeInstanceOf(AllegroShipmentRejectedException);
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
      });
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

    it('throws a readable rejection when the cancel command resolves ERROR', async () => {
      http.post.mockResolvedValue(ok({}));
      http.get.mockResolvedValue(
        ok<AllegroShipmentCommandResult>({
          commandId: 'c1',
          status: 'ERROR',
          errors: [{ message: 'Shipment already dispatched' }],
        }),
      );

      await expect(
        adapter.cancelShipment({ providerShipmentId: 'allegro-ship-1' }),
      ).rejects.toBeInstanceOf(AllegroShipmentRejectedException);
    });
  });
});

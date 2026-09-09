/**
 * Shipping-stub Shipping Adapter — unit tests (#3043)
 *
 * Driven against a mocked `fetchImpl` (never real HTTP) - the point of the
 * unit test is the adapter's own contract, not a network round-trip. The
 * real-network behaviour is exercised on the perf lab stand and by
 * `stubs/shipping/test.mjs` against the actual stub server.
 *
 * @module libs/integrations/shipping-stub/src/infrastructure/adapters/__tests__
 */
import type { GenerateLabelCommand } from '@openlinker/core/shipping';
import type { LoggerPort } from '@openlinker/shared/logging';
import type { FetchLike } from '@openlinker/shared/http';
import { ShippingStubShippingAdapter } from '../shipping-stub-shipping.adapter';

function command(overrides: Partial<GenerateLabelCommand> = {}): GenerateLabelCommand {
  return {
    shipmentId: 'ol_shipment_1',
    orderId: 'ol_order_1',
    connectionId: 'conn-shipping-stub',
    shippingMethod: 'kurier',
    recipient: { email: 'buyer@example.invalid', phone: '+48000000000' },
    parcel: { weightGrams: 500, dimensions: { length: 10, width: 10, height: 10 } },
    ...overrides,
  };
}

function fakeLogger(): LoggerPort {
  return { log: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() };
}

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

describe('ShippingStubShippingAdapter', () => {
  describe('generateLabel', () => {
    it('should POST to {baseUrl}/labels and map a successful response', async () => {
      const fetchImpl = jest.fn<ReturnType<FetchLike>, Parameters<FetchLike>>().mockResolvedValue(
        jsonResponse(201, {
          providerShipmentId: 'stub-shp-1',
          trackingNumber: null,
          labelPdfRef: 'https://stub.invalid/labels/stub-shp-1.pdf',
        }),
      );
      const adapter = new ShippingStubShippingAdapter(
        'conn-shipping-stub',
        'http://shipping-stub:19086',
        fetchImpl,
        fakeLogger(),
      );

      const result = await adapter.generateLabel(command());

      expect(fetchImpl).toHaveBeenCalledWith(
        'http://shipping-stub:19086/labels',
        expect.objectContaining({ method: 'POST' }),
      );
      expect(result.providerShipmentId).toBe('stub-shp-1');
      expect(result.trackingNumber).toBeNull();
      expect(result.labelPdfRef).toContain('stub-shp-1');
    });

    it('should throw when the stub answers a non-2xx status', async () => {
      const fetchImpl = jest
        .fn<ReturnType<FetchLike>, Parameters<FetchLike>>()
        .mockResolvedValue(jsonResponse(500, { error: 'boom' }));
      const adapter = new ShippingStubShippingAdapter(
        'conn-shipping-stub',
        'http://shipping-stub:19086',
        fetchImpl,
        fakeLogger(),
      );

      await expect(adapter.generateLabel(command())).rejects.toThrow(/HTTP 500/);
    });
  });

  describe('getTracking', () => {
    it('should GET {baseUrl}/shipments/{id}/tracking and map the response', async () => {
      const fetchImpl = jest.fn<ReturnType<FetchLike>, Parameters<FetchLike>>().mockResolvedValue(
        jsonResponse(200, {
          status: 'dispatched',
          trackingNumber: 'STUB-TRACK-1',
          carrier: 'inpost',
          providerStatus: 'sent',
        }),
      );
      const adapter = new ShippingStubShippingAdapter(
        'conn-shipping-stub',
        'http://shipping-stub:19086',
        fetchImpl,
        fakeLogger(),
      );

      const snapshot = await adapter.getTracking({ providerShipmentId: 'stub-shp-1' });

      expect(fetchImpl).toHaveBeenCalledWith('http://shipping-stub:19086/shipments/stub-shp-1/tracking');
      expect(snapshot.status).toBe('dispatched');
      expect(snapshot.trackingNumber).toBe('STUB-TRACK-1');
      expect(snapshot.carrier).toBe('inpost');
    });

    it('should map a null trackingNumber to undefined, never the literal null', async () => {
      const fetchImpl = jest.fn<ReturnType<FetchLike>, Parameters<FetchLike>>().mockResolvedValue(
        jsonResponse(200, {
          status: 'generated',
          trackingNumber: null,
          carrier: 'inpost',
          providerStatus: 'label-issued',
        }),
      );
      const adapter = new ShippingStubShippingAdapter(
        'conn-shipping-stub',
        'http://shipping-stub:19086',
        fetchImpl,
        fakeLogger(),
      );

      const snapshot = await adapter.getTracking({ providerShipmentId: 'stub-shp-1' });
      expect(snapshot.trackingNumber).toBeUndefined();
    });
  });

  describe('getSupportedMethods', () => {
    it('should declare kurier and paczkomat without making a network call', () => {
      const fetchImpl = jest.fn<ReturnType<FetchLike>, Parameters<FetchLike>>();
      const adapter = new ShippingStubShippingAdapter(
        'conn-shipping-stub',
        'http://shipping-stub:19086',
        fetchImpl,
        fakeLogger(),
      );

      expect(adapter.getSupportedMethods()).toEqual(['kurier', 'paczkomat']);
      expect(fetchImpl).not.toHaveBeenCalled();
    });
  });
});

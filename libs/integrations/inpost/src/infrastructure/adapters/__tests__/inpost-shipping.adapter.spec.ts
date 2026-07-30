/**
 * InPost Shipping Adapter — unit tests
 *
 * Mocks `IInpostHttpClient` (per engineering-standards: mock the port, not a
 * real transport). Verifies request shape, response mapping, the
 * paczkomat-unavailable re-tag, and the unknown-status fallback.
 *
 * @module libs/integrations/inpost/src/infrastructure/adapters
 */
import {
  ShippingProviderRejectionException,
  type GenerateLabelCommand,
} from '@openlinker/core/shipping';
import { Logger } from '@openlinker/shared/logging';
import type { InpostConnectionConfig } from '../../../domain/types/inpost-config.types';
import type { IInpostHttpClient } from '../../http/inpost-http-client.interface';
import { InpostUnauthorizedException } from '../../../domain/exceptions/inpost-unauthorized.exception';
import { InpostShippingAdapter } from '../inpost-shipping.adapter';

const config: InpostConnectionConfig = {
  environment: 'sandbox',
  organizationId: 'org-123',
  senderAddress: {
    name: 'Shop',
    email: 'shop@example.com',
    phone: '321321321',
    address: {
      street: 'Czerniakowska',
      buildingNumber: '87A',
      city: 'Warszawa',
      postCode: '00-718',
      countryCode: 'PL',
    },
  },
};

const paczkomatCmd: GenerateLabelCommand = {
  shipmentId: 'ol_shipment_abc',
  orderId: 'ol_order_xyz',
  connectionId: 'conn-1',
  shippingMethod: 'paczkomat',
  paczkomatId: 'POZ08A',
  recipient: { email: 'buyer@example.com', phone: '111222333' },
  parcel: { template: 'small' },
};

const courierCmd: GenerateLabelCommand = {
  shipmentId: 'ol_shipment_def',
  orderId: 'ol_order_uvw',
  connectionId: 'conn-1',
  shippingMethod: 'kurier',
  recipient: {
    firstName: 'Jan',
    lastName: 'Kowalski',
    email: 'buyer@example.com',
    phone: '888000000',
    address: {
      street: 'Cybernetyki',
      buildingNumber: '10',
      city: 'Warszawa',
      postCode: '02-677',
      countryCode: 'PL',
    },
  },
  parcel: { dimensions: { length: 80, width: 360, height: 640 }, weightGrams: 2500 },
};

function makeAdapter(): {
  adapter: InpostShippingAdapter;
  request: jest.Mock;
  requestBinary: jest.Mock;
} {
  const request = jest.fn();
  const requestBinary = jest.fn();
  const http = { request, requestBinary } as unknown as IInpostHttpClient;
  return { adapter: new InpostShippingAdapter(http, config), request, requestBinary };
}

describe('InpostShippingAdapter', () => {
  describe('getSupportedMethods', () => {
    it('should return paczkomat and kurier', () => {
      const { adapter } = makeAdapter();
      expect(adapter.getSupportedMethods()).toEqual(['paczkomat', 'kurier']);
    });
  });

  describe('generateLabel', () => {
    it('should POST to the org shipments endpoint and map the response', async () => {
      const { adapter, request } = makeAdapter();
      request.mockResolvedValueOnce({ id: 1234, status: 'created', tracking_number: null });

      const result = await adapter.generateLabel(paczkomatCmd);

      expect(request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'POST',
          path: '/v1/organizations/org-123/shipments',
          body: expect.objectContaining({
            service: 'inpost_locker_standard',
            reference: 'ol_shipment_abc',
          }),
        }),
      );
      expect(result).toEqual({
        providerShipmentId: '1234',
        trackingNumber: null,
        labelPdfRef: 'shipx:label:1234',
      });
    });

    it('should POST a courier shipment with the courier service', async () => {
      const { adapter, request } = makeAdapter();
      request.mockResolvedValueOnce({ id: 5, status: 'created', tracking_number: null });

      await adapter.generateLabel(courierCmd);

      expect(request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'POST',
          body: expect.objectContaining({ service: 'inpost_courier_standard' }),
        }),
      );
    });

    it('should re-tag a target_point validation error with providerCode=target_point + paczkomatId (#885)', async () => {
      const { adapter, request } = makeAdapter();
      request.mockRejectedValueOnce(
        new ShippingProviderRejectionException(
          'inpost',
          'target_point',
          'invalid target_point',
          { fieldErrors: { target_point: ['invalid'] } },
        ),
      );

      await expect(adapter.generateLabel(paczkomatCmd)).rejects.toMatchObject({
        name: 'ShippingProviderRejectionException',
        providerName: 'inpost',
        providerCode: 'target_point',
        message: 'invalid target_point',
        providerDetails: expect.objectContaining({
          paczkomatId: 'POZ08A',
          fieldErrors: { target_point: ['invalid'] },
        }),
      });
    });

    it('should rethrow non-paczkomat errors unchanged', async () => {
      const { adapter, request } = makeAdapter();
      request.mockRejectedValueOnce(new InpostUnauthorizedException('bad token'));

      await expect(adapter.generateLabel(paczkomatCmd)).rejects.toBeInstanceOf(
        InpostUnauthorizedException,
      );
    });
  });

  describe('getTracking', () => {
    it('should map a known ShipX status to its OL bucket', async () => {
      const { adapter, request } = makeAdapter();
      request.mockResolvedValueOnce({ id: 1, status: 'delivered', tracking_number: 'X' });

      const snapshot = await adapter.getTracking({ providerShipmentId: '1' });

      expect(request).toHaveBeenCalledWith({ method: 'GET', path: '/v1/shipments/1' });
      expect(snapshot).toEqual({
        status: 'delivered',
        providerStatus: 'delivered',
        carrier: 'inpost',
        trackingNumber: 'X',
      });
    });

    it('should carry the ShipX tracking number into the snapshot so it backfills (#1426)', async () => {
      const { adapter, request } = makeAdapter();
      request.mockResolvedValueOnce({
        id: 1,
        status: 'confirmed',
        tracking_number: '602222118600000022831478',
      });

      const snapshot = await adapter.getTracking({ providerShipmentId: '1' });

      expect(snapshot.trackingNumber).toBe('602222118600000022831478');
    });

    it('should omit trackingNumber when ShipX has not minted one yet', async () => {
      const { adapter, request } = makeAdapter();
      request.mockResolvedValueOnce({ id: 1, status: 'created', tracking_number: null });

      const snapshot = await adapter.getTracking({ providerShipmentId: '1' });

      expect(snapshot.trackingNumber).toBeUndefined();
    });

    it('should fall back to in-transit for an unknown ShipX status', async () => {
      const { adapter, request } = makeAdapter();
      request.mockResolvedValueOnce({ id: 1, status: 'weird_code', tracking_number: null });

      const snapshot = await adapter.getTracking({ providerShipmentId: '1' });

      expect(snapshot).toEqual({ status: 'in-transit', providerStatus: 'weird_code', carrier: 'inpost' });
    });

    it('should populate carrier as "inpost" for own-contract InPost shipments (#769)', async () => {
      const { adapter, request } = makeAdapter();
      request.mockResolvedValueOnce({ id: 1, status: 'confirmed', tracking_number: 'X' });

      const snapshot = await adapter.getTracking({ providerShipmentId: '1' });

      expect(snapshot.carrier).toBe('inpost');
    });
  });

  describe('cancelShipment', () => {
    it('should DELETE the shipment by id', async () => {
      const { adapter, request } = makeAdapter();
      request.mockResolvedValueOnce(undefined);

      await adapter.cancelShipment({ providerShipmentId: 'abc' });

      expect(request).toHaveBeenCalledWith({ method: 'DELETE', path: '/v1/shipments/abc' });
    });
  });

  describe('findPickupPoints', () => {
    it('should query /v1/points and map the items', async () => {
      const { adapter, request } = makeAdapter();
      request.mockResolvedValueOnce({
        items: [{ name: 'POZ08A', status: 'Operating', address_details: { city: 'Poznań' } }],
      });

      const points = await adapter.findPickupPoints({ city: 'Poznań' });

      expect(request).toHaveBeenCalledWith(
        expect.objectContaining({ method: 'GET', path: '/v1/points' }),
      );
      expect(points).toHaveLength(1);
      expect(points[0].providerId).toBe('POZ08A');
    });
  });

  describe('fetchLabel', () => {
    it('should GET the label endpoint with format=pdf and return the bytes', async () => {
      const { adapter, requestBinary } = makeAdapter();
      const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // %PDF
      requestBinary.mockResolvedValueOnce({ body: bytes, contentType: 'application/pdf' });

      const result = await adapter.fetchLabel({ providerShipmentId: '1234' });

      expect(requestBinary).toHaveBeenCalledWith({
        method: 'GET',
        path: '/v1/shipments/1234/label',
        query: { format: 'pdf' },
      });
      expect(result).toEqual({ contentType: 'application/pdf', body: bytes });
    });

    it('should pass a non-PDF content type (e.g. PNG) through unchanged', async () => {
      const { adapter, requestBinary } = makeAdapter();
      requestBinary.mockResolvedValueOnce({
        body: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
        contentType: 'image/png',
      });

      const result = await adapter.fetchLabel({ providerShipmentId: '1234' });

      expect(result.contentType).toBe('image/png');
    });

    it('should default to application/pdf when the response carries no content type', async () => {
      const { adapter, requestBinary } = makeAdapter();
      requestBinary.mockResolvedValueOnce({ body: new Uint8Array([1]), contentType: '' });

      const result = await adapter.fetchLabel({ providerShipmentId: '1234' });

      expect(result.contentType).toBe('application/pdf');
    });
  });

  describe('generateProtocol', () => {
    it('should GET the org printouts endpoint with the shipment_ids batch + format=Pdf and return the bytes', async () => {
      const { adapter, requestBinary } = makeAdapter();
      const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // %PDF
      requestBinary.mockResolvedValueOnce({ body: bytes, contentType: 'application/pdf' });

      const result = await adapter.generateProtocol({ providerShipmentIds: ['11', '22', '33'] });

      expect(requestBinary).toHaveBeenCalledWith({
        method: 'GET',
        path: '/v1/organizations/org-123/dispatch_orders/printouts',
        query: { shipment_ids: ['11', '22', '33'], format: 'Pdf' },
      });
      expect(result).toEqual({ contentType: 'application/pdf', body: bytes });
    });

    it('should pass a ZIP content type through unchanged (mixed-service batch)', async () => {
      const { adapter, requestBinary } = makeAdapter();
      requestBinary.mockResolvedValueOnce({
        body: new Uint8Array([0x50, 0x4b, 0x03, 0x04]), // PK..
        contentType: 'application/zip',
      });

      const result = await adapter.generateProtocol({ providerShipmentIds: ['11', '22'] });

      expect(result.contentType).toBe('application/zip');
    });

    it('should default to application/pdf when the response carries no content type', async () => {
      const { adapter, requestBinary } = makeAdapter();
      requestBinary.mockResolvedValueOnce({ body: new Uint8Array([1]), contentType: '' });

      const result = await adapter.generateProtocol({ providerShipmentIds: ['11'] });

      expect(result.contentType).toBe('application/pdf');
    });

    it('should reject an empty batch before hitting ShipX', async () => {
      const { adapter, requestBinary } = makeAdapter();

      await expect(adapter.generateProtocol({ providerShipmentIds: [] })).rejects.toMatchObject({
        name: 'ShippingProviderRejectionException',
        providerName: 'inpost',
        providerCode: 'preflight.empty-protocol-batch',
      });
      expect(requestBinary).not.toHaveBeenCalled();
    });
  });

  describe('findShipmentByReference (#1917)', () => {
    it('should query the org shipment collection filtered by reference', async () => {
      const { adapter, request } = makeAdapter();
      request.mockResolvedValueOnce({ items: [] });

      await adapter.findShipmentByReference({ reference: 'ol_shipment_abc' });

      expect(request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'GET',
          path: '/v1/organizations/org-123/shipments',
          query: expect.objectContaining({ reference: 'ol_shipment_abc' }),
        }),
      );
    });

    it('should map a single exact match', async () => {
      const { adapter, request } = makeAdapter();
      request.mockResolvedValueOnce({
        items: [
          { id: 998877, status: 'confirmed', tracking_number: '6200001', reference: 'ol_shipment_abc' },
        ],
      });

      await expect(adapter.findShipmentByReference({ reference: 'ol_shipment_abc' })).resolves.toEqual(
        { providerShipmentId: '998877', trackingNumber: '6200001' },
      );
    });

    it('should normalise a missing tracking number to null', async () => {
      const { adapter, request } = makeAdapter();
      request.mockResolvedValueOnce({
        items: [{ id: 5, status: 'created', tracking_number: null, reference: 'ol_shipment_abc' }],
      });

      await expect(adapter.findShipmentByReference({ reference: 'ol_shipment_abc' })).resolves.toEqual(
        { providerShipmentId: '5', trackingNumber: null },
      );
    });

    it('should return null when nothing matches', async () => {
      const { adapter, request } = makeAdapter();
      request.mockResolvedValueOnce({ items: [] });

      await expect(
        adapter.findShipmentByReference({ reference: 'ol_shipment_abc' }),
      ).resolves.toBeNull();
    });

    it('should tolerate a response with no items array', async () => {
      const { adapter, request } = makeAdapter();
      request.mockResolvedValueOnce({});

      await expect(
        adapter.findShipmentByReference({ reference: 'ol_shipment_abc' }),
      ).resolves.toBeNull();
    });

    it('should ignore items whose reference does not match exactly', async () => {
      const { adapter, request } = makeAdapter();
      // ShipX silently ignoring an unsupported filter would answer with an
      // unfiltered page; the client-side check must not adopt a stranger.
      request.mockResolvedValueOnce({
        items: [
          { id: 1, status: 'created', tracking_number: null, reference: 'ol_shipment_other' },
          { id: 2, status: 'created', tracking_number: null, reference: undefined },
        ],
      });

      await expect(
        adapter.findShipmentByReference({ reference: 'ol_shipment_abc' }),
      ).resolves.toBeNull();
    });

    it('should warn when a full page comes back with no match (filter likely unsupported)', async () => {
      const { adapter, request } = makeAdapter();
      // A full page of strangers is the signature of ShipX ignoring the filter:
      // safe (nothing is adopted) but a permanent silent no-op without a signal.
      request.mockResolvedValueOnce({
        items: Array.from({ length: 10 }, (_, index) => ({
          id: index + 1,
          status: 'created',
          tracking_number: null,
          reference: `ol_shipment_other_${index}`,
        })),
      });
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

      await expect(
        adapter.findShipmentByReference({ reference: 'ol_shipment_abc' }),
      ).resolves.toBeNull();

      const logged = warn.mock.calls.map((call) => String(call[0])).join('\n');
      expect(logged).toContain('full page');
      expect(logged).toContain('ol_shipment_abc');
      warn.mockRestore();
    });

    it('should not warn when a partial page comes back with no match', async () => {
      const { adapter, request } = makeAdapter();
      // Fewer items than the page size means the filter WAS applied (or the org
      // is small) — nothing to diagnose, so no noise.
      request.mockResolvedValueOnce({
        items: [{ id: 1, status: 'created', tracking_number: null, reference: 'ol_shipment_x' }],
      });
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

      await expect(
        adapter.findShipmentByReference({ reference: 'ol_shipment_abc' }),
      ).resolves.toBeNull();

      expect(warn).not.toHaveBeenCalled();
      warn.mockRestore();
    });

    it('should refuse to adopt when more than one shipment shares the reference', async () => {
      const { adapter, request } = makeAdapter();
      // The pre-#1917 race could leave two paid labels under one reference.
      request.mockResolvedValueOnce({
        items: [
          { id: 11, status: 'created', tracking_number: 'A', reference: 'ol_shipment_abc' },
          { id: 22, status: 'created', tracking_number: 'B', reference: 'ol_shipment_abc' },
        ],
      });

      await expect(
        adapter.findShipmentByReference({ reference: 'ol_shipment_abc' }),
      ).resolves.toBeNull();
    });
  });
});

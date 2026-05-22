/**
 * InPost Shipping Adapter — unit tests
 *
 * Mocks `IInpostHttpClient` (per engineering-standards: mock the port, not a
 * real transport). Verifies request shape, response mapping, the
 * paczkomat-unavailable re-tag, and the unknown-status fallback.
 *
 * @module libs/integrations/inpost/src/infrastructure/adapters
 */
import type { GenerateLabelCommand } from '@openlinker/core/shipping';
import type { InpostConnectionConfig } from '../../../domain/types/inpost-config.types';
import type { IInpostHttpClient } from '../../http/inpost-http-client.interface';
import { InpostUnauthorizedException } from '../../../domain/exceptions/inpost-unauthorized.exception';
import { InpostValidationException } from '../../../domain/exceptions/inpost-validation.exception';
import { PaczkomatUnavailableException } from '../../../domain/exceptions/paczkomat-unavailable.exception';
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

function makeAdapter(): { adapter: InpostShippingAdapter; request: jest.Mock } {
  const request = jest.fn();
  const http = { request } as unknown as IInpostHttpClient;
  return { adapter: new InpostShippingAdapter(http, config), request };
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

    it('should re-tag a target_point validation error as PaczkomatUnavailableException', async () => {
      const { adapter, request } = makeAdapter();
      request.mockRejectedValueOnce(
        new InpostValidationException('invalid target_point', { target_point: ['invalid'] }),
      );

      await expect(adapter.generateLabel(paczkomatCmd)).rejects.toBeInstanceOf(
        PaczkomatUnavailableException,
      );
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
      expect(snapshot).toEqual({ status: 'delivered', providerStatus: 'delivered' });
    });

    it('should fall back to in-transit for an unknown ShipX status', async () => {
      const { adapter, request } = makeAdapter();
      request.mockResolvedValueOnce({ id: 1, status: 'weird_code', tracking_number: null });

      const snapshot = await adapter.getTracking({ providerShipmentId: '1' });

      expect(snapshot).toEqual({ status: 'in-transit', providerStatus: 'weird_code' });
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
});

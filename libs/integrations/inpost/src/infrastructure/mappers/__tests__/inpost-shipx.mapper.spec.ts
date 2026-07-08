/**
 * InPost ShipX Mapper — unit tests
 *
 * @module libs/integrations/inpost/src/infrastructure/mappers
 */
import type { GenerateLabelCommand } from '@openlinker/core/shipping';
import type { InpostConnectionConfig } from '../../../domain/types/inpost-config.types';
import type {
  ShipXCourierParcel,
  ShipXLockerParcel,
  ShipXPoint,
} from '../../../domain/types/inpost-shipx.types';
import { ShippingProviderRejectionException } from '@openlinker/core/shipping';
import {
  buildCreateShipmentRequest,
  buildPointsQuery,
  classifyInpostPointType,
  mapShipXStatus,
  toGenerateLabelResult,
  toPickupPoint,
} from '../inpost-shipx.mapper';

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

describe('inpost-shipx.mapper', () => {
  describe('buildCreateShipmentRequest', () => {
    it('should build a locker request with object parcel and target_point when method is paczkomat', () => {
      const request = buildCreateShipmentRequest(paczkomatCmd, config);

      expect(request.service).toBe('inpost_locker_standard');
      expect(request.reference).toBe('ol_shipment_abc');
      expect(request.custom_attributes?.target_point).toBe('POZ08A');
      expect(request.custom_attributes?.sending_method).toBe('dispatch_order');
      expect((request.parcels as ShipXLockerParcel).template).toBe('small');
      // Locker receiver carries no address (addressed by the locker).
      expect(request.receiver.address).toBeUndefined();
      expect(request.sender.address?.building_number).toBe('87A');
    });

    it('should build a courier request with array parcel and receiver address when method is kurier', () => {
      const request = buildCreateShipmentRequest(courierCmd, config);

      expect(request.service).toBe('inpost_courier_standard');
      expect(Array.isArray(request.parcels)).toBe(true);
      const parcel = (request.parcels as ShipXCourierParcel[])[0];
      expect(parcel.dimensions).toEqual({ length: '80', width: '360', height: '640', unit: 'mm' });
      expect(parcel.weight).toEqual({ amount: '2.50', unit: 'kg' });
      expect(request.receiver.address?.post_code).toBe('02-677');
    });

    it('should throw a typed rejection (preflight.missing-paczkomat-id) when paczkomat shipment lacks paczkomatId (#885)', () => {
      const call = (): unknown =>
        buildCreateShipmentRequest({ ...paczkomatCmd, paczkomatId: undefined }, config);
      expect(call).toThrow(ShippingProviderRejectionException);
      try {
        call();
      } catch (error) {
        expect(error).toMatchObject({
          providerName: 'inpost',
          providerCode: 'preflight.missing-paczkomat-id',
        });
      }
    });

    it('should throw a typed rejection (preflight.missing-parcel-template) when paczkomat shipment lacks a parcel template (#885)', () => {
      const call = (): unknown => buildCreateShipmentRequest({ ...paczkomatCmd, parcel: {} }, config);
      expect(call).toThrow(ShippingProviderRejectionException);
      try {
        call();
      } catch (error) {
        expect(error).toMatchObject({
          providerName: 'inpost',
          providerCode: 'preflight.missing-parcel-template',
        });
      }
    });

    it('should throw a typed rejection (preflight.missing-recipient-address) when courier shipment lacks a recipient address (#885)', () => {
      const call = (): unknown =>
        buildCreateShipmentRequest(
          { ...courierCmd, recipient: { ...courierCmd.recipient, address: undefined } },
          config,
        );
      expect(call).toThrow(ShippingProviderRejectionException);
      try {
        call();
      } catch (error) {
        expect(error).toMatchObject({
          providerName: 'inpost',
          providerCode: 'preflight.missing-recipient-address',
        });
      }
    });

    it('should throw a typed rejection (preflight.missing-dimensions-or-weight) when courier shipment lacks dimensions or weight (#885)', () => {
      const call = (): unknown =>
        buildCreateShipmentRequest({ ...courierCmd, parcel: { template: 'small' } }, config);
      expect(call).toThrow(ShippingProviderRejectionException);
      try {
        call();
      } catch (error) {
        expect(error).toMatchObject({
          providerName: 'inpost',
          providerCode: 'preflight.missing-dimensions-or-weight',
        });
      }
    });
  });

  describe('mapShipXStatus', () => {
    it.each([
      ['confirmed', 'generated'],
      ['dispatched_by_sender', 'dispatched'],
      ['out_for_delivery', 'in-transit'],
      ['delivered', 'delivered'],
      ['canceled', 'cancelled'],
      ['returned_to_sender', 'failed'],
    ])('should map ShipX status %s to OL bucket %s', (raw, expected) => {
      expect(mapShipXStatus(raw)).toBe(expected);
    });

    it('should return null for an unknown ShipX status', () => {
      expect(mapShipXStatus('totally_unknown_code')).toBeNull();
    });
  });

  describe('toGenerateLabelResult', () => {
    it('should stringify the id, pass through tracking_number, and build the label ref', () => {
      const result = toGenerateLabelResult({ id: 1234, status: 'created', tracking_number: null });
      expect(result).toEqual({
        providerShipmentId: '1234',
        trackingNumber: null,
        labelPdfRef: 'shipx:label:1234',
      });
    });
  });

  describe('toPickupPoint', () => {
    it('should map a ShipX point to the neutral PickupPoint', () => {
      const point: ShipXPoint = {
        name: 'POZ08A',
        status: 'Operating',
        location: { latitude: 52.4, longitude: 16.9 },
        address: { line1: 'Główna 1', line2: 'paczkomat' },
        address_details: { city: 'Poznań', post_code: '60-001', street: 'Główna', building_number: '1' },
      };
      const result = toPickupPoint(point);
      expect(result.providerId).toBe('POZ08A');
      expect(result.status).toBe('active');
      expect(result.address.city).toBe('Poznań');
      expect(result.lat).toBe(52.4);
    });

    it('should carry pointType and raw type for a parcel_locker automat', () => {
      const point: ShipXPoint = {
        name: 'OLS06A',
        display_name: 'InPost Paczkomat OLS06A',
        type: ['parcel_locker'],
      };
      const result = toPickupPoint(point);
      expect(result.pointType).toBe('apm');
      expect(result.type).toEqual(['parcel_locker']);
    });

    it('should classify a PaczkoPunkt as pop from the type list', () => {
      const point: ShipXPoint = {
        name: 'POP-OLS19',
        display_name: 'InPost PaczkoPunkt POP-OLS19',
        type: ['parcel_locker', 'parcel_locker_superpop', 'pok', 'pop'],
      };
      const result = toPickupPoint(point);
      expect(result.pointType).toBe('pop');
      expect(result.type).toEqual(['parcel_locker', 'parcel_locker_superpop', 'pok', 'pop']);
    });

    it('should leave raw type absent when the point omits it', () => {
      const result = toPickupPoint({ name: 'POZ08A' });
      expect(result.type).toBeUndefined();
      expect(result.pointType).toBe('apm');
    });
  });

  describe('classifyInpostPointType', () => {
    it('should return pop when the type list contains pop (authoritative path)', () => {
      expect(classifyInpostPointType({ id: 'OLS06A', type: ['parcel_locker', 'pop'] })).toBe('pop');
    });

    it('should return pop for a parcel_locker_superpop token', () => {
      expect(
        classifyInpostPointType({ type: ['parcel_locker', 'parcel_locker_superpop'] }),
      ).toBe('pop');
    });

    it('should return apm for a plain parcel_locker type list', () => {
      expect(classifyInpostPointType({ id: 'POP-OLS19', type: ['parcel_locker'] })).toBe('apm');
    });

    it('should fall back to the POP- id prefix when type is absent', () => {
      expect(classifyInpostPointType({ id: 'POP-OLS19' })).toBe('pop');
      expect(classifyInpostPointType({ id: 'pop-ols19' })).toBe('pop');
    });

    it('should fall back to the PaczkoPunkt name when type is absent', () => {
      expect(classifyInpostPointType({ id: 'X', name: 'InPost PaczkoPunkt POP-OLS19' })).toBe('pop');
    });

    it('should default to apm on the heuristic path when no POP signal is present', () => {
      expect(classifyInpostPointType({ id: 'OLS06A', name: 'InPost Paczkomat OLS06A' })).toBe('apm');
      expect(classifyInpostPointType({})).toBe('apm');
    });
  });

  describe('buildPointsQuery', () => {
    it('should map the neutral finder query to ShipX query params', () => {
      expect(
        buildPointsQuery({ city: 'Warszawa', postalCode: '00-001', searchText: 'POZ', limit: 10 }),
      ).toEqual({ city: 'Warszawa', post_code: '00-001', name: 'POZ', per_page: 10 });
    });
  });
});

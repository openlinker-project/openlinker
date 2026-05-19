/**
 * Shipment Canceller Capability — Type-Guard Tests
 *
 * Verifies the `isShipmentCanceller` runtime narrowing matches its
 * compile-time signature on both branches. Mirrors the listings
 * sub-capability spec shape.
 *
 * @module libs/core/src/shipping/domain/ports/capabilities/__tests__
 */
import type { ShippingProviderManagerPort } from '../../shipping-provider-manager.port';
import {
  type ShipmentCanceller,
  isShipmentCanceller,
} from '../shipment-canceller.capability';

describe('isShipmentCanceller', () => {
  it('should narrow to ShippingProviderManagerPort & ShipmentCanceller when the adapter implements cancelShipment', () => {
    const adapter: ShippingProviderManagerPort & ShipmentCanceller = {
      generateLabel: jest.fn(),
      getTracking: jest.fn(),
      getSupportedMethods: () => ['paczkomat'],
      cancelShipment: jest.fn(),
    };

    expect(isShipmentCanceller(adapter)).toBe(true);

    if (isShipmentCanceller(adapter)) {
      // Compile-time narrowing check: TS knows `cancelShipment` exists.
      expect(typeof adapter.cancelShipment).toBe('function');
    }
  });

  it('should return false when the adapter does not implement cancelShipment', () => {
    const adapter: ShippingProviderManagerPort = {
      generateLabel: jest.fn(),
      getTracking: jest.fn(),
      getSupportedMethods: () => ['paczkomat'],
    };

    expect(isShipmentCanceller(adapter)).toBe(false);
  });

  it('should return false when cancelShipment is present but not a function', () => {
    const adapter = {
      generateLabel: jest.fn(),
      getTracking: jest.fn(),
      getSupportedMethods: () => ['paczkomat'],
      cancelShipment: 'not a function',
    } as unknown as ShippingProviderManagerPort;

    expect(isShipmentCanceller(adapter)).toBe(false);
  });
});

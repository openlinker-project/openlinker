/**
 * Pickup Point Finder Capability — Type-Guard Tests
 *
 * Verifies the `isPickupPointFinder` runtime narrowing matches its
 * compile-time signature on both branches.
 *
 * @module libs/core/src/shipping/domain/ports/capabilities/__tests__
 */
import type { ShippingProviderManagerPort } from '../../shipping-provider-manager.port';
import {
  type PickupPointFinder,
  isPickupPointFinder,
} from '../pickup-point-finder.capability';

describe('isPickupPointFinder', () => {
  it('should narrow to ShippingProviderManagerPort & PickupPointFinder when the adapter implements findPickupPoints', () => {
    const adapter: ShippingProviderManagerPort & PickupPointFinder = {
      generateLabel: jest.fn(),
      getTracking: jest.fn(),
      getSupportedMethods: () => ['paczkomat'],
      findPickupPoints: jest.fn(),
    };

    expect(isPickupPointFinder(adapter)).toBe(true);

    if (isPickupPointFinder(adapter)) {
      // Compile-time narrowing check: TS knows `findPickupPoints` exists.
      expect(typeof adapter.findPickupPoints).toBe('function');
    }
  });

  it('should return false when the adapter does not implement findPickupPoints', () => {
    const adapter: ShippingProviderManagerPort = {
      generateLabel: jest.fn(),
      getTracking: jest.fn(),
      getSupportedMethods: () => ['kurier'],
    };

    expect(isPickupPointFinder(adapter)).toBe(false);
  });

  it('should return false when findPickupPoints is present but not a function', () => {
    const adapter = {
      generateLabel: jest.fn(),
      getTracking: jest.fn(),
      getSupportedMethods: () => ['paczkomat'],
      findPickupPoints: null,
    } as unknown as ShippingProviderManagerPort;

    expect(isPickupPointFinder(adapter)).toBe(false);
  });
});

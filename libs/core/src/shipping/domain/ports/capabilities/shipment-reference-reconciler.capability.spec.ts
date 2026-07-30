/**
 * ShipmentReferenceReconciler type-guard unit tests (#1917).
 */

import { isShipmentReferenceReconciler } from './shipment-reference-reconciler.capability';
import type { ShipmentReferenceReconciler } from './shipment-reference-reconciler.capability';
import type { ShippingProviderManagerPort } from '../shipping-provider-manager.port';

const base: ShippingProviderManagerPort = {
  generateLabel: jest.fn(),
  getTracking: jest.fn(),
  getSupportedMethods: jest.fn(),
};

describe('isShipmentReferenceReconciler', () => {
  it('should return true when the adapter implements findShipmentByReference', () => {
    const adapter: ShippingProviderManagerPort & ShipmentReferenceReconciler = {
      ...base,
      findShipmentByReference: jest.fn(),
    };
    expect(isShipmentReferenceReconciler(adapter)).toBe(true);
  });

  it('should return false when the adapter does not implement findShipmentByReference', () => {
    expect(isShipmentReferenceReconciler(base)).toBe(false);
  });
});

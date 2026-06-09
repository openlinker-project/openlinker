/**
 * Unit tests for the pure delivery-intent → carrier-method resolver (#979).
 */
import {
  resolveCarrierMethod,
  deriveIntentFromLegacyMethod,
} from './delivery-intent-resolution';
import type { ShippingMethod } from './types/shipping-method.types';

const DPD: readonly ShippingMethod[] = ['kurier', 'pickup'];
const INPOST: readonly ShippingMethod[] = ['paczkomat', 'kurier'];
const ALLEGRO: readonly ShippingMethod[] = ['paczkomat', 'kurier'];

describe('resolveCarrierMethod', () => {
  describe('pickup_point', () => {
    it('should resolve to the carrier point method per adapter', () => {
      expect(resolveCarrierMethod('pickup_point', DPD)).toBe('pickup');
      expect(resolveCarrierMethod('pickup_point', INPOST)).toBe('paczkomat');
      expect(resolveCarrierMethod('pickup_point', ALLEGRO)).toBe('paczkomat');
    });

    it('should return null when the carrier has no point method (courier-only)', () => {
      expect(resolveCarrierMethod('pickup_point', ['kurier'])).toBeNull();
    });

    it('should return null when the carrier has two point methods (ambiguous)', () => {
      expect(resolveCarrierMethod('pickup_point', ['paczkomat', 'pickup'])).toBeNull();
    });
  });

  describe('address', () => {
    it('should resolve to kurier for every carrier', () => {
      expect(resolveCarrierMethod('address', DPD)).toBe('kurier');
      expect(resolveCarrierMethod('address', INPOST)).toBe('kurier');
      expect(resolveCarrierMethod('address', ALLEGRO)).toBe('kurier');
    });

    it('should return null when the carrier offers no courier method', () => {
      expect(resolveCarrierMethod('address', ['pickup'])).toBeNull();
    });
  });
});

describe('deriveIntentFromLegacyMethod', () => {
  it('should map point methods to pickup_point and kurier to address', () => {
    expect(deriveIntentFromLegacyMethod('paczkomat')).toBe('pickup_point');
    expect(deriveIntentFromLegacyMethod('pickup')).toBe('pickup_point');
    expect(deriveIntentFromLegacyMethod('kurier')).toBe('address');
  });
});

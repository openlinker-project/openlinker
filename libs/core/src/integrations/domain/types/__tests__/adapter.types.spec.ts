/**
 * Adapter Types — unit tests
 *
 * Regression guards for the open-`Capability` extension axis (#576). The
 * well-known core list (`CoreCapabilityValues`) stays closed; port boundary
 * signatures accept arbitrary strings. Tests document the narrowing pattern
 * call sites should use.
 *
 * @module libs/core/src/integrations/domain/types/__tests__
 */
import type { CoreCapability, AdapterMetadata } from '../adapter.types';
import { CoreCapabilityValues } from '../adapter.types';

describe('adapter.types', () => {
  describe('CoreCapabilityValues', () => {
    it('should expose the documented five well-known capabilities', () => {
      // Guards against silent reordering or accidental additions/removals
      // of the published well-known set. If this fails, either the set
      // genuinely changed (update the test + arch doc) or someone extended
      // the closed list when they should have used the open boundary.
      expect([...CoreCapabilityValues]).toEqual([
        'ProductMaster',
        'InventoryMaster',
        'OrderProcessorManager',
        'OrderSource',
        'OfferManager',
      ]);
    });
  });

  describe('AdapterMetadata.supportedCapabilities', () => {
    it('should accept a well-known capability', () => {
      const metadata: AdapterMetadata = {
        adapterKey: 'test.v1',
        platformType: 'test',
        supportedCapabilities: ['ProductMaster'],
      };
      expect(metadata.supportedCapabilities).toEqual(['ProductMaster']);
    });

    it('should accept a plugin-registered capability name beyond the core set', () => {
      // Documents the open extension axis: plugin adapters may register
      // capability names not in `CoreCapabilityValues` (e.g. PricingAuthority
      // listed in architecture-overview.md as future). The runtime gate at
      // IntegrationsService.getCapabilityAdapter is the source of truth.
      const metadata: AdapterMetadata = {
        adapterKey: 'plugin.v1',
        platformType: 'plugin',
        supportedCapabilities: ['PricingAuthority', 'ProductMaster'],
      };
      expect(metadata.supportedCapabilities).toContain('PricingAuthority');
    });
  });

  describe('isCoreCapability narrowing pattern', () => {
    // Documented call-site pattern for narrowing back to the well-known set
    // when exhaustiveness matters (e.g. UI dropdowns). Lifted here as a
    // runtime test so future reorganisations don't silently break the
    // pattern — call sites that copy this idiom should remain correct.
    function isCoreCapability(value: string): value is CoreCapability {
      return (CoreCapabilityValues as readonly string[]).includes(value);
    }

    it('should return true for every well-known core capability', () => {
      for (const value of CoreCapabilityValues) {
        expect(isCoreCapability(value)).toBe(true);
      }
    });

    it('should return false for a plugin-registered capability', () => {
      expect(isCoreCapability('PricingAuthority')).toBe(false);
      expect(isCoreCapability('ShippingProvider')).toBe(false);
    });

    it('should return false for the empty string', () => {
      expect(isCoreCapability('')).toBe(false);
    });
  });
});

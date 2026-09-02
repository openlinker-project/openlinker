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
import { CoreCapabilityValues, resolveRequiresCredentials } from '../adapter.types';

describe('adapter.types', () => {
  describe('CoreCapabilityValues', () => {
    it('should expose the documented well-known capabilities', () => {
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
        // Shop-listing (#1041, ADR-024)
        'ProductPublisher',
        'CategoryProvisioner',
        // Invoicing (#751, ADR-026)
        'Invoicing',
        // Fiscalization (#1908, ADR-042)
        'Fiscalization',
        // Returns disposition authority (#2351, ADR-052)
        'ReturnsAuthority',
        // Availability read authority — ADR-052 A1 (#2403)
        'AvailabilityAuthority',
        // Fulfilment execution authority — ADR-052 A3 (#2403)
        'FulfillmentExecutor',
        // NOTE: 'FulfillmentRouter' (A2) is deliberately absent while A2 is
        // `config-only` — see the declaration's own comment for why.
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

describe('resolveRequiresCredentials', () => {
  it('should default to true when the adapter declares nothing', () => {
    // The safe default is the restrictive one: an adapter that says nothing
    // keeps the credential guard it has always had, so relaxing it is always
    // an explicit act by the adapter author (#2405, ADR-055).
    expect(resolveRequiresCredentials({})).toBe(true);
  });

  it('should default to true for undefined or null metadata', () => {
    expect(resolveRequiresCredentials(undefined)).toBe(true);
    expect(resolveRequiresCredentials(null)).toBe(true);
  });

  it('should honour an explicit false', () => {
    expect(resolveRequiresCredentials({ requiresCredentials: false })).toBe(false);
  });

  it('should honour an explicit true', () => {
    expect(resolveRequiresCredentials({ requiresCredentials: true })).toBe(true);
  });
});

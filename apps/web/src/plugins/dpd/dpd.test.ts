/**
 * dpdPlugin smoke tests
 *
 * Asserts the DPD plugin's static surface: identity, the guided setup route,
 * and the shipping-only platform contributions (display name, setup card,
 * credentials panel). DPD is a carrier — it deliberately contributes none of
 * the marketplace slots and omits `pickupPointResolvesAsync` (DPD Pickup is
 * operator-selected). Behavioural coverage lives in the consumer tests.
 *
 * @module plugins/dpd
 */
import { describe, expect, it } from 'vitest';

import { dpdPlugin } from './index';

describe('dpdPlugin', () => {
  describe('identity', () => {
    it('has the stable kebab-case id', () => {
      expect(dpdPlugin.id).toBe('dpd');
    });
    it('declares the matching platformType', () => {
      expect(dpdPlugin.platformType).toBe('dpd');
    });
  });

  describe('build contributions', () => {
    it('contributes the guided setup route', () => {
      const paths = (dpdPlugin.build?.routes ?? []).map((route) => route.path);
      expect(paths).toContain('connections/new/dpd');
    });
    it('does NOT contribute API namespaces or an offer-creation wizard (carrier-only)', () => {
      expect(dpdPlugin.build?.apiNamespaces).toBeUndefined();
      expect(dpdPlugin.build?.offerCreationWizard).toBeUndefined();
    });
  });

  describe('platform contributions', () => {
    it('declares the display name', () => {
      expect(dpdPlugin.platform?.displayName).toBe('DPD Polska');
    });
    it('contributes the setup card pointing to the guided wizard', () => {
      expect(dpdPlugin.platform?.setupCard?.to).toBe('/connections/new/dpd');
      expect(dpdPlugin.platform?.setupCard?.badge).toBe('DPDServices REST');
    });
    it('contributes a credentials panel', () => {
      expect(dpdPlugin.platform?.CredentialsPanel).toBeDefined();
    });
    it('does NOT contribute structured-config edit, connection actions, or marketplace slots', () => {
      expect(dpdPlugin.platform?.StructuredConfigSection).toBeUndefined();
      expect(dpdPlugin.platform?.ConnectionActions).toBeUndefined();
      expect(dpdPlugin.platform?.ExtraConfigSection).toBeUndefined();
      expect(dpdPlugin.platform?.supportsListingEdit).toBeUndefined();
    });
    it('omits pickupPointResolvesAsync (DPD Pickup is operator-selected)', () => {
      expect(dpdPlugin.platform?.pickupPointResolvesAsync).toBeUndefined();
    });
  });
});

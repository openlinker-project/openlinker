/**
 * inpostPlugin smoke tests (#771)
 *
 * Asserts the InPost plugin's static surface: identity, the guided setup route,
 * and the shipping carrier platform contributions (display name, setup card,
 * structured-config editing, credentials panel, webhook-runbook connection
 * actions). InPost is a carrier — it deliberately contributes none of the
 * marketplace slots. Behavioural coverage lives in the component tests.
 *
 * @module plugins/inpost
 */
import { describe, expect, it } from 'vitest';

import { inpostPlugin } from './index';

describe('inpostPlugin', () => {
  describe('identity', () => {
    it('has the stable kebab-case id', () => {
      expect(inpostPlugin.id).toBe('inpost');
    });
    it('declares the matching platformType', () => {
      expect(inpostPlugin.platformType).toBe('inpost');
    });
  });

  describe('build contributions', () => {
    it('contributes the guided setup route', () => {
      const paths = (inpostPlugin.build?.routes ?? []).map((route) => route.path);
      expect(paths).toContain('connections/new/inpost');
    });
    it('does NOT contribute API namespaces (carrier-only)', () => {
      expect(inpostPlugin.build?.apiNamespaces).toBeUndefined();
    });
  });

  describe('platform contributions', () => {
    it('declares the display name', () => {
      expect(inpostPlugin.platform?.displayName).toBe('InPost');
    });
    it('contributes the setup card pointing to the guided wizard', () => {
      expect(inpostPlugin.platform?.setupCard?.to).toBe('/connections/new/inpost');
      expect(inpostPlugin.platform?.setupCard?.badge).toBe('ShipX API');
    });
    it('contributes structured-config editing, a credentials panel, and connection actions', () => {
      expect(inpostPlugin.platform?.StructuredConfigSection).toBeDefined();
      expect(inpostPlugin.platform?.CredentialsPanel).toBeDefined();
      expect(inpostPlugin.platform?.ConnectionActions).toBeDefined();
    });
    it('does NOT contribute marketplace slots (carrier-only)', () => {
      expect(inpostPlugin.platform?.ExtraConfigSection).toBeUndefined();
      expect(inpostPlugin.platform?.supportsListingEdit).toBeUndefined();
    });
  });
});

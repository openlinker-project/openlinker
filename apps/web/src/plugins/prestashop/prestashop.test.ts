/**
 * prestashopPlugin smoke tests
 *
 * Asserts the unified plugin's static surface: top-level identity, build-side
 * routes, and platform-side contributions (setup card, structured-config,
 * credentials panel, connection actions, callback-URL default). Behavioural
 * coverage of each contributed component lives in the consumer-side tests
 * (`platform-picker.test.tsx`, `ConnectionActionsPanel.test.tsx`,
 * `EditConnectionForm.test.tsx`).
 *
 * @module plugins/prestashop
 */
import { describe, expect, it } from 'vitest';

import { prestashopPlugin } from './index';

describe('prestashopPlugin', () => {
  describe('identity', () => {
    it('has the stable kebab-case id', () => {
      expect(prestashopPlugin.id).toBe('prestashop');
    });

    it('declares the matching platformType', () => {
      expect(prestashopPlugin.platformType).toBe('prestashop');
    });
  });

  describe('build contributions', () => {
    it('contributes the setup route', () => {
      const paths = (prestashopPlugin.build?.routes ?? []).map((route) => route.path);
      expect(paths).toContain('connections/new/prestashop');
    });

    it('does NOT contribute an API namespace (PS goes through generic core APIs)', () => {
      expect(prestashopPlugin.build?.apiNamespaces).toBeUndefined();
    });

    it('does NOT contribute an offer-creation wizard (no Allegro-style listing flow)', () => {
      expect(prestashopPlugin.build?.offerCreationWizard).toBeUndefined();
    });
  });

  describe('platform contributions', () => {
    it('declares the display name', () => {
      expect(prestashopPlugin.platform?.displayName).toBe('PrestaShop');
    });

    it('contributes the setup card pointing to the guided wizard', () => {
      expect(prestashopPlugin.platform?.setupCard).toBeDefined();
      expect(prestashopPlugin.platform?.setupCard?.to).toBe('/connections/new/prestashop');
    });

    it('contributes structured-config + credentials + actions slots', () => {
      expect(prestashopPlugin.platform?.StructuredConfigSection).toBeDefined();
      expect(prestashopPlugin.platform?.CredentialsPanel).toBeDefined();
      expect(prestashopPlugin.platform?.ConnectionActions).toBeDefined();
    });

    it('does NOT contribute an extra config section (no Allegro-like GPSR block)', () => {
      expect(prestashopPlugin.platform?.ExtraConfigSection).toBeUndefined();
    });

    it('does NOT mark itself as external-auth-redirect (PS uses inline credentials)', () => {
      expect(prestashopPlugin.platform?.requiresExternalAuthRedirect).toBeUndefined();
    });

    it('returns window.location.origin from getCallbackUrlDefault under jsdom', () => {
      expect(prestashopPlugin.platform?.getCallbackUrlDefault?.()).toBe(window.location.origin);
    });

    it('does NOT contribute a content-publish error extractor (Allegro-specific)', () => {
      expect(prestashopPlugin.platform?.extractContentPublishErrors).toBeUndefined();
    });
  });
});

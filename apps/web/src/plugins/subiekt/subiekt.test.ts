/**
 * subiektPlugin smoke tests (#1199)
 *
 * Asserts the Subiekt plugin's static surface: identity, the guided setup
 * route, and the platform contributions (display name + setup card). Also
 * confirms the live plugin registry includes Subiekt so the connection-type
 * picker renders it. Behavioural coverage lives in the consumer test
 * (subiekt-setup-form).
 *
 * @module plugins/subiekt
 */
import { describe, expect, it } from 'vitest';

import { plugins } from '../index';
import { subiektPlugin } from './index';

describe('subiektPlugin', () => {
  describe('identity', () => {
    it('has the stable kebab-case id', () => {
      expect(subiektPlugin.id).toBe('subiekt');
    });
    it('declares the matching platformType', () => {
      expect(subiektPlugin.platformType).toBe('subiekt');
    });
  });

  describe('build contributions', () => {
    it('contributes the guided setup route', () => {
      const paths = (subiektPlugin.build?.routes ?? []).map((route) => route.path);
      expect(paths).toContain('connections/new/subiekt');
    });
    it('does NOT contribute API namespaces', () => {
      expect(subiektPlugin.build?.apiNamespaces).toBeUndefined();
    });
    it('does NOT contribute an offer-creation wizard', () => {
      expect(subiektPlugin.build?.offerCreationWizard).toBeUndefined();
    });
  });

  describe('platform contributions', () => {
    it('declares the display name', () => {
      expect(subiektPlugin.platform?.displayName).toBe('Subiekt nexo');
    });
    it('contributes the setup card pointing to the guided wizard', () => {
      expect(subiektPlugin.platform?.setupCard?.to).toBe('/connections/new/subiekt');
      expect(subiektPlugin.platform?.setupCard?.badge).toBe('Sfera bridge');
    });
    it('does NOT contribute edit-form / credentials / connection-action slots (deferred to #759)', () => {
      expect(subiektPlugin.platform?.StructuredConfigSection).toBeUndefined();
      expect(subiektPlugin.platform?.CredentialsPanel).toBeUndefined();
      expect(subiektPlugin.platform?.ConnectionActions).toBeUndefined();
    });
    it('does NOT mark itself as external-auth-redirect', () => {
      expect(subiektPlugin.platform?.requiresExternalAuthRedirect).toBeUndefined();
    });
  });

  describe('registration', () => {
    it('is present in the live plugin registry (drives the connection-type picker)', () => {
      expect(plugins.map((p) => p.id)).toContain('subiekt');
      expect(plugins.map((p) => p.platformType)).toContain('subiekt');
    });
  });
});

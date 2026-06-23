/**
 * subiektPlugin invariant tests (#1199 + #759)
 *
 * Static-surface coverage of the combined Subiekt plugin: identity, the guided
 * setup route + setup card (#1199), the structured-config section + credentials
 * panel + capability descriptors (#759), the trigger-model mirror staying in
 * lockstep with the feature-layer source of truth, and presence in the live
 * plugin registry (drives the connection-type picker). Behavioural coverage
 * lives in the consumer-side tests (subiekt-setup-form / subiekt-structured-section).
 *
 * @module plugins/subiekt
 */
import { describe, expect, it } from 'vitest';

import { plugins } from '../index';
import { INVOICE_TRIGGER_MODEL_VALUES } from '../../features/connections';
import { subiektPlugin } from './index';
import {
  SUBIEKT_CAPABILITY_DESCRIPTORS,
  SUBIEKT_TRIGGER_MODELS,
} from './subiekt-capability-descriptors';

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
    it('contributes the guided setup route (#1199)', () => {
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
    it('contributes the setup card pointing to the guided wizard (#1199)', () => {
      expect(subiektPlugin.platform?.setupCard?.to).toBe('/connections/new/subiekt');
      expect(subiektPlugin.platform?.setupCard?.badge).toBe('Sfera bridge');
    });
    it('contributes StructuredConfigSection + CredentialsPanel + capabilityDescriptors (#759)', () => {
      expect(subiektPlugin.platform?.StructuredConfigSection).toBeDefined();
      expect(subiektPlugin.platform?.CredentialsPanel).toBeDefined();
      expect(subiektPlugin.platform?.capabilityDescriptors).toBe(SUBIEKT_CAPABILITY_DESCRIPTORS);
    });
    it('does NOT mark itself as external-auth-redirect', () => {
      expect(subiektPlugin.platform?.requiresExternalAuthRedirect).toBeUndefined();
    });
  });

  describe('capability + trigger models', () => {
    it('SUBIEKT_TRIGGER_MODELS equals the 4 values [manual, auto-on-paid, auto-on-shipped, batched]', () => {
      expect([...SUBIEKT_TRIGGER_MODELS]).toEqual([
        'manual',
        'auto-on-paid',
        'auto-on-shipped',
        'batched',
      ]);
      // Stays in lockstep with the feature-layer source of truth (no drift).
      expect([...SUBIEKT_TRIGGER_MODELS]).toEqual([...INVOICE_TRIGGER_MODEL_VALUES]);
    });
    it('capabilityDescriptors contains regulatory-transmission-tracking', () => {
      expect(SUBIEKT_CAPABILITY_DESCRIPTORS).toHaveProperty('regulatory-transmission-tracking');
      expect(SUBIEKT_CAPABILITY_DESCRIPTORS['regulatory-transmission-tracking'].label).toBeTruthy();
    });
  });

  describe('registration', () => {
    it('is present in the live plugin registry (drives the connection-type picker)', () => {
      expect(plugins.map((p) => p.id)).toContain('subiekt');
      expect(plugins.map((p) => p.platformType)).toContain('subiekt');
    });
  });
});

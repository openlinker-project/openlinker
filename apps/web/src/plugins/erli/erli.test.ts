/**
 * erliPlugin smoke tests
 *
 * Asserts the Erli plugin's static surface: identity, the guided setup route,
 * and the platform contributions (display name, setup card, credentials panel).
 * Also confirms the live plugin registry includes Erli so the connection-type
 * picker renders it. Behavioural coverage lives in the consumer tests
 * (erli-setup-form / erli-credentials-panel).
 *
 * @module plugins/erli
 */
import { describe, expect, it } from 'vitest';

import { plugins } from '../index';
import { erliPlugin } from './index';

describe('erliPlugin', () => {
  describe('identity', () => {
    it('has the stable kebab-case id', () => {
      expect(erliPlugin.id).toBe('erli');
    });
    it('declares the matching platformType', () => {
      expect(erliPlugin.platformType).toBe('erli');
    });
  });

  describe('build contributions', () => {
    it('contributes the guided setup route', () => {
      const paths = (erliPlugin.build?.routes ?? []).map((route) => route.path);
      expect(paths).toContain('connections/new/erli');
    });
    it('does NOT contribute API namespaces', () => {
      expect(erliPlugin.build?.apiNamespaces).toBeUndefined();
    });
  });

  describe('platform contributions', () => {
    it('declares the display name', () => {
      expect(erliPlugin.platform?.displayName).toBe('Erli');
    });
    it('contributes the setup card pointing to the guided wizard', () => {
      expect(erliPlugin.platform?.setupCard?.to).toBe('/connections/new/erli');
      expect(erliPlugin.platform?.setupCard?.badge).toBe('API key');
    });
    it('contributes a credentials panel', () => {
      expect(erliPlugin.platform?.CredentialsPanel).toBeDefined();
    });
    it('contributes a structured-config edit slot for the callback URL (#1454 follow-up)', () => {
      expect(erliPlugin.platform?.StructuredConfigSection).toBeDefined();
    });
    it('contributes a getCallbackUrlDefault matching the PrestaShop precedent', () => {
      expect(erliPlugin.platform?.getCallbackUrlDefault).toBeInstanceOf(Function);
    });
    it('contributes a ConnectionActions component for webhook install (#1216)', () => {
      expect(erliPlugin.platform?.ConnectionActions).toBeDefined();
    });
    it('contributes the bulk-offer config section + offer validation (#1096)', () => {
      expect(erliPlugin.platform?.bulkOfferConfigSection?.component).toBeDefined();
      expect(erliPlugin.platform?.bulkOfferConfigSection?.isComplete).toBeInstanceOf(Function);
      expect(erliPlugin.platform?.offerValidation?.blockers.length).toBeGreaterThan(0);
    });
    it('supports listing edit — Edit offer button enabled (#1215)', () => {
      expect(erliPlugin.platform?.supportsListingEdit).toBe(true);
    });
  });

  describe('registration', () => {
    it('is present in the live plugin registry (drives the connection-type picker)', () => {
      expect(plugins.map((p) => p.id)).toContain('erli');
      expect(plugins.map((p) => p.platformType)).toContain('erli');
    });
  });
});

/**
 * ksefPlugin smoke tests
 *
 * Asserts the KSeF plugin's static surface: identity, the guided setup route,
 * and the invoicing-platform contributions (display name, setup card,
 * structured-config section, credentials panel). KSeF carries the neutral
 * `Invoicing` capability — it deliberately contributes none of the marketplace
 * or shipping slots. Also re-asserts the registry-wide uniqueness invariants
 * with the plugin in the array.
 *
 * @module plugins/ksef
 */
import { describe, expect, it } from 'vitest';

import { assertUniquePluginInvariants } from '../assert-unique-plugin-invariants';
import { plugins } from '../index';
import { ksefPlugin } from './index';

describe('ksefPlugin', () => {
  describe('identity', () => {
    it('has the stable kebab-case id', () => {
      expect(ksefPlugin.id).toBe('ksef');
    });
    it('declares the matching platformType', () => {
      expect(ksefPlugin.platformType).toBe('ksef');
    });
  });

  describe('build contributions', () => {
    it('contributes the guided setup route', () => {
      const paths = (ksefPlugin.build?.routes ?? []).map((route) => route.path);
      expect(paths).toContain('connections/new/ksef');
    });
    it('does NOT contribute API namespaces or marketplace/shop wizards', () => {
      expect(ksefPlugin.build?.apiNamespaces).toBeUndefined();
      expect(ksefPlugin.build?.offerCreationWizard).toBeUndefined();
      expect(ksefPlugin.build?.shopProductPublishWizard).toBeUndefined();
    });
  });

  describe('platform contributions', () => {
    it('declares the display name', () => {
      expect(ksefPlugin.platform?.displayName).toBe('KSeF (e-invoicing)');
    });
    it('contributes the setup card pointing to the guided wizard', () => {
      expect(ksefPlugin.platform?.setupCard?.to).toBe('/connections/new/ksef');
      expect(ksefPlugin.platform?.setupCard?.badge).toBe('e-Invoicing');
    });
    it('contributes a structured-config section and a credentials panel', () => {
      expect(ksefPlugin.platform?.StructuredConfigSection).toBeDefined();
      expect(ksefPlugin.platform?.CredentialsPanel).toBeDefined();
    });
    it('contributes the invoice-detail section slot (B4 KSeF regulatory region)', () => {
      expect(ksefPlugin.platform?.invoiceDetailSection).toBeDefined();
    });
    it('contributes the invoice-correction flow slot (C1 KOR)', () => {
      expect(ksefPlugin.platform?.invoiceCorrectionFlow).toBeDefined();
    });
    it('does NOT contribute marketplace or async-pickup slots', () => {
      expect(ksefPlugin.platform?.supportsListingEdit).toBeUndefined();
      expect(ksefPlugin.platform?.pickupPointResolvesAsync).toBeUndefined();
      expect(ksefPlugin.platform?.ConnectionActions).toBeUndefined();
    });
  });

  describe('registry', () => {
    it('is registered in the in-tree plugin array exactly once', () => {
      expect(plugins.filter((p) => p.id === 'ksef')).toHaveLength(1);
      expect(plugins.filter((p) => p.platformType === 'ksef')).toHaveLength(1);
    });
    it('keeps the registry uniqueness invariants intact', () => {
      expect(() => assertUniquePluginInvariants(plugins)).not.toThrow();
    });
  });
});

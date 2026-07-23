/**
 * allegroPlugin smoke tests
 *
 * Asserts the unified plugin's static surface: top-level identity
 * (`id`, `platformType`), build-side contributions (routes, API namespace
 * factory), and platform-side contributions (setup card, ExtraConfigSection,
 * supportsListingEdit, content-error extractor). Behavioural coverage of
 * each contributed component lives in the consumer-side tests
 * (`platform-picker.test.tsx`, `EditConnectionForm.test.tsx`, etc.).
 *
 * @module plugins/allegro
 */
import { describe, expect, it, vi } from 'vitest';

import type { ApiRequest } from '../../app/api/api-client';

import { allegroPlugin } from './index';

describe('allegroPlugin', () => {
  describe('identity', () => {
    it('has the stable kebab-case id', () => {
      expect(allegroPlugin.id).toBe('allegro');
    });

    it('declares the matching platformType', () => {
      expect(allegroPlugin.platformType).toBe('allegro');
    });
  });

  describe('build contributions', () => {
    it('contributes the OAuth callback and setup routes', () => {
      const paths = (allegroPlugin.build?.routes ?? []).map((route) => route.path);
      expect(paths).toContain('integrations/allegro/connect/callback');
      expect(paths).toContain('connections/new/allegro');
    });

    it('contributes the `allegro` API namespace when its factory is called', () => {
      const stubRequest: ApiRequest = vi.fn();
      const namespaces = allegroPlugin.build?.apiNamespaces?.(stubRequest);
      expect(namespaces).toBeDefined();
      expect(namespaces && 'allegro' in namespaces).toBe(true);
    });
  });

  describe('platform contributions', () => {
    it('declares the display name', () => {
      expect(allegroPlugin.platform?.displayName).toBe('Allegro');
    });

    it('contributes the setup card pointing to the guided wizard', () => {
      expect(allegroPlugin.platform?.setupCard).toBeDefined();
      expect(allegroPlugin.platform?.setupCard?.to).toBe('/connections/new/allegro');
    });

    it('marks itself as requiring an external auth redirect (OAuth)', () => {
      expect(allegroPlugin.platform?.requiresExternalAuthRedirect).toBe(true);
    });

    it('contributes the GPSR extra-config section and the edit-offer affordance', () => {
      expect(allegroPlugin.platform?.ExtraConfigSection).toBeDefined();
      expect(allegroPlugin.platform?.supportsListingEdit).toBe(true);
    });

    it('does NOT contribute structured-config / credentials / connection-actions slots', () => {
      expect(allegroPlugin.platform?.StructuredConfigSection).toBeUndefined();
      expect(allegroPlugin.platform?.CredentialsPanel).toBeUndefined();
      expect(allegroPlugin.platform?.ConnectionActions).toBeUndefined();
    });

    it('does NOT contribute a callback-URL default (PS-only affordance)', () => {
      expect(allegroPlugin.platform?.getCallbackUrlDefault).toBeUndefined();
    });

    it('contributes the content-publish error extractor', () => {
      expect(allegroPlugin.platform?.extractContentPublishErrors).toBeDefined();
    });
  });
});

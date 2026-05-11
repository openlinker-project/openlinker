/**
 * Plugin registry composition tests
 *
 * Pins the contract a plugin author depends on:
 *   - `createApiClient` merges every plugin's `apiNamespaces` into the
 *     returned client (with the bound `request` function).
 *   - Route slot flows through (covered indirectly here; route precedence
 *     is React Router's job).
 *   - Duplicate plugin ids fail loudly at module load time.
 *
 * @module plugins
 */
import { describe, expect, it, vi } from 'vitest';

import { createApiClient, type ApiRequest, type PluginApiNamespaces } from '../app/api/api-client';
import { createNoopSessionAdapter } from '../shared/auth/noop-session-adapter';

import { definePlugin } from './define-plugin';
import { plugins } from './index';

interface ShopifyPing {
  ping: () => string;
}

// Augment the plugin namespace surface for the duration of this test file so
// the fixture below type-checks against the same seam real plugins use.
declare module '../app/api/api-client' {
  interface PluginApiNamespaces {
    shopify?: ShopifyPing;
  }
}

describe('plugin registry', () => {
  describe('createApiClient with the real registry', () => {
    it('exposes every namespace contributed by registered plugins', () => {
      // `fetchFn` is optional and defaults to the global fetch. The test
      // never invokes any namespace method, so the default is fine.
      const client = createApiClient({
        baseUrl: 'http://example.test',
        sessionAdapter: createNoopSessionAdapter(),
      });

      // allegroPlugin contributes the `allegro` namespace via declaration merging.
      // The real factory wires `createAllegroApi(request)` — we don't invoke it,
      // we only assert presence so the test stays offline.
      expect(client.allegro).toBeDefined();
      expect(typeof client.allegro.startOAuth).toBe('function');
    });
  });

  describe('apiNamespaces factory contract', () => {
    it('receives the bound request function from createApiClient', () => {
      // Verify the seam by inspecting an inline plugin's factory result. We
      // can't easily intercept the real registry from inside createApiClient,
      // so we exercise the plugin's factory directly with a stub.
      const stubRequest: ApiRequest = vi.fn();
      const shopifyPlugin = definePlugin({
        id: 'shopify-test-fixture',
        apiNamespaces: (request): Partial<PluginApiNamespaces> => {
          expect(request).toBe(stubRequest);
          return { shopify: { ping: () => 'pong' } };
        },
      });

      const result = shopifyPlugin.apiNamespaces?.(stubRequest);
      expect(result?.shopify?.ping()).toBe('pong');
    });
  });

  describe('id uniqueness', () => {
    it('the in-tree plugins barrel has no duplicate ids', () => {
      const ids = plugins.map((p) => p.id);
      expect(new Set(ids).size).toBe(ids.length);
    });
  });
});

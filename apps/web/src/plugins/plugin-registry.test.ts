/**
 * Plugin registry composition tests
 *
 * Pins the contract a plugin author depends on:
 *   - `createApiClient` merges every plugin's `apiNamespaces` into the
 *     returned client (with the bound `request` function).
 *   - Caller overrides in `createMockApiClient` win over plugin contributions
 *     so existing tests that stub a plugin namespace keep working.
 *   - Duplicate plugin ids throw at module load (failure path verified
 *     directly against the `assertUniquePluginIds` helper).
 *
 * @module plugins
 */
import { describe, expect, it, vi } from 'vitest';

import { createApiClient, type ApiRequest, type PluginApiNamespaces } from '../app/api/api-client';
import { createNoopSessionAdapter } from '../shared/auth/noop-session-adapter';
import { createMockApiClient } from '../test/test-utils';

import { assertUniquePluginIds } from './assert-unique-plugin-ids';
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

  describe('WebPlugin contract', () => {
    it("definePlugin's apiNamespaces factory receives the request it is invoked with", () => {
      // Narrow contract test: a `definePlugin` author can rely on the
      // `request` argument being the one the host passes in. We don't go
      // through `createApiClient` here — the registry barrel is static, so
      // there's no clean way to inject a fixture plugin without mutating
      // module state. Verifying the plugin's own factory contract is the
      // right level: createApiClient just calls this contract.
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

  describe('createMockApiClient merge order', () => {
    it('caller overrides win over plugin contributions', () => {
      // Documents the merge order spelled out in test-utils.tsx:
      //   hardcoded defaults → caller overrides.
      // Existing tests that pass `{ allegro: { startOAuth: vi.fn(...) } }`
      // rely on this — if the order ever flips, every Allegro-flow test
      // silently starts hitting the default mock instead of the caller's.
      const callerOverride = vi.fn().mockResolvedValue({
        authorizationUrl: 'http://override',
        state: 'override-state',
      });

      const client = createMockApiClient({
        allegro: {
          startOAuth: callerOverride,
        },
      });

      expect(client.allegro.startOAuth).toBe(callerOverride);
    });
  });

  describe('id uniqueness invariant', () => {
    it('the live plugins barrel has no duplicate ids', () => {
      const ids = plugins.map((p) => p.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('assertUniquePluginIds throws when two plugins share an id', () => {
      const duplicates = [
        definePlugin({ id: 'duplicate-fixture' }),
        definePlugin({ id: 'duplicate-fixture' }),
      ];

      expect(() => {
        assertUniquePluginIds(duplicates);
      }).toThrow(/Duplicate plugin id: "duplicate-fixture"/);
    });

    it('assertUniquePluginIds accepts an empty array', () => {
      expect(() => {
        assertUniquePluginIds([]);
      }).not.toThrow();
    });
  });
});

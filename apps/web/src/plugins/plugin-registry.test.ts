/**
 * Plugin registry composition tests
 *
 * Pins the contract a plugin author depends on:
 *   - `createApiClient` merges every plugin's `build.apiNamespaces` into
 *     the returned client (with the bound `request` function).
 *   - Caller overrides in `createMockApiClient` win over plugin contributions
 *     so existing tests that stub a plugin namespace keep working.
 *   - Duplicate plugin ids and platformTypes throw at module load (failure
 *     paths verified directly against `assertUniquePluginInvariants`).
 *
 * @module plugins
 */
import { describe, expect, it, vi } from 'vitest';

import { createApiClient, type ApiRequest, type PluginApiNamespaces } from '../app/api/api-client';
import { createNoopSessionAdapter } from '../shared/auth/noop-session-adapter';
import { createMockApiClient } from '../test/test-utils';

import { assertUniquePluginInvariants } from './assert-unique-plugin-invariants';
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

  describe('OpenLinkerPlugin contract', () => {
    it("definePlugin's build.apiNamespaces factory receives the request it is invoked with", () => {
      // Narrow contract test: a `definePlugin` author can rely on the
      // `request` argument being the one the host passes in. We don't go
      // through `createApiClient` here — the registry barrel is static, so
      // there's no clean way to inject a fixture plugin without mutating
      // module state. Verifying the plugin's own factory contract is the
      // right level: createApiClient just calls this contract.
      const stubRequest: ApiRequest = vi.fn();
      const shopifyPlugin = definePlugin({
        id: 'shopify-test-fixture',
        build: {
          apiNamespaces: (request): Partial<PluginApiNamespaces> => {
            expect(request).toBe(stubRequest);
            return { shopify: { ping: () => 'pong' } };
          },
        },
      });

      const result = shopifyPlugin.build?.apiNamespaces?.(stubRequest);
      expect(result?.shopify?.ping()).toBe('pong');
    });
  });

  describe('createMockApiClient merge order', () => {
    it('caller overrides win over plugin contributions', () => {
      // Documents the merge order spelled out in test-utils.tsx (#603):
      //   core defaults → plugin mock defaults → caller overrides.
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

    it('folds plugin mock defaults from the in-tree registry by default', () => {
      // Default invocation: no caller overrides, no custom mock registry.
      // The Allegro mock factory in `plugins/allegro/allegro.mocks.ts` must
      // produce a callable `client.allegro.startOAuth` — otherwise hundreds
      // of Allegro-flow tests that depend on the default behaviour fail.
      const client = createMockApiClient();

      expect(client.allegro).toBeDefined();
      expect(typeof client.allegro.startOAuth).toBe('function');
    });

    it('accepts a custom mockApiNamespaces registry that replaces in-tree mocks', () => {
      // Plugin-author seam (#603): a third-party plugin's tests can pass their
      // own factory list to register mock defaults without editing host code.
      const customPing = vi.fn().mockReturnValue('custom-pong');
      const client = createMockApiClient({}, [
        (): Partial<PluginApiNamespaces> => ({ shopify: { ping: customPing } }),
      ]);

      expect(client.shopify?.ping()).toBe('custom-pong');
      // The in-tree Allegro mock factory is replaced by the custom list, so
      // `client.allegro` is not contributed unless the caller overrides it.
      // Runtime-only assertion: TS types `allegro` as required via declaration
      // merging, but the spread skips the key entirely so it's `undefined` at
      // runtime. The type system can't express "declaration-merged namespace
      // absent at runtime" — the JS assertion holds, the TS type is a lie.
      expect(client.allegro).toBeUndefined();
    });

    it('applies caller overrides for plugin namespaces with no mock-factory contribution', () => {
      // A third-party plugin tested in isolation: no in-tree factory supplies
      // its namespace, but the caller passes an override. The factory must
      // forward it untouched, not silently drop it.
      const stubPing = vi.fn().mockReturnValue('inline-pong');
      const client = createMockApiClient(
        { shopify: { ping: stubPing } },
        [], // empty mock registry — no plugin contributes defaults
      );

      expect(client.shopify?.ping()).toBe('inline-pong');
    });
  });

  describe('id uniqueness invariant', () => {
    it('the live plugins barrel has no duplicate ids', () => {
      const ids = plugins.map((p) => p.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('assertUniquePluginInvariants throws when two plugins share an id', () => {
      const duplicates = [
        definePlugin({ id: 'duplicate-fixture' }),
        definePlugin({ id: 'duplicate-fixture' }),
      ];

      expect(() => {
        assertUniquePluginInvariants(duplicates);
      }).toThrow(/Duplicate plugin id: "duplicate-fixture"/);
    });

    it('assertUniquePluginInvariants accepts an empty array', () => {
      expect(() => {
        assertUniquePluginInvariants([]);
      }).not.toThrow();
    });

    it('assertUniquePluginInvariants throws when two plugins share a platformType', () => {
      // The unified shape (#702) collapses build-time + platform-side concerns
      // onto one object — but the `platformType` key still has to be unique
      // across plugins that contribute platform-side affordances, because
      // `usePlatform(target)` resolves by `Array.find` and a duplicate would
      // silently shadow its sibling.
      const duplicates = [
        definePlugin({
          id: 'plugin-a',
          platformType: 'shared',
          platform: { displayName: 'A' },
        }),
        definePlugin({
          id: 'plugin-b',
          platformType: 'shared',
          platform: { displayName: 'B' },
        }),
      ];

      expect(() => {
        assertUniquePluginInvariants(duplicates);
      }).toThrow(/Duplicate plugin platformType: "shared"/);
    });

    it('assertUniquePluginInvariants throws when platform is set without platformType', () => {
      // The TS type allows `{ platform: {...} }` without `platformType` (both
      // are optional at the top-level), but a `platform` bag without a
      // runtime-lookup key is unreachable from `usePlatform()`. The runtime
      // guard catches the malformed combo at module load.
      const orphan = [
        definePlugin({
          id: 'orphan',
          platform: { displayName: 'Orphan' },
        }),
      ];

      expect(() => {
        assertUniquePluginInvariants(orphan);
      }).toThrow(/missing the required top-level `platformType`/);
    });
  });
});

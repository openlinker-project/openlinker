# Implementation plan — #603 FE test harness open to plugin mock defaults

**Layer**: Frontend / Test infrastructure
**Severity**: LOW (Modularity Thread G follow-up)
**Parent**: #553, catalog #546 / FE-11

## Problem

`apps/web/src/test/test-utils.tsx` is the canonical FE test harness. Its `createMockApiClient` is closed over the host's plugin manifest: the `allegro:` namespace's mock defaults live inline in the factory body. Every new plugin requires hand-editing `test-utils.tsx`; a third-party plugin that adds a namespace via TS declaration-merging will compile-fail the factory until its defaults are added there.

The `DeepPartialApiClient` mapped type already auto-tracks plugin-augmented keys (`keyof ApiClient`) — but the **defaults** are hardcoded. Plugin authors have no seam to register mock defaults.

## Goal

Make `createMockApiClient` symmetric with `createApiClient`: iterate the build-time `plugins` registry and fold each plugin's contributed mock namespace into the defaults. Co-locate Allegro's mock defaults with the plugin.

## Non-goals

- **Extracting `test-utils.tsx` to a separate `@openlinker/web-test-kit` workspace package.** The harness imports 8+ host primitives (`ApiClientProvider`, `SessionProvider`, `ToastProvider`, `LocaleProvider`, `PluginRegistryProvider`, `Connection`, `SessionUser`, `IN_TREE_PLUGINS`). Hoisting requires parameterizing each — much larger scope than #603's coupling complaint. Defer; file as a sub-issue under #553.
- Migrating any of the 62 existing test files. The factory's public signature is backwards-compatible.
- Touching the runtime `apiNamespaces` factory (it already iterates the registry correctly).

## Layer classification

Frontend, `apps/web/src/`. No backend / no migrations.

## Changes

**Constraint — `vi` cannot leak into the production bundle.** Vite's prod build of `apps/web` follows the import graph from `main.tsx` → `app/api/api-client.ts` → `../../plugins` → each plugin's `index.ts`. Putting `vi.fn()` defaults on the `WebPlugin` itself would pull `vitest` into the prod bundle. The architectural fix therefore lives on a **parallel test-only registry**, not on the build-time `WebPlugin` contract.

### 1. `apps/web/src/plugins/<name>/<name>.mocks.ts` (new per plugin)

Test-only side file per plugin. Imports `vi` freely (never reached from prod imports). For Allegro:

```ts
// apps/web/src/plugins/allegro/allegro.mocks.ts
import { vi } from 'vitest';
import type { AllegroApi } from '../../features/allegro';
import type { PluginApiNamespaces } from '../../app/api/api-client';

export function allegroMockApiNamespaces(): Partial<PluginApiNamespaces> {
  return {
    allegro: {
      startOAuth: vi.fn().mockResolvedValue({
        authorizationUrl: 'https://example.com/oauth',
        state: 'state',
      }),
      handleCallback: vi.fn().mockResolvedValue({
        message: 'OAuth callback processed successfully. Connection created.',
        connectionId: 'conn_allegro_1',
        connectionName: 'Allegro sandbox',
      }),
      listResponsibleProducers: vi.fn().mockResolvedValue([]),
    } satisfies AllegroApi,
  };
}
```

### 2. `apps/web/src/test/plugin-mocks.ts` (new aggregator)

Single-edit-point for in-tree plugin mock contributions. Mirrors `plugins/index.ts` in role, lives in the test tree to keep the test-only nature explicit:

```ts
import { allegroMockApiNamespaces } from '../plugins/allegro/allegro.mocks';
import type { PluginApiNamespaces } from '../app/api/api-client';

export type PluginMockApiNamespacesFactory = () => Partial<PluginApiNamespaces>;

export const IN_TREE_MOCK_API_NAMESPACES: readonly PluginMockApiNamespacesFactory[] = [
  allegroMockApiNamespaces,
];
```

### 3. `apps/web/src/test/test-utils.tsx`

- Drop the hardcoded `allegro:` block from `createMockApiClient`'s body.
- Build core namespace defaults as today.
- Iterate `IN_TREE_MOCK_API_NAMESPACES` and merge each result into a `pluginDefaults` object.
- Merge order: core defaults → plugin mock defaults → caller overrides. Caller still wins (unchanged semantics).
- Update the long-form JSDoc above `DeepPartialApiClient`: drop "keep this block in sync with runtime"; the test-only registry IS the source of truth.
- Add optional `mockApiNamespaces?: readonly PluginMockApiNamespacesFactory[]` parameter so tests can inject a fixture registry (defaults to `IN_TREE_MOCK_API_NAMESPACES`).

### 4. Tests

Co-add `apps/web/src/test/test-utils.test.ts` (new file) covering the new fold semantics:
- Plugin mock defaults are merged into the returned client
- Caller overrides win over plugin mock defaults
- The `mockApiNamespaces?` override parameter replaces the in-tree registry
- An empty mock-factories array is a valid input (no plugin contributes)

## Acceptance criteria

- `grep -n "allegro:" apps/web/src/test/test-utils.tsx` returns 0 hits
- All 62 existing consumer tests pass unchanged
- New tests in (4) pass
- `pnpm lint` / `pnpm type-check` / `pnpm test --filter @openlinker/web` all green
- PR body documents the deferred package-extraction follow-up

## Risks

- **`vi`-in-prod**: avoided by routing mocks through a test-only side file (`<plugin>.mocks.ts`) rather than the build-time `WebPlugin` contract. Production import graph (`main.tsx` → `app/api/api-client.ts` → `plugins/index.ts` → `plugins/allegro/index.ts`) never reaches `allegro.mocks.ts`.
- **Third-party plugins**: a future third-party plugin would add its own `<plugin>.mocks.ts` side file and register it in `apps/web/src/test/plugin-mocks.ts` — same single-edit-point convention. Documented in the file's JSDoc.

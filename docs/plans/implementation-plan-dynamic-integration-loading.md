# Implementation plan — dynamic integration loading (#572)

Closes: #572 (C3). Tracks: #549 (Modularity Thread C) / #546. Follows: #570/#571 (pluggable adapter registry — merged).

## 1. Goal & non-goals

**Goal.** Remove the requirement that an OSS contributor must fork `apps/api` and `apps/worker` to enable a third-party plugin. Today every integration module is statically named:

- `apps/api/src/integrations/integrations.module.ts:14-16, 31-33` — three `import { AllegroIntegrationModule, PrestashopIntegrationModule, AiIntegrationModule } from '@openlinker/integrations-*'` followed by hardcoded `imports:` entries.
- `apps/worker/src/app.module.ts:15-16, 33-34` — `PrestashopIntegrationModule` + `AllegroIntegrationModule` imported and listed.
- `apps/worker/src/sync/sync-worker.module.ts:17, 45` — `AllegroIntegrationModule` imported a second time (the worker also reaches for `ALLEGRO_QUANTITY_COMMAND_REPOSITORY_TOKEN` through that import; the token coupling itself is a separate E2/E3-class smell and out of scope here).

The packaging boundary exists already: `@openlinker/integrations-{prestashop,allegro,ai}` are real workspace packages with their own `package.json`, each integration module already registers its adapter via `onModuleInit` against the now-pluggable `AdapterRegistryService` (`#570/#571`). Only the **import-side** wiring is hand-coded. This PR closes that gap by introducing a single seam — `PluginRegistryModule.forRoot({ plugins })` — that accepts an explicit array of integration modules, and a top-level plugins constant that an OSS user can edit in one place.

**Layer.** Interface / DX — `libs/core/src/integrations` (new `PluginRegistryModule`) + `apps/api` + `apps/worker` (rewire). Pure module-composition refactor; no port, service, or domain changes.

**Non-goals.**
- *No dynamic `import()` from a JSON manifest in this PR.* The issue recommendation lists this as a follow-up shape; the static `forRoot({ plugins: [...] })` API gets us 90% of the way and is the API future-dynamic-loading would call internally. Filing as follow-up.
- *No `@openlinker/plugin-sdk` package.* That's #597 (F10) — different scope.
- *No reshaping of the integration modules themselves.* They keep their current `OnModuleInit.register(...)` contract. The change is purely how the apps consume them.
- *No change to the platform-specific token couplings* (`ALLEGRO_QUANTITY_COMMAND_REPOSITORY_TOKEN` consumed in `apps/api/src/integrations/http/allegro.controller.ts` and `apps/worker/src/sync/sync-worker.module.ts`). Those are E2/E3 issues — out of scope here. The plugin registry simply re-exports each plugin module so existing token consumers keep working.
- *No conditional loading via env vars.* If an integration is in the `plugins` array, it loads. If you don't want it, edit the array — that's the whole story.

## 2. Existing patterns we lean on

- **`AdapterRegistryService.register(metadata)`** (`libs/core/src/integrations/infrastructure/adapters/adapter-registry.service.ts`, #570/#571) — the integration modules already self-register via `OnModuleInit`. The Nest module-import wiring is the *only* remaining hardcoded knowledge.
- **NestJS `DynamicModule` shape** — `register` / `forRoot` patterns are how `AiIntegrationModule.register()` already exposes per-environment configuration. We reuse that exact mechanism.
- **The `apps/api/src/integrations/integrations.module.ts:exports: [AiIntegrationModule]`** pattern — downstream modules (e.g. `ContentApiModule`) resolve `AI_COMPLETION_PORT_TOKEN` through the API integrations module's re-export. The plugin registry must preserve this behaviour, i.e. **re-export every plugin** it imports so downstream resolution still works.

## 3. Design

### 3.1 `PluginRegistryModule.forRoot({ plugins })`

New file `libs/core/src/integrations/plugin-registry.module.ts`:

```ts
import { Module, DynamicModule, Type } from '@nestjs/common';

/**
 * A plugin entry is either a Nest module class (static, no per-env config)
 * or a `DynamicModule` returned by a module's `.register(...)` method
 * (e.g. `AiIntegrationModule.register()`).
 */
export type PluginEntry = Type<unknown> | DynamicModule;

export interface PluginRegistryOptions {
  /**
   * Integration modules to enable on this app. Each module's own
   * `onModuleInit` is responsible for self-registering with the
   * `AdapterRegistryService` and `AdapterFactoryResolverService` —
   * we just compose their imports here.
   */
  plugins: PluginEntry[];
}

/**
 * Plugin Registry Module
 *
 * Single seam that replaces the previously hand-coded list of integration
 * modules in `apps/api` and `apps/worker`. Apps declare which integrations
 * they want via `PluginRegistryModule.forRoot({ plugins: [...] })`; the
 * plugins themselves stay responsible for registering their adapter
 * metadata + factories via `onModuleInit` (the pattern #570/#571 landed).
 *
 * Re-exports every plugin so downstream modules that depend on per-plugin
 * tokens (`AI_COMPLETION_PORT_TOKEN`, etc.) keep resolving the same way
 * they did before this seam existed.
 */
@Module({})
export class PluginRegistryModule {
  static forRoot(options: PluginRegistryOptions): DynamicModule {
    return {
      module: PluginRegistryModule,
      imports: options.plugins,
      exports: options.plugins,
    };
  }
}
```

Six lines of behaviour. Exported from `libs/core/src/integrations/index.ts`.

### 3.2 Top-level plugin list per app

Each app gets a single dedicated file that declares which integrations it ships with. This is the file an OSS user edits to enable a plugin — one line added, instead of three places.

**`apps/api/src/plugins.ts`**:

```ts
import type { PluginEntry } from '@openlinker/core/integrations';
import { PrestashopIntegrationModule } from '@openlinker/integrations-prestashop';
import { AllegroIntegrationModule } from '@openlinker/integrations-allegro';
import { AiIntegrationModule } from '@openlinker/integrations-ai';

/**
 * Integrations loaded by `apps/api`. To enable a third-party plugin:
 *
 *   1. `pnpm add @third-party/openlinker-plugin-<name>` in `apps/api`.
 *   2. Import its module here.
 *   3. Add it to the array below.
 *
 * `AiIntegrationModule.register()` is dynamic — it reads `OL_AI_PROVIDER`
 * at construction time. Other modules are static.
 */
export const apiPlugins: PluginEntry[] = [
  PrestashopIntegrationModule,
  AllegroIntegrationModule,
  AiIntegrationModule.register(),
];
```

**`apps/worker/src/plugins.ts`** — same shape, worker-specific (no AI module today, since the worker doesn't run the AI suggestion flow):

```ts
import type { PluginEntry } from '@openlinker/core/integrations';
import { PrestashopIntegrationModule } from '@openlinker/integrations-prestashop';
import { AllegroIntegrationModule } from '@openlinker/integrations-allegro';

export const workerPlugins: PluginEntry[] = [
  PrestashopIntegrationModule,
  AllegroIntegrationModule,
];
```

### 3.3 Rewire the apps

**`apps/api/src/integrations/integrations.module.ts`** — replace the three direct imports + three hardcoded `imports:` entries with one `PluginRegistryModule.forRoot({ plugins: apiPlugins })`. **Replace `exports: [AiIntegrationModule]` with `exports: [PluginRegistryModule]`** — NestJS providers exported by a child module propagate only to direct importers, so `ContentApiModule` (which imports `IntegrationsModule`, not the registry) needs `IntegrationsModule` itself to re-export the registry. The re-export forwarding stays generic: every plugin the registry composes (including third-party) becomes visible through `IntegrationsModule` without per-plugin knowledge.

**`apps/worker/src/app.module.ts`** — replace the two direct integration imports + two hardcoded `imports:` entries with `PluginRegistryModule.forRoot({ plugins: workerPlugins })`.

**`apps/worker/src/sync/sync-worker.module.ts:17, 45`** — **keep** the direct `AllegroIntegrationModule` import + `imports:` entry. The sub-module reaches for `ALLEGRO_QUANTITY_COMMAND_REPOSITORY_TOKEN`, which `AllegroIntegrationModule` provides + exports; Nest only forwards exported providers to direct importers, not transitively through the parent app module's registry composition. Mark this as a localised platform-coupling exception with a one-line comment pointing at Thread E (#581 / #582 / #583), which owns unwinding the platform-specific token coupling. The plugin-registry rewire and the Allegro-token coupling are then visibly separated concerns.

## 4. Step-by-step plan

| # | File | Change | Acceptance |
|---|---|---|---|
| 1 | `libs/core/src/integrations/plugin-registry.module.ts` (new) | Define `PluginRegistryModule.forRoot({ plugins })` per §3.1. File header per *Engineering Standards / File Headers*. Imports `PluginEntry` / `PluginRegistryOptions` from `plugin-registry.types.ts` (step 2). The class implements `OnModuleInit` and `this.logger.log("Composed N plugins: [...]")` at boot — mirrors `AdapterRegistryService.register()` / `AdapterFactoryResolverService.registerFactory()` logging so operators have one observable place to confirm the plugin list. | File compiles standalone; boot log lists the composed plugins. |
| 2 | `libs/core/src/integrations/plugin-registry.types.ts` (new — **top-level, NOT under `domain/`**) | Defines `PluginEntry = Type<unknown> \| DynamicModule` and `PluginRegistryOptions`. Both types import from `@nestjs/common`, which is forbidden in `domain/` per *Engineering Standards / Domain Layer Independence* and `.claude/rules/backend.md` ("Domain layer has ZERO framework dependencies"). Top-level sibling to `plugin-registry.module.ts` keeps types-in-separate-file compliant while honouring the domain-purity boundary. | Engineering-standards + domain-independence compliant. |
| 3 | `libs/core/src/integrations/index.ts` | Export `PluginRegistryModule`, `PluginEntry`, `PluginRegistryOptions`. | New names available from the integrations barrel. |
| 4 | `apps/api/src/plugins.ts` (new) | Top-level plugin list per §3.2. JSDoc explains the OSS contributor workflow and points at `docs/architecture-overview.md` § *Adapter Registry* for the conceptual model. | `apiPlugins: PluginEntry[]` exported. |
| 5 | `apps/api/src/integrations/integrations.module.ts` | Drop the three `import { *IntegrationModule } from '@openlinker/integrations-*'` lines. Drop the three hardcoded `imports:` entries. Add `import { PluginRegistryModule } from '@openlinker/core/integrations'` + `import { apiPlugins } from '../plugins'` and `PluginRegistryModule.forRoot({ plugins: apiPlugins })` into `imports:`. **Replace `exports: [AiIntegrationModule]` with `exports: [PluginRegistryModule]`** — NestJS module re-exports propagate only to direct importers, so `ContentApiModule` (which imports `IntegrationsModule`, not the registry directly) needs `IntegrationsModule` itself to re-export the registry to keep resolving `AI_COMPLETION_PORT_TOKEN`. This makes the re-export forwarding generic — every plugin the registry composes (incl. third-party) becomes visible to `IntegrationsModule` importers without per-plugin knowledge. | `apps/api` builds; `ContentApiModule` resolves `AI_COMPLETION_PORT_TOKEN`; AI fake-mode int-spec (`apps/api/test/integration/harness.ts:80-88`) green. |
| 6 | `apps/worker/src/plugins.ts` (new) | Worker plugin list per §3.2 (no AI module). Same JSDoc shape as step 4. | `workerPlugins: PluginEntry[]` exported. |
| 7 | `apps/worker/src/app.module.ts` | Drop the two direct integration imports + two hardcoded `imports:` entries. Add the `PluginRegistryModule.forRoot({ plugins: workerPlugins })` import. | Worker builds. |
| 8 | `apps/worker/src/sync/sync-worker.module.ts:17, 45` | **Keep** the direct `AllegroIntegrationModule` import + `imports:` entry. NestJS providers exported by `AllegroIntegrationModule` (i.e. `ALLEGRO_QUANTITY_COMMAND_REPOSITORY_TOKEN`) are visible only to modules that directly import `AllegroIntegrationModule`; transitive resolution through the parent `app.module.ts`'s plugin registry is not how Nest scopes module-level exports. Add a one-line comment marking this as a localised exception pointing at Thread E (#581 / #582 / #583) — those issues own the platform-specific token coupling that should eventually be unwound. | Worker boots; sync-job handlers that depend on the Allegro quantity-command repository keep working. The plugin-registry rewire and the Allegro-token coupling are now visibly separated concerns. |
| 9 | Verify `apps/api/test/integration/setup.ts` and `apps/api/test/integration/harness.ts` | The harness imports `AppModule` from `apps/api/src/app.module.ts` and runs it through `Test.createTestingModule({ imports: [AppModule] })`. No changes needed — the harness sees the plugin registry transitively via `IntegrationsModule`'s re-export from step 5. The `OL_AI_PROVIDER=fake` env switch flows through to `AiIntegrationModule.register()` as before. | Integration test boot still wires AI in fake mode. |
| 10 | New unit test: `libs/core/src/integrations/__tests__/plugin-registry.module.spec.ts` | Compose a tiny `PluginRegistryModule.forRoot({ plugins: [FakePluginA, FakePluginB] })` against `Test.createTestingModule(...)`. Assert: (a) the composed `DynamicModule` lists both plugins in `imports` and `exports`; (b) a token provided by `FakePluginA` resolves at a consumer that imports `PluginRegistryModule.forRoot(...)`; (c) the boot log from step 1 fires with the composed plugin names. Concrete `should X when Y` test names. | `pnpm test` passes. |
| 11 | `docs/architecture-overview.md` | Replace the §"Adapter Registry (Code-Level)" code block (currently shows direct `onModuleInit` calls in two integration modules) with the new top-level pattern: "App declares plugins in `apps/<app>/src/plugins.ts`; `PluginRegistryModule.forRoot({ plugins })` composes them; each integration module still self-registers its adapter metadata via `onModuleInit`." Mention the registration mechanic is unchanged — only the import seam moved. | Doc + code agree. |
| 12 | Final sweep: `grep -rn 'PrestashopIntegrationModule\|AllegroIntegrationModule\|AiIntegrationModule' apps/api/src apps/api/test apps/worker/src` | Expected hits: zero in `apps/api/src/integrations/integrations.module.ts` and `apps/worker/src/app.module.ts`. Single localised hit in `apps/worker/src/sync/sync-worker.module.ts` per step 8 (must carry the Thread E comment). Hits in `apps/api/src/plugins.ts` and `apps/worker/src/plugins.ts` are expected — single edit-point. Comment-only hits in test helpers (e.g. `apps/api/test/integration/harness.ts` JSDoc) are expected. | Confirms the wiring moved cleanly to the registry seam, with the one documented Thread-E exception. |

## 5. Validation

### 5.1 Architecture & standards compliance

- ✅ Hexagonal layers untouched — this is pure module composition.
- ✅ `PluginRegistryModule` lives in `libs/core/src/integrations` next to `AdapterRegistryService` (the symmetric registry it complements). No domain imports.
- ✅ `PluginEntry` / `PluginRegistryOptions` go in `plugin-registry.types.ts` per the *Type Definitions in Separate Files* standard.
- ✅ Filename `plugin-registry.module.ts` matches the existing `*-integration.module.ts` shape used by every integration package.
- ✅ No `any`. `PluginEntry = Type<unknown> | DynamicModule` is the canonical Nest typing for either form.
- ✅ JSDoc on the module + on the top-level `plugins.ts` files explains the OSS-contributor workflow — that's the load-bearing audience for this change.

### 5.2 Tests

- One new spec (step 10) covers the module composition behaviour and the re-export transitivity.
- Existing integration tests (`apps/api/test/integration/*.int-spec.ts`) regress-test the AI-fake-mode wiring through the harness; if anything in the plugin registry breaks token resolution, those go red. No int-spec changes needed.

### 5.3 Quality gate

`pnpm lint && pnpm type-check && pnpm test`.

### 5.4 Security

- No new attack surface. The `plugins` array is a build-time constant; we are not introducing runtime plugin loading.
- Plugin-registered adapters still pass through the same `AdapterRegistryService.register()` validation that #570/#571 introduced (duplicate-key detection, duplicate-platform-default detection).

### 5.5 Risk

- **Step 5 (`exports: [PluginRegistryModule]` swap)**. NestJS module re-exports propagate only to direct importers. The whole point of the swap from `exports: [AiIntegrationModule]` to `exports: [PluginRegistryModule]` is to keep `AI_COMPLETION_PORT_TOKEN` resolvable through `IntegrationsModule` for `ContentApiModule`. Validated by the existing AI fake-mode int-spec (`apps/api/test/integration/harness.ts:80-88` forces `OL_AI_PROVIDER=fake`); if the chain breaks, that suite goes red on boot.
- **Step 8 (`sync-worker.module.ts` Allegro coupling)**. Kept as a localised exception with a comment. No DI risk from this PR; the Thread-E issues track the actual cleanup.
- **Step 11 (doc edit)**. Cosmetic. No risk.

## 6. Open questions / follow-ups

1. **Dynamic `import()` from a JSON manifest.** Listed in the issue's recommendation as the OSS path. Out of scope here — file as a follow-up under #549. The `PluginRegistryModule.forRoot({ plugins })` API is exactly what a future `loadPluginsFromManifest()` helper would feed.
2. **Direct token coupling (`ALLEGRO_QUANTITY_COMMAND_REPOSITORY_TOKEN`).** The Allegro controller in `apps/api` and (currently) the worker reach for a platform-specific token. That's an E2/E3-class issue (platform-specific bleed into core orchestration), not C3. Out of scope here; the plugin registry just preserves resolution by re-exporting every plugin module.
3. **`apps/api/src/integrations/integrations.module.ts:exports`** changes from `[AiIntegrationModule]` (per-plugin) to `[PluginRegistryModule]` (registry-level). Its purpose — forwarding the AI module to `ContentApiModule` — is preserved through the registry's own `exports: options.plugins` chain. The new shape is generic: any plugin a future contributor adds to `apiPlugins` becomes visible through `IntegrationsModule` without further edits here. Verified via the existing AI fake-mode int-spec.

# Implementation Plan — #600 Export the integration-test harness for plugin reuse

| Layer | Scope | Risk |
|---|---|---|
| DX (new workspace) + apps/api refactor + docs | `libs/test-kit/` (new) + thin rewrite of `apps/api/test/integration/setup.ts` + `docs/plugin-author-guide.md` section + cross-link in `docs/testing-guide.md` | Medium — 23 in-tree int-specs depend on the current `getTestHarness()` shape; the refactor must not change their call sites. |

## 1. Problem framing

The current harness (`apps/api/test/integration/setup.ts` + `harness.ts`) is hardcoded to the API:

- `IntegrationTestHarness.setup()` imports `AppModule` directly
- Truncate list in `reset()` is the API's table set (12 hardcoded names)
- `/webhooks` raw-body middleware is API-specific
- Bunch of `OL_*` env-var defaults are API-specific (`OL_BOOTSTRAP_ADMIN_ENABLED`, `OL_AI_PROVIDER=fake`, etc.)

A plugin author writing `libs/integrations/shopify/test/integration/*.int-spec.ts` cannot import this without either a deep relative reach or a copy-paste. Per issue body and modularity-thread-G framing, the fix is to extract the generic container + Nest-bootstrap path into a published workspace and let consumers (apps/api today; plugins tomorrow) supply the app-specific config.

## 2. Public API of `@openlinker/test-kit`

```typescript
// libs/test-kit/src/index.ts
export { startContainers, stopContainers } from './containers';
export { createIntegrationTestHarness, IntegrationTestHarness } from './harness';
export type {
  ContainerConfig,
  ContainerHandles,
  IntegrationTestHarnessConfig,
} from './types';
```

### `startContainers(config?)` / `stopContainers()`

Wraps the current `harness.ts` container lifecycle. Idempotent (singleton on `globalThis.__OL_TEST_KIT_CONTAINERS__`). Returns container handles; sets `DB_*` / `REDIS_*` env vars. `config` is optional and lets the caller pin image tags or pre-set additional env vars before container start (today: `OL_*` API flags).

### `createIntegrationTestHarness(config): TestHarnessHandle`

Returns a `TestHarnessHandle` — a singleton-accessor surface bound to a single internal harness instance. The `IntegrationTestHarness` class is internal to the package (not exported as a value).

```typescript
interface IntegrationTestHarnessConfig {
  /** Nest modules to register in the test app. Replaces today's hardcoded AppModule. */
  imports: ModuleMetadata['imports'];

  /** Optional ValidationPipe config. `false` disables; default mirrors apps/api production. */
  validationPipe?: ValidationPipeOptions | false;

  /** Optional body-parser setup hook. Receives the INestApplication so callers can wire raw-body middleware (today: API's /webhooks). */
  configureBodyParser?: (app: INestApplication) => void;

  /** Tables to TRUNCATE between tests, in FK-aware order. Caller-owned — plugin authors list only their tables. */
  tablesToTruncate?: string[];

  /** Extra env vars set before container start. Useful for app-specific feature flags. */
  env?: Record<string, string>;

  /** Optional Redis client DI token. Defaults to 'REDIS_CLIENT' (apps/api's convention). */
  redisClientToken?: string | symbol;
}

interface TestHarnessHandle {
  /** Lazy singleton accessor — boots containers + Nest app on first call, returns the instance on subsequent calls. */
  getTestHarness(): Promise<IntegrationTestHarness>;
  /** Clear DB tables + flush Redis between tests. No-op if `getTestHarness()` was never called. */
  resetTestHarness(): Promise<void>;
  /** Close app, destroy DataSource, stop containers. No-op if `getTestHarness()` was never called. */
  teardownTestHarness(): Promise<void>;
}

interface IntegrationTestHarness {
  setup(): Promise<void>;
  reset(): Promise<void>;
  teardown(): Promise<void>;
  getHttp(): SuperTest<Test>;
  getApp(): INestApplication;
  getDataSource(): DataSource;
  getRedisClient(): RedisClientType | undefined;
}
```

The `IntegrationTestHarness` *interface* is exported (type-only) so consumers can type their `let harness: IntegrationTestHarness` locals — matching the 23 existing int-specs' usage shape. The class is not exported as a value; callers cannot construct it directly. This is shape (B) from the tech-review IMPORTANT item.

apps/api's `setup.ts` re-exports the `TestHarnessHandle` fields directly so existing `import { getTestHarness, resetTestHarness, teardownTestHarness } from './setup'` keeps working bit-for-bit.

## 3. Files

### 3.1 New workspace `libs/test-kit/`

- `package.json` — name `@openlinker/test-kit`, private, `version: 0.1.0`. peerDeps on `@nestjs/common`, `@nestjs/testing`, `typeorm`, `@testcontainers/postgresql`, `@testcontainers/redis`, `supertest`, `express`, `redis`. Same `exports` shape as `libs/shared`.
- `tsconfig.json`, `tsconfig.spec.json` — mirror `libs/shared`.
- `src/index.ts` — public barrel (see § 2).
- `src/types.ts` — `IntegrationTestHarnessConfig`, `ContainerConfig`, `ContainerHandles`.
- `src/containers.ts` — `startContainers(config?)`, `stopContainers()` (lifted from `harness.ts`, generalized).
- `src/harness.ts` — `IntegrationTestHarness` class + `createIntegrationTestHarness(config)` factory + module-singleton helpers (`getTestHarness`, `resetTestHarness`, `teardownTestHarness`).
- `src/__tests__/harness.spec.ts` — two unit tests with no real containers:
  1. `createIntegrationTestHarness` returns a `TestHarnessHandle` with the three singleton-accessor methods.
  2. `reset()` issues `TRUNCATE TABLE <name> CASCADE` queries for **caller-supplied** tables only, not a hardcoded list — the regression-prevention test for the whole refactor. Stub the DataSource on a class-instance test seam (see § 3.1 implementation note).

  Real container behaviour is exercised by every consuming int-spec.

### 3.2 `apps/api/test/integration/setup.ts` (rewrite, ~30 LoC)

Becomes a thin wrapper:

```typescript
import { createIntegrationTestHarness } from '@openlinker/test-kit';
import { AppModule } from '../../src/app.module';

const harness = createIntegrationTestHarness({
  imports: [AppModule],
  configureBodyParser: (app) => {
    // /webhooks raw-body capture (signature verification needs raw bytes)
    app.use('/webhooks', express.json({ limit: '256kb', verify: ... }));
    app.use(express.json({ limit: '1mb' }));
    app.use(express.urlencoded({ extended: true }));
  },
  tablesToTruncate: [
    'identifier_mappings', 'sync_jobs', 'inventory_items', 'order_records',
    'product_content_field', 'prompt_templates', 'ai_provider_active_setting',
    'integration_credentials', 'product_variants', 'products', 'connections', 'users',
  ],
  env: {
    OL_BOOTSTRAP_ADMIN_ENABLED: 'false',
    OL_AI_PROVIDER: 'fake',
    OL_ALLEGRO_POLL_SCHEDULER_ENABLED: 'false',
    OL_ALLEGRO_OFFERS_SYNC_SCHEDULER_ENABLED: 'false',
    OL_INVENTORY_SYNC_ENABLED: 'false',
    OL_PRODUCT_SYNC_ENABLED: 'false',
    JWT_SECRET: 'test-secret-for-integration-tests',
    JWT_EXPIRES_IN: '1d',
  },
});

export const { getTestHarness, resetTestHarness, teardownTestHarness } = harness;
export type { IntegrationTestHarness } from '@openlinker/test-kit';
```

### 3.3 `apps/api/test/integration/harness.ts` — decision pending until we inspect `jest-integration.js`

`jest-integration.js` references `apps/api/test/integration/harness.ts` for `globalSetup` / `globalTeardown`. Two options:

- **Option A (shim)**: keep `harness.ts` as a 10-LoC re-export of `startContainers` / `stopContainers` from `@openlinker/test-kit`. Avoids touching jest config; one extra file lives forever.
- **Option B (direct)**: update `jest-integration.js`'s `globalSetup` / `globalTeardown` paths to point at `@openlinker/test-kit` directly and delete the shim. Cleaner but requires the path alias to resolve in Jest's globalSetup execution context (it does today via `moduleNameMapper`, but globalSetup runs in a separate context — needs verification).

Default to **B (direct)** if the alias resolves; fall back to **A (shim)** if it doesn't. Decision recorded in the commit body.

### 3.4 `apps/api/test/integration/teardown.ts` — unchanged (delegates to `stopHarness` which now re-exports from test-kit).

### 3.5 Docs

- `docs/plugin-author-guide.md` — add a "Testing your adapter" section after the existing test-strategy framing. Show:
  - `pnpm add -D @openlinker/test-kit @testcontainers/postgresql @testcontainers/redis @nestjs/testing supertest`
  - `apps/your-plugin/test/integration/setup.ts` example using `createIntegrationTestHarness({ imports: [YourPluginModule], tablesToTruncate: [...] })`
  - Cross-link to `docs/testing-guide.md`
- `docs/testing-guide.md` — small note at the top of "Test Organization" pointing plugin authors at the new guide section.

## 4. Architecture compliance

- **Workspace placement**: `libs/test-kit/` mirrors `libs/shared/` shape. Test-only dependencies are peer-deps so consumers control versions.
- **No deep relatives**: `apps/api/test/integration/setup.ts` imports from `@openlinker/test-kit` (top-level barrel).
- **No `any`**: types from `@nestjs/common` (`ModuleMetadata['imports']`, `ValidationPipeOptions`, `INestApplication`) are used directly.
- **Logging**: harness keeps `console.warn` for non-critical teardown errors (matches today's behaviour). Engineering-standards § Logging says to use the `@openlinker/shared/logging` factory; the harness deviates because (1) it's test-time teardown code, (2) avoiding a `@openlinker/shared` dependency keeps the test-kit dep graph tight, and (3) `Logger` calls can race against backend teardown. The implementation will carry a one-line comment at each `console.warn` so future readers don't "fix" it as a standards violation.
- **Backwards compat**: the singleton-accessor public API (`getTestHarness`, `resetTestHarness`, `teardownTestHarness`) is preserved bit-for-bit. 23 in-tree int-specs require zero changes.

## 5. Risks / open questions

- **Express vs Fastify**: harness assumes Express middleware (e.g. `app.use('/webhooks', express.json(...))`). The `configureBodyParser` hook receives the `INestApplication` and the caller wires whatever middleware suits their app. Plugin authors who use Fastify would do likewise.
- **PrestaShop Testcontainer harness** (`apps/api/test/integration/helpers/prestashop-container.helper.ts`) is **out of scope** for this PR. It's PS-specific and should eventually live in `libs/integrations/prestashop/test/`, but moving it now would balloon the PR. Tracked as a follow-up note in the PR description.
- **Workspace name**: `@openlinker/test-kit` (matches "test kit" framing in issue #601 / Thread G); the issue body's parenthetical `@openlinker/test-utils` is a close synonym. Going with `test-kit` for consistency with the thread title and #601's name.

## 6. Step-by-step implementation

> **File-header convention**: every new file under `libs/test-kit/src/` gets the standard JSDoc `@module` header block per engineering-standards.md § File Headers. Not called out per step.

1. **Create workspace skeleton** — `libs/test-kit/{package.json, tsconfig.json, tsconfig.spec.json, jest.config.js, src/index.ts}`. Wire into `pnpm-workspace.yaml` (already covers `libs/*`) and `tsconfig.base.json` `paths`. Add `@openlinker/test-kit` to apps/api's devDependencies.
2. **Extract `containers.ts`** — copy `apps/api/test/integration/harness.ts` startup/stop logic. Generalize the API-specific env vars to be passed in via `config.env`. Keep the singleton-on-globalThis pattern for idempotency.
3. **Extract `harness.ts`** — port `IntegrationTestHarness` class into `libs/test-kit/src/harness.ts`. Parameterize the four hardcoded API bits (imports, validation pipe, body parser, truncate table list, redis token). Export the factory + singleton accessors.
4. **Rewrite `apps/api/test/integration/setup.ts`** — collapse to the thin wrapper described in § 3.2. Re-export the singleton accessors.
5. **Rewrite `apps/api/test/integration/harness.ts`** — re-export `startContainers` / `stopContainers` from `@openlinker/test-kit` (kept as a shim so `globalSetup` / `globalTeardown` paths don't move).
6. **Unit test** the factory shape (`libs/test-kit/src/__tests__/harness.spec.ts`).
7. **Run quality gate** — `pnpm lint && pnpm type-check && pnpm test`. Integration tests require Docker; rely on CI.
8. **Docs** — plugin-author-guide section + testing-guide cross-link.
9. **Commit + self-review + PR**. Body: `Closes #600`; note PrestaShop-Testcontainer-relocation deferred; note Thread G next steps (#601 in-memory fakes, #603 FE harness) remain.

## 7. Quality gate

```bash
pnpm lint
pnpm type-check
pnpm test                       # full unit suite across all workspaces
# Optional, Docker-dependent:
pnpm test:integration
```

## 8. Validation checklist

- [ ] `libs/test-kit/` builds standalone (`pnpm --filter @openlinker/test-kit build`).
- [ ] `apps/api/test/integration/setup.ts` is < 50 LoC and contains only API-specific config.
- [ ] No int-spec in `apps/api/test/integration/*.int-spec.ts` is touched.
- [ ] `pnpm lint && pnpm type-check && pnpm test` green.
- [ ] `docs/plugin-author-guide.md` has a "Testing your adapter" section with a working code example.
- [ ] `docs/testing-guide.md` cross-links to the new section.
- [ ] PR body carries `Closes #600` and explicitly notes the PrestaShop-harness relocation is **not** in scope.

# Implementation Plan — Scheduler Task Registry (#584)

**Issue**: [#584 — [E4] [HIGH] SchedulerService hardcodes Allegro-specific cron tasks and env-var keys](https://github.com/SilkSoftwareHouse/openlinker/issues/584)
**Thread**: E (Remove platform-specific knowledge from core orchestration) — last HIGH item.
**Branch**: `584-scheduler-task-registry`

---

## 1. Goal

`apps/api/src/sync/application/services/scheduler.service.ts` currently hardcodes two Allegro-specific cron tasks (`allegro-orders-poll`, `allegro-offers-sync`) and reads six `OL_ALLEGRO_*` env-vars. Adding a Shopify orders poll requires editing core.

Make core platform-agnostic: integrations contribute their own cron tasks at boot via a registry, mirroring the pattern already established for retry classification (#581), webhook provisioning (#583), email normalization (#585), connection testing.

**Non-goals**:
- No rename of the existing `OL_ALLEGRO_*` env-vars (backwards compat for deployers).
- Capability-based core tasks (`master-inventory-sync`, `master-product-sync`) stay in core — they're cross-platform orchestration, not platform-specific triggers.
- No new public HTTP surface; no plugin-author-facing API design beyond the registry call.

## 2. Layer classification

- **CORE** (`libs/core/src/sync/`) — define the scheduler-task config type and a registry service.
- **Integration** (`libs/integrations/allegro/`) — Allegro module self-registers its two cron tasks in `onModuleInit`.
- **Interface** (`apps/api/src/sync/`) — `SchedulerService` reshaped to drain the registry at bootstrap.

## 3. Pattern reuse

Mirrors three already-merged sibling registries on Thread E:

| Registry | File | Established by |
|---|---|---|
| `RetryClassifierRegistryService` | `libs/core/src/sync/infrastructure/adapters/retry-classifier-registry.service.ts` | #581 |
| `WebhookProvisioningRegistryService` | `libs/core/src/integrations/infrastructure/adapters/webhook-provisioning-registry.service.ts` | #583 |
| `EmailNormalizerRegistryService` | `libs/core/src/integrations/infrastructure/adapters/email-normalizer-registry.service.ts` | #585 |

Same shape: a `Map`-backed `@Injectable()` service with `register(key, value)` / `get(key)` / `has(key)`; token in `*.tokens.ts`; bound `useExisting` in the owning module; integration modules write to it in `onModuleInit`.

Key divergence: scheduler tasks are **additive, not keyed by `adapterKey`** (the scheduler drains the full set once at bootstrap and schedules each). The registry only needs `register(task)` + `getAll()`.

## 4. Design

### 4.1 New file — `libs/core/src/sync/domain/types/scheduler-task.types.ts`

Move `SchedulerTaskConfig` from `apps/api/.../scheduler.service.ts` to core so integrations can import it via the `@openlinker/core/sync` alias. The interface stays structurally identical — `taskId`, `platformType?`, `jobType`, `cronExpression`, `enabledEnvVar?`, `connectionFilter?`, `generatePayload`, `generateIdempotencyKey`.

**JSDoc invariant on `platformType` / `connectionFilter`**: now that this type is public-surface (consumable by plugin authors), the existing implicit "exactly one of these two must be present" invariant must be documented on both fields. `executeTask` already enforces it at runtime by erroring when both are absent; document it on the type so plugin authors find out at JSDoc-hover time, not at first cron tick. A future refactor could promote this to a discriminated union — out of scope here (noted in §8).

### 4.2 New file — `libs/core/src/sync/infrastructure/adapters/scheduler-task-registry.service.ts`

```typescript
@Injectable()
export class SchedulerTaskRegistryService {
  private readonly tasks: Map<string, SchedulerTaskConfig> = new Map();

  register(task: SchedulerTaskConfig): void {
    this.tasks.set(task.taskId, task);
  }

  getAll(): SchedulerTaskConfig[] {
    return [...this.tasks.values()];
  }

  has(taskId: string): boolean {
    return this.tasks.has(taskId);
  }
}
```

Silent overwrite on duplicate `taskId` mirrors `ConnectionTesterRegistryService`/`WebhookProvisioningRegistryService` — integration modules register once at boot so collisions are near-impossible. (Duplicate `taskId` would also collide on `SchedulerRegistry.addCronJob` downstream, surfacing as a hard error — so the "silent" overwrite isn't actually silent in practice.)

**File-header callout (required)**: the file header MUST explicitly note that this registry's `register(task)` / `getAll()` signature diverges from sibling registries (`RetryClassifierRegistryService`, `WebhookProvisioningRegistryService`, `EmailNormalizerRegistryService`, `ConnectionTesterRegistryService`) which all index by `adapterKey`. The divergence is justified because cron tasks are **additive** — drained once at bootstrap by the scheduler, never dispatched by `adapterKey`. Without this rationale a future reviewer reads the shape difference as drift and tries to "fix" it back into sibling shape.

### 4.3 Token — `libs/core/src/sync/sync.tokens.ts`

```typescript
export const SCHEDULER_TASK_REGISTRY_TOKEN = Symbol('SchedulerTaskRegistryService');
```

### 4.4 Wire in `libs/core/src/sync/sync.module.ts`

Provide `SchedulerTaskRegistryService` + token binding (`useExisting`), export both for downstream consumption.

### 4.5 Re-export from `libs/core/src/sync/index.ts`

```typescript
export { SchedulerTaskConfig } from './domain/types/scheduler-task.types';
export { SchedulerTaskRegistryService } from './infrastructure/adapters/scheduler-task-registry.service';
export { SCHEDULER_TASK_REGISTRY_TOKEN } from './sync.tokens';
```

### 4.6 Reshape `apps/api/src/sync/application/services/scheduler.service.ts`

- Import `SchedulerTaskConfig` from `@openlinker/core/sync` (remove local definition).
- Inject `SCHEDULER_TASK_REGISTRY_TOKEN` → `SchedulerTaskRegistryService`.
- **Switch from `OnModuleInit` to `OnApplicationBootstrap`** so all integration modules have already written to the registry before the scheduler drains it. NestJS guarantees `onApplicationBootstrap` fires after every module's `onModuleInit`.
- **Make `registerTask` private** (was public, used only internally by the two capability-based registrations + one test). The registry becomes the *only* external contributor seam, tightening the public contract.
- New flow at bootstrap:
  1. Call the two capability-based core registrations (`registerInventorySyncTask`, `registerProductSyncTask`) on `this.tasks`.
  2. Drain `schedulerTaskRegistry.getAll()` and merge into `this.tasks`.
  3. Call `scheduleTask` on each.
- Delete the two Allegro task registrations and `getMasterCatalogConnectionId` (moves to Allegro integration).

### 4.7 Allegro contributor — new file `libs/integrations/allegro/src/scheduler/allegro-scheduler-tasks.ts`

Pure helper that builds two `SchedulerTaskConfig` instances from `ConfigService`. Keeping it out of the module file mirrors how Allegro keeps `AllegroRetryClassifierAdapter` etc. in dedicated files.

### 4.8 Wire in `libs/integrations/allegro/src/allegro-integration.module.ts`

- Inject `SCHEDULER_TASK_REGISTRY_TOKEN` (not `@Optional` — the registry lives in core's `SyncModule`, which `AllegroIntegrationModule` already imports).
- In `onModuleInit`, build the two Allegro tasks from the helper, gate each on its `OL_ALLEGRO_*_SCHEDULER_ENABLED` env-var, and call `registry.register(...)`.
- **Add a code comment next to the registration calls** explaining that registration is unconditional w.r.t. host app (API vs worker): the worker imports `AllegroIntegrationModule` too but no scheduler consumer drains the registry there. This is benign — the `Map<string, SchedulerTaskConfig>` is a small heap retention with no side effects until a scheduler drains it. Saves a future contributor's confusion.

Note: the env-var gates currently live in `SchedulerService.registerDefaultTasks`. After the move, the Allegro module owns its own enable-gate (scheduler still re-checks `enabledEnvVar` at execute-time as a runtime override — see `scheduleTask`).

### 4.9 Tests

| File | Change |
|---|---|
| `libs/core/src/sync/infrastructure/adapters/__tests__/scheduler-task-registry.service.spec.ts` | **NEW** — register/getAll/has, overwrite-by-taskId. |
| `apps/api/src/sync/application/services/__tests__/scheduler.service.spec.ts` | **UPDATE** — remove Allegro-specific config-key assumptions; replace with assertion that the scheduler schedules tasks drained from the injected registry; keep inventory/product sync coverage; flip lifecycle hook from `onModuleInit` to `onApplicationBootstrap`. |
| `libs/integrations/allegro/src/__tests__/allegro-scheduler-tasks.spec.ts` | **NEW** — verify helper produces correct payloads + idempotency keys; gates on enable env-vars. |

The harness already sets `OL_ALLEGRO_POLL_SCHEDULER_ENABLED=false` and `OL_ALLEGRO_OFFERS_SYNC_SCHEDULER_ENABLED=false` before init (`apps/api/test/integration/harness.ts:68-69`) — these continue to work because the Allegro module reads `ConfigService` in `onModuleInit`.

**Also update**: the comment block at `harness.ts:60-71` currently instructs future readers to "register the task via `SchedulerService.registerTask()` and then call `scheduleTask()` directly." That advice goes stale after this refactor — the new contributor entry point is `schedulerTaskRegistry.register(...)`. Update the comment to point readers at the registry instead.

## 5. Step-by-step plan

| # | File | Action | Acceptance |
|---|---|---|---|
| 1 | `libs/core/src/sync/domain/types/scheduler-task.types.ts` | Create — move `SchedulerTaskConfig` interface verbatim. | Type exported, no inline declarations remain. |
| 2 | `libs/core/src/sync/infrastructure/adapters/scheduler-task-registry.service.ts` | Create — `@Injectable()` registry with `register`/`getAll`/`has`. | File mirrors `RetryClassifierRegistryService` shape; lint clean. |
| 3 | `libs/core/src/sync/sync.tokens.ts` | Add `SCHEDULER_TASK_REGISTRY_TOKEN`. | Token exported alongside siblings. |
| 4 | `libs/core/src/sync/sync.module.ts` | Provide registry + token binding; export both. | Token resolvable from any module importing `SyncModule`. |
| 5 | `libs/core/src/sync/index.ts` | Re-export type/service/token. | Public surface includes the three new symbols. |
| 6 | `libs/core/src/sync/infrastructure/adapters/__tests__/scheduler-task-registry.service.spec.ts` | Create unit spec. | 3+ cases: register, overwrite, getAll snapshot independence. |
| 7 | `apps/api/src/sync/application/services/scheduler.service.ts` | Refactor: import `SchedulerTaskConfig` from core; inject registry; switch hook to `onApplicationBootstrap`; delete two Allegro task blocks + `getMasterCatalogConnectionId`. | No `'allegro'` literal in file; no `OL_ALLEGRO_*` env reads. |
| 8 | `apps/api/src/sync/application/services/__tests__/scheduler.service.spec.ts` | Update — drop Allegro defaults, add registry-drain test. | All existing assertions still meaningful; new test covers drain path. |
| 9 | `libs/integrations/allegro/src/scheduler/allegro-scheduler-tasks.ts` | Create helper that builds the two `SchedulerTaskConfig` instances. | Function takes `ConfigService` and returns `SchedulerTaskConfig[]` (zero–two entries depending on gates). |
| 10 | `libs/integrations/allegro/src/__tests__/allegro-scheduler-tasks.spec.ts` | Create unit spec for the helper. | Payload shape, idempotency key, enable-gate coverage. |
| 11 | `libs/integrations/allegro/src/allegro-integration.module.ts` | Inject `SCHEDULER_TASK_REGISTRY_TOKEN`; call `registry.register(...)` for each helper-returned task in `onModuleInit`. | Module boots; integration test harness no longer fails. |

## 6. Architecture compliance

- ✅ Domain layer has no framework deps (the new `scheduler-task.types.ts` is a pure interface, no NestJS imports).
- ✅ Registry service lives under `infrastructure/adapters/` per existing convention (sibling registries do the same).
- ✅ Symbol token used for DI.
- ✅ Naming: `*.types.ts`, `*-registry.service.ts` per `engineering-standards.md`.
- ✅ No `any` — `SchedulerTaskConfig` types are unchanged.
- ✅ No `console.log` — `Logger` from shared.
- ✅ Cross-package imports use `@openlinker/core/sync` alias.
- ✅ **File headers on every new file** (`scheduler-task.types.ts`, `scheduler-task-registry.service.ts`, `allegro-scheduler-tasks.ts`, and the two new specs) per `engineering-standards.md#file-headers`. The registry header specifically must include the rationale-for-divergence callout from §4.2.

## 7. Risks

1. **Module init order** — Mitigated by switching `SchedulerService` to `OnApplicationBootstrap`, which fires strictly after all `onModuleInit` hooks (NestJS guarantee).
2. **Worker app boots without SchedulerService** — `apps/worker` doesn't import `apps/api/src/sync/sync.module.ts`, so `SchedulerService` doesn't run there. But `AllegroIntegrationModule` IS imported by the worker — and it will now try to register tasks into a registry that no consumer drains. That's fine: the registry is core, always provided by `SyncModule`, and the unread tasks are simply garbage-collected at worker shutdown. No memory leak (one-time Map<string, config>).
3. **Integration test harness** — `OL_ALLEGRO_POLL_SCHEDULER_ENABLED=false` is set before module init; the Allegro module's new gate consults the same key. Behaviour preserved.
4. **Public type movement** — `SchedulerTaskConfig` was previously *exported* from `apps/api/src/sync/.../scheduler.service.ts`. No external consumer imports it (verified by grep: only references are inside `apps/api`). Safe to relocate to core.

## 8. Out of scope (deferred)

- Generalizing the env-var-gating mechanism (currently bespoke per task) into a typed config-schema port — would be a Thread D-shaped change, not E.
- Removing `Connection.config` `Record<string, any>` from `getMasterCatalogConnectionId` — tracked in #587.
- Promoting `SchedulerTaskRegistryService` into the `@openlinker/plugin-sdk` package — that package doesn't exist yet (#597).
- Promoting `SchedulerTaskConfig` to a discriminated union over `platformType` vs `connectionFilter` to enforce the "exactly one" invariant at compile time — JSDoc captures it for this PR; a typed split is a Thread D follow-up that touches the existing call sites too.
- Splitting the sync module's public surface along the lines of `@openlinker/core/listings` vs `@openlinker/core/listings/services` (#337/#359) — sync currently exports runtime wiring from its main barrel for `RedisStreamsJobEnqueueService`, `RetryClassifierRegistryService`, etc.; this PR continues that convention rather than introducing a parallel split.

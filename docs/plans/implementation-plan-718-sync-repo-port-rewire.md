# Implementation Plan — Rewire sync repository-port callers through ISyncJobsService / ISyncCursorsService (#718, slice 2 of 4)

**Issue**: [#718 — Rewire cross-context repository-port couplings through service interfaces](https://github.com/SilkSoftwareHouse/openlinker/issues/718)
**Slice**: 2 of 4 — sync-context callers.
**Branch**: `718-sync-repo-port-rewire`
**Drops**: 4 of the 12 remaining `(file, symbol)` entries from `scripts/check-cross-context-imports.mjs`.

---

## 0. Goal

Eliminate two cross-context value-imports of sync-owned repository ports. After this PR:

- `libs/core/src/listings/application/services/offer-status-poll.service.ts` no longer imports `SyncJobRepositoryPort` — it calls a new `ISyncJobsService` instead.
- `libs/core/src/orders/application/services/order-ingestion.service.ts` no longer imports `ConnectionCursorRepositoryPort` — it calls a new `ISyncCursorsService` instead.
- 4 entries (2 production + 2 spec) drop from the cross-context-imports allow-list.
- `pnpm check:invariants` stays green with those 4 entries removed.

**Non-goals** (deferred to a follow-up):

- The apps/worker callers of the same two ports — `cursors.controller`, `allegro.controller`, `sync.controller`, `connection.controller`, `marketplace-offers-sync.handler`, `job-intake.consumer`, `sync-job.runner`, plus int-specs. Roughly 17 allow-list entries. These surfaced under #719's extended scope and are not part of #718's original 10-file audit. The new service interfaces this PR introduces are the right seam for them; that rewire is mechanical once the seam exists and belongs in a separate follow-up issue.
- Slice 3 (`listings.OfferMappingRepositoryPort` callers, content → IListingsService).
- Slice 4 (`integrations.IntegrationCredentialRepositoryPort` callers, ai → ICredentialsService).

---

## 1. Architecture mapping

| Layer | What lands here |
|---|---|
| **CORE — Sync application** | Two new service interfaces (`ISyncJobsService`, `ISyncCursorsService`) + their concrete implementations (`SyncJobsService`, `SyncCursorsService`). Both proxy through to the existing repository ports. |
| **CORE — Sync tokens** | Two new Symbol tokens (`SYNC_JOBS_SERVICE_TOKEN`, `SYNC_CURSORS_SERVICE_TOKEN`) in `libs/core/src/sync/sync.tokens.ts`. |
| **CORE — Sync barrel** | `libs/core/src/sync/index.ts` re-exports the two interfaces. |
| **CORE — Sync module** | `SyncModule` registers both services as `useExisting` bindings and exports their tokens. |
| **CORE — Listings application** | `offer-status-poll.service.ts` injects `ISyncJobsService` instead of `SyncJobRepositoryPort`; the single call site swaps from `createIfNotExistsByIdempotencyKey` to a single service method. |
| **CORE — Orders application** | `order-ingestion.service.ts` injects `ISyncCursorsService` instead of `ConnectionCursorRepositoryPort`; two call sites (`get` / `set`) swap to service methods. |
| **Lint** | Drop 4 entries from the `ALLOW_LIST` in `scripts/check-cross-context-imports.mjs`. |

**Why two services and not one umbrella `ISyncService`?**

The two responsibilities are operationally distinct: scheduling jobs vs. tracking cursors. They share a context (sync) but no methods, no return types, no error vocabulary. A single umbrella would mix the two domains. Two narrow services keep the seam intentional and let consumers depend on only what they use. The issue body explicitly names both — `ISyncJobsService` and `ISyncCursorsService`.

**Why not extend the existing `SyncJobQueuePort`?**

The existing `SyncJobQueueService` (`sync-job-queue.service.ts:32`) explicitly throws on `delayMs > 0` — Redis Streams doesn't support delayed delivery. The `offer-status-poll` path uses `SyncJobRepositoryPort.createIfNotExistsByIdempotencyKey({...}, { runAfter })` precisely *because* the queue-port can't schedule into the future. That's a different mechanism (DB-backed `nextRunAt` + worker poll) from queue-port's stream-fanout model. Building a "scheduleDelayed" hook into `SyncJobQueuePort` would muddy that port's contract. A separate `ISyncJobsService` is the cleaner home.

---

## 2. New service: ISyncJobsService

### 2.1 Types (separate file per Engineering Standards § "Type Definitions in Separate Files")

`libs/core/src/sync/application/services/sync-jobs.types.ts`

```ts
import type { JobType } from '../../domain/types/sync-job.types';

export interface ScheduleJobInput {
  jobType: JobType;
  connectionId: string;
  payload: Record<string, unknown>;
  /**
   * Deterministic idempotency key. Two scheduling attempts with the same
   * key produce one row; later attempts return the existing row.
   */
  idempotencyKey: string;
  /** Max attempts the runner will give this job. */
  maxAttempts?: number;
  /** Earliest time the runner is allowed to pick up the job. */
  runAfter: Date;
}
```

### 2.2 Interface

`libs/core/src/sync/application/services/sync-jobs.service.interface.ts`

```ts
import type { SyncJob } from '../../domain/entities/sync-job.entity';
import type { ScheduleJobInput } from './sync-jobs.types';

export interface ISyncJobsService {
  /**
   * Schedule a sync job with a required `runAfter`, idempotently.
   *
   * This path inserts the job directly via the sync-job repository
   * rather than the Redis-stream queue, because the stream-based
   * enqueue (`SyncJobQueuePort.enqueue`) does not deliver messages on
   * a future timestamp. The worker's polling loop picks the job up
   * when `nextRunAt <= now()`.
   *
   * Returns the persisted job — the freshly-created row, or the
   * pre-existing row when the idempotency key has already been seen.
   */
  schedule(input: ScheduleJobInput): Promise<SyncJob>;
}
```

Method name is `schedule`, not `scheduleDelayed`: every call through this method is delayed (`runAfter` is required), so the "Delayed" suffix would be redundant labelling. If a non-delayed variant is ever added it can be a new method on the same interface — the contract doesn't have to evolve to accommodate it.

### 2.3 Implementation

`libs/core/src/sync/application/services/sync-jobs.service.ts`

```ts
/**
 * Sync Jobs Service
 *
 * Application-layer entry point for scheduling sync jobs from
 * cross-context callers. The single method (`schedule`) bypasses the
 * Redis-stream enqueue path on purpose — the stream backend does not
 * support delayed delivery — and writes the job row directly through
 * `SyncJobRepositoryPort`. The worker poller (`nextRunAt <= now()`)
 * picks the row up at the requested time.
 *
 * @module libs/core/src/sync/application/services
 * @implements {ISyncJobsService}
 */
@Injectable()
export class SyncJobsService implements ISyncJobsService {
  constructor(
    @Inject(SYNC_JOB_REPOSITORY_TOKEN)
    private readonly syncJobRepository: SyncJobRepositoryPort,
  ) {}

  async schedule(input: ScheduleJobInput): Promise<SyncJob> {
    return this.syncJobRepository.createIfNotExistsByIdempotencyKey(
      {
        jobType: input.jobType,
        connectionId: input.connectionId,
        payload: input.payload,
        idempotencyKey: input.idempotencyKey,
        maxAttempts: input.maxAttempts,
      },
      { runAfter: input.runAfter },
    );
  }
}
```

Pass-through with no extra logic — the service is the seam, not a place for new policy.

---

## 3. New service: ISyncCursorsService

### 3.1 Interface

`libs/core/src/sync/application/services/sync-cursors.service.interface.ts`

```ts
export interface ISyncCursorsService {
  /**
   * Read the current cursor value for a connection + cursor-key pair.
   * Returns null when no row exists (treat as "from beginning").
   */
  getCursor(connectionId: string, cursorKey: string): Promise<string | null>;

  /**
   * Set the cursor for a connection + cursor-key pair to `value`.
   * Creates the row if missing, updates otherwise. Idempotent and
   * safe for concurrent advances (atomic upsert in the persistence
   * layer).
   *
   * **Monotonicity is the caller's responsibility.** The underlying
   * repository upserts unconditionally — it does NOT reject a value
   * lower than the current one. Callers that need monotonic-only
   * advancement must read with `getCursor` and apply the comparison
   * themselves before calling this method.
   */
  advanceCursor(connectionId: string, cursorKey: string, value: string): Promise<void>;
}
```

Method names use operational verbs (`getCursor` / `advanceCursor`) rather than mirroring the repository-port `get` / `set`. Per slice 1's convention: the service is the seam, names should describe intent at the seam level. The monotonicity note exists because `advanceCursor` reads as a guaranteed-monotonic operation, but the underlying `set` is a plain upsert; without the note a future caller might assume server-side enforcement that isn't there.

### 3.2 Implementation

`libs/core/src/sync/application/services/sync-cursors.service.ts`

```ts
@Injectable()
export class SyncCursorsService implements ISyncCursorsService {
  constructor(
    @Inject(CONNECTION_CURSOR_REPOSITORY_TOKEN)
    private readonly cursorRepository: ConnectionCursorRepositoryPort,
  ) {}

  async getCursor(connectionId: string, cursorKey: string): Promise<string | null> {
    return this.cursorRepository.get(connectionId, cursorKey);
  }

  async advanceCursor(connectionId: string, cursorKey: string, value: string): Promise<void> {
    await this.cursorRepository.set(connectionId, cursorKey, value);
  }
}
```

---

## 4. Tokens, barrel, module

### 4.1 `sync.tokens.ts`

Add two Symbol tokens:

```ts
export const SYNC_JOBS_SERVICE_TOKEN = Symbol('ISyncJobsService');
export const SYNC_CURSORS_SERVICE_TOKEN = Symbol('ISyncCursorsService');
```

### 4.2 `libs/core/src/sync/index.ts`

Add re-exports for the two interfaces + the input type (tokens already re-exported via `export * from './sync.tokens'`):

```ts
export type { ISyncJobsService } from './application/services/sync-jobs.service.interface';
export type { ScheduleJobInput } from './application/services/sync-jobs.types';
export type { ISyncCursorsService } from './application/services/sync-cursors.service.interface';
```

### 4.3 `sync.module.ts`

Register both concrete services + their token bindings, export the tokens:

```ts
providers: [
  // ... existing
  SyncJobsService,
  { provide: SYNC_JOBS_SERVICE_TOKEN, useExisting: SyncJobsService },
  SyncCursorsService,
  { provide: SYNC_CURSORS_SERVICE_TOKEN, useExisting: SyncCursorsService },
],
exports: [
  // ... existing
  SYNC_JOBS_SERVICE_TOKEN,
  SYNC_CURSORS_SERVICE_TOKEN,
],
```

---

## 5. Consumer rewires

### 5.1 `offer-status-poll.service.ts`

- Drop `SYNC_JOB_REPOSITORY_TOKEN` + `SyncJobRepositoryPort` imports.
- Add `SYNC_JOBS_SERVICE_TOKEN` + `ISyncJobsService` imports.
- Constructor: replace the `@Inject(SYNC_JOB_REPOSITORY_TOKEN) private readonly syncJobRepository: SyncJobRepositoryPort` binding with `@Inject(SYNC_JOBS_SERVICE_TOKEN) private readonly syncJobs: ISyncJobsService`.
- Call-site: replace
  ```ts
  await this.syncJobRepository.createIfNotExistsByIdempotencyKey(
    { jobType: POLL_JOB_TYPE, connectionId, payload, idempotencyKey, maxAttempts: RUNNER_RETRY_BUDGET },
    { runAfter },
  );
  ```
  with
  ```ts
  await this.syncJobs.schedule({
    jobType: POLL_JOB_TYPE,
    connectionId,
    payload,
    idempotencyKey,
    maxAttempts: RUNNER_RETRY_BUDGET,
    runAfter,
  });
  ```
- File-header comment at line 13 (`Bypasses Redis Streams: enqueues directly via SyncJobRepositoryPort so we can set a future nextRunAt`) is now stale after the rewire — the consumer no longer touches the repository or the stream. Replace with a one-liner noting `ISyncJobsService` is the seam, with the bypass rationale moved to the service's own docblock (§2.3).
- Update file-header `@see` (currently mentions `SyncJobRepositoryPort`) to reference `ISyncJobsService` for #718 consistency with slice 1.

### 5.2 `order-ingestion.service.ts`

- Drop `CONNECTION_CURSOR_REPOSITORY_TOKEN` + `ConnectionCursorRepositoryPort` imports.
- Add `SYNC_CURSORS_SERVICE_TOKEN` + `ISyncCursorsService` imports.
- Constructor: same swap.
- Two call sites:
  - `this.cursorRepository.get(connectionId, cursorKey)` → `this.syncCursors.getCursor(connectionId, cursorKey)`.
  - `this.cursorRepository.set(connectionId, cursorKey, nextCursor)` → `this.syncCursors.advanceCursor(connectionId, cursorKey, nextCursor)`.
- Update file-header `@see` if it references the repository port.

---

## 6. Spec rewires

| Spec | `Pick<I*, …>` |
|---|---|
| `offer-status-poll.service.spec.ts` | `Pick<ISyncJobsService, 'schedule'>` |
| `order-ingestion.service.spec.ts` | `Pick<ISyncCursorsService, 'getCursor' \| 'advanceCursor'>` |

Each spec drops the repository-port mock + its `provide: *_REPOSITORY_TOKEN` binding and replaces with a service-token binding. Assertion verbs change: `expect(syncJobRepository.createIfNotExistsByIdempotencyKey)` → `expect(syncJobs.scheduleDelayed)`; `expect(cursorRepository.get/set)` → `expect(syncCursors.getCursor/advanceCursor)`.

---

## 7. New service unit tests

`libs/core/src/sync/application/services/sync-jobs.service.spec.ts` — covers `scheduleDelayed` pass-through.

`libs/core/src/sync/application/services/sync-cursors.service.spec.ts` — covers `getCursor` + `advanceCursor` pass-through.

Both specs follow the slice-1 pattern: mock the underlying repository port, assert the service forwards exact args.

---

## 8. Allow-list cleanup

Remove these four entries from `scripts/check-cross-context-imports.mjs`:

```
'libs/core/src/listings/application/services/offer-status-poll.service.ts'        → 'SyncJobRepositoryPort'
'libs/core/src/listings/application/services/__tests__/offer-status-poll.service.spec.ts' → 'SyncJobRepositoryPort'
'libs/core/src/orders/application/services/order-ingestion.service.ts'            → 'ConnectionCursorRepositoryPort'
'libs/core/src/orders/application/services/__tests__/order-ingestion.service.spec.ts'     → 'ConnectionCursorRepositoryPort'
```

The apps/worker entries (17+ across sync.controller, allegro.controller, cursors.controller, connection.controller, marketplace-offers-sync.handler, job-intake.consumer, sync-job.runner, and int-specs) stay until a separate follow-up rewires them through `ISyncJobsService` / `ISyncCursorsService`.

---

## 9. Testing strategy

| Layer | Test | What it asserts |
|---|---|---|
| Sync service | `sync-jobs.service.spec.ts` | `scheduleDelayed` forwards `(jobType, connectionId, payload, idempotencyKey, maxAttempts)` + `{ runAfter }` to the repository unchanged. |
| Sync service | `sync-cursors.service.spec.ts` | `getCursor`/`advanceCursor` forward `(connectionId, cursorKey[, value])` to the repository unchanged. |
| Listings consumer | `offer-status-poll.service.spec.ts` | `enqueuePoll` calls `syncJobs.scheduleDelayed` exactly once with the correct (payload, idempotencyKey, runAfter) triple. |
| Orders consumer | `order-ingestion.service.spec.ts` | Existing assertions on cursor get/set move verbatim to `getCursor`/`advanceCursor`. |
| Lint invariant | `pnpm check:invariants` | 4 allow-list entries removed; remaining entries still pass. |

No behaviour change → no integration test needed.

---

## 10. Acceptance criteria (slice 2 of #718)

- [ ] `offer-status-poll.service.ts` no longer imports `SyncJobRepositoryPort` or `SYNC_JOB_REPOSITORY_TOKEN`.
- [ ] `order-ingestion.service.ts` no longer imports `ConnectionCursorRepositoryPort` or `CONNECTION_CURSOR_REPOSITORY_TOKEN`.
- [ ] Both consumer specs mock the new service interfaces.
- [ ] `ISyncJobsService` + `ISyncCursorsService` exist and are exported from `@openlinker/core/sync`.
- [ ] Allow-list drops the 4 core entries listed in §8.
- [ ] `pnpm check:invariants`, `pnpm lint`, `pnpm type-check`, `pnpm test` all green.

---

## 11. Risks & open questions

- **Apps/worker scope**: chosen to defer (see §0). New service interfaces are the right seam for them; rewire is mechanical once this PR lands. **List the 17 deferred allow-list entries explicitly in the PR body's "Follow-ups" section**, so the work doesn't get lost to "we'll file it after merge" drift — the next reader of the allow-list (slice-3 or slice-4 author) sees the queued cleanup at the entry point rather than having to dig through git history. Filing a separate GitHub issue is optional; the PR-body checklist is the load-bearing seam.
- **`SyncJob` return type leak**: `scheduleDelayed` returns `SyncJob` (the domain entity). `offer-status-poll`'s single caller ignores the return value (`await this.syncJobRepository.createIfNotExistsByIdempotencyKey(...)` — return is unused). Keeping the return for parity with the underlying repository method, but worth noting that the consumer doesn't read it. If this becomes the only caller, the service could narrow to `Promise<void>`. Defer the narrowing decision until a second caller emerges.
- **`maxAttempts` optionality**: `ScheduleDelayedJobInput.maxAttempts` is optional in the input type to mirror the repository's existing optional field. The current `offer-status-poll` caller always passes `RUNNER_RETRY_BUDGET`. Optional in the contract for future-flexibility, not a current need.
- **Module circulars**: `SyncModule` already exports its token surface; no new imports between `SyncModule` and consumer modules (`ListingsModule`, `OrdersModule`). Consumer modules already import `SyncModule` (they currently use `SYNC_JOB_REPOSITORY_TOKEN` / `CONNECTION_CURSOR_REPOSITORY_TOKEN`). Verify per-module during implementation.

---

## 12. Out-of-scope follow-ups

- **Apps/worker sync-port rewire** (~17 allow-list entries) — file a new issue once this PR merges. Title: "Rewire apps + worker sync repository-port callers through ISyncJobsService / ISyncCursorsService (#718 follow-up)".
- **Slice 3** — listings.OfferMappingRepositoryPort callers (content → IListingsService).
- **Slice 4** — integrations.IntegrationCredentialRepositoryPort callers (ai → ICredentialsService).
- **Barrel cleanup**: dropping `SyncJobRepositoryPort` and `ConnectionCursorRepositoryPort` from `@openlinker/core/sync`'s barrel once all cross-context callers (incl. apps/worker) are rewired. Intra-context users (the sync context itself) still need them; the lint script is the active gate.

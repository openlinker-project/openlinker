# Implementation Plan — #447: Poll Allegro offer-creation status

**Branch:** `447-allegro-offer-poll-creation-status`
**Scope:** Self-rescheduling sync-job that polls `GET /sale/product-offers/{id}` until terminal, then updates `OfferCreationRecord`. Replaces the `logger.warn` TODO at `offer-creation-execution.service.ts:148`.

---

## 1. Goal

When `POST /sale/product-offers` returns `publication.status: ACTIVATING`, the Allegro adapter maps it to `CreateOfferResultStatus: 'validating'`. Today, `OfferCreationExecutionService` persists the record with `status='validating'`, logs a warn, and returns `outcome:'ok'`. The record then sits forever — the FE polls every 5 s on `['listings','offerCreationStatus',...]` but only stops on `active|draft|failed`, so operators see a permanently-stuck offer.

The fix is a new sync-job type `marketplace.offer.pollCreationStatus` that re-runs every few seconds (capped) and flips the record to its terminal state.

## 2. Layer classification

- **CORE** — new application service `OfferStatusPollService` (owns the orchestration), new sub-capability `OfferStatusReader` + co-located guard, new neutral types, new domain exception, two new sync-job/payload registrations, two token additions
- **Integration (Allegro)** — `AllegroOfferManagerAdapter` implements `OfferStatusReader.getOfferStatus`; extracted shared helper for `GET /sale/product-offers/{id}` (used today only by the private `fetchOfferIdentifiers`)
- **Worker** — thin handler that resolves the adapter, narrows via the guard, calls the core service
- **DX** — `.env.example` documents four `OL_ALLEGRO_OFFER_POLL_*` env vars

## 3. Non-goals

- No FE changes. The existing 5 s polling loop in `useOfferCreationStatusQuery` stops naturally once the record reaches `active|draft|failed`.
- No new `'inactive'` value on `OfferCreationStatusValues`. Allegro `INACTIVE` (no errors) and `ENDED` map to `'draft'` — the offer exists, isn't live, the create-flow record is terminal. The record tracks **creation lifecycle**, not ongoing offer health.
- No domain events / event bus. The DB record-update + FE polling closes the loop.
- No retry of the original create flow from the poller. If Allegro returns terminal validation errors → `record.status = 'failed'` and the existing FE "Retry" button (which replays the snapshot) handles user-driven retries.
- No change to the runner's hardcoded retry constants. Polling cadence is owned by the application service via env vars; the runner's existing 30 s/2× backoff stays out of the polling path.
- No persistence of `lastPolledAt` / `pollAttempts` columns on `OfferCreationRecord`. `pollAttempt` is transient-in-payload (decision locked).

## 4. Background — what already exists

- **Warning site (the TODO):** `libs/core/src/listings/application/services/offer-creation-execution.service.ts:144-150` — at this point the record is already persisted with `status='validating'`, `externalOfferId` set, snapshot kept; `IdentifierMapping('Offer', externalOfferId, connectionId, internalVariantId)` was created upstream (lines ~124-129). The poller does **not** re-create the mapping.
- **Allegro mapping (creation):** `allegro-offer-manager.adapter.ts:1214-1232` — `resolveCreateOfferStatus(publicationStatus, hasValidationErrors, publishImmediately)`. `ACTIVATING` → `validating`, `ACTIVE` → `active`, default → `draft`. Codebase recognises five Allegro statuses: `INACTIVE | ACTIVE | ACTIVATING | INACTIVATING | ENDED` (`AllegroOfferPublicationStatusValues` in `allegro-api.types.ts`).
- **Existing GET-by-id call:** `fetchOfferIdentifiers(offerId, categoryId)` at `allegro-offer-manager.adapter.ts:463-502` already issues `httpClient.get<AllegroProductOffer>('/sale/product-offers/${offerId}')`. We extract a shared private helper so the new `getOfferStatus` reuses the same call without duplicating header/error handling.
- **`OfferCreationStatusValues`:** `'pending' | 'draft' | 'validating' | 'active' | 'failed'` (`libs/core/src/listings/domain/types/offer-creation-record.types.ts`). `errors: OfferCreationError[]` jsonb column is already present and populated on `failed`.
- **`OfferCreator` capability:** `createOffer(cmd) → CreateOfferResult { externalOfferId, status: 'draft'|'validating'|'active', validationErrors? }`. We mirror the *result* shape on the new reader so mapping is symmetric.
- **`JobTypeValues` registry:** `libs/core/src/sync/domain/types/sync-job.types.ts:16-33`. Append `'marketplace.offer.pollCreationStatus'` (reverse-DNS dotted, matches existing convention).
- **Worker registration pattern:** `apps/worker/src/sync/handlers/handler-registration.service.ts:44+` — one line per registration in `onModuleInit()`. New handler injected as a constructor field.
- **Sync-job runner mechanics:** `nextRunAt` (TIMESTAMP) on `sync_jobs`; runner picks up rows where `status='queued' AND nextRunAt <= NOW()`. Self-rescheduling is the prior-art pattern (`OrdersPollHandler`): handler completes `'ok'`, application service enqueues the next iteration via `JobEnqueuePort.enqueueJob` with a custom `nextRunAt`.
- **Idempotency (`enqueueJob`):** `SyncJobRepository.createIfNotExistsByIdempotencyKey` short-circuits on duplicate keys. We use `pollCreationStatus:{recordId}:{pollAttempt}` so each poll iteration has a unique key.
- **FE polling:** `apps/web/src/features/listings/hooks/use-offer-creation-status-query.ts` — 5 s `refetchInterval`, stops on `'draft' | 'active' | 'failed'`. Will pick up the terminal transition within ≤5 s of record-update; **no FE changes required**.

## 5. Design — state machine + cadence

### 5.1 State mapping (Allegro → record + handler outcome)

The mapping is split across two layers to keep the reader port platform-agnostic:

- **Adapter (`OfferStatusReader.getOfferStatus`)** returns the raw observation: `{ publicationStatus: AllegroOfferPublicationStatus, validationErrors: OfferValidationError[] }`. It does NOT know about OL record states. A 404 on the offer-id is also expressed at this layer — see "404 handling" below.
- **Core service (`OfferStatusPollService.pollOnce`)** owns the mapping from raw observation → `OfferCreationRecord` lifecycle. Future marketplace adapters (Shopify, eBay) supply their own `getOfferStatus` returning their own neutral observation; the service stays the single owner of OL record-state semantics.

| `publication.status` (from adapter) | `validation.errors` | → `record.status` | next action | handler outcome |
|---|---|---|---|---|
| `ACTIVE` | n/a | `'active'` | done | `ok` |
| `ACTIVATING` | n/a | (unchanged: `'validating'`) | re-enqueue next poll | `ok` |
| `INACTIVATING` | n/a | (unchanged: `'validating'`) | re-enqueue next poll | `ok` |
| `INACTIVE` | empty | `'draft'` | done | `ok` |
| `INACTIVE` | non-empty | `'failed'` (with errors) | done | `business_failure` |
| `ENDED` | n/a | `'draft'` | done | `ok` |
| 404 — offer gone | n/a | `'failed'` (errors=[{code:`OFFER_NOT_FOUND`}]) | done | `business_failure` |
| max attempts hit | n/a | `'failed'` (errors=[{code:`POLL_TIMEOUT`}]) | done | `business_failure` |

**404 handling.** The adapter throws a domain exception (`OfferNotFoundOnMarketplaceException`, new) which the service catches and maps to the `'failed'` row above. Adapter does not invent a synthetic publication-status for this case — that would muddle the neutral observation contract.

### 5.2 Cadence

Defaults (all env-tunable):
- `OL_ALLEGRO_OFFER_POLL_INITIAL_DELAY_SECONDS=5`
- `OL_ALLEGRO_OFFER_POLL_BACKOFF_MULTIPLIER=2`
- `OL_ALLEGRO_OFFER_POLL_MAX_DELAY_SECONDS=60`
- `OL_ALLEGRO_OFFER_POLL_MAX_ATTEMPTS=12`

→ delays: 5, 10, 20, 40, 60, 60, 60, 60, 60, 60, 60, 60 s — worst case ≈ 9 min over 12 attempts. Allegro's pipeline is "usually within seconds, sometimes minutes," so this comfortably covers the long tail.

### 5.3 Self-enqueue mechanics

Two retry counters operate on orthogonal axes:

- **`pollAttempt`** (1..`OL_ALLEGRO_OFFER_POLL_MAX_ATTEMPTS`, default 12) — owns the *polling cadence*. Lives in the job payload. Service increments on each iteration and writes `pollAttempt+1` into the next enqueue's payload.
- **`maxAttempts=3`** on each `sync_jobs` row — owns the *runner's retry on transient HTTP errors* (e.g. Allegro 5xx, network blip). Each poll iteration tolerates 2 runner-level retries before that iteration is marked dead.

Each poll iteration = a fresh `sync_jobs` row with `status='queued'`, `nextRunAt = now() + delay`, `attempts=0`, `maxAttempts=3`.

- Idempotency key: `pollCreationStatus:{offerCreationRecordId}:{pollAttempt}`.
- On every dequeue, the handler reads `pollAttempt` from payload, calls the core service, which (a) hits Allegro, (b) updates the record on terminal, OR (c) re-enqueues at `pollAttempt+1` with the next backoff delay. If `pollAttempt > maxPollAttempts`, the service writes `record.status='failed'` with `POLL_TIMEOUT` and stops.
- **Worst-case Allegro load:** 12 poll iterations × 3 runner retries = 36 GETs per stuck offer over ~9 minutes. With ~10 concurrent in-flight creations, peak ≈ 4 req/s — well within Allegro's 1000 req/min default quota.

### 5.4 Handler outcome semantics (#391/#400)

- A successful poll that reaches a terminal **business** failure (`INACTIVE` with errors, 404, max-attempts) → `outcome: 'business_failure'`. Matches how `marketplace.offer.create` maps record.status `'failed'` to `business_failure`.
- A successful poll that finds Allegro still validating (re-enqueue path) → `outcome: 'ok'`. The poll itself succeeded; the offer just isn't ready yet.
- Transient HTTP / network error → `throw` → runner marks failed with backoff (`maxAttempts=3` per §5.3 absorbs 1–2 transient blips before this iteration dies; the next poll iteration then runs as scheduled).

## 6. Files

### CORE — `libs/core/src/listings/` (prep)

| File | Action | Notes |
|---|---|---|
| `domain/types/offer-validation-error.types.ts` | **new (prep)** | Extract `OfferValidationError` (currently inlined in `offer-creator.capability.ts`) into its own types file per Engineering Standards §"Type Definitions in Separate Files". Both `offer-creator.capability.ts` and the new `offer-status-reader.capability.ts` will import it from here. Run as **step 0** of §7 — keeps the type extraction as its own atomic edit so #447's diff stays focused. If grep shows the type is already in a `*.types.ts` file, skip this row and the corresponding §7 step. |
| `domain/ports/capabilities/offer-creator.capability.ts` | edit (prep) | If row above ran, update import + drop the inline definition. No behaviour change. |

### CORE — `libs/core/src/listings/` (#447 proper)

| File | Action | Notes |
|---|---|---|
| `domain/ports/capabilities/offer-status-reader.capability.ts` | new | `interface OfferStatusReader { getOfferStatus(externalOfferId: string): Promise<OfferStatusReadResult>; }` + `isOfferStatusReader(adapter: unknown): adapter is OfferStatusReader` co-located guard |
| `domain/types/offer-status-read.types.ts` | new | `OfferStatusReadResult { publicationStatus: AllegroOfferPublicationStatus; validationErrors: OfferValidationError[]; }` — neutral, platform-agnostic observation. Imports `OfferValidationError` from the extracted types file above. Note: the `publicationStatus` type is the Allegro union for now (it's the only marketplace with an async-validation lifecycle); rename to `OfferPublicationStatus` and broaden when a second marketplace ships. The `'failed'` lifecycle state lives on `OfferCreationRecord`, not in this result type — see §5.1 |
| `domain/exceptions/offer-poll-not-supported.exception.ts` | new | thrown when adapter for the connection does not implement `OfferStatusReader` |
| `domain/exceptions/offer-not-found-on-marketplace.exception.ts` | new | thrown by adapter on 404 from `GET /sale/product-offers/{id}`; caught by core service and mapped to record.status='failed' with `OFFER_NOT_FOUND` |
| `application/interfaces/offer-status-poll.service.interface.ts` | new | `IOfferStatusPollService { scheduleFirstPoll(input): Promise<void>; pollOnce(input): Promise<{ outcome: 'ok' \| 'business_failure' }>; }` |
| `application/services/offer-status-poll.service.ts` | new | `@Injectable`. Injects `INTEGRATIONS_SERVICE_TOKEN`, `OFFER_CREATION_RECORD_REPOSITORY_TOKEN`, `JOB_ENQUEUE_TOKEN`, `ConfigService`, `Logger`. `scheduleFirstPoll` enqueues iteration #1; `pollOnce` does fetch → map (§5.1 helper) → terminal-update OR re-enqueue. Reads cadence env vars on construction (cached) |
| `application/services/__tests__/offer-status-poll.service.spec.ts` | new | covers all 8 rows of §5.1, re-enqueue branch, max-attempts cutoff, `OfferStatusReader`-not-supported exception, `OfferNotFoundOnMarketplaceException` mapping, idempotency-key collision (no-op) |
| `listings.tokens.ts` | extend | add `OFFER_STATUS_POLL_SERVICE_TOKEN` symbol |
| `listings.module.ts` (`/services` subpath) | extend | provide `OfferStatusPollService` bound to its token |
| `index.ts` | extend | export interface + token + capability + guard + types + both exceptions |
| `domain/ports/offer-creation-record-repository.port.ts` | **verify, possibly extend** | Service needs to atomically write `(status, errors)` on terminal states (the `INACTIVE+errors → 'failed'` and 404/timeout rows in §5.1). The create flow already uses an atomic `updateExternalIdAndStatus(recordId, externalOfferId, status, errors)`. Verify in step 1 of §7 whether that method covers our update shape (we don't change `externalOfferId` here). If not, add `updateStatusAndErrors(recordId, status, errors)` — single SQL UPDATE. **Do not** call `updateStatus` and a separate errors-write — a crash between would leave an inconsistent record. |

### CORE — `libs/core/src/sync/`

| File | Action | Notes |
|---|---|---|
| `domain/types/sync-job.types.ts` | extend | append `'marketplace.offer.pollCreationStatus'` to `JobTypeValues` |
| `domain/types/marketplace-job-payloads.types.ts` | extend | new `MarketplaceOfferPollCreationStatusPayloadV1 { schemaVersion: 1; offerCreationRecordId: string; externalOfferId: string; pollAttempt: number; }` |

### CORE — wire the call site

| File | Action | Notes |
|---|---|---|
| `libs/core/src/listings/application/services/offer-creation-execution.service.ts` | edit (line 144-150) | replace the `logger.warn` TODO block with `await this.offerStatusPoll.scheduleFirstPoll({ offerCreationRecordId: finalRecord.id, externalOfferId: result.externalOfferId, connectionId: input.connectionId })`. Inject `IOfferStatusPollService` via `OFFER_STATUS_POLL_SERVICE_TOKEN`. Catch + log enqueue failures so the create flow doesn't fail just because the follow-up enqueue had a hiccup — the warn-log fallback is preserved as a safety net |
| same (test spec) | edit | add a "schedules first poll on validating outcome" test |

### Integration — Allegro

| File | Action | Notes |
|---|---|---|
| `libs/integrations/allegro/src/infrastructure/adapters/allegro-offer-manager.adapter.ts` | edit | (a) extract private `fetchProductOfferById(offerId: string): Promise<AllegroProductOffer>` helper wrapping the existing `httpClient.get` at line ~468; (b) refactor `fetchOfferIdentifiers` to use the helper (no behaviour change); (c) implement `getOfferStatus(externalOfferId): Promise<OfferStatusReadResult>` returning the neutral observation `{ publicationStatus, validationErrors }` — direct field-mapping from Allegro response, no record-lifecycle logic; (d) on 404 from `fetchProductOfferById`, throw `OfferNotFoundOnMarketplaceException`. Class declaration extends `implements OfferManagerPort, OfferLister, OfferEventReader, OfferFieldUpdater, CategoryBrowser, CategoryBarcodeMatcher, OfferCreator, SellerPoliciesReader, OfferStatusReader` |
| `libs/integrations/allegro/src/infrastructure/adapters/__tests__/allegro-offer-manager.adapter.getOfferStatus.spec.ts` | new | tests the **adapter contract only** (raw observation): each of the 5 Allegro `publication.status` values produces a result with that same `publicationStatus`; presence/absence of `validation.errors` flows through faithfully; 404 throws `OfferNotFoundOnMarketplaceException`. The §5.1 record-mapping table is tested in the **service** spec, not here — keeps the adapter test focused on transport + neutral observation. Plus one regression test that `fetchOfferIdentifiers` still works after the helper extraction |

### Worker

| File | Action | Notes |
|---|---|---|
| `apps/worker/src/sync/handlers/marketplace-offer-poll-creation-status.handler.ts` | new | `@Injectable` `implements SyncJobHandler`. Parses payload, narrows it via runtime type-guard (mirroring `marketplace-offer-create.handler.ts`), delegates to `IOfferStatusPollService.pollOnce`. Returns the service's `{ outcome }`. Throws `SyncJobExecutionError` on parsing/connection-not-found. HTTP/network errors from inside `pollOnce` propagate naturally — the runner's retry-on-throw kicks in |
| `apps/worker/src/sync/handlers/__tests__/marketplace-offer-poll-creation-status.handler.spec.ts` | new | smoke test: payload narrows, service called once, outcome returned |
| `apps/worker/src/sync/sync-worker.module.ts` | extend | register the new handler in providers |
| `apps/worker/src/sync/handlers/handler-registration.service.ts` | extend | constructor field + `this.handlerRegistry.register('marketplace.offer.pollCreationStatus', this.marketplaceOfferPollCreationStatusHandler)` in `onModuleInit()` |

### DX

| File | Action | Notes |
|---|---|---|
| `.env.example` | extend | document `OL_ALLEGRO_OFFER_POLL_INITIAL_DELAY_SECONDS=5`, `_BACKOFF_MULTIPLIER=2`, `_MAX_DELAY_SECONDS=60`, `_MAX_ATTEMPTS=12` |

## 7. Step-by-step implementation order

0. **Prep — extract `OfferValidationError`** (only if not already in a `*.types.ts`). Move the type definition to `libs/core/src/listings/domain/types/offer-validation-error.types.ts`; update import in `offer-creator.capability.ts`. Atomic edit, behaviour-neutral, makes step 1 clean.
1. **Verify `OfferCreationRecordRepositoryPort` atomic-update surface** — grep for `updateExternalIdAndStatus` / `updateStatus` and confirm the service can write `(status, errors)` atomically (covers §5.1's `'failed'` rows). If neither method covers the shape, add `updateStatusAndErrors(recordId, status, errors)` in the same step; never split into two writes.
2. **Types + capability + guard + exceptions** — `OfferStatusReadResult` (`{publicationStatus, validationErrors}`), `OfferStatusReader` capability + `isOfferStatusReader` guard, `OfferPollNotSupportedException`, `OfferNotFoundOnMarketplaceException`. Pure declarations.
3. **Allegro adapter** — extract `fetchProductOfferById` helper (refactor `fetchOfferIdentifiers` to use it; existing tests must pass); implement `getOfferStatus` returning raw observation; throw `OfferNotFoundOnMarketplaceException` on 404; declare `implements OfferStatusReader`. Adapter test green.
4. **Sync-job registry** — append `'marketplace.offer.pollCreationStatus'` to `JobTypeValues`; add `MarketplaceOfferPollCreationStatusPayloadV1`. Two-line changes; unblocks worker + core in parallel.
5. **Core service** — `OfferStatusPollService` + interface + token + module wiring. Owns the §5.1 mapping table as a private pure helper. Unit-test the state machine and re-enqueue branch with mocked `IIntegrationsService` + `JobEnqueuePort`.
6. **Wire create→poll** — replace the `logger.warn` block in `offer-creation-execution.service.ts:144-150` with `scheduleFirstPoll`. Update create-service spec.
7. **Worker handler** — thin shell + handler-registration entry + module provider list. Smoke spec.
8. **`.env.example`** — document the four env vars.
9. **Integration sanity** — manual: with the new env vars, create an offer in the Allegro sandbox and watch the record flip from `validating` → `active` (or `failed` with errors) within minutes. Logged but not gated.
10. **Quality gate** — `pnpm lint && pnpm type-check && pnpm test`. Fix all errors at the root cause.

## 8. Testing strategy

- **Adapter** — tests the **transport + neutral observation contract only** (no record-state logic):
  - 5 rows for `publication.status` ∈ {`ACTIVE`, `ACTIVATING`, `INACTIVATING`, `INACTIVE`, `ENDED`}, asserting the same value flows through to `result.publicationStatus`.
  - 2 rows for `validation.errors` (empty array, 2-error array) on a single status (`INACTIVE` is the realistic carrier — `ACTIVE` with errors doesn't occur in Allegro's contract; testing every cross-product would be theatre).
  - 1 row: 404 → `OfferNotFoundOnMarketplaceException` thrown.
  - 1 regression row: `fetchOfferIdentifiers` still works after the helper extraction (call it with the same fixture used by an existing test, assert no behaviour change).
- **Core service** — owns the §5.1 mapping table. Mock `IIntegrationsService.getCapabilityAdapter` to return a stub `OfferStatusReader`; mock `JobEnqueuePort.enqueueJob`; mock the record repository. Verify: (a) all 8 §5.1 rows produce the documented `record.status` + handler outcome, (b) terminal states write atomically via `updateStatusAndErrors` (or equivalent) and **don't** re-enqueue, (c) `validating` re-enqueues with the right `nextRunAt` and `pollAttempt+1`, (d) `pollAttempt > maxPollAttempts` writes `failed` with `POLL_TIMEOUT` and stops, (e) `isOfferStatusReader` guard miss → throws `OfferPollNotSupportedException` and updates record to `'failed'`, (f) `OfferNotFoundOnMarketplaceException` from adapter → maps to `'failed'` with `OFFER_NOT_FOUND` (no leak of the marketplace exception type to the handler), (g) record already at terminal state when poll runs → no-op + return `'ok'`. Use Vitest's fake timers for cadence assertions.
- **Worker handler** — smoke only. The orchestration is in core; nothing to re-test here.
- **Create-service** — extend the existing `offer-creation-execution.service.spec.ts` with one new test: `'on validating outcome, schedules first poll'`. Verify `scheduleFirstPoll` is called with `{recordId, externalOfferId, connectionId}` AND verify the `logger.warn` safety net still fires if `scheduleFirstPoll` throws.

## 9. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Allegro rate-limit hit by aggressive polling across many in-flight offers | Cadence caps at 60 s and max 12 poll-attempts × 3 runner-attempts = 36 GETs per stuck offer, max. With ~10 concurrent in-flight creations: peak ≈ 4 req/s, well within Allegro's 1 000 req/min default. If we need to soften, raise `OL_ALLEGRO_OFFER_POLL_INITIAL_DELAY_SECONDS` or lower `OL_ALLEGRO_OFFER_POLL_MAX_ATTEMPTS` |
| Worker restart loses in-flight polling | Each iteration is a persisted `sync_jobs` row with `nextRunAt` in the future. Restart resumes naturally — runner picks up due rows on the next scan |
| Adapter doesn't implement `OfferStatusReader` (future marketplace) | `isOfferStatusReader` guard in the core service; throws `OfferPollNotSupportedException` and writes `record.status='failed'` with a clear error code. Adapter author sees a typed compile-time signal that the capability is required for this code path |
| Concurrent `scheduleFirstPoll` calls (double-click on the same record) | Idempotency key `pollCreationStatus:{recordId}:1` dedupes at enqueue time. Second call short-circuits |
| Operator-driven retry from FE collides with existing poll chain | **Verified non-issue.** Per `implementation-plan-offer-retry-affordance.md:19` ("Not linking the new record to the old"), retry mints a fresh `OfferCreationRecord` with a new UUID, so the new poll-job idempotency keys (`pollCreationStatus:{NEW_RECORD_ID}:1`) are naturally unique and the old chain is unaffected (and naturally finishes its lifecycle on the orphaned record). |
| Iteration N completes successfully but iteration N+1 enqueue fails (e.g. DB blip) | `logger.error` + the iteration has already returned `'ok'`. The record stays at `'validating'`. Recovery path: an operator's "Retry" click on the FE produces a fresh record + fresh `pollAttempt=1` chain. Acceptable — failure mode is "stuck record," not "wrong data" |
| Iteration N enqueues iteration N+1, then crashes before marking N succeeded | At-most-one-in-flight guarantee weakens to at-most-two for a brief window: the runner picks up N+1 at its `nextRunAt` while N is still technically in-flight. Outcome: a duplicate Allegro GET. Harmless — the read is idempotent and the second update on the record is also idempotent (it sees the record at terminal and no-ops via the §8 row "g" guard). Worth noting so future readers don't try to add locking. |
| Record already at terminal state when poll runs (e.g. operator dismissed/retried) | Service reads the record before fetching Allegro; if `record.status !== 'validating'`, log + skip + return `'ok'`. No-op |
| 4xx auth-level error from Allegro (token expired, scope revoked) | Existing `AllegroHttpClient` handles token refresh on 401. Persistent 401 → throws → runner-level retry → after `maxAttempts=3`, the iteration is marked dead. The record remains `validating` until the next scheduled poll iteration runs (or doesn't, if all dead). **Acceptable gap:** a failure to refresh credentials surfaces as a stuck record + a dead job — the existing `/sync/jobs` dashboard shows the dead job with the error message |

## 10. Locked decisions

(From the deep analysis pre-plan, confirmed by the user.)

1. **`ENDED` → `'draft'`** — the offer was created (the goal of the create flow) and is no longer live; treat the same as INACTIVE-without-errors.
2. **`pollAttempt` lives in the job payload**, not on a new record column. Transient state, observable through `sync_jobs` history if needed.
3. **Inline `ConfigService.get()` in the core service** — no separate `OfferPollConfigService` for #447. If future poll-job types appear, factor then.
4. **Refactor the adapter to share the GET helper** as part of #447. The duplication risk between `fetchOfferIdentifiers` and `getOfferStatus` is real; a one-call private helper closes it.

## 11. Validation checklist

- [ ] CORE has no NestJS / TypeORM imports outside infrastructure
- [ ] All ports / adapters use Symbol tokens (no string DI)
- [ ] No `any` types; no `console.log`; no `synchronize: true`
- [ ] Files match naming conventions (`*.capability.ts`, `*.service.ts`, `*.types.ts`, `*.exception.ts`)
- [ ] Dependency direction: orchestration in core, thin shell in worker
- [ ] Tests added at every non-trivial branch (state machine, exceptions, cadence)
- [ ] `.env.example` documents the four env vars
- [ ] Quality gate green: `pnpm lint && pnpm type-check && pnpm test`
- [ ] No DB migration needed (no schema changes — `pollAttempt` is in payload, errors[] column already exists)

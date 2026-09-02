# Implementation Plan: Fulfillment Progress Ingress (#2400 / W3a-11)

**Date**: 2026-08-30
**Status**: Draft
**Estimated Effort**: 2–3 days (size L)
**PR target**: `oms-programme-wave-3a` (never `main`)

---

## 0-bis. Amendment after `/tech-review` (2026-08-31) — READ BEFORE §0

The plan below was reviewed and four findings were accepted by the coordinator. **Where this
section and the sections below disagree, this section wins.** The originals are left intact
because their reasoning is still the record of why the alternatives were weighed.

### A1 (was BLOCKING) — `record()` ships with NO production caller

§4 declares webhook-as-trigger / authoritative pull; §9 Phase 4 then built a
`FulfillmentProgressEvent` — line deltas included — out of the trigger payload, which
`CanonicalInboundEvent.payload` documents as *"Non-authoritative payload hint; never source of
truth."* Two facts make that unshippable rather than merely untidy. The specified
`FulfillmentWorkStatusSyncPayloadV1` carries **no deltas**, so the handler as described cannot
compile; and closing that by widening the payload would move counters off an unauthenticated
hint — exactly what the #904 discipline exists to prevent, and what the `master.*` arms
deliberately decline to do.

**Resolution.** The handler resolves nothing, records nothing, and returns `{ outcome: 'ok' }`
after a `log`. `IFulfillmentProgressService.record()` is exercised by specs only.

This is the repo's established posture, not a consolation prize: `FulfillmentRouterPort` (#2393)
ships with no implementer, and all four vocabulary leaves shipped ahead of their consumers so
that the contexts adopting them adopt one spelling. The adjacent precedent is ADR-042, which
records that eparagony's fiscalization webhook was deliberately **not** wired because a
registered decoder would authenticate every delivery and then dead-letter it. This change is the
inverse — add the domain member so the delivery *routes* — and stops short of a progress write
nothing can authorise yet.

**Consequences for the ACs, to be stated plainly in the PR body rather than left to inference:**
AC1 is **fully discharged** (a fulfillment-domain webhook routes instead of dead-lettering, proven
through the real ingress). AC2 and AC3 are **spec-level**: the dedup and the claim-before-intent
ordering are asserted against `record()` directly, because no production path reaches it yet.

### A2 (was IMPORTANT) — `externalWorkId` is deferred to #2399 entirely

D3 chose a `fulfillment_works.externalWorkId` column, and flagged itself open for #2399. With A1
applied, the argument that decided it — "`record()` stays self-sufficient" — largely evaporates,
since `record()` has no production caller to be self-sufficient *for*. A migration is also the
single hardest artefact to unship, and guessing the shape hands #2399 a schema it must migrate
away from.

**Dropped from this PR**: the `externalWorkId` column, its partial unique index, that half of the
migration, and the read path in `record()`. **`record()` therefore takes a `workId`** — an
internal id, entering as an argument. That is the better fit for ADR-053's *"order data enters as
ARGUMENTS"* discipline the context already follows, which is why `FulfillmentWork.orderId` is a
plain internal-id string and not an `Order`.

**#2399 inherits the choice** between D3's alternatives (a) `IIdentifierMappingService` resolution
in the handler and (c) the column, and is the party that knows, because it owns the writer and
therefore knows whether the vendor reference is per-connection (mapping-shaped) or intrinsic to
the row (column-shaped).

The `unknown-work` outcome status is **retained** — `record()` still reads the work to validate it
exists before claiming, and a `workId` naming no row is a real, nameable outcome.

**This PR still ships ONE migration**, for `fulfillment_progress_claims`, and it is still covered
by a migration-parity spec — that spec remains the only automated check of a migration anywhere in
this repo (the harness sets `migrationsRun: false` and builds by `synchronize`).

### A3 (was IMPORTANT) — the `'return'` arm's over-permissive gate needs a terminal outcome

Gating on `OrderSource` rather than `ReturnSourceReader` is correct (§3's #2085 reasoning stands),
but it is over-permissive in the other direction: a plain `OrderSource` connection with no
`ReturnSourceReader` (PrestaShop, WooCommerce) passes the gate and enqueues
`marketplace.return.sync`, which then fails at the guard narrowing. That must be a **named
terminal `business_failure`** (ADR-007), never ten attempts against a structural condition no
retry can change, and it needs its own spec case beside the `ungated` one.

### A4 (was SUGGESTION x2) — name the command that produces each RED

- `apps/worker/test/integration/fulfillment-no-injection-boot.int-spec.ts` needs an **explicit**
  `pnpm --dir apps/worker exec jest --runTestsByPath <file>` run: the root `test:integration`
  script is `@openlinker/api` only (#2670), so listing it as "must stay green" without saying so
  leaves it unexercised.
- The `assertFullLaneCoverage()` red lands at worker **boot**, not in `pnpm test`. Record which
  command produced it — an unlabelled red is how a false pass gets written down.


---

## 0. The Three Decisions (read this first)

### D1 — `IFulfillmentProgressService` lives in `libs/core/src/fulfillment/`, and returns a relay INTENT rather than firing a relay

It cannot fire a relay: firing means touching `@openlinker/core/orders`, forbidden independently by `scripts/check-no-injection-contracts.mjs` (exact-specifier scan, incl. `require`/dynamic import) **and** by `barrel-purity.spec.ts`, whose `ZERO_SIBLING_EDGE_LEAVES` allow-set for `fulfillment` is exactly `['@openlinker/core/fulfillment-authority', '@openlinker/core/order-lifecycle']`, type-only, rejecting any other `@openlinker/core/*` specifier *including type-only*.

That is not an obstacle to route around — it is ADR-053's stated discipline ("the gate returns an outcome, the caller in `orders` persists it"), the #2100 `SalesDocumentBlockOutcome` report-don't-perform seam. So:

```
record(event) -> FulfillmentProgressOutcome
```

a neutral value carrying an optional relay *intent*; the **worker handler composes**. Host apps may inject anything; the core context stays a leaf.

**The evidence that the placement is right**: `record()` needs nothing from `orders`, `sync`, or `identifier-mapping`. It reads and writes only `fulfillment_works` / `fulfillment_work_lines` (via `FulfillmentWorkRepositoryPort`, already built) plus one new claim table. **This change adds ZERO new entries to `ZERO_SIBLING_EDGE_LEAVES` and ZERO new exemptions to `check-no-injection-contracts.mjs`.** If implementation finds itself needing such a registration, that is the signal the placement is wrong — treat it as a stop-and-reconsider, not a line to add.

Note the D3 decision below is what makes this true: resolution of the vendor's reference happens *inside* the context, so no `identifier-mapping` edge is needed.

### D2 — the dedup index is UNCONDITIONAL, and enforcement is the index, never `SELECT`-then-`INSERT`

A partial unique index over "live" states was proposed, on the `reservations WHERE status='held'` / `order_changes WHERE status IN ('pending','requested')` precedent. **Reject it.** Those predicates are partial because they express **slot-holding**: a terminal row must not block a legitimate fresh holder of the same slot, so the index deliberately forgets terminal rows.

A progress dedup key is the opposite: it is **permanent memory**. A replay of `(workId, idempotencyKey)` must be a no-op *forever*. Any predicate that lets a row fall out of the index opens a window in which a replay re-fires the relay — precisely the defect REVIEW C9 exists to close. So the predicate is *exactly as wide as it needs to be* only when it is the whole table.

**Shape**: composite primary key `(workId, idempotencyKey)` on a new `fulfillment_progress_claims` table, plus `claimedAt`, `eventKind`, `connectionId`. Modelled on `bulk_batch_advancements` (composite PK `(bulkBatchId, offerCreationRecordId)` + `advancedAt`) and, closer still, on `automation_trigger_firings` (#2360) whose repository is the exact idiom to copy:

```ts
// AutomationTriggerFiringRepository.claim
.orIgnore().execute();
return (result.raw as unknown[]).length > 0;
```

`INSERT … ON CONFLICT DO NOTHING`, read `raw.length > 0` as "did I win?". A duplicate is the **normal path, not an error**, which is why this idiom is preferred over fulfillment's own `isUniqueViolationOn(error, constraint)` → named domain error (`order-hold.repository.ts`): a named error would make the *expected* case exceptional and force the caller into catch-as-control-flow.

**Carry over #2360's warning verbatim in the docblock**: TypeORM 0.3.17's `orIgnore(statement)` *discards* its argument and always emits the bare `ON CONFLICT DO NOTHING`. That is safe **only because this table has exactly one uniqueness declaration** (the composite PK). If a second unique index is ever added, this must first become an explicit column-list target — otherwise an unrelated conflict silently reports "already claimed", and "already claimed" is the answer that suppresses a relay forever.

**Never** an application `SELECT`-then-`INSERT`: under READ COMMITTED no locks are taken and the conflicting row is a phantom. This is the exact trap #2392 hit and had to solve by locking the parent row.

Contrast with D3's index, which *is* partial — for the returns reason (a legitimately NULL external id), which is a **nullability** concern, not a liveness concern. The two are not in tension.

### D3 — the vendor reference resolves to a `workId` via a `fulfillment_works.externalWorkId` column, NOT via `identifier-mapping`

Candidates weighed:

- **(a) handler resolves external→internal via `IIdentifierMappingService`.** Clean split, matches "order data enters as arguments". Cost: another hop in the handler, and — per the correction verified this session — it would *not* actually require a `CoreEntityTypeValues` member, since `getOrCreateInternalId` takes `string` at the port boundary and the union's own docblock names `Fulfilment` as an anticipated open-world entity type.
- **(b) payload carries the OL `workId`.** Rejected: a webhook cannot know it.
- **(c) `fulfillment_works.externalWorkId` column, resolved inside the context.** ← **CHOSEN.**

**Why (c).** It is the `returns` precedent, and the reasoning transfers exactly. `returns` deliberately added no `CoreEntityTypeValues` member and instead carries `externalReturnId` as a column with a partial unique index on `(sourceConnectionId, externalReturnId)`, because that union is the *external-mapping* vocabulary and a return is not mapped through `identifier_mappings`. Neither is a fulfillment work: it is created by OL's own router (#2395) and only *later* acquires a vendor identity at the executor handshake.

Decisively, (c) keeps resolution **inside** the fulfillment context — no `@openlinker/core/identifier-mapping` import, so no barrel-purity registration, which is exactly the evidence D1 leans on. Under (a), D1's "zero new registrations" claim survives too (the handler does the resolving), but `record()` is no longer self-sufficient and every future caller must repeat the hop.

**No `'FulfillmentWork'` member is added to `CoreEntityTypeValues`.** The only argument for adding one is exhaustiveness at a literal comparison site, and this change creates none.

**Cost, stated honestly**: a second migration against a table #2392 created one PR ago, and a column whose **WRITER is #2399** (the executor handshake, at submit). #2400 ships the column, the index, the migration and the *read*; #2399 fills it. Until #2399 lands, every fulfillment-domain webhook resolves to nothing — which must be honest, not silent:

**Unresolvable reference ⇒ named, non-crashing, non-silent outcome.** `record()` returns `{ status: 'unknown-work', externalWorkId, connectionId }`. The handler logs at `warn` and completes `{ outcome: 'ok' }` — no `SyncJobExecutionError`, because retrying cannot make an absent mapping appear, and a retry storm on every unmapped vendor webhook is a worse failure than a logged miss. It is not a silent success: it is a distinct status with its own unit spec.

**Index predicate for D3**: `UQ_fulfillment_works_source_external` on `(connectionId, externalWorkId)` **partial, `WHERE "externalWorkId" IS NOT NULL`** — partial for the returns reason (an OL-originated work legitimately has no external id and many such rows must coexist). This is a nullability predicate, not a liveness predicate, so it does not reopen the C9 window D2 closes.

> **Open for the coordinator / #2399.** (a) and (c) are both guard-clean. (c) is chosen because it keeps `record()` self-sufficient and follows the `returns` precedent; (a) needs no schema change at all, which is the lighter footprint on a table #2392 created one PR ago. The party that actually knows is **#2399**, which owns the writer and therefore knows whether the vendor reference is per-connection (mapping-shaped) or intrinsic to the row (column-shaped). If #2399 prefers the mapping, this plan's Phase 2 column work drops and the handler grows one resolution hop — a contained change, but worth settling before the migration lands.

---

## 1. Task Summary

**Objective**: Give fulfillment progress a first-class inbound path — grow `InboundEventDomainValues` with `'fulfillment'` and `'return'`, add a core-owned `fulfillment.work.statusSync` job, and land `IFulfillmentProgressService.record()` as the single core-side ingestion seam, deduped by a claim row that is committed before any relay intent is emitted.

**Context**: Today a fulfillment-domain webhook has no `InboundEventDomain` arm, so `InboundWebhookRoutingService` cannot route it and it lands as a `deadlettered` delivery row. #2392 already shipped the write primitive (`recordLineProgress`) and the at-most-once relay marker (`dispatchRelayedAt`); what is missing is the ingress that drives them.

**Classification**: CORE (+ Interface: one worker handler; + Infrastructure: one migration).

---

## 2. Scope & Non-Goals

### In Scope
- `InboundEventDomainValues` += `'fulfillment'`, `'return'`; two `resolveRoute` arms.
- New `JobType` `'fulfillment.work.statusSync'` + `FulfillmentWorkStatusSyncPayloadV1`.
- `IFulfillmentProgressService` + `FulfillmentProgressService` in `libs/core/src/fulfillment/application/`.
- `FulfillmentProgressEvent` union: `picked | short_picked | packed | shipped | closed`, each with a **mandatory** vendor-scoped `idempotencyKey`.
- New table `fulfillment_progress_claims` (composite PK) + `FulfillmentProgressClaimRepositoryPort`.
- New column `fulfillment_works.externalWorkId` + partial unique index.
- One migration covering both, plus its parity spec.
- Worker handler `FulfillmentWorkStatusSyncHandler`, registered on the **`realtime`** lane.
- `default:` arms at port boundaries per ADR-055 G9; `never`-exhaustive stays core-internal.

### Out of Scope (each named with an owner)
- **The relay itself** — `#2401`. `record()` returns an intent; nothing consumes it yet. `releaseDispatchRelay` is #2401's too: `fulfillment-work.repository.ts` annotates `claimDispatchRelay`'s caller as #2401, and the rule is "whichever PR first has a caller". When #2401 adds it, model it on `ShipmentRepository.releaseWaybillRelay` (unconditional, idempotent).
- **Writing `externalWorkId`** — `#2399` (executor handshake at submit).
- **`FulfillmentExecutorPort` / `FulfillmentStatusSource`** — `#2398`. Confirmed **zero hits in the tree** this session. The issue names `FulfillmentStatusSource.getFulfillmentStatus(workRef)` only as the *polling* alternative to the webhook trigger; #2400 must not reference the type. The plan records the seam in prose so #2398 can wire its poller into the same `record()`.
- **Re-entering `route()` after `short_picked` + `releaseShortfall`** — `#2395` (router) plus the routing lock. See §5 below for the cut line.
- **`awaiting_wave`** — deliberately absent from v1 (the ADR-045 `packGrain` lesson: do not ship a grain you cannot yet honour). It is the **named first extension point**; say so in the union's docblock.
- **A `FulfillmentExecutor`-advertising adapter** — none ships today.

### Constraints
- Expect merge conflicts in `fulfillment.tokens.ts` and `fulfillment/index.ts` with #2398/#2402/#2405. Keep additions minimal and append-only.
- `fulfillment.tokens.ts` may contain **only** `export const X_TOKEN = Symbol(...)` (engineering-standards rule 6).
- `FulfillmentWorkRepositoryPort` is **not** exported from the barrel and must stay unexported.

---

## 3. Architecture Mapping

**Target Layer**: CORE, with one Interface-layer handler in `apps/worker` and one Infrastructure migration in `apps/api`.

**Capabilities Involved**
- `FulfillmentExecutor` — gates the `'fulfillment'` arm. Already in `CoreCapabilityValues` (`adapter.types.ts:76`, merged #2403).
- `OrderSource` — gates the `'return'` arm. **Not** `ReturnSourceReader`: that is a guard-only sub-capability narrowed off the dispatched `OrderSource` adapter (`return-ingestion.service.ts` states "never `getCapabilityAdapter(connectionId, 'ReturnSourceReader')`"), absent from `CoreCapabilityValues`, so `connection.enabledCapabilities` can never contain it and the arm would be permanently `ungated` — the #2085 stamped-at-create trap.

**Existing Services Reused**
- `InboundRoutingPolicyService.resolve` / `.route` — unchanged signature; two new table rows.
- `buildInboundJobIdempotencyKey(platformType, connectionId, sourceEventId)` — job-level idempotency, orthogonal to the vendor-scoped progress key.
- `FulfillmentWorkRepositoryPort.recordLineProgress({workId, orderLineId, fulfilledDelta, cancelledDelta})` — **already built** by #2392 and documented "Progress ingress (#2400) moves the counters, never a per-line status". This is the write primitive; do not add a second one.
- `transitionStatus` for `packed`/`shipped`/`closed` header movement.
- `MarketplaceReturnSyncPayloadV1` + existing job `marketplace.return.sync` for the `'return'` arm — no new return job.

**New Components**
- Domain: `FulfillmentProgressEvent` union, `FulfillmentProgressOutcome`, `FulfillmentProgressClaimRepositoryPort`, `FulfillmentProgressClaimOrmEntity`.
- Application: `IFulfillmentProgressService` (interface) + `FulfillmentProgressService`.
- Infrastructure: `FulfillmentProgressClaimRepository`, migration `1865000000000-…`.
- Interface: `FulfillmentWorkStatusSyncHandler`.
- Tokens: `FULFILLMENT_PROGRESS_SERVICE_TOKEN`, `FULFILLMENT_PROGRESS_CLAIM_REPOSITORY_TOKEN`.

**Core vs Integration Justification**: every piece is vendor-neutral. The vendor-specific half is the `WebhookEventTranslatorPort` that produces a `CanonicalInboundEvent` with `domain: 'fulfillment'` — plugin-side, and not this PR. No CORE↔Integration edge is created (AC 6).

**Barrel exports** (`fulfillment/index.ts`, append-only): the event union, the outcome type, `IFulfillmentProgressService`, `FULFILLMENT_PROGRESS_SERVICE_TOKEN`. **Not** `FulfillmentProgressClaimRepositoryPort` — it is an intra-context persistence contract and `check-cross-context-imports` denies `*RepositoryPort`, same as `FulfillmentWorkRepositoryPort`.

**Module**: register `FulfillmentProgressClaimOrmEntity` in `FulfillmentModule`'s `TypeOrmModule.forFeature([...])`. That registration is what puts the table into the integration-test schema (`autoLoadEntities` + `synchronize`) — omit it and the int-specs fail on a missing relation. `FulfillmentModule` still imports **no** sibling context.

---

## 4. Internal Patterns

- **Webhook-as-trigger, authoritative pull** — the shipped #904 discipline, restated by the `invoicing` and `invoice-payment` arms already in `resolveRoute`. `fulfillment.work.statusSync` follows it: the webhook body is advisory, the job re-reads.
- **Job naming**: `fulfillment.work.statusSync` follows the core-owned-internal-pass precedent `inventory.reservations.*` / `orders.holds.reconcile`.
  **CRITICAL COLLISION, call it out in the docblock**: `'marketplace.fulfillment.statusSync'` **already exists** and means the shipping-context branch-1 OMP read-back (#834, `MarketplaceFulfillmentStatusSyncHandler`, `IFulfillmentStatusSyncService` from `@openlinker/core/shipping`). Unrelated. Do not extend it, do not rename it.
- **Claim-before-act**: `AutomationTriggerFiringRepository.claim` (#2360).
- **Handler shape**: copy `apps/worker/src/sync/handlers/marketplace-return-sync.handler.ts` — thin core-service delegate, `SyncJobExecutionError` rewrapping, `{ outcome: 'ok' }`.
- **Report-don't-perform**: `SalesDocumentBlockOutcome` (#2100).
- **Guarded update**: every `FulfillmentWorkRepositoryPort` mutation is a narrow conditional UPDATE returning `boolean` via `applyGuardedUpdate`; `false` means the precondition no longer held — an **ordinary outcome, not an error**. `record()` must map a `false` to a named outcome status, never a throw.

---

## 5. The `short_picked` cut line

`short_picked` carries a shortfall. DESIGN §5.4/§5.5 has it close the work `incomplete` for the shortfall and **re-enter `route()`** with the rejecter blocked, gated on the order carrying no `cancelledAt`, under the routing lock.

**#2400 owns**: recording the shortfall deltas via `recordLineProgress` (`fulfilledDelta` for what was picked, `cancelledDelta` for the shortfall), and transitioning the header to `incomplete` via `transitionStatus`. That is entirely inside the fulfillment context.

**#2400 does NOT own re-entry.** Re-entering `route()` needs #2395's router *and* the routing lock, and reading `order.cancelledAt` needs `@openlinker/core/orders` — forbidden here by both guards. The re-route is therefore expressed as a **relay intent** (`{ kind: 'reroute', workId, blockedHolderId }`) returned from `record()`; **#2401** composes it in the handler. `releaseShortfall` semantics land with that caller.

This is the same honest split AC (3) forces, below.

---

## 6. Honouring AC (3) when no relay caller exists yet

AC (3): "the dedup claim is asserted to precede the relay call (ordering spec)". There **is** no relay caller until #2401. Faking one would be worse than the gap. Honour it as:

> The claim `INSERT` is **committed** before `record()` returns any relay intent, and a spec asserts that ordering directly.

Concretely, in `fulfillment-progress-ordering.spec.ts`: a mock claim repository whose `claim()` records a call-order token, and a mock work repository whose mutators do the same; assert the claim token precedes every other token, and that on `claim() === false` the returned outcome is `{ status: 'duplicate' }` with **no** intent and **zero** calls to `recordLineProgress` / `transitionStatus`.

**What #2401 completes**: the second half — that the intent is actually consumed by a relay, and that the relay is not fired twice. #2401 also brings `claimDispatchRelay` (already built, `dispatchRelayedAt IS NULL` + `version` bump) into use, and adds `releaseDispatchRelay`. Say this plainly in the PR description; do not claim AC (3) is fully discharged.

---

## 7. Should `'return'` be in this change?

**Yes.** The issue's reasoning ("so the closed union is grown once") holds and is cheap: union growth is **type-only and needs no migration**, and both arms are forced through the same `never`-exhaustive break in `resolveRoute` — splitting them means paying that forcing-function cost twice and leaving a half-grown union in between. The `'return'` arm additionally routes to an **existing** job with an **existing** payload, so its marginal cost is one `case` and one spec.

The honest caveat, which the docs must carry: the `'fulfillment'` arm resolves **`ungated` in practice today**, because no shipped adapter manifest advertises `FulfillmentExecutor`. It must have an explicit spec case asserting exactly that, and the docblock must not present it as working end-to-end.

---

## 8. Is a new ADR warranted?

**No.** Every decision here is an application of an existing ADR, and inventing a new one for an application would dilute the register:

- Leaf posture, no-injection, report-don't-perform → **ADR-053**.
- `FulfillmentWork` as the unit of assignment, the two status axes → **ADR-054**.
- `default:` arms at the port boundary, `never`-exhaustive core-internal → **ADR-055 G9**.
- `realtime` lane by cost-of-starvation → **ADR-050**.

The one genuinely novel argument — *permanent-memory dedup takes an unconditional index, slot-holding dedup takes a partial one* — is a persistence idiom, not an architectural decision. Record it in the `FulfillmentProgressClaimRepository` docblock, in the #2360 house style.

Update `docs/architecture-overview.md` § 26 Fulfillment (the progress ingress seam), § 7 Sync Manager (the two new domains and the new job type), and Data Flow 4.

---

## 9. Proposed Implementation Plan

### Phase 1 — Vocabulary and the forcing function (RED first)

1. **Grow the inbound domain union**
   - **File**: `libs/core/src/integrations/domain/types/canonical-inbound-event.types.ts`
   - **Action**: add `'fulfillment'`, `'return'` to `InboundEventDomainValues` with comments explaining each arm's gate.
   - **RED evidence**: adding the two members alone breaks `inbound-routing-policy.service.ts` at `const exhaustive: never = event.domain`. **This is the intended red** — a compile error naming both new members. Confirm the error text mentions `"fulfillment" | "return"`; a red that is merely "module not found" is the wrong red.
   - **Acceptance**: `tsc` fails at exactly that line, nowhere else.

2. **Add the job type and payload**
   - **Files**: `libs/core/src/sync/domain/types/sync-job.types.ts`; new `libs/core/src/sync/domain/types/fulfillment-job-payloads.types.ts`
   - **Action**: `'fulfillment.work.statusSync'` in `JobTypeValues`, with a docblock explicitly disambiguating it from the pre-existing `'marketplace.fulfillment.statusSync'` (#834, shipping context). `FulfillmentWorkStatusSyncPayloadV1 { schemaVersion: 1; externalWorkId: string; sourceEventId: string; eventType: string; occurredAt?: string }`.
   - **RED evidence**: `assertFullLaneCoverage()` in `handler-registration.service.ts` now fails boot naming the uncovered type. Capture that failure — it is the guard doing its job.

3. **Two `resolveRoute` arms**
   - **File**: `libs/core/src/sync/application/services/inbound-routing-policy.service.ts`
   - **Action**: `'fulfillment'` → `requiredCapability: 'FulfillmentExecutor'`, `jobType: 'fulfillment.work.statusSync'`, payload `satisfies FulfillmentWorkStatusSyncPayloadV1`. `'return'` → `requiredCapability: 'OrderSource'`, `jobType: 'marketplace.return.sync'`, payload `satisfies MarketplaceReturnSyncPayloadV1 { schemaVersion: 1, externalReturnId: event.externalId, eventKey: sourceEventId, occurredAt: event.occurredAt }`. Keep the `never`-exhaustive `default:` — ADR-055 G9 keeps it because this is core-internal. Import payload types **type-only**, consistent with the file's existing discipline (it avoids a `sync → orders` value edge because the orders barrel re-exports `OrdersModule`, which imports `SyncModule`).
   - **Acceptance**: green; unit specs from §11.1 pass.

### Phase 2 — Persistence (migration + parity)

4. **Claim entity + `externalWorkId` column**
   - **Files**: `libs/core/src/fulfillment/infrastructure/persistence/entities/fulfillment-progress-claim.orm-entity.ts` (new); `…/fulfillment-work.orm-entity.ts`
   - **Action**: claim entity with `@PrimaryColumn` `workId` + `idempotencyKey`, plus `connectionId`, `eventKind`, `claimedAt`. Add `externalWorkId: string | null` to the work entity with `@Index('UQ_fulfillment_works_source_external', ['connectionId','externalWorkId'], { unique: true, where: '"externalWorkId" IS NOT NULL' })`.
   - **Acceptance**: **every `@Index`/`@Check` carries the SAME NAME as the migration.** The integration harness builds schema by `synchronize`, so an anonymous decorator gets a hash name and diverges from prod — this is the drift the #2392 parity spec caught on its first green run.

5. **Migration**
   - **File**: `apps/api/src/migrations/1865000000000-add-fulfillment-progress-claims.ts`, class `AddFulfillmentProgressClaims1865000000000`.
   - **Action**: create `fulfillment_progress_claims` (composite PK `(workId, idempotencyKey)`, FK to `fulfillment_works` `ON DELETE CASCADE`); `ALTER TABLE fulfillment_works ADD COLUMN "externalWorkId" varchar NULL` + the named partial unique index. Reversible `down()`.
   - **Acceptance**: highest existing prefix is `1864000000000-create-fulfillment-works.ts`, so `1865000000000` is the next free synthetic prefix. `scripts/check-migration-timestamps.mjs` rule 4 — strictly greater than every migration on `origin/main`; **filename prefix AND exported class suffix must match**. Re-list `apps/api/src/migrations/` at implementation time in case a sibling PR merged first.

6. **Parity spec**
   - **File**: `apps/api/test/integration/fulfillment-progress-claims-migration-parity.int-spec.ts`
   - **Action**: mirror `fulfillment-work-migration-parity.int-spec.ts` (#2392) — the **only** automated check of a migration anywhere in this repo. Assert: table exists; PK columns and order; index names present and matching the decorators; the partial index's `indexdef` contains the `WHERE` clause.
   - **Acceptance**: name avoids the pre-existing shipping-layer specs `fulfillment-status-sync-relay.int-spec.ts` (#1168) and `fulfillment-routing.int-spec.ts` (#1776). Add `fulfillment_progress_claims` to `tablesToTruncate` in `apps/api/test/integration/setup.ts` — a new table not listed there is not cleaned between tests and will produce order-dependent flake.

7. **Claim repository**
   - **File**: `libs/core/src/fulfillment/infrastructure/persistence/repositories/fulfillment-progress-claim.repository.ts`
   - **Action**: single method `claim(input): Promise<boolean>` — `INSERT … .orIgnore().execute()`, `return (result.raw as unknown[]).length > 0`. Docblock carries the #2360 `orIgnore`-discards-its-argument warning and the "exactly one uniqueness declaration" precondition.
   - **Acceptance**: unit spec with a mocked query builder (the `bulk-batch-advancement.repository.spec.ts` shape) **plus** a real-DB int-spec proving a second insert of the same pair returns `false` — the mock alone cannot prove the constraint exists.

### Phase 3 — The service

8. **Event union and outcome**
   - **File**: `libs/core/src/fulfillment/domain/types/fulfillment-progress-event.types.ts`
   - **Action**: `FulfillmentProgressEventKindValues = ['picked','short_picked','packed','shipped','closed']`; discriminated union, each member carrying `externalWorkId`, `connectionId`, and a **mandatory** `idempotencyKey: string` (vendor-scoped — document that it is the vendor's key, distinct from both `FulfillmentRequest.idempotencyKey` (`work:{workId}:{assignmentAttempt}`) and `buildInboundJobIdempotencyKey`). `picked` / `short_picked` carry line deltas. Docblock names `awaiting_wave` as the first extension point and cites the ADR-045 `packGrain` lesson.
   - `FulfillmentProgressOutcome = { status: 'recorded'; intents: readonly FulfillmentRelayIntent[] } | { status: 'duplicate' } | { status: 'unknown-work'; externalWorkId; connectionId } | { status: 'precondition-failed'; reason: string }`.

9. **`IFulfillmentProgressService` + implementation**
   - **Files**: `libs/core/src/fulfillment/application/interfaces/fulfillment-progress.service.interface.ts`, `…/services/fulfillment-progress.service.ts`
   - **Order inside `record()`** — this ordering is the whole point:
     1. resolve `externalWorkId` + `connectionId` → work (repository read) → absent ⇒ `{ status: 'unknown-work' }`, **return immediately, no claim burned**;
     2. `claim(workId, idempotencyKey)` → `false` ⇒ `{ status: 'duplicate' }`, **return immediately, no mutation, no intent**;
     3. only now apply `recordLineProgress` / `transitionStatus`;
     4. a guarded update returning `false` ⇒ `{ status: 'precondition-failed', reason }` (ordinary outcome, never a throw);
     5. build and return intents.
   - **ADR-055 G9**: the switch over `FulfillmentProgressEventKind` is core-internal, so it keeps the `never`-exhaustive `default:`. Any consumer-facing narrowing on the union **at the port boundary** takes a real `default:` arm.
   - **Acceptance**: `record()` imports nothing from `@openlinker/core/{orders,inventory,sync,identifier-mapping}`. `barrel-purity.spec.ts` and `check-no-injection-contracts.mjs` pass with **no new entries**.

10. **Tokens + module + barrel**
    - `fulfillment.tokens.ts`: append two `Symbol(...)` lines only.
    - `fulfillment.module.ts`: add the claim entity to `forFeature`, provide the two implementations under their tokens, export the tokens. Still imports no sibling context.
    - `index.ts`: append the event union, the outcome, the service interface. **Not** the claim repository port.

### Phase 4 — Worker

11. **Handler + registration**
    - **Files**: `apps/worker/src/sync/handlers/fulfillment-work-status-sync.handler.ts`; `handler-registration.service.ts`
    - **Action**: copy the `marketplace-return-sync.handler.ts` shape. Resolve authoritative state (a pull — for now, translate the trigger payload into a `FulfillmentProgressEvent`; #2398's `FulfillmentStatusSource` is where the real pull plugs in), call `record()`, switch on the outcome. `unknown-work` / `duplicate` / `precondition-failed` all → `warn` + `{ outcome: 'ok' }`. Only genuine infrastructure faults rewrap into `SyncJobExecutionError`.
    - **Lane: `realtime`.** ADR-050 chooses by cost-of-starvation: a vendor progress webhook is *waited on* — a picker is standing at a station, and the OMS UI shows stale counters until it drains. That is the same argument that puts inbound order sync on `realtime`, and it outranks the "core-owned internal pass" instinct that would suggest `bulk`. State the resulting lane tally in the PR description as "after this change", derived by counting `register(..., 'realtime')` calls — do not hard-code a number that will go stale.
    - **Acceptance**: `assertFullLaneCoverage()` passes; boot succeeds.

### Phase 5 — Docs

12. `docs/architecture-overview.md` § 26 / § 7 / Data Flow 4; the `fulfillment/index.ts` "What consumes this" table. Be explicit that the `'fulfillment'` arm is `ungated` until an adapter advertises `FulfillmentExecutor`, and that `externalWorkId` has no writer until #2399.

---

## 10. Alternatives Considered

**A1 — `IFulfillmentProgressService` in `orders`, firing the relay directly.** Rejected: inverts ADR-053's report-don't-perform seam and puts fulfillment vocabulary in the wrong context. The guards would permit it, which is exactly why the ADR argument, not the guard, is the reason.

**A2 — Partial dedup index over live states.** Rejected, D2. Slot-holding semantics misapplied to permanent memory; reopens the C9 window.

**A3 — `isUniqueViolationOn` → named domain error for the dedup.** Rejected: a duplicate is the normal path. Catch-as-control-flow for the expected case.

**A4 — `identifier-mapping` resolution in the handler.** Rejected, D3 — viable and guard-clean, but leaves `record()` non-self-sufficient and pushes the hop onto every future caller (#2398's poller included). Left open for #2399, which owns the writer.

**A5 — `'FulfillmentWork'` added to `CoreEntityTypeValues`.** Rejected: no literal comparison site needs exhaustiveness, the port is open-world (`string`), and the union's docblock names `Fulfilment` as an anticipated open-world type. Adding it is churn on a union other contexts read.

**A6 — Ship `'fulfillment'` now, `'return'` later.** Rejected, §7.

**A7 — Reuse `'marketplace.fulfillment.statusSync'`.** Rejected: that is #834's shipping-context OMP read-back. Reusing it would silently route OMS traffic into `MarketplaceFulfillmentStatusSyncHandler`.

---

## 11. Testing Strategy & Acceptance Criteria

**RED-FIRST throughout, and a red must be red for the RIGHT reason.** A `TS6133` unused-import failure reporting `Tests: 0 total` is a **false pass** — it means the suite never ran. A concurrency test that still passes with the claim removed is not evidence of anything. For each red below, record the failing assertion text, not just "it failed".

### 11.1 Unit
- `inbound-routing-policy.service.spec.ts` — `'fulfillment'` with `FulfillmentExecutor` supported+enabled ⇒ `resolved` with the right job/payload; **with it absent ⇒ `ungated`, which is today's real-world case and gets its own named test**; `'return'` ⇒ `marketplace.return.sync` + `MarketplaceReturnSyncPayloadV1`; a test asserting `'ReturnSourceReader'` is *not* the required capability, citing the #2085 trap.
- `fulfillment-progress.service.spec.ts` — one test per event kind; `unknown-work` returns the named status and calls no mutator; `precondition-failed` on a `false` guarded update; `duplicate` returns no intent.
- `fulfillment-progress-ordering.spec.ts` — §6. **RED first**: write it against a service that mutates before claiming and watch the order assertion fail.
- `fulfillment-progress-claim.repository.spec.ts` — mocked QB, asserts `orIgnore()` and `raw.length > 0`.

### 11.2 Integration
- `apps/api/test/integration/fulfillment-inbound-routing.int-spec.ts` — **AC (1), through the REAL ingress**: `WebhookService` → `InboundWebhookRoutingService.resolveEvent` → `WebhookJobGateRepository.insertDeliveryWithJob`. Assert a `fulfillment`-domain event on a `FulfillmentExecutor`-enabled connection produces a `fulfillment.work.statusSync` job row and a non-`deadlettered` delivery. **RED first**: on `origin/oms-programme-wave-3a` this same spec must produce a `deadlettered` row — record that as the baseline. Also assert the `ungated` path yields exactly `` `ungated: fulfillment requires FulfillmentExecutor` ``.
- `apps/api/test/integration/fulfillment-progress-dedup.int-spec.ts` — **AC (2)**: replay the same `(workId, idempotencyKey)` against a real DB; second call returns `duplicate`, counters unchanged, zero intents. **This must be an int-spec, not a unit spec** — the enforcement is the index, and a mock cannot prove an index exists. Add a concurrent variant (two `record()` calls in flight); it is only evidence if it fails when the PK is dropped.
- `fulfillment-progress-claims-migration-parity.int-spec.ts` — step 6.
- `apps/worker/test/integration/fulfillment-no-injection-boot.int-spec.ts` — existing; must stay green (the `ModuleRef.get(TOKEN, { strict: false })` complement the source scan cannot see).

### 11.3 Guards to run
`scripts/check-no-injection-contracts.mjs`, `check-cross-context-imports`, `libs/core/src/__tests__/barrel-purity.spec.ts`, `scripts/check-migration-timestamps.mjs`, `scripts/check-jest-integration-mappers.mjs`.

### Acceptance Criteria
- [ ] AC1 — fulfillment-domain webhook routes to `fulfillment.work.statusSync` instead of dead-lettering; int-spec through the real ingress.
- [ ] AC2 — replaying `(workId, idempotencyKey)` is a no-op, fires no relay intent.
- [ ] AC3 — ordering spec asserts the claim commits before any intent is returned; PR states plainly that #2401 completes the relay half.
- [ ] AC4 — port-boundary switches carry `default:`; `never`-exhaustive stays core-internal.
- [ ] AC5 — unit + integration coverage above, each with recorded RED evidence.
- [ ] AC6 — no CORE↔Integration boundary violations; **zero new** `ZERO_SIBLING_EDGE_LEAVES` or no-injection registrations.
- [ ] Migration parity spec covers the new migration.
- [ ] `fulfillment_progress_claims` added to `tablesToTruncate`.
- [ ] PR targets `oms-programme-wave-3a`.

---

## 12. Risks

- **Merge conflicts** in `fulfillment.tokens.ts` / `fulfillment/index.ts` with #2398/#2402/#2405 — mitigate by append-only edits at file end.
- **`externalWorkId` has no writer until #2399** — mitigated by the named `unknown-work` outcome and honest docs. Risk if unmitigated: silent success, which would be worse than dead-lettering.
- **Bare `ON CONFLICT DO NOTHING`** — safe only while the claim table has exactly one uniqueness declaration. Encoded as a docblock precondition, per #2360.
- **`realtime` lane pressure** — a chatty vendor could crowd the lane. ADR-050's answer is lane isolation, not lane demotion; revisit only with evidence.
- **Migration prefix races a sibling PR** — re-list `apps/api/src/migrations/` immediately before opening the PR.
- **D3 may be reopened by #2399** — see the note in D3. Contained: the column work drops, the handler gains one hop.

---

## 13. Alignment Checklist

- [ ] Hexagonal: ports in domain, services in application, repositories in infrastructure, handler in `apps/worker`.
- [ ] CORE vs Integration respected; no plugin imports.
- [ ] Existing patterns reused (#2360 claim, #2100 outcome, `marketplace-return-sync` handler).
- [ ] Idempotency: mandatory vendor-scoped key + unconditional unique index + `buildInboundJobIdempotencyKey` at the ingress.
- [ ] Webhook-as-trigger / authoritative-pull discipline preserved.
- [ ] Errors: named outcomes over throws; `applyGuardedUpdate` `false` convention preserved.
- [ ] Lane chosen by cost-of-starvation (ADR-050) with the argument written down.
- [ ] Migration timestamp, class-name parity, index-name parity, truncation all handled.
- [ ] Every deferral names an owner: #2395, #2398, #2399, #2401, #2402.

---

## Related Documentation

- [Architecture Overview](../architecture-overview.md) — § 26 Fulfillment, § 7 Sync Manager, § Data Flow 4
- [Engineering Standards](../engineering-standards.md)
- [Testing Guide](../testing-guide.md)
- [Database Migrations](../migrations.md)
- ADR-050 (concurrency lanes), ADR-053 (vocabulary leaf / no-injection), ADR-054 (`FulfillmentWork`), ADR-055 (plugin forward-compat, G9)

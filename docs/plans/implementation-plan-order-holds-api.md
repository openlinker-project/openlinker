# Implementation Plan: Order holds API and order-detail projection (#2341)

**Date**: 2026-08-26
**Status**: Ready for Review
**Estimated Effort**: ~1 day

---

## 1. Task Summary

**Objective**: give OL-owned order holds an HTTP surface — place, release, and read — and close the
one gap #2339 deliberately left for this issue: releasing a hold must re-enqueue the provisioning run
the hold suppressed.

**Context**: #2338 shipped `order_holds` + `OrderHoldRepositoryPort`; #2339 shipped
`OrderHoldService` (clock, §6.4 release policy, `held`/`released` facts) plus the provisioning and
dispatch gates; #2340 shipped the `order_records.activeHoldReason` display cache and its reconcile
sweep. Holds are therefore fully functional and completely unreachable from the product. #2342 (FE)
consumes exactly what this issue exposes.

**Classification**: **Interface** (controller + DTOs + error mapping), plus ONE small CORE
application service for the release→enqueue gap.

---

## 2. Scope & Non-Goals

### In Scope
- `POST /orders/:internalOrderId/holds` — place a hold.
- `POST /orders/:internalOrderId/holds/:holdId/release` — release a hold.
- `activeHold` + `holdHistory[]` on the order **detail** projection.
- `IOrderProvisioningResumeService` — re-enqueue `marketplace.order.sync` after a release.
- Deleting `OrderHoldRepositoryPort.listOpenHolds` (zero callers, false docblock).

### Out of Scope
- Any frontend (#2342).
- A list-level `holdHistory` / `activeHold` projection — that would be one `listHolds` query per row,
  an N+1 behind a paged table. The list gets exactly one free field, `activeHoldReason` (already a
  loaded column), per D2.
- A `GET /orders/:id/holds` route. `holdHistory[]` on the detail projection is the audit trail the
  issue asks for; a second route with no consumer is surface for its own sake.
- Bulk place/release.
- Any schema change. **Migration slot 1858000000000 is NOT used** — this is an API over columns and
  tables #2338/#2340 already created, and an API over existing storage needs no migration.

### Constraints
- `JwtAuthGuard` + `RolesGuard` are **global** `APP_GUARD`s (`apps/api/src/auth/auth.module.ts`), so
  routes need `@Roles(...)` only; a per-route `@UseGuards(JwtAuthGuard)` would be redundant noise
  that no sibling route in `OrdersController` carries.
- No hold GATE may read `activeHoldReason` — the epic's L4 exit criterion. Nothing in this plan
  reads it; the projection reads `order_holds` through `IOrderHoldService`.

---

## 3. Architecture Mapping

**Target layers**: Interface (`apps/api/src/orders/http/`), plus Application + Domain in
`libs/core/src/orders/` for the resume service.

**Existing seams reused**:
- `IOrderHoldService` (`ORDER_HOLD_SERVICE_TOKEN`) — `place` / `release` / `getOpenHold` /
  `listHolds`. Already exported by `OrderHoldsModule`, which `OrdersModule` re-exports, which the api
  `OrdersModule` already imports. **No module wiring change is needed for the hold seam.**
- `OrderRecordRepositoryPort` — already injected into `OrdersController` for the detail read.
- `JobEnqueuePort` + `IIdentifierMappingService` — the exact pair
  `OrderDestinationRetryService` uses to enqueue `marketplace.order.sync`.

**New components**:
| Layer | File | Purpose |
|---|---|---|
| Application (interface) | `libs/core/src/orders/application/interfaces/order-provisioning-resume.service.interface.ts` | `IOrderProvisioningResumeService` + its result union |
| Application (service) | `libs/core/src/orders/application/services/order-provisioning-resume.service.ts` | re-enqueue the source-side sync for one order |
| Interface | `apps/api/src/orders/http/dto/place-order-hold-request.dto.ts` | class-validator body |
| Interface | `apps/api/src/orders/http/dto/release-order-hold-request.dto.ts` | class-validator body |
| Interface | `apps/api/src/orders/http/dto/order-hold-response.dto.ts` | `OrderHoldDto`, `PlaceOrderHoldResponseDto`, `ReleaseOrderHoldResponseDto`, `ProvisioningResumeDto` |

**Why the resume service is CORE, not controller code.** It needs `IIdentifierMappingService` +
`JobEnqueuePort` + `OrderRecordRepositoryPort`. Assembling a marketplace job payload in an HTTP
controller would put orchestration policy in the interface layer. It cannot live in
`OrderHoldService` either — that service is provided by the leaf `OrderHoldsModule`, whose whole
point (#2338/#2339 docblocks) is that it takes one repository and nothing else; injecting three more
seams there drags the eight-context graph into the leaf. It belongs in `OrdersModule`, beside
`OrderDestinationRetryService`, which already has exactly these dependencies — which is precisely
what #2339's docblock meant by "#2341's release route sits beside the job-enqueue seam".

---

## 4. Design decisions

### D1 — The release→enqueue gap: report, never claim

`IOrderProvisioningResumeService.resume(internalOrderId)` returns a discriminated result rather than
`void`:

```ts
export const ProvisioningResumeSkipReasonValues = [
  'order-not-found',
  'missing-source-external-id',
] as const;
export type ProvisioningResumeSkipReason =
  (typeof ProvisioningResumeSkipReasonValues)[number];

export type OrderProvisioningResumeResult =
  | { status: 'enqueued'; jobId: string; jobType: JobType }
  | { status: 'skipped'; reason: ProvisioningResumeSkipReason }
  | { status: 'failed'; reason: 'enqueue-failed' };
```

**The failure arm carries a CODE, never the caught message** (`/tech-review` BLOCKING). An enqueue
failure surfaces from Redis / Postgres / TypeORM, and those messages routinely carry a host, a port,
sometimes a credential fragment — putting one in a response body breaches
`CLAUDE.md § Security baselines` ("never return secrets… in API responses"), and the wording is not
OL's to publish in any case. The underlying message is logged at `error` with the order id; the
operator's remedy (press Retry on the destination row) does not depend on the provider's phrasing.
The skip reasons take the `as const` + union shape per `engineering-standards.md § Union Types`, so
#2342 can render them exhaustively.

Four properties are load-bearing.

1. **The release is the fact; the enqueue is a consequence.** The hold is already released and
   `releasedAt` is already stamped when `resume` runs. A throw here would answer 5xx for a release
   that DID happen, and the operator would retry into a `HoldAlreadyReleasedError` 409 — i.e. the
   route would report failure for its own success.

   **Who owns the error is settled, not shared** (`/tech-review` IMPORTANT). The **service never
   throws for a modelled condition** — that is its contract, stated in its header docblock and
   asserted by its spec, and every modelled failure leaves by the result union. The controller still
   wraps the call, but purely as a last-resort guard for an *unmodelled* throw, mapped to
   `status: 'failed'` and carrying a comment saying exactly that. Without the comment a later reader
   deletes one of the two layers, and which one they delete decides whether a release can 500.
2. **It is REPORTED, not silently swallowed.** `marketplace.order.sync` has no cron backstop for a
   specific order, so a lost enqueue is an order that stays un-provisioned until something unrelated
   re-polls it. Returning the outcome is what lets #2342 tell the operator to press Retry on the
   destination row instead of watching nothing happen. A `2xx` that asserted "provisioning resumed"
   unconditionally would state a fact OL had not witnessed.
3. **`skipped` is not `failed`.** An order with no source-external-id mapping (an operator-authored
   or not-yet-mapped record) has no source-side job to enqueue; calling that a failure would put a
   red state on a healthy order.

The idempotency key mirrors the retry service's wave-distinct shape so it can never dedup against a
long-dead job: `marketplace:{sourceConnectionId}:order:{sourceEventId ?? internalOrderId}:hold-release:{Date.now()}`.
A distinct `hold-release` namespace (rather than reusing `:retry:`) keeps a release and an operator
retry legible apart in `sync_jobs`.

**No destination status flip.** `OrderDestinationRetryService` claims its slot by flipping
`failed → pending`; #2339 persists a held skip as `pending` with the reason already, so there is
nothing to claim and re-flipping would erase the reason text. `resume` enqueues and writes nothing.

### D2 — The rich projection is detail-only; the list gets exactly one cheap field

`activeHold` + `holdHistory[]` are attached in `getOrder`, beside the invoice / delivery-resolution
projections — **not** in the shared `toDto`, which runs per row on the paged list. `listHolds` is one
query per order; on the list that is N.

**But the list is not left with nothing** (`/pre-implement` finding F1). `OrderRecordResponseDto`
carries no hold field today: `activeHoldReason` is read only *inside* the controller
(`orders.controller.ts:498`) as an input to `deriveOrderLifecyclePhase` and never projected. A list
row therefore ships `lifecyclePhase: 'held'` and **no reason** — so #2342's first AC, an
`On hold — {reason}` row badge, would be unserviceable, and story L4's "the operator must see *why*"
would need a detail fetch per row: exactly the N+1 this decision exists to prevent.

So the shared `toDto` gains **one** field, `activeHoldReason: HoldReason | null`. It is free — a plain
column on the `OrderRecord` already materialised for both reads, zero extra queries — and it is the
same value the SQL twin behind `?phase=held` filters on, so the badge and the filter cannot disagree.

**Its docblock and `@ApiProperty` description must carry #2340's caveat**: this is a display cache
with an hourly repair window. A badge is a legitimate consumer of a briefly-stale cache; a *decision*
about whether an order is held is not, and must go through `IOrderHoldService.getOpenHold` — the
epic's L4 exit criterion. Naming it verbatim after the column is deliberate: a different wire name
would invite a reader to think it is a different, authoritative fact.

`activeHold` is derived from `holdHistory` in the controller (`find(h => h.releasedAt === null)`)
rather than a second `getOpenHold` call — one read, and the two answers cannot disagree.

`OrderHoldDto` projects the entity in full **except** nothing: every column on `order_holds` is
operator-facing audit data and none is a secret. `note` / `releaseNote` are operator free text (the
#2338 types say explicitly: never buyer data).

### D3 — Error mapping

Mapped as `catch` arms in the controller, matching `retryDestination`'s existing local-catch
precedent in this file. A global filter would be right if a second controller raised these; none
does, and #2100's filter precedent was created exactly because a second controller appeared.

| Domain error | HTTP | Why |
|---|---|---|
| `OrderRecordNotFoundException` (place, pre-check) | 404 | a hold on an order OL has never seen names nothing |
| `OrderAlreadyOnHoldError` | 409 | R1: one open hold per order; the partial unique index decides it |
| `OrderHoldNotFoundError` | 404 | |
| `HoldAlreadyReleasedError` | 409 | distinguishable from the above — the two remedies differ |
| `HoldReleaseNoteRequiredError` | 400 | the caller can fix it by resubmitting with a note |
| `HoldReleaseNotPermittedError` | 403 | unreachable from this route (the actor is always a user) but mapped, so a future service-actor route cannot fall through to 500 |
| unknown `reason` | 400 | class-validator `@IsIn(HoldReasonValues)` |

**Both 409s carry a distinguishable machine-readable code** (`ORDER_ALREADY_ON_HOLD` /
`HOLD_ALREADY_RELEASED`) in the response body's `error` field — the issue's AC says "distinguishable",
and a status code alone is not.

### D4 — The `holdId` must belong to the path order

`release` takes only a `holdId`; the route also carries `:internalOrderId`. The controller asserts
the loaded hold's `internalOrderId` matches the path, and answers **404** when it does not.
Without that check, `POST /orders/A/holds/{a-hold-on-B}/release` would succeed and report that
order A's hold was released — a false statement about the operator's data, and the response body
would be about a different order than the URL.

### D5 — Read vs write access

The route pair is `@Roles('admin')` (per the handover: core has no roles, the interface layer owns
this, and #2339's docblock names `@Roles('admin')` explicitly). The **read** side — the detail
projection — inherits `GET /orders/:internalOrderId`'s existing authorization, which is the global
`JwtAuthGuard` with no `@Roles`, i.e. any authenticated session. That satisfies the issue's AC
"read surfaces expose the hold to a read-only role; writes require write access" without inventing a
new permission value (which the issue explicitly adjudicated against).

### D6 — `listOpenHolds` is deleted, not amended

It has **zero** production callers. Its docblock claims it serves "#2340's reconcile sweep", which is
false — #2340 rejected offset paging over a shrinking open set (it steps over rows) and built a
frontier-as-query instead. Leaving the method with a corrected docblock would leave an offset-paged
reader on the port for the next person to reach for, which is exactly the trap the sweep avoided.
Removed: the port method, the repository implementation, the `jest.fn()` in
`order-hold.service.spec.ts`'s mock, the local port-shape restatement + assertions in
`apps/api/test/integration/orders/order-holds.int-spec.ts`, and the stale reference in the
`1849000000000` migration comment (comment text only — the migration body is untouched, and an
executed migration is never edited).

---

## 5. Questions & Assumptions

- **Assumption**: `POST .../holds` answers **201**; `POST .../release` answers **200**. Placing
  creates a row; releasing mutates one. `markPacked` (200, idempotent) is the precedent for the
  latter shape.
- **Assumption**: the FE (#2342) reads `provisioningResume` off the release response. If it chooses
  to ignore it, the field is still the operator-facing record in the API and the log line stands.
- **Open**: whether a service actor will ever release through HTTP. Not modelled — every route here
  stamps `{kind: 'user', userId}` from `@CurrentUser()`. `HoldReleaseNotPermittedError` is mapped
  anyway so a future route cannot silently 500.

---

### D7 — Every new file carries a header, and the header carries the decision

`engineering-standards.md § File Headers` makes a header comment mandatory on all source files. This
wave has repeatedly caught docblocks that were **wrong** rather than absent (the false `listOpenHolds`
claim this issue deletes is one), so content matters as much as presence:

- `order-provisioning-resume.service.interface.ts` — D1's four properties, especially *why* the
  failure arm carries a code rather than the caught message.
- `order-provisioning-resume.service.ts` — `@implements`, plus the one-line contract its spec
  asserts: **this service never throws for a modelled condition.**
- `order-hold-response.dto.ts` — D2's rule that `activeHold` / `holdHistory` are detail-only, and
  that `activeHoldReason` on the shared `toDto` is a display cache with an hourly repair window that
  **no gate may read**.
- The two request DTOs — that `reason` is validated against the closed `HoldReasonValues` union.

---

## 6. Implementation Plan

### Phase 1 — Delete the dead port method
1. `libs/core/src/orders/domain/ports/order-hold-repository.port.ts` — remove `listOpenHolds` + its
   docblock.
2. `.../repositories/order-hold.repository.ts` — remove the implementation.
3. `.../services/__tests__/order-hold.service.spec.ts` — remove the mock entry.
4. `apps/api/test/integration/orders/order-holds.int-spec.ts` — **three** sites (`:67` the local
   port-shape restatement, `:304` and `:305` the two paging calls).
5. `apps/api/src/migrations/1849000000000-create-order-holds.ts` — the comment naming the method.
6. `.../entities/order-hold.orm-entity.ts` — the comment naming the method.
**Acceptance**: `grep -rn listOpenHolds` returns nothing; `pnpm type-check` clean.

### Phase 2 — The resume service (CORE)
1. New `order-provisioning-resume.service.interface.ts` (interface + result union + header docblock
   stating D1's three properties).
2. New `order-provisioning-resume.service.ts` implementing it — `findById` → source mapping via
   `getExternalIds(CORE_ENTITY_TYPE.Order, id)` filtered to `order.sourceConnectionId` → build the
   `SyncJobRequest` → `enqueueJob`. Every failure path returns a result value; only a programming
   error throws.
3. `orders.tokens.ts` — `ORDER_PROVISIONING_RESUME_SERVICE_TOKEN`.
4. `orders.module.ts` — provider + `useExisting` + export.
5. `libs/core/src/orders/index.ts` — export the interface, the result type, (token comes free via
   `export * from './orders.tokens'`).
6. Unit spec `__tests__/order-provisioning-resume.service.spec.ts`: enqueued / order-not-found /
   missing-source-external-id / enqueue-throws.
**Acceptance**: four unit tests green; the service never throws on any modelled input.

### Phase 3 — DTOs
1. `place-order-hold-request.dto.ts` — `reason` (`@IsIn(HoldReasonValues)`), `note?`
   (`@IsOptional() @IsString() @MaxLength(2000)`), `@ApiProperty({ enum: HoldReasonValues })`.
2. `release-order-hold-request.dto.ts` — `note?` only, same constraints.
3. `order-hold-response.dto.ts` — `OrderHoldDto` (ISO-string dates), `ProvisioningResumeDto`,
   `PlaceOrderHoldResponseDto { hold }`, `ReleaseOrderHoldResponseDto { hold, provisioningResume }`.
4. Unit spec for the request DTOs (the `record-refund-request.dto.spec.ts` precedent): a bad reason
   fails validation, a valid one passes, an over-long note fails.
**Acceptance**: DTO spec green.

### Phase 4 — Controller
1. `OrdersController` — inject `ORDER_HOLD_SERVICE_TOKEN` and
   `ORDER_PROVISIONING_RESUME_SERVICE_TOKEN`.
2. `placeHold` — 404 pre-check via `orderRecordRepository.findById`, then `place(...)`, catch-map
   per D3, return 201. The pre-check is a read-then-act against a concurrently-deleted order, and
   `order_holds` carries no FK by design (#2338), so a hold could in principle outlive its order.
   **Not worth a lock** — the window is tiny and the row is inert audit data — but say so in the
   route's docblock, or a later reader "fixes" it with a transaction it does not need.
3. `releaseHold` — **the ownership check precedes the write.** Call
   `holdService.listHolds(internalOrderId)` first and look `holdId` up in the result; if it is absent,
   answer **404 with no write attempted**. Only then call `release(...)`, and pass the returned
   `hold.internalOrderId` (not the path param) into `resume`, so the resumed order can never differ
   from the released one independently of this check.

   Releasing first and 404-ing afterwards was considered and rejected: it performs a side effect on
   the refusal path, leaving a hold released while telling the caller nothing happened. One extra
   read on a route an operator triggers by hand is the right price. The pre-read is a read-then-act,
   but it only decides *which refusal* — a concurrent release in the window is caught by
   `HoldAlreadyReleasedError` (409), which is the correct answer — so it can never permit a write it
   should have refused.
4. `getOrder` — after the invoice projection, `const holds = await holdService.listHolds(id)`; map to
   `holdHistory` + derive `activeHold`.
5. `toDto` (SHARED, list + detail) — add `activeHoldReason: order.activeHoldReason` per D2, with the
   display-cache caveat in its docblock and Swagger description.
6. `OrderRecordResponseDto` — add `activeHold: OrderHoldDto | null` and `holdHistory: OrderHoldDto[]`,
   documented as **detail-only** (the shared `toDto` leaves them absent, which is why they are
   declared optional-on-the-wire for the list shape — see below).

   `toDto` is shared by list and detail. Adding required fields there would force the list to
   populate them. They are therefore declared on `OrderRecordResponseDto` as
   `activeHold?: OrderHoldDto | null` / `holdHistory?: OrderHoldDto[]` and attached only in
   `getOrder`, exactly as `deliveryResolution` / `deliveryRider` already are. **#2342 must treat
   both as `.nullish()`** (the standing S3 rule, #939).
7. Controller unit spec additions: place happy path, place 409, release happy path + resume reported,
   release 409, release 404 on foreign holdId, detail projection carries both fields.
**Acceptance**: controller spec green.

### Phase 5 — Integration test
`apps/api/test/integration/orders/order-holds-api.int-spec.ts` — the issue's AC verbatim:
place → GET detail (activeHold set, history length 1) → release → GET detail (activeHold null,
history length 1 with `releasedAt`), plus double-place 409, double-release 409, invalid reason 400,
foreign-holdId 404. `loginAsAdmin` is called **once** per test file (a second call violates the users
unique constraint — `reference_int_spec_login_once_per_test`).
**Acceptance**: suite green under `--runTestsByPath`.

### Phase 6 — Docs
`docs/architecture-overview.md § 4. Orders` — one bullet for the hold API: the two routes, the
detail-only projection, D1's report-never-claim rule for the resume, and D6's note that
`listOpenHolds` is gone.

---

## 7. Alternatives Considered

**A1 — Enqueue the resume inside `OrderHoldService.release`.** Rejected: it drags `JobEnqueuePort`,
`IIdentifierMappingService` and `OrderRecordRepositoryPort` into the leaf `OrderHoldsModule`, whose
narrow dependency list is the documented reason it exists (#2338/#2339). It would also make the
`released` lifecycle fact conditional on a job queue being reachable.

**A2 — A background sweep that resumes provisioning for recently-released orders.** Rejected: a
release is a single, operator-triggered, immediately-observable act; a sweep would add latency and a
second cursor for a case that has an exact trigger. (If a resume failure ever needs a backstop, the
destination Retry button already is one.)

**A3 — Put `activeHold`/`holdHistory` on the shared `toDto`.** Rejected: N+1 behind a paged table for
data the list already renders from `lifecyclePhase`.

**A4 — Amend `listOpenHolds`'s docblock instead of deleting it.** Rejected: see D6.

**A5 — A global exception filter for the hold errors.** Rejected: one controller raises them. The
#2100 filter exists because a second controller appeared; inventing that shape ahead of a second
consumer is speculative surface.

---

## 8. Validation & Risks

- ✅ Hexagonal: the controller depends on `I*Service` interfaces + `OrderRecordRepositoryPort` (a
  pre-existing, allow-listed coupling in this file, unchanged by this work). The new core service
  depends on ports only.
- ✅ Cross-context rule: nothing new is imported from a sibling context; the resume service stays
  inside `orders`.
- ✅ Naming: `*.service.interface.ts` / `*.service.ts` / `*.dto.ts` / `*.spec.ts` / `*.int-spec.ts`.
- ✅ No `any`, no `console.log`, no secret in a response.
- **Risk — the 404-on-foreign-holdId pre-read is a read-then-act.** A concurrent release between the
  read and the write is caught by `HoldAlreadyReleasedError` (409), which is the correct answer; the
  pre-read only decides *which* refusal, never permits a write it should not.
- **Risk — `provisioningResume: 'failed'` leaves an order un-provisioned.** Accepted and reported;
  D1 states why a throw is worse. The operator's remedy is the existing destination Retry action.
- **Backward compatibility**: additive. Two optional response fields and two new routes; removing
  `listOpenHolds` breaks no caller (there are none) and the port is intra-context, unexported from
  the barrel, so no plugin can depend on it.

---

## 9. Testing Strategy

| Level | File | Covers |
|---|---|---|
| Unit | `libs/core/.../__tests__/order-provisioning-resume.service.spec.ts` | 4 result arms |
| Unit | `apps/api/src/orders/http/dto/place-order-hold-request.dto.spec.ts` | reason union, note bounds |
| Unit | `apps/api/src/orders/http/orders.controller.spec.ts` (additions) | both routes' happy + error arms, detail projection |
| Integration | `apps/api/test/integration/orders/order-holds-api.int-spec.ts` | place → detail → release → detail, both 409s, 400, 404 |

Mocks are of port/service interfaces, never concrete classes.

### Acceptance Criteria (from #2341)
- [ ] Both endpoints validated with class-validator DTOs; reason validated against the closed union
- [ ] Double-place and double-release both answer 409 with a distinguishable error code
- [ ] Read surfaces expose the hold to a read-only role; writes require write access
- [ ] Swagger annotations present; integration test covers place → detail → release → detail
- [ ] Releasing a hold re-enqueues provisioning, and the outcome is reported rather than assumed
- [ ] `listOpenHolds` and its false docblock are gone

---

## 10. Alignment Checklist

- [x] Follows hexagonal architecture
- [x] Respects CORE vs Integration boundaries (no integration touched)
- [x] Uses existing patterns (`OrderDestinationRetryService` enqueue shape, invoice-projection shape)
- [x] Idempotency considered (wave-distinct `hold-release` key namespace)
- [x] Event-driven patterns: the `released` lifecycle fact stays returned-not-published (#2339)
- [x] Rate limits & retries: N/A (no outbound platform call)
- [x] Error handling comprehensive (7 mapped arms)
- [x] Testing strategy complete
- [x] Naming conventions followed
- [x] File structure matches standards
- [x] **No migration; slot 1858000000000 is not consumed**
- [x] Plan is execution-ready

# Implementation Plan: Returns read API (#2334, W1c-7)

**Date**: 2026-08-25
**Status**: Implemented (revised after the `/pre-implement` and `/tech-review` gates)
**Estimated Effort**: ~1 day

> **Revisions applied after review.** (1) The detail response gained
> `declineAvailability` — #2336 needs "disabled with a stated reason" and the
> frontend cannot derive it: a connection's `supportedCapabilities` is served
> EMPTY when adapter metadata fails to resolve, so deriving there renders a false
> "this source does not support decline", and it cannot see the
> `no-source-return-id` case at all (that is a property of the return, not the
> connection). (2) The envelope `total` and `counts.total` are now explicitly
> different scopes — bucket-applied and bucket-less — and `total` is DERIVED from
> the counts rather than queried again. (3) `ReturnsService` does **not** already
> inject `IIntegrationsService`; it gains a constructor dependency (no new module
> edge — `ReturnsModule` already imports `IntegrationsModule`), and three specs
> that construct it directly were updated. (4) The port docblock now states
> plainly that the **unfiltered** list — the frontend's default page load — rides
> no index, rather than letting an enumeration of two indexes imply coverage.
> (5) The availability docblock records that `OrderSource` itself must still be
> enabled on the connection; only the `ReturnSourceReader` sub-capability is read
> manifest-side.

---

## 1. Task Summary

**Objective**: Expose the OL-owned return aggregate (#2327/#2328) over HTTP: a paged,
filterable list carrying the aggregate counts the FE's filter chips need, a per-return
detail carrying the source's own `rawStatus` verbatim and attributed, and the one fact
#2335's empty state needs to tell "no returns" apart from "returns ingestion is not
configured on any connection".

**Context**: Wave 1c has shipped the model, ingestion, the orphan bucket, the
downstream-trigger block and the one write (`return.decline`). None of it is reachable
from a browser. #2335 (list + orphan bucket) and #2336 (detail + decline action) are
written against the shapes this issue lands, so the response DTOs are a contract, not an
internal detail.

**Classification**: Interface (+ a narrow CORE widening of `ReturnRepositoryPort` /
`IReturnsService`, because a general paged list does not exist yet).

---

## 2. Scope & Non-Goals

### In Scope

- `GET /returns` — paged; filters `sourceConnectionId`, `bucket`, `createdFrom`,
  `createdTo`; returns items + `total` + `limit` + `offset` + a `counts` aggregate
  (`{ total, orphan, attributed }`) over the **bucket-less** filter scope.
- `GET /returns/:returnId` — the hydrated aggregate: header + lines.
- `GET /returns/ingestion-availability` — whether any connection's adapter declares
  `ReturnSourceReader`, plus the connection ids that do.
- Widening `ReturnRepositoryPort` + `IReturnsService` with the general list/count reads.
- Global HTTP mapping for the two returns-context refusals (already present — see D3).
- Unit specs for the new service/repository logic and the projections; one integration
  spec covering the three routes.

### Out of Scope

- The derived return **stage** projection and its mirror invariant — **W2-40 owns it
  outright** (#2335 assumption). Wave 1c has no custody or money movement to derive a
  stage from; shipping it here would derive a stage from columns nothing writes.
- Any new permission value (`returns:*`) — **adjudicated**. Reads sit behind the global
  `JwtAuthGuard`; the write keeps #2333's `@Roles('admin','operator')`.
- Sorting beyond the fixed `createdAt DESC` the orphan bucket already uses. No FE
  surface asks for a sortable column in Wave 1c, and a sort axis is additive later.
- Cursor pagination. Every sibling list read in the tree is limit/offset; introducing a
  second pagination idiom for one new list would be gratuitous.
- Any migration. Both queries are served by indexes #2327/#2332 already shipped.

### Constraints

- `rawPayload` is **never** returned, in whole or in part. It is the source payload as
  received and its PII posture is `OL_STORE_PII`'s, not this endpoint's.
- No `orders -> returns` import may be introduced. The edge runs one way (see
  `ReturnRepositoryPort`'s docblock).
- Migration tail is `1848000000000`; nothing here needs one.

---

## 3. Architecture Mapping

**Target Layer**: Interface (`apps/api/src/returns/`) over a CORE widening
(`libs/core/src/returns/`).

**Capabilities Involved**:

- `ReturnSourceReader` (sub-capability of `OrderSourcePort`) — read **only** for
  the ingestion-availability discovery, manifest-first, never dispatched.
- No other capability. Every list/detail read is served from OL's own store — the
  ADR-033 Phase-1 principle: a read surface must not spend the operator's marketplace
  quota on a page load.

**Existing Services Reused**:

- `IReturnsService` (`RETURNS_SERVICE_TOKEN`) — the cross-context seam. The controller
  goes through it, never `RETURN_REPOSITORY_TOKEN`, so the API layer does not become the
  second definition of a returns read.
- `IIntegrationsService.listCapabilityAdapters` — availability discovery.
- `ReturnRecord.isOrphan()` — **the** definition of orphan. The DTO's `bucket` field is
  derived from it, never from a second null check.
- `isReturnBucket` — the `?bucket=` coercion rule.

**New Components Required**:

| Layer | Component |
|---|---|
| CORE domain | `domain/types/return-query.types.ts` — `ReturnListFilter`, `ReturnBucketCounts` |
| CORE domain | `ReturnRepositoryPort.listReturns` / `.countReturnsByBucket` |
| CORE application | `IReturnsService.listReturns` / `.countReturnsByBucket` |
| CORE application | `IReturnsService.getReturnIngestionAvailability` + `ReturnIngestionAvailability` type |
| Interface | `apps/api/src/returns/http/returns.controller.ts` |
| Interface | `apps/api/src/returns/dto/list-returns-query.dto.ts` |
| Interface | `apps/api/src/returns/dto/return-response.dto.ts` (header + line + paginated + availability) |

**Core vs Integration Justification**: the list predicate, the bucket derivation and the
count are OL-owned facts about OL's own table. They cannot live in an integration — no
source knows what OL failed to attribute. The one capability touched
(`ReturnSourceReader`) is read for its *declaration only*, which is host-side discovery,
exactly the advertised-without-dispatch posture the Allegro manifest records.

---

## 4. External / Domain Research

No external system is called on any of the three routes. Internal patterns followed:

| Concern | Precedent |
|---|---|
| Paged list query DTO | `apps/api/src/orders/http/dto/list-orders-query.dto.ts` |
| Paged response envelope | `apps/api/src/orders/http/dto/paginated-orders-response.dto.ts` |
| Aggregate counts beside a list | `apps/api/src/orders/http/dto/order-health-summary-response.dto.ts` |
| Source attribution on a row | `OrderRecordResponseDto` exposes `sourceConnectionId` only |
| Domain-exception → HTTP | `apps/api/src/common/filters/*.filter.ts`, global in `main.ts` |
| Manifest-first capability discovery | `libs/core/src/catalog-trust/` (#2258) |
| Read-only trust composition | `libs/core/src/analytics-trust/` (#1982) |

---

## 5. Questions & Assumptions

### Resolved decisions (the two the issue asked me to settle explicitly)

**D1 — Where "verbatim source status" lives.** It exists: `ReturnRecord.rawStatus`
(`text`, nullable), written verbatim by `upsertFromSource` and, per its own docblock,
*never parsed and never mapped*. Nothing needs inventing. The detail DTO exposes it as
`rawStatus` and the list DTO does too (a row is allowed to show what the source called
it). **Attribution is `sourceConnectionId`, and nothing more**, matching
`OrderRecordResponseDto` exactly: the FE already holds the connections list and resolves
the display name and platform from it, so joining a connection per row here would be an
N+1 for data the FE already has — and it would put a cross-context read on the hot path
of a list page. `rawStatus: null` is returned as `null`, never as an empty string and
never defaulted to a word: "the source told us nothing" and "the source said `NEW`" are
different facts, and #2336 renders the first as an explicit state.

**D2 — One `apps/api/src/returns/` module or two.** **Two, kept as they are.** #2333's
agent deliberately named `ReturnActionsApiModule` / `return-actions.controller.ts` so
this issue could land beside it as a textual merge, and that is what happens: a new
`ReturnsReadApiModule` + `returns.controller.ts` in the same directory, both registered
in `app.module.ts`. Folding them was considered and rejected on two counts. (a) The two
controllers have genuinely different auth postures — the write carries
`@Roles('admin','operator')`, the reads do not — and one controller holding both makes
the role decoration a per-method detail an eye can skip, which is the wrong failure
direction for the only return write OL performs. (b) They inject different services
(`IReturnDeclineService` vs `IReturnsService`); merging them would give every read
request a decline-service dependency it never uses. The cost of two modules is one extra
line in `app.module.ts`, and both import the same `ReturnsModule`, so no provider is
duplicated. Route prefix is `returns` on both — Nest composes them into one
`@ApiTags('returns')` Swagger group, so the surface reads as one resource regardless.

### Assumptions

1. **Buyer PII posture.** The return aggregate persists no buyer name, email or address
   in a column of its own — the only place such data could hide is `rawPayload`, which
   is never projected. So the allowlist is the whole PII story here, and this endpoint
   inherits `OL_STORE_PII` by not reading anything it governs.
2. **`counts` scope.** The `counts` aggregate is computed over the request's filters
   **with `bucket` removed**. That is what makes a chip row honest: an operator viewing
   the `orphan` chip must still see how many `attributed` returns the same
   connection/date scope holds, or the other chip renders a count that equals the list
   they are already looking at. Same rule `order-health-summary` follows.
3. **`attributed = total − orphan`.** Derived, never separately queried — the partition
   is exhaustive by construction (`ReturnRecord.isOrphan()` is one nullable column), so
   a second query could only introduce a way for the two to disagree.
4. **`ingestion-availability` is manifest-first and constructs no adapter.**
   `listCapabilityAdapters({ capability: 'OrderSource', lazy: true, includeAllStatuses:
   true })` returns each entry's `metadata`, so the `ReturnSourceReader` test is
   `metadata.supportedCapabilities.includes(...)` — no credential resolution, no
   network. **It deliberately does NOT gate on the connection's `enabledCapabilities`**:
   `ReturnSourceReader` is advertised-without-dispatch and `enabledCapabilities` is
   stamped at connection create and never retro-filled, so gating on it would report
   "not configured" for every connection that predates #2330 — the #2085 failure shape,
   reproduced on the exact screen whose job is to tell the operator whether they are
   configured. `includeAllStatuses: true` for the `analytics-trust` reason: a connection
   in `needs_reauth` is precisely one the operator must be told about, not skipped.

### Documentation gaps

None found. ADR-060 and the returns product spec cover the operator shape; the read API
is an ordinary interface slice over them and warrants no ADR of its own (no new
abstraction, no cross-context contract, no alternative seriously in play).

---

## 6. Proposed Implementation Plan

### Phase 1 — CORE: the general list read

1. **`libs/core/src/returns/domain/types/return-query.types.ts`** *(new)*
   - `ReturnListFilter { sourceConnectionId?: string; bucket?: ReturnBucket;
     createdFrom?: Date; createdTo?: Date }` — every field optional; an absent field
     does not filter.
   - `ReturnBucketCounts { total: number; orphan: number; attributed: number }`.
   - Docblock records the bucket-less-counts rule (assumption 2) and the derived
     `attributed` (assumption 3) so the next reader cannot restate them differently.
   - **Acceptance**: types only; no runtime export (the pure-rule exception does not
     apply — there is no coercion rule that belongs with these).

2. **`ReturnRepositoryPort`** — add two methods with docblocks in the port's established
   register (each one states what index serves it and why the shape is what it is):
   - `listReturns(filter, limit, offset): Promise<ReturnRecord[]>` — **headers only**,
     `createdAt DESC, id ASC`. Headers-only for `listOrphans`' stated reason: a triage
     list renders no lines, and hydrating them would be an N+1 for data nothing shows.
     The `id ASC` tiebreak keeps an offset meaning the same thing between requests.
   - `countReturnsByBucket(filter): Promise<ReturnBucketCounts>` — **ONE** query using
     a `FILTER (WHERE "internalOrderId" IS NULL)` aggregate, so total and orphan are
     read from the same scan and cannot drift; `attributed` is subtracted in the mapper.
   - **Acceptance**: `pnpm type-check` green; port docblock states the index each read
     rides (`IDX_returns_connection_created` when `sourceConnectionId` is present,
     `IDX_returns_orphans` for the orphan-only page).

3. **`ReturnRepository`** — implement both over ONE shared private
   `buildListQuery(filter)` (the `buildReattributionQuery` / `buildSweepQuery`
   precedent), so the page and its counts can never apply different predicates.
   - `bucket: 'orphan'` → `internalOrderId IS NULL`; `'attributed'` → `IS NOT NULL`;
     absent → no arm.
   - `createdFrom` / `createdTo` are inclusive bounds on `createdAt`.
   - **Acceptance**: unit spec asserts each filter arm, the DESC+id ordering, and that
     `countReturnsByBucket` returns `total === orphan + attributed`.

4. **`IReturnsService`** — add `listReturns` / `countReturnsByBucket`, delegating.
   The existing `listOrphanReturns` / `countOrphanReturns` are **kept**: they have live
   consumers (`apps/api/test/integration/returns-ingestion.int-spec.ts`,
   `apps/worker/test/integration/allegro-returns-sync-e2e.int-spec.ts`) and they are the
   narrower index-backed question. The docblock records that they are the same question
   as `bucket: 'orphan'` asked without a filter, so a future reader does not conclude one
   of them is dead.

### Phase 2 — CORE: ingestion availability

5. **`ReturnIngestionAvailability { configured: boolean; connectionIds: string[] }`** in
   `return-query.types.ts`; `IReturnsService.getReturnIngestionAvailability()`.
   - Implemented in `ReturnsService`, which gains an `IIntegrationsService` constructor
     dependency. `ReturnsModule` already imports `IntegrationsModule` for the #2330
     ingestion services, so this adds **no module edge** — but it does widen the
     constructor, so the three specs that build the service directly are updated.
     Manifest-first per assumption 4.
   - A discovery failure **rethrows**; it is never reported as
     `{ configured: false }`. Answering `false` would assert "you are not configured"
     for what is really an infrastructure hiccup — the `catalog-trust` `'unknown'`
     lesson — on the exact screen that exists to answer the question. The route surfaces
     the failure and the FE renders its error state.
   - Also here: `getDeclineAvailability(record)`, the #2336 fact. Two reasons, both
     knowable without asking the source — the return carries no source-native id, or
     the platform declares no `ReturnDecliner`. The orphan case is deliberately NOT one
     of them: that is `bucket`, already on the response. An **unresolvable adapter
     reports `supported: true`**, because a disabled button captioned "this source does
     not support decline" is a false claim with no path back, while letting the attempt
     through costs one request that fails with the specific 400.
   - **Acceptance**: unit spec covers (a) an adapter declaring the capability, (b) one
     not declaring it, (c) zero connections, (d) a connection in `needs_reauth` still
     counted. A spec asserts `lazy: true` is passed (no adapter constructed).

### Phase 3 — Interface

6. **`apps/api/src/returns/dto/list-returns-query.dto.ts`** *(new)* — `sourceConnectionId`
   (`@IsUUID`), `bucket`, `createdFrom` / `createdTo` (`@IsDateString`), `limit`
   (1–100, default 20), `offset` (≥0, default 0).
   - `bucket` uses `@IsIn(ReturnBucketValues)` + `ApiPropertyOptional({ enum:
     ReturnBucketValues })` — the union's own runtime array, never restated literals.
     (`isReturnBucket` is the coercion rule for an untrusted string; inside a
     class-validator DTO the array IS the validator, and using both would be two rules.
     The controller therefore never re-coerces — the pipe has already narrowed it.)

7. **`apps/api/src/returns/dto/return-response.dto.ts`** *(new)* — explicit allowlists:
   - `ReturnLineResponseDto`: `id`, `lineIndex`, `externalLineId`, `resolvedOrderLineId`,
     `offerId`, `sku`, `name`, `reason`, the four quantity counters, `custodyState`,
     `moneyState`, `disposition`, `receivedAt`, `disposedAt`, `note`. Every date ISO-8601
     or `null`. (`returnId` omitted — a line is never referenced from outside the
     aggregate, and it is the parent's own id.)
   - `ReturnResponseDto`: `id`, `sourceConnectionId`, `externalReturnId`,
     `internalOrderId`, `externalOrderId`, `origin`, `rawStatus`, `bucket` (derived from
     `record.isOrphan()`), the four timestamps, `createdAt`, `updatedAt`, and `lines`.
   - `ReturnListItemResponseDto` = the same header **without** `lines` (the list read
     hydrates none — a DTO promising an array the read never fills would be a lie the
     FE would render as "this return has no lines").
   - `PaginatedReturnsResponseDto`: `items`, `total`, `limit`, `offset`, `counts`.
   - `ReturnIngestionAvailabilityResponseDto`: `configured`, `connectionIds`.
   - **No `rawPayload` field exists on any DTO** — enforced by a spec asserting the
     projected key set, so adding a column later cannot silently start leaking it.

8. **`apps/api/src/returns/http/returns.controller.ts`** *(new)* — `@Controller('returns')`,
   `@ApiTags('returns')`, `@ApiBearerAuth()`. Three `@Get`s. Injects
   `RETURNS_SERVICE_TOKEN` only. Private `toResponseDto` / `toListItemDto` /
   `toLineDto` projections; no logic beyond mapping.
   - **Route order matters**: `@Get('ingestion-availability')` is declared **before**
     `@Get(':returnId')`, or Nest matches the literal path as an id and the endpoint
     answers 404 for itself.
   - `GET /returns/:returnId` throws `ReturnNotFoundError` (the domain error, from core)
     when the service returns `null` — **not** a Nest `NotFoundException`: the mapping is
     the filter's, and constructing an HTTP exception in a controller for a state the
     domain already names would give that state two spellings.

9. **`apps/api/src/returns/returns-read.module.ts`** *(new)* — imports `ReturnsModule`,
   declares the controller. Registered in `app.module.ts` beside `ReturnActionsApiModule`
   with a comment naming its routes (that file's convention).

### Phase 4 — Exception mapping

10. **Rename `ReturnDeclineExceptionFilter` → `ReturnsExceptionFilter`**
    (`common/filters/returns-exception.filter.ts`), updating `main.ts` and the
    integration harness's `configureApp`.
    - The mapping itself is **unchanged and already correct** — #2333 landed
      `ReturnNotFoundError → 404`, `ReturnNotAttributedError → 409`,
      `ReturnDeclineUnsupportedError → 400`, globally registered. So this issue's "you
      own the HTTP mapping" is satisfied by an existing filter, and the work is honesty
      about scope: with `GET /returns/:id` reaching it, a filter named for `decline` now
      maps a plain read's 404, and the name would tell the next reader the mapping is
      decline-specific when it is the context's. The rename is safe because #2333 is
      already merged on this branch, so there is no concurrent edit to conflict with.
    - Its docblock gains one line recording that `ReturnNotAttributedError` renders
      `error.trigger` **from the readonly field, never by parsing the message** — the
      property #2332 built the two-field constructor for. (The current body renders
      `exception.message`, which already interpolates the trigger; the field stays the
      seam for any structured rendering, and the docblock says so rather than leaving the
      next person to re-derive it.)
    - **Acceptance**: `grep -rn ReturnDeclineExceptionFilter` returns nothing; the
      existing decline int-spec still passes unchanged.

### Phase 5 — Tests

11. **Unit**: `return.repository.spec.ts` (filter arms, ordering, count identity),
    `returns.service.spec.ts` (delegation, availability discovery, `lazy: true`),
    `returns.controller.spec.ts` (projections, the no-`rawPayload` key-set assertion,
    `bucket` derived from `isOrphan()`, `null` dates stay `null`).
12. **Integration**: `apps/api/test/integration/returns-read-api.int-spec.ts` — seeds
    returns via `IReturnsService.upsertFromObservation` (never raw SQL), then asserts:
    paging; each filter; `counts` invariance under `?bucket=`; detail hydrates lines
    ordered by `lineIndex`; `rawStatus` round-trips byte-identically; unknown id → 404;
    `ingestion-availability` shape. `returns` / `return_lines` are already in the
    harness's `tablesToTruncate`.
    - Run with `--runTestsByPath` (a `--testPathPattern` is silently swallowed and runs
      all ~90 suites).

---

## 7. Alternatives Considered

**A1 — Reuse `listOrphanReturns` and let the FE filter client-side.** Rejected: the
`attributed` set is unbounded, so "all returns" would have no read at all, and a chip
count derived from a page is wrong by construction.

**A2 — Two count queries (`total`, then `orphan`).** Rejected: two scans that can be
served from one, and two numbers that can disagree if a write lands between them. The
`FILTER (WHERE …)` aggregate makes the partition an atomic read.

**A3 — Fold the read controller into `ReturnActionsApiModule`.** Rejected — see D2.

**A4 — Answer ingestion-availability by constructing each `OrderSource` adapter and
narrowing with `isReturnSourceReader`.** Rejected: construction resolves credentials, so
a list-page load would do N credential resolutions to answer a question the manifest
already answers. The guard stays the right tool where an adapter is in hand (the
ingestion services); it is the wrong tool for discovery.

**A5 — Gate availability on `Connection.enabledCapabilities`.** Rejected: #2085's shape —
`ReturnSourceReader` is advertised-without-dispatch and never retro-filled, so every
pre-#2330 connection would report "not configured" while ingesting fine.

---

## 8. Validation & Risks

### Architecture compliance

- ✅ Controller reaches the aggregate through `IReturnsService`, never
  `RETURN_REPOSITORY_TOKEN` — the cross-context rule, which has teeth here.
- ✅ No new `orders -> returns` edge. `ReturnsService` gains no new dependency at all;
  `IIntegrationsService` is already injected.
- ✅ Domain layer stays framework-free; the new types file imports only sibling types.
- ✅ Domain exceptions map at a global filter, not in a controller catch.
- ✅ `as const` union reused, not restated.

### Risks

| Risk | Mitigation |
|---|---|
| Unbounded scan on `countReturnsByBucket` for a large `returns` table | Bounded in practice by the same filters as the page; `IDX_returns_connection_created` serves the common connection-scoped call. A count is a full scan of the filtered set by nature — the same trade `countForSourceSweep` and `countOrphans` already make, recorded in the port docblock rather than silently accepted. |
| Route shadowing (`/returns/ingestion-availability` matched as an id) | Literal route declared first; int-spec asserts the endpoint answers its own shape, so a reorder fails the build. |
| A future column leaking through the DTO | Projections are explicit allowlists and a spec asserts the exact key set. |
| The filter rename breaks a caller | `grep` gate in the acceptance criteria; the decline int-spec is the regression test. |

### Backward compatibility

Additive. Two new port methods, two new service methods, three new routes, one file
rename with no behaviour change. No migration, no schema change, no contract narrowing.

---

## 9. Testing Strategy & Acceptance Criteria

- [ ] List is paged and returns orphan/total counts for the FE chips
- [ ] `counts` is computed over the bucket-less filter scope and satisfies
      `total === orphan + attributed`
- [ ] Detail returns `rawStatus` verbatim (byte-identical round trip) with its
      `sourceConnectionId` attribution; `null` stays `null`
- [ ] `resolvedOrderLineId: null` survives the projection as `null`
- [ ] Response DTOs are explicit allowlists; no `rawPayload` on any of them
- [ ] `?bucket=` validated against `ReturnBucketValues`; an unknown value → 400
- [ ] Unknown return id → 404 via the global filter, not a controller catch
- [ ] `ingestion-availability` constructs no adapter and ignores `enabledCapabilities`
- [ ] All endpoints guarded
- [ ] `pnpm lint`, `pnpm type-check`, `pnpm test`, `pnpm check:invariants` green
- [ ] `returns-read-api.int-spec.ts` green via `--runTestsByPath`

---

## 10. Alignment Checklist

- [x] Follows hexagonal architecture
- [x] Respects CORE vs Integration boundaries
- [x] Uses existing patterns (no new abstractions)
- [x] Idempotency N/A (read-only)
- [x] Event-driven patterns N/A
- [x] Rate limits addressed by not calling any external system
- [x] Error handling comprehensive (global filter, no swallowed availability failure)
- [x] Testing strategy complete
- [x] Naming conventions followed
- [x] File structure matches standards
- [x] Execution-ready

---

## Related Documentation

- [ADR-060](../architecture/adrs/060-returns-aggregate-above-source-projection.md)
- [Returns operator UX spec](../specs/product-spec-oms-returns-operator-ux.md)
- [Architecture Overview](../architecture-overview.md)
- [Engineering Standards](../engineering-standards.md)

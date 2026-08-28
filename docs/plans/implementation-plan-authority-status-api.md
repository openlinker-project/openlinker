# Implementation Plan: Authority status API, preset preview and preset apply (#2353)

**Date**: 2026-08-26
**Status**: Ready for Review
**Estimated Effort**: ~1 day

---

## 1. Task Summary

**Objective**: ship the HTTP surface Wave-2 body C's three frontend issues consume — the seven
resolved who-decides answers plus the attention split (#2354/#2356), a server-computed preset
before/after diff (#2355), and a preset apply — **plus** the `?attention=` orders filter #2356
depends on, landed first and standalone.

**Context**: #2351 shipped `resolveAuthorities` (pure, total, seven rows) and #2352 shipped the
eight inert-state reasons plus `countOrdersWithOmsAttention`. Neither has an HTTP consumer. This
issue is that consumer.

**Classification**: Interface (apps/api) + a small Infrastructure/Interface increment in `orders`.

---

## 2. Scope & Non-Goals

### In Scope

1. `?attention=` orders filter + `omsAttention` summary count (standalone first commit).
2. `GET /fulfillment-authority/status`.
3. `POST /fulfillment-authority/presets/preview` — in-memory, mutates nothing.
4. `PUT /fulfillment-authority/presets` — apply, admin-only, 422 on a resulting ambiguity.
5. Preset catalogue: `leave-as-they-are` available (no-op); `keep-other-system` and
   `openlinker-decides` unavailable-with-reason.

### Out of Scope (with reason)

- **`openlinker-decides`'s config-mutation semantics.** No document in the tree defines what a
  preset writes to `Connection.config`. Escalated to the programme owner; shipped here as
  `available: false` with a reason naming the pending decision. A stub that **refuses** is honest;
  a stub that no-ops would make the card silently lie about having done something.
- All frontend work (#2354/#2355/#2356/#2357).
- Any migration. This is an API over existing columns plus a pure function; migration slot
  `1857000000000` stays free.

### Constraints

- `resolveAuthorities` **may render and may inform, and may never gate a write** (#2351). The apply
  path therefore validates the *result* independently; it does not consume the read model's answer
  as an authorisation.
- The `fulfillment-authority` leaf has an EMPTY cross-context allow-set in `barrel-purity.spec.ts`.
  Nothing added under `libs/core/src/fulfillment-authority/`.
- Core stays codes-only; every operator-facing string is #2357's.

---

## 3. Architecture Mapping

**Target layer**: Interface (`apps/api/src/fulfillment-authority/`), plus `libs/core/src/orders`
(domain types + repository) for the filter.

**Why the composition lives in `apps/api`, not in a core context**: `resolveAuthorities` needs
EVERY connection, whatever its status and whatever its capabilities — A2/A4/A6 are `config-only`,
so any connection may claim them. A core service composing `IIntegrationsService` +
`IOrderRecordService` + the leaf would either have to live IN the leaf (impossible: zero sibling
edges) or become a fifth trust-shaped context. The issue names `apps/api/src/fulfillment-authority/`
explicitly, and `RateLimitStatusService` / `WebhookStatusService` are the in-tree precedent for an
app-layer composition service over `ConnectionService`.

**Existing services reused**: `ConnectionService.list()` (all statuses), `resolveAdapterMetadata`
(metadata-only — constructs no adapter and resolves no credentials, so it works for a `disabled`
connection where `getAdapter` throws), `IOrderRecordService`/`OrderRecordRepositoryPort`
`countOrdersWithOmsAttention`, and the leaf's `resolveAuthorities` +
`AUTHORITY_ATTENTION_REASON_DESCRIPTORS` + `attentionReasonForAuthorityQuestion`.

**New components**: one app-layer service, one controller, request/response DTOs, one preset
catalogue module.

---

## 4. Domain research

### The `?attention=` filter has an exact in-tree template

`taxRateConflict` (#2254) is the same shape end to end: a `boolean` field on `OrderRecordFilters`,
a bracketed predicate ANDed in `applyFilters`, a `COUNT(*) FILTER` in the summary aggregate, a
`@Transform`-ed optional boolean on `ListOrdersQueryDto`, and a number on
`OrderHealthSummaryResponseDto`. The predicate already exists — `HAS_OMS_ATTENTION`, private, built
from `AuthorityAttentionCountedReasonValues` at class-definition time.

**Summary fold — decision: FOLD, and keep the standalone count.** They answer different questions.
`getOrderHealthSummary(filters)` is filter-scoped and drives the `/orders` chips, so the OMS count
belongs beside `salesDocumentBlocked`/`taxRateConflict` for the same reason those are there — a chip
whose number ignores the page's own scope disagrees with its rows. `countOrdersWithOmsAttention()`
is unscoped and is what the authority-status page's `Needs attention (N)` reads; deriving it from
the summary would force that page to pass filters it has no opinion about. Both read
`HAS_OMS_ATTENTION`, so there is one predicate and no drift. #2352's port docblock defers the fold
to "the issue that wires the surface" — this is it, and the docblock is updated rather than left
stating a deferral that has happened.

### The attention split is a descriptor read, not a new rule

`AUTHORITY_ATTENTION_REASON_DESCRIPTORS[reason].counted` is the §4.3 classification table; every
member is `true` today. The API reports counted and routine as two arrays derived from that flag —
never a `filter` predicate invented at the call site.

### Preview is "mutate a copy, re-run, diff" (#2351's own handover)

`resolveAuthorities` takes every input as a plain argument, so the preview is: build the claimant
array once, deep-copy each `config`, apply the preset's mutations to the copy, re-run, diff the two
seven-row outputs by `question`. No repository, no adapter, no write.

---

## 5. Questions & Assumptions

### Open (escalated, blocking only preset 2)

- **What does `openlinker-decides` write?** Undefined everywhere. Shipped unavailable-with-reason.

### Assumptions

- `leave-as-they-are` is a no-op: spec §3.2 card 1 says *"Nothing changes when you pick this."*
- The 422 guard is on the **result**, per #2351's handover wording
  (`answers.some(a => a.state === 'ambiguous')`), so it is reachable in Wave 2 without preset 3: an
  install that already has two connections claiming one authority is refused by every preset,
  including the no-op — which is literally what story S1-4 says (*"a preset selection would **result
  in** any authority resolving ambiguous"*).
- Preview is guarded as a READ (ratified by the orchestrator): #2355's confirm dialog must work for
  a read-only role that then cannot save.

---

## 6. Implementation Plan

### Phase 1 — `?attention=` orders filter (standalone commit)

1. **`libs/core/src/orders/domain/types/order-record.types.ts`** — add `omsAttention?: boolean` to
   `OrderRecordFilters` and `omsAttention: number` to `OrderHealthSummary`.
   *Acceptance*: type-check green; both fields documented as an orthogonal axis, never a health bucket.
2. **`order-record.repository.ts`** — apply `HAS_OMS_ATTENTION` (bracketed, with the `NOT (…)`
   arm) in `applyFilters`; add `COUNT(*) FILTER (WHERE …)` as `oms_attention` to the summary select
   and map it. *Acceptance*: repository spec covers `true`, `false` and `undefined`, and asserts the
   negative arm is total over a NULL column.
3. **`order-record-repository.port.ts`** — update the `countOrdersWithOmsAttention` docblock: the
   fold happened, and the two reads are deliberately both retained.
4. **`apps/api/src/orders/http/dto/list-orders-query.dto.ts`** + `orders.controller.ts` — query param
   `attention`, mapped to the repository filter `omsAttention` (the `phase` → `lifecyclePhase`
   precedent for a short param name over a full axis name).
5. **`order-health-summary-response.dto.ts`** — `omsAttention: number`.
   *Acceptance*: controller spec asserts the param threads through; Swagger describes it as its own
   axis.

### Phase 2 — the preset catalogue (one file, one drop-in point)

6. **`apps/api/src/fulfillment-authority/application/authority-presets.ts`** —
   `AuthorityPresetIdValues` (`leave-as-they-are`, `openlinker-decides`, `keep-other-system`) plus
   `AUTHORITY_PRESETS: Record<AuthorityPresetId, AuthorityPresetDefinition>` where a definition is
   `{ available: boolean; unavailableReasonCode: string | null; mutate: (config: unknown) => unknown }`.
   `mutate` is pure and returns a NEW object; `leave-as-they-are` returns its argument unchanged.
   *Acceptance*: a spec asserts (a) exactly one preset is available in this slice, (b) every
   unavailable preset carries a reason code, (c) `mutate` never mutates its argument.
   **This file is the single place the owner's answer lands**: `openlinker-decides` flips
   `available` and gains a real `mutate`. No route, DTO or service changes.

### Phase 3 — the composition service

7. **`apps/api/src/fulfillment-authority/application/services/authority-status.service.ts`**
   implementing `IAuthorityStatusService` (separate interface file, per the standards).
   - `buildClaimants()`: `connectionService.list()` (no status filter — `isActive` is REPORTED, not
     filtered; the `analytics-trust` `includeAllStatuses` trap), then per connection
     `resolveAdapterMetadata({ platformType, adapterKey })` for `supportedCapabilities`, catching
     per connection so one unregistered adapter degrades that row rather than the request.
   - `getStatus()`: `resolveAuthorities({ claimants })` + the attention split + the order count.
   - `previewPreset(id)`: claimants → deep-copied configs → `preset.mutate` → re-resolve → diff.
   - `applyPreset(id)`: refuse an unavailable preset; compute the result; refuse on any
     `state === 'ambiguous'`; otherwise persist each changed config via `connectionService.update`
     and return the fresh status.
   *Acceptance*: unit spec with a stubbed `ConnectionService` covering zero-config (seven rows, no
   ambiguity), a two-claimant ambiguity, an inactive claimant (reported, never eligible), and a
   metadata-resolution failure.

### Phase 4 — HTTP

8. **DTOs** — `authority-status-response.dto.ts` (rows + attention + presets),
   `preset-preview-request.dto.ts` (`@IsIn(AuthorityPresetIdValues)`),
   `preset-preview-response.dto.ts` (changed rows + ambiguity), `apply-preset-request.dto.ts`.
9. **`http/fulfillment-authority.controller.ts`** — `@ApiBearerAuth()`, `@ApiTags`, the global
   `JwtAuthGuard`; `GET /status` and `POST /presets/preview` with
   `@Roles('admin','operator','viewer')`; `PUT /presets` with `@Roles('admin')`.
   422 for a resulting ambiguity (`UnprocessableEntityException`, body naming
   `candidateConnectionIds`); 400 for an unavailable preset, carrying its reason code.
10. **`fulfillment-authority.module.ts`** + registration in `app.module.ts`.

### Phase 5 — Integration test

11. **`apps/api/test/integration/authority-status.int-spec.ts`** — status → preview → apply →
    status. Asserts: zero-config renders seven rows each with an answer AND a why; **preview mutates
    nothing** (status re-read is byte-identical, `toEqual` over the whole response, not an
    inspection of the code path); apply of the no-op preset is accepted and changes nothing; two
    claimants on one authority make apply answer 422 naming both connection ids; the two unavailable
    presets are returned with reasons rather than omitted.

---

## 7. Alternatives Considered

- **A new `authority-status` core context** (the `analytics-trust` shape). Rejected: it would be a
  fifth trust-shaped context whose only consumer is one page, and the issue names `apps/api`. The
  seam is reconsidered the moment a second (non-HTTP) consumer appears.
- **Deriving the attention count from the summary aggregate only.** Rejected: the authority page has
  no filter scope to pass, and inventing one would make its number depend on a scope no operator chose.
- **Shipping `openlinker-decides` as a no-op** so all three cards "work". Rejected as the worst
  option available: an operator would click it, see a success, and believe stock decisions had moved.

---

## 8. Validation & Risks

- ✅ Leaf untouched — zero files under `libs/core/src/fulfillment-authority/`.
- ✅ No migration; slot `1857000000000` free.
- ✅ `resolveAuthorities` gates nothing: the apply path's refusal is its own check over its own
  computed result.
- **Risk — a preset apply racing an operator's connection edit.** `ConnectionService.update` is a
  read-modify-write full-row save. In this slice the only available preset writes nothing, so the
  race is unreachable; it becomes real the day `openlinker-decides` gains a `mutate`, and is called
  out here so that lands with a lock or a narrow conditional update rather than by accident.
- **Risk — N metadata resolutions per status read.** Bounded by the connection count (single digits
  for this persona), constructs no adapter, resolves no credentials.

---

## 9. Testing Strategy

- Unit: preset catalogue purity/availability; the composition service's four branches; the repository
  filter's three states.
- Integration: the vertical slice in step 11.
- Acceptance criteria (from #2353): preview mutates nothing (asserted by re-reading status);
  ambiguity answers 422 naming both connections; preset 3 unavailable-with-reason, not omitted;
  Swagger annotations present; status → preview → apply → status covered.

---

## 10. Alignment Checklist

- [x] Hexagonal layering respected (composition in the app's application layer, HTTP in its interface layer)
- [x] Core/leaf boundary untouched
- [x] Existing patterns reused (`taxRateConflict` filter, `catalog-trust` controller/module shape)
- [x] Input validated at the boundary with class-validator DTOs
- [x] Writes admin-only; reads visible to a read-only role
- [x] No `any`, no `console.log`, no migration
- [x] Plan is execution-ready

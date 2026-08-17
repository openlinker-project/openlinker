# Implementation Plan: WooCommerce order source — populate `placedAt`

**Date**: 2026-08-14
**Status**: Draft
**Estimated Effort**: 1-2 hours

---

## 1. Task Summary

**Objective**: `WoocommerceOrderSourceAdapter.getOrder` must populate `IncomingOrder.placedAt` from WooCommerce's `date_created_gmt` (falling back to `date_created`), mirroring the PrestaShop adapter's existing mapping of `placedAt` from `date_add`.

**Context**: `placedAt` is the buyer-placement instant, distinct from `createdAt` (OL's ingestion clock, #1525). Two downstream consumers depend on it and currently silently degrade for WooCommerce orders:
1. **Invoicing** (`order-to-issue-invoice-command.mapper.ts:109-113`) sets `command.saleDate` only when `order.placedAt` is defined — a WooCommerce invoice today carries no `saleDate`, and the provider substitutes its own date.
2. **Order-time FX rate stamping** (#2049, ADR-040 — not yet merged to `main`) derives its rate date from `placedAt`; without it a foreign-currency WooCommerce order cannot resolve a rate and is recorded permanently unstamped.

The data is already fetched (`order.date_created_gmt` / `order.date_created`) via the existing `normGmt` helper used for `createdAt` — this is a one-line mapping addition, not a new fetch.

**Classification**: Integration (Infrastructure/adapter layer). No CORE change — `IncomingOrder.placedAt` already exists as an optional `string` field (`libs/core/src/orders/domain/types/incoming-order.types.ts:117`) and every downstream consumer (`OrderIngestionService`, `OrderRecordService`, the invoicing mapper) already handles it as optional.

---

## 2. Scope & Non-Goals

### In Scope
- Map `placedAt` in `WoocommerceOrderSourceAdapter.getOrder` alongside the existing `createdAt`.
- Unit test asserting `date_created_gmt` (and its non-GMT fallback) lands on **both** `createdAt` and `placedAt`.
- Record the VAT-period decision (see § 5) in the eventual PR description, per the issue's acceptance criteria.

### Out of Scope
- The ADR-040 / #2049-implementation-plan doc cleanup named in the issue. **Neither file exists on `main` today** — see § 5 Open Questions. This plan implements the mapping only; the doc cleanup is a follow-up once #2049/#2050 lands (or a rebase note on whichever branch merges second).
- Any change to `libs/core/src/invoicing/**` or the FX-stamping feature (#2049) itself — both are unchanged consumers.
- Backfilling or migrating existing `order_records` rows. Per the issue's own assumption, `persistOrder` rewrites `orderSnapshot` wholesale, so already-ingested WooCommerce orders self-heal `placedAt` on their next poll with no code needed.
- Any change to `listOrderFeed` (the feed-item cursor path) — `placedAt` is only relevant on the hydrated `IncomingOrder` returned by `getOrder`.

### Constraints
- Must not change the wire shape or timezone semantics of the existing `createdAt` mapping — `placedAt` uses the exact same `normGmt(order.date_created_gmt, order.date_created)` call, so both fields are always identical in value (by construction, matching the issue's acceptance criteria).
- `IncomingOrder.placedAt` is `string | undefined` (ISO-ish string) — `normGmt` already returns a `string`, so no type coercion or `new Date(...)` wrapping is needed (contrast with `OrderIngestionService` which does `new Date(incoming.placedAt)` downstream).

---

## 3. Architecture Mapping

**Target Layer**: Integration (`libs/integrations/woocommerce/src/infrastructure/adapters/woocommerce-order-source.adapter.ts`)

**Capabilities Involved**: `OrderSourcePort.getOrder` (existing, unchanged signature) — no new port or capability.

**Existing Services Reused**:
- `normGmt` (`libs/integrations/woocommerce/src/infrastructure/utils/woocommerce-utils.ts`) — already used for `createdAt`/`updatedAt`/`occurredAt`.
- `IncomingOrder.placedAt` — already defined in CORE (`libs/core/src/orders/domain/types/incoming-order.types.ts:117`), already consumed by `OrderIngestionService.syncOrderFromSource` (`libs/core/src/orders/application/services/order-ingestion.service.ts:638`) and `OrderRecordService` (`order-record.service.ts:107,192`), already the sole gate for `order-to-issue-invoice-command.mapper.ts`'s `saleDate`.

**New Components Required**: None. This is a single-line mapping addition plus one test.

**Core vs Integration Justification**: Pure integration-adapter change. The CORE contract (`IncomingOrder.placedAt`) already exists and is platform-neutral; WooCommerce simply wasn't populating a field it already fetches. No port change, no CORE logic change — matches the PrestaShop adapter's existing pattern exactly (`prestashop-order-source.adapter.ts:235-249`), which comments: *"PrestaShop `date_add` is when the customer placed the order — the buyer-placed time (#926)."*

---

## 4. External / Domain Research

### Internal Patterns
- **PrestaShop precedent** (`prestashop-order-source.adapter.ts:235-249`): maps `placedAt: placedAtIso` from `date_add`, with `undefined` when the source field is absent — no fallback substitution, matching #1525's guardrail (`createdAt` must never substitute for `placedAt`).
- **WooCommerce `createdAt` precedent** (`woocommerce-order-source.adapter.ts:249`): `createdAt: normGmt(order.date_created_gmt, order.date_created)`. Since `date_created` is a WooCommerce REST API required field (never absent on a hydrated order — confirmed in `woocommerce-order.types.ts:15` and the existing adapter contract), `placedAt` mapped the same way will always resolve to a defined string, matching the issue's acceptance criteria ("identical in value to `createdAt`").
- **Consumers already optional-safe**: `OrderIngestionService` (`incoming.placedAt ? new Date(incoming.placedAt) : undefined`), `OrderRecordService` (spreads conditionally on `!== undefined`), and the invoicing mapper (`if (order.placedAt !== undefined)`) all already branch on presence — no consumer needs a change.

### Documentation Gap Found
The issue's acceptance criteria reference `docs/architecture/adrs/040-*.md` and `docs/plans/implementation-plan-2049-order-fx-rate-snapshot.md` as files to clean up. **Neither exists on `main`** as of this plan (confirmed: `docs/architecture/adrs/` jumps from `038` to `041`; no `2049` plan file exists). Per #2049's own issue body, both live "on #2050" (an as-yet-unmerged branch). See § 5.

---

## 5. Questions & Assumptions

### Open Questions
1. **VAT-period cutoff.** The issue asks whether existing not-yet-invoiced WooCommerce orders regaining `placedAt` (and therefore a real `saleDate` for future invoices) needs a cutoff, or whether it's acceptable as-is. **Recommendation** (to be confirmed in the PR description, per the issue's own acceptance criterion): no cutoff. Rationale — `createdAt` was never a defensible sale-date substitute; the moment `placedAt` becomes available, using it is *more* correct under art. 19a/31a, and #2049 (FX stamping) already treats "first stamp attempt wins" as the correctness boundary for a similar problem — there is no equivalent "already committed" state to protect here since no `saleDate` was ever written for WooCommerce orders before now. This is a product/fiscal-policy call, not an engineering one — flagging explicitly rather than deciding unilaterally.
2. **Admin/REST-created orders.** `date_created` is the creation instant regardless of channel (checkout, admin, REST). The issue asks whether that is fine for non-checkout-created orders. **Recommendation**: yes, unchanged — this mirrors the PrestaShop adapter's existing `date_add` treatment, which the issue itself notes "has the identical property." No special-casing.

### Assumptions
- `order.date_created` (and `date_created_gmt`) is never absent on a `WooCommerceOrder` returned by `GET /wp-json/wc/v3/orders/{id}` — confirmed via the type definition (`date_created: string`, not optional) and the existing unconditional `createdAt` mapping. `placedAt` will therefore never legitimately need an `undefined` branch for WooCommerce, unlike PrestaShop.
- The ADR-040 / #2049-plan doc cleanup is **not** blocking this change and is deferred to whichever of #2049/#2050 merges — noting it in the PR description satisfies the issue's spirit without inventing files that don't exist on `main` yet.

### Documentation Gaps
- See § 4 — ADR-040 and the #2049 implementation plan are not present on `main`.

---

## 6. Proposed Implementation Plan

### Phase 1: Adapter mapping
**Goal**: `getOrder` returns `placedAt` populated identically to `createdAt`.

**Steps**:
1. **Add the `placedAt` field to the returned `IncomingOrder`**
   - **File**: `libs/integrations/woocommerce/src/infrastructure/adapters/woocommerce-order-source.adapter.ts`
   - **Action**: In `getOrder`'s return object, add `placedAt: normGmt(order.date_created_gmt, order.date_created),` immediately above the existing `createdAt: normGmt(order.date_created_gmt, order.date_created),` line (~line 238, just before the ship-by comment block that precedes `createdAt`). Add a short comment mirroring PrestaShop's, e.g.:
     ```ts
     // date_created is the buyer-placement instant (checkout, admin, or REST
     // creation all set it at the same instant) — the buyer-placed time (#926),
     // mirroring the PrestaShop adapter's date_add mapping. Always defined on a
     // hydrated WC order, so placedAt and createdAt are always identical.
     placedAt: normGmt(order.date_created_gmt, order.date_created),
     createdAt: normGmt(order.date_created_gmt, order.date_created),
     ```
   - **Acceptance**: `getOrder`'s return type-checks (no `IncomingOrder` shape change needed — field already exists) and `pnpm --filter @openlinker/integrations-woocommerce type-check` passes.
   - **Dependencies**: None.

### Phase 2: Tests

2. **Unit test — `placedAt` mapped from `date_created_gmt`**
   - **File**: `libs/integrations/woocommerce/src/infrastructure/adapters/__tests__/woocommerce-order-source.adapter.spec.ts`
   - **Action**: Add tests inside the existing `describe('getOrder', ...)` block:
     - `it('should map placedAt from date_created_gmt, identical to createdAt')` — call `getOrder`, assert `result.placedAt === result.createdAt` and both equal `normGmt(order.date_created_gmt, order.date_created)` for the default `makeOrder()` fixture.
     - `it('should fall back to date_created for placedAt when date_created_gmt is absent/empty')` — construct an order via `makeOrder({ date_created_gmt: '', date_created: '2024-01-15T10:00:00' })` (matching however `normGmt`'s existing fallback tests, if any, exercise the empty-string case — check `normGmt`'s own spec for the exact falsy-input convention it uses) and assert `result.placedAt === result.createdAt === '2024-01-15T10:00:00'` (or whatever `normGmt` normalizes it to).
   - **Acceptance**: Both new tests pass; existing `getOrder` tests remain green (no fixture shape change).
   - **Dependencies**: Step 1.

### Implementation Details

**New Components**: None — no new files.

**Configuration Changes**: None.

**Database Migrations**: None — `IncomingOrder.placedAt` is a transient DTO field; `Order.placedAt` / `order_records.placedAt` persistence already exists (#926).

**Events**: None emitted or consumed by this change.

**Error Handling**: None needed — `normGmt` already handles its own fallback; no new failure mode is introduced.

---

## 7. Alternatives Considered

### Alternative 1: Derive `placedAt` in `OrderIngestionService` from `createdAt` when `placedAt` is absent
- **Description**: Instead of fixing the WooCommerce adapter, have core substitute `createdAt` for `placedAt` when the latter is missing.
- **Why Rejected**: This is exactly the anti-pattern #1525 exists to prevent — `createdAt` is OL's ingestion clock, not the sale date, and "must never substitute" per the existing comment in the invoicing mapper. Fixing it at the adapter (where the real fact is already fetched) is correct; fixing it at the consumer would launder a wrong value into every future adapter that has the same gap.
- **Trade-offs**: None — the adapter fix is strictly better and is what the issue asks for.

### Alternative 2: Add a cutoff/gating flag so only orders ingested after this change get `placedAt`
- **Description**: Introduce a config flag or ingestion-timestamp cutoff so existing orders don't retroactively gain a different `saleDate`.
- **Why Rejected**: No `saleDate` was ever written for WooCommerce orders before this change (the field was simply absent), so there's no "already committed" value being changed — only a previously-missing fact becoming available. Adding gating infrastructure for a one-line data-completeness fix is disproportionate, and the issue itself frames this as an open question for the PR description, not a required code change. Flagged in § 5 rather than built.
- **Trade-offs**: If the VAT-period recommendation in § 5 is rejected by whoever owns invoicing, a cutoff could be added in a fast follow-up — but it should not gate this fix from merging, since the fix is otherwise a pure bug correction (empty → correct value).

---

## 8. Validation & Risks

### Architecture Compliance
- ✅ Change is entirely within `libs/integrations/woocommerce/**` (Infrastructure/adapter layer) — no CORE, no port, no cross-context import added.
- ✅ No new symbol crosses the `@openlinker/core/*` barrel; `IncomingOrder` is already an allowed cross-context type.

### Naming Conventions
- ✅ No new files; existing file/test naming (`*.adapter.ts` / `*.adapter.spec.ts`) is unchanged. Reference: [Engineering Standards - Naming Conventions](../engineering-standards.md#naming-conventions).

### Existing Patterns
- ✅ Matches the PrestaShop adapter's `placedAt` mapping pattern exactly (same field semantics, same "buyer-placed time" comment style, same #926 cross-reference).

### Risks
- **VAT-period shift for future invoices** (named explicitly in the issue): a WooCommerce order placed in month N and invoiced in month N+1 after this change gets `saleDate` = placement date instead of the provider-substituted date. Mitigation: this is a **more correct** outcome per the issue's own framing (art. 19a/31a), and is explicitly called out for the PR description rather than silently shipped — no code mitigation is needed, only documentation of the decision at merge time.
- **None on the FX-stamping side today** — #2049 is unmerged, so this change has zero behavioral effect on FX stamping until that feature lands; the `placedAt` field simply becomes available for it to consume once merged.
- **Already-issued WooCommerce invoices are unaffected — corrected mechanism (review, #2114)**: the initial PR description attributed this to `IssuedLineSnapshot`, which is wrong — `IssuedLineSnapshot` (`invoicing.types.ts:329-336`) carries only `buyer` / `currency` / `lines`, not `saleDate`. The actual reasons an already-issued document is safe: (a) it already exists at the provider and is not re-derived from a live `IncomingOrder`, and (b) `InvoiceRecord.saleDate` is a persisted column (`invoicing.types.ts:444`) with nothing in the codebase re-deriving it from a fresh sync. Residual gap this leaves open: `IssueCorrectionCommand` (`invoicing.types.ts:606`) carries no `saleDate` field, so a correction of a pre-change WooCommerce invoice cannot acquire one even after this fix ships — plausibly fine (a correction inherits the original document's period by convention), but worth stating explicitly given the no-cutoff decision rather than leaving it unstated.
- **Epoch-sentinel guard added for `placedAt` (review, #2114)**: `normGmt` returns the `1970-01-01` epoch sentinel when both `date_created_gmt` and `date_created` are absent — harmless for `createdAt`/`updatedAt` (bookkeeping timestamps), but `placedAt` now feeds `IssueInvoiceCommand.saleDate` → KSeF FA(3) `P_6` on a submitted document. The adapter now leaves `placedAt` `undefined` (mirroring the PrestaShop adapter's `date_add` guard) rather than mapping the sentinel through, closing that gap before it reaches a fiscal document.
- **GMT-vs-local fallback mislabels a local time as UTC (review, #2114, not fixed here)**: `normGmt`'s fallback path appends `Z` to `date_created` (site-local time) when `date_created_gmt` is absent, treating it as if it were already UTC. Cosmetic for `createdAt`, but for `saleDate`, `toIsoDate` truncates to a calendar date — so a near-midnight order on a UTC-offset shop can resolve to the wrong day, and at a month boundary, the wrong VAT period. This is pre-existing `normGmt` behavior (shared with `createdAt`/`updatedAt`), and this PR is what first makes it fiscally relevant; fixing it properly requires knowing the shop's configured timezone, which is out of scope for this one-line mapping fix. Flagged here rather than silently shipped — a follow-up should either thread the WooCommerce site timezone into `normGmt`'s fallback or accept the risk explicitly (it only bites when `date_created_gmt` is missing, which WC always populates on a normally-functioning REST v3 endpoint).

### Edge Cases
- **`date_created_gmt` absent/empty on a hydrated order**: covered by the fallback test (Step 2) — `normGmt` already handles this for `createdAt`; `placedAt` inherits the same fallback since it's the identical expression, not a separate re-implementation.
- **Both `date_created_gmt` and `date_created` absent**: `placedAt` is left `undefined` rather than resolving to `normGmt`'s epoch sentinel (`1970-01-01T00:00:00.000Z`) — see Risks above. Covered by a dedicated spec asserting `placedAt` is `undefined` while `createdAt` keeps the sentinel.
- **Guest / admin-created orders**: `date_created` is set unconditionally by WooCommerce regardless of order origin (per Research, § 4) — no special-casing needed, matching the issue's own recommendation to leave this untouched (parity with PrestaShop's `date_add`).

### Backward Compatibility
- ✅ No breaking change. `placedAt` is a new, previously-`undefined` field on the returned `IncomingOrder` for WooCommerce connections only — every existing consumer already branches on its presence. Existing WooCommerce `order_records` rows gain `placedAt` on their next re-poll (per `persistOrder`'s wholesale `orderSnapshot` rewrite), with no migration or backfill required.

---

## 9. Testing Strategy & Acceptance Criteria

### Unit Tests
- `libs/integrations/woocommerce/src/infrastructure/adapters/__tests__/woocommerce-order-source.adapter.spec.ts` — the two `getOrder` tests described in Phase 2, Step 2.

### Integration Tests
- None required — this is a pure mapping change within an existing unit-tested adapter method; no new HTTP shape, no new persistence path, no new cross-service flow to exercise end-to-end. The existing invoicing-mapper and order-ingestion unit tests (`order-ingestion.service.spec.ts:355`, `order-to-issue-invoice-command.mapper.ts` tests) already cover the consumer side generically via `incoming.placedAt` — no WooCommerce-specific integration test is needed since the adapter boundary is where the fix lives.

### Mocking Strategy
- No mocking changes — the existing `makeOrder()` / `makeHttpClient()` fixtures in the spec file are reused as-is (with one fixture override for the fallback test).

### Acceptance Criteria
- [ ] `WoocommerceOrderSourceAdapter.getOrder` returns an `IncomingOrder` with `placedAt` populated from `date_created_gmt` (falling back to `date_created`), identical in value to `createdAt`.
- [ ] A spec asserts both fields are set from the same source field, including the non-GMT fallback path.
- [ ] `pnpm --filter @openlinker/integrations-woocommerce test` passes.
- [ ] `pnpm lint` / `pnpm type-check` pass with zero errors.
- [ ] The VAT-period question (§ 5, Open Question 1) is answered explicitly in the PR description.
- [ ] The ADR-040 / #2049-plan doc-cleanup criterion is noted as deferred in the PR description, with a pointer to this plan's § 4 finding (files don't exist on `main` yet).

---

## 10. Alignment Checklist

- [x] Follows hexagonal architecture — change confined to the Integration adapter layer.
- [x] Respects CORE vs Integration boundaries — no CORE change; `IncomingOrder.placedAt` already published.
- [x] Uses existing patterns (no unnecessary abstractions) — reuses `normGmt`, mirrors PrestaShop's mapping verbatim.
- [x] Idempotency considered — re-mapping on every poll is inherently idempotent (same input → same output); no new idempotency key needed.
- [ ] Event-driven patterns used where applicable — N/A, no event involved.
- [ ] Rate limits & retries addressed — N/A, no new external call (the order is already fetched).
- [x] Error handling comprehensive — no new failure mode introduced.
- [x] Testing strategy complete — unit tests specified above.
- [x] Naming conventions followed — no new files.
- [x] File structure matches standards — change lives in the existing adapter + its existing spec file.
- [x] Plan is execution-ready.
- [x] Plan is saved as markdown file.

---

## Related Documentation

- [Architecture Overview](../architecture-overview.md)
- [Engineering Standards](../engineering-standards.md)
- [Testing Guide](../testing-guide.md)
- [Code Review Guide](../code-review-guide.md)
- Issue: [#2097](https://github.com/openlinker-project/openlinker/issues/2097)
- Related: [#2049](https://github.com/openlinker-project/openlinker/issues/2049) (order-time FX stamping, depends on this), #1525 (`placedAt` as the sale-date anchor), #926 (`placedAt` introduced for PrestaShop)

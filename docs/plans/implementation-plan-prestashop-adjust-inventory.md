# Implementation Plan: PrestaShop `adjustInventory`

**Date**: 2026-08-26
**Status**: Ready for Review
**Issue**: #2369 (`W2-32`, OMS Wave 2, stream S1)
**Depends on**: #2368 (`W2-31` — the `InventoryAdjustmentResult` contract, already on this branch)
**First caller**: #2370 (`W2-33` — return receive/dispose, owner of `restock_blocked`)
**Estimated Effort**: ~0.5 day

---

## 1. Task Summary

**Objective**: implement `adjustInventory` on `PrestashopInventoryMasterAdapter` against the #2368
contract, over the PrestaShop webservice `stock_availables` resource.

**Context**: the method currently throws `PrestashopNotSupportedException` unconditionally
(`prestashop-inventory-master.adapter.ts:283`). PrestaShop is the most common OL master, so on a
default install `restock_blocked` (#2370) is the **default** outcome of every return restock rather
than the exception — which turns the returns spec's highest-severity remediation path into the
normal path and gets it learned-ignored.

**Classification**: Integration / Infrastructure. No CORE change. No migration.

---

## 2. Scope & Non-Goals

### In scope
- Read-modify-write of the targeted `(product, combination)` `stock_availables` row.
- Honouring `adjustment.idempotencyKey` per connection via the shared `CachePort`, recorded only
  **after** the write succeeds.
- Reporting `disposition` / `idempotency` / `appliedAt` honestly.
- Carrying `adjustment.reason` where PrestaShop can hold it, logging it where it cannot.
- **Typed refusals** for configurations PrestaShop cannot safely serve, so they surface to #2370 as
  `restock_blocked` rather than as a silent success.
- Threading `HostServices.cache` from the plugin through the adapter factory to the adapter.

### Out of scope
- `reserveInventory` / `releaseInventory` — deprecated in place (ADR-061); they keep throwing.
- A PrestaShop-module (`importorder`-style) stock endpoint. The issue floats it as preferable "if
  one already exists for stock"; **none does** — `apps/prestashop-module/openlinker/` ships
  `cartshipping` and `importorder` only. Adding a module endpoint would mean shipping a new PHP
  front controller and requiring every operator to upgrade the module before a return can restock,
  which is a far larger change than this issue and would gate #2370 behind a module rollout.
- Closing the read-modify-write race (see §8).
- Multi-location / warehouse-aware adjustment.

### Constraints
- CORE ↔ Integration boundary: no PrestaShop vocabulary in `libs/core`, and no PrestaShop exception
  type may reach core except through the established neutral translations.
- Source-compatible: the adapter must keep satisfying `InventoryMasterPort`.
- Node 22 LTS; migration slot `1852000000000` is reserved for this body but **is not needed**.

---

## 3. Architecture Mapping

**Target layer**: Integration (`libs/integrations/prestashop/`), infrastructure sub-layer.

**Capability**: `InventoryMasterPort.adjustInventory` (#2368 signature —
`Promise<InventoryAdjustmentResult>`).

**Existing components reused**:
- `IPrestashopWebserviceClient.listResources` / `getResource` / `updateResource`.
- The adapter's own `resolvePrestashopProductId` (mapping-gap carve-out) and `listStockRecords`
  (the `MasterProductNotFoundError` translation point, #1688).
- `IPrestashopInventoryMapper.mapInventory` for the returned `Inventory`.
- `CachePort` (`@openlinker/shared/cache`) — the #2368 WooCommerce idempotency precedent.
- `PrestashopNotSupportedException` for the typed refusals.

**New components**: none beyond private methods on the existing adapter. No new port, no new
exception class, no new type.

**Core vs Integration justification**: everything here is PrestaShop's own storage model
(`stock_availables`, `id_product_attribute`, `depends_on_stock`, `id_shop`). The neutral contract
already exists in core (#2368); this issue only supplies an implementer.

---

## 4. External Research — the PrestaShop `stock_availables` resource

`ps_stock_available` columns: `id_stock_available`, `id_product`, `id_product_attribute`,
`id_shop`, `id_shop_group`, `quantity`, `depends_on_stock`, `out_of_stock`, `location`.

Four consequences shape the implementation:

1. **No delta primitive and no conditional write.** The webservice exposes only a full-resource
   `PUT`. So the adjustment is read-current → compute → write, exactly as WooCommerce does, and the
   de-duplication has to be the adapter's own.
2. **No timestamp column of any kind.** There is no `date_upd` / `date_add` on this resource, so
   PrestaShop reports no instant for a stock change. `appliedAt` is therefore **`null`** — an honest
   absence, per the #2367/#2336 rule that OL must not fabricate a claim about the outside world.
   (This is the same trap WooCommerce hit from the other side, where `date_modified` exists but is
   site-local with no offset and only `date_modified_gmt` is an instant.)
3. **No audit/reason field.** `location` is an operator-authored warehouse location string, not a
   comment field; writing the reason there would corrupt real operator data. The reason is therefore
   **logged**, not carried — the contract's explicit "logs it where it does not" branch.
4. **`depends_on_stock = 1` means Advanced Stock Management owns the quantity.** PrestaShop
   recomputes `quantity` from warehouse stock, so a `quantity` write is accepted and then silently
   overwritten. This is precisely the "silent success" the issue forbids.

**Multi-shop**: one `(id_product, id_product_attribute)` pair has one `stock_availables` row *per
shop*. With several rows the write target is ambiguous, and picking one would silently adjust one
storefront's stock while the operator believes the product was restocked.

**In-tree precedent for the write**: `PrestashopProductPublisherAdapter.updateStock`
(`product-publisher/prestashop-product-publisher.adapter.ts:301`) already `PUT`s `stock_availables`.
It sends a partial body (`id`, `id_product`, `quantity`); this plan sends the **full read-back row
with `quantity` overlaid**, per the client interface's documented PUT contract, so `id_shop`,
`id_shop_group`, `depends_on_stock` and `out_of_stock` are preserved rather than left to PS defaults.

---

## 5. Questions & Assumptions

### Assumptions
- **A1** — `stock_availables` carries no timestamp, so `appliedAt` is always `null` on this adapter.
  Verified against the resource's column list; asserted by a unit test so a future PS version adding
  one surfaces as a failing assertion rather than a silent `null`.
- **A2** — `depends_on_stock` and `id_shop` are returned by the webservice on a `stock_availables`
  read. Both are real columns of the resource, but **neither is declared** on
  `PrestashopStockAvailable` today — they fall through its `[key: string]: unknown` index signature.
  They are therefore **declared as optional fields** on that interface (additive; the index signature
  means no existing construction site or read changes), so the guards narrow without a cast and
  without `any`. Handled defensively: a **missing/unparseable** `depends_on_stock` is treated as `0`
  (not-ASM) rather than refusing, because refusing on an absent field would break every ordinary
  install if a PS version omits it; whereas an explicit `1` refuses.
- **A5** — a cache **throw** (Redis outage, as distinct from the miss/parse-failure `CachePort`
  documents as `null`) **propagates**: the adjustment fails closed. A blocked restock is recorded by
  #2370 as `restock_blocked` and an operator can retry it; a double restock silently moves real stock
  and cannot be undone from OL. Stated in the method docblock.
- **A3** — an adjustment with no `variantId` against a product that has combination rows is
  ambiguous and must refuse, mirroring WooCommerce's `adjustInventory without variantId on a
  variable product` refusal.
- **A4** — #2370 treats **any** thrown error from `adjustInventory` as `restock_blocked`. This plan
  therefore uses a typed *throw* for refusals rather than an outcome field, matching the port's
  documented `@throws NotSupportedException` contract and WooCommerce's behaviour. An outcome value
  claiming `disposition: 'applied'` is never produced on a refusal path.

### Open questions
- **Q1 — ANSWERED, not deferred.** Multi-shop support already ships: `PrestashopQueryBuilder.buildQuery`
  appends `id_shop={shopId}` whenever `config.shopId` is a positive number
  (`prestashop-query.builder.ts:74-80`), and `listResources` routes through it
  (`prestashop-webservice.client.ts:188`). So a multi-shop operator's fix is **one existing config
  key**, not a future feature. Only the *unset* case refuses — genuinely ambiguous, and guessing a
  shop would adjust one storefront's stock while the operator believes the product was restocked —
  and the refusal message **names `config.shopId`** so the remediation travels with the
  `restock_blocked` that #2370 records.
- **Q2** — the read-modify-write race is real and unclosable with this API (see §8). Documented in
  the method docblock, as WooCommerce's is.

---

## 6. Proposed Implementation Plan

### Phase 1 — Thread the cache to the adapter

1. **`prestashop-adapter.factory.interface.ts`** — add an optional trailing `cache?: CachePort`
   parameter to `createAdapters`.
   *Acceptance*: existing 4-arg call sites still type-check.
2. **`prestashop-adapter.factory.ts`** — accept the parameter and pass it as the trailing argument
   to `new PrestashopInventoryMasterAdapter(...)`.
3. **`prestashop-plugin.ts`** — pass `host.cache` at the single `factory.createAdapters(...)` call.
   *Acceptance*: mirrors the WooCommerce wiring (`woocommerce-plugin.ts`, `host.cache`).

**Why optional/trailing**: `HostServices.cache` is itself optional, and every existing construction
site stays source-compatible. With no cache wired the adapter applies the adjustment and reports
`idempotency: 'unsupported'` — never `'honoured'`.

### Phase 2 — Resolve the target row

4. **`resolveTargetAttributeId(adjustment, psProductId)`** (private) — resolve the
   `id_product_attribute` the adjustment targets:
   - `variantId` present → `getExternalIds(ProductVariant, variantId)` filtered to this connection;
     a `product:<id>` synthetic resolves to `0`, a numeric combination id resolves to itself.
     No mapping for this connection → `PrestashopResourceNotFoundException` (retryable mapping gap,
     never `MasterProductNotFoundError` — the #1688 carve-out this file already documents).
   - `variantId` absent → `0`, **but** only after confirming the product has no combination rows;
     otherwise refuse (A3).

### Phase 3 — Read, guard, write

5. **`adjustInventory`** — the orchestration, in this order:
   1. Log `reason` when present (§4.3).
   2. Resolve idempotency support: no key → `'not_requested'`; key but no cache → `'unsupported'`;
      key + cache → `'honoured'`.
   3. On `'honoured'`, check the applied-key marker.
   4. Resolve `psProductId` (existing helper) and the target attribute id (step 4).
   5. Read the `stock_availables` rows for `(id_product, id_product_attribute)` via the existing
      `listStockRecords` — so the #1688 not-found translation is inherited unchanged.
   6. **Guards, in this order** (each a typed `PrestashopNotSupportedException` naming its cause):
      - more than one row → multi-shop, ambiguous target;
      - `depends_on_stock === '1'` → advanced stock management;
      - zero rows → delegate to the existing `throwForAbsentStockRecords`, which already probes the
        product and distinguishes a real master deletion from a data gap. **This widens #1688's
        contract to the write path and must be stated in the docblock**: the port documents that
        neutral-error translation for the two READ methods only, and `MasterInventorySyncService`
        acts on it destructively (stale every row, terminal `business_failure`). The widening is
        correct — a product absent at the master is the same fact whoever asks — and duplicating the
        probe to avoid it would be worse; but it is a decision, not helper reuse, so it is
        documented rather than implied. #2370 renders it as `restock_blocked` like any other throw.
   7. If already applied: **re-read and return current stock, write nothing**
      (`disposition: 'deduplicated'`).
   8. Otherwise `PUT` the full read-back row with `quantity` overlaid at `max(0, current + delta)`.
      **Warn when the clamp actually bites** (a decrement larger than current stock): the outcome
      still reports `applied` while less than `delta` was applied, which is a small honesty gap of
      the kind this issue exists to close. Exposure is low — #2370 restocks positive only — and
      WooCommerce sets the precedent, so no contract change; the log line makes it greppable.
   9. Record the applied key **after** the write returns (never before).
   10. Return `{ ...mappedInventory, adjustmentOutcome: { disposition, idempotency, appliedAt: null } }`.

**Idempotency cache key**: `ps:inventory-adjust:{connectionId}:{key}` — connection-scoped, matching
the WooCommerce `wc:` prefix. TTL 7 days, the same constant WooCommerce uses (it matches the
`jobdedup:*` TTL, so the retry ladder's 6 h backoff cannot outlive the window).

### Phase 4 — Tests

6. **`prestashop-inventory-master.adapter.spec.ts`** — extend the existing suite:
   - raises quantity by exactly `n`, and writes the full row with `quantity` overlaid;
   - clamps at `0` on an over-decrement;
   - targets the combination row when `variantId` names one, and `id_product_attribute=0` for a
     synthetic `product:<id>` variant;
   - repeated key applies nothing, re-reads, reports `deduplicated` + `honoured`;
   - key with no cache wired reports `unsupported` and still applies;
   - no key reports `not_requested`;
   - the applied-key marker is written only after a successful `PUT` (assert no marker write when
     the `PUT` rejects);
   - `appliedAt` is `null` (A1);
   - multi-shop rows refuse; `depends_on_stock='1'` refuses; combination product with no `variantId`
     refuses — each with `PrestashopNotSupportedException` and no `updateResource` call;
   - a mapping gap raises the platform exception, not `MasterProductNotFoundError`.

No integration test is added: the PS Testcontainer harness exists but the behaviour under test is
request-shape plus guard logic, which unit tests cover precisely; the issue's "integration test
against the dev stack" AC is noted as satisfied at the unit level with the gap stated (§9).

---

## 7. Alternatives Considered

**A. Ship a stock endpoint in the OL PrestaShop module** (the issue's ADR-016 hint). Rejected for
this issue: no such endpoint exists today, so it means a new PHP front controller plus an operator
module upgrade gating every #2370 restock. It also would not remove the read-modify-write race
unless the module performed an atomic SQL increment — which is a genuinely better design and worth
its own issue, but not a prerequisite for making PrestaShop restock at all.

**B. Report unsupported configurations as an `adjustmentOutcome` rather than throwing.** Rejected:
`InventoryAdjustmentOutcome` has no member that can express a refusal — `disposition` is
`applied | deduplicated`, both successes — so a refusal would have to be encoded as `applied`, which
is the exact silent-success the issue forbids.

**C. Persist applied keys in Postgres instead of the cache.** Rejected: it would put an
integration-owned table in a plugin for a bounded de-duplication window, and diverge from the
WooCommerce precedent set one issue earlier. The cache's weaker guarantee is stated honestly rather
than papered over.

**D. Write the reason into `location`.** Rejected — that column is operator data.

---

## 8. Validation & Risks

### Architecture compliance
- ✅ No `libs/core` change; the adapter satisfies the existing port.
- ✅ No PrestaShop type or exception reaches core except the neutral `MasterProductNotFoundError`,
  raised only through the pre-existing translation points.
- ✅ Naming, file headers, `as const` — unchanged file conventions.

### Risks
- **Read-modify-write race** — two concurrent adjustments to one row can lose an update. The
  webservice exposes no conditional write, so this is not closable here. Documented in the docblock,
  identical in kind to the WooCommerce limitation accepted in #2368.
- **Idempotency window is best-effort** — `CachePort` has no atomic set-if-absent, so two *genuinely
  concurrent* same-key calls can both miss and both apply. The threat this closes is the sequential
  job retry, and #2370 mints one deterministic key per disposition sequence. Stated in the docblock.
- **Cache loss re-opens the window** — a Redis flush drops applied-key markers, so a retry after one
  double-applies. Accepted, same as WooCommerce; the alternative is durable storage (alternative C).
- **A refusal now blocks what previously threw anyway** — no regression: the method threw
  unconditionally before, so every refusal path is at worst status quo and every non-refusal path is
  a strict improvement.

### Backward compatibility
**Source-compatible; not breaking.** The signature widens from `Promise<Inventory>` to
`Promise<InventoryAdjustmentResult>`, which #2368 already established as a source-compatible
widening (`InventoryAdjustmentResult extends Inventory`, `adjustmentOutcome` optional). No caller
exists in this tree today. #2368's own `BREAKING CHANGE:` footer (the `reason` narrowing) is
unaffected by this issue and must be preserved in the wave PR.

### Migration
**None.** No ORM entity changes. The reserved slot `1852000000000` is left free for a sibling.

---

## 9. Acceptance Criteria

- [ ] A restock of `n` units raises the PrestaShop quantity by exactly `n` (unit-asserted against the
      `updateResource` body; the issue's dev-stack integration test is **not** added — noted gap).
- [ ] A repeated idempotency key does not double-apply, reports `deduplicated` + `honoured`, and
      returns current — not replayed — stock.
- [ ] With no cache wired, an adjustment applies and reports `unsupported`, never `honoured`.
- [ ] The applied-key marker is written only after the write succeeds.
- [ ] `appliedAt` is `null` (PrestaShop reports no instant).
- [ ] `reason` is logged, never written to a PrestaShop field.
- [ ] Multi-shop, advanced stock management, and an ambiguous combination target each raise a typed
      refusal with no write attempted.
- [ ] Tests added; `pnpm lint`, `pnpm type-check`, `pnpm test`, `pnpm check:invariants` green.

---

## 10. Alignment Checklist

- [x] Follows hexagonal architecture (adapter implements an existing core port)
- [x] Respects CORE vs Integration boundaries
- [x] Uses existing patterns (WooCommerce #2368 precedent; in-tree `stock_availables` PUT precedent)
- [x] Idempotency considered, and its bound stated rather than overclaimed
- [x] Event-driven patterns — n/a (no event emitted or consumed)
- [x] Rate limits & retries — inherited from the connection-bound transport; no new outbound pattern
- [x] Error handling comprehensive (typed refusals; #1688 translation inherited unchanged)
- [x] Testing strategy complete
- [x] Naming conventions followed
- [x] Plan is execution-ready

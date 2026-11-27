# ANALYSIS-3774 — operator-defined payment-method map (pre-implement gate)

**Plan**: `docs/plans/implementation-plan-payment-method-map.md`
**Issue**: #3774 (frontend half #3775)
**Worktree / branch**: `/home/jretaj_1/openlinker-3774`, `3774-payment-method-map`
**Gate run**: 2026-10-19, read-only against the live tree of that worktree.

## Verdict: **READY**

No Critical finding and no reuse collision. Five Warnings and one open question are
listed below; none blocks implementation, and each is cheaper to settle in the plan
than in code. No source and no plan text was edited by this gate.

## Reuse findings

| Plan artifact | Result | Evidence |
|---|---|---|
| `payment-method-map.types.ts` (`readPaymentMethodMap`, `normalizeSourcePaymentMethodKey`, `resolveSourcePaymentMethod`) | **NEW (confirmed absent)** | no `paymentMethodMap` / `resolveSourcePaymentMethod` / `normalizeSourcePaymentMethodKey` anywhere in `libs`, `apps`, `scripts` |
| `PlatformPaymentMethodClassifier` capability + guard | **NEW** | no `classifyPlatformPaymentMethod` / `PlatformPaymentMethodClassifier`; sits beside nine existing `*.capability.ts` in `libs/core/src/orders/domain/ports/capabilities/`, same shape as the guard-only `ModifiedProductLister` (`libs/core/src/products/domain/ports/capabilities/`) |
| `IOrderRecordService.listObservedSourcePaymentMethods` + repository read | **NEW** | no such method; the batched-read neighbour is `getEarliestOrderDateByConnection` (`order-record.service.interface.ts:156`), the shape to copy |
| `ConnectionPaymentMethodsService` (apps/api) | **NEW** | none; `apps/api/src/orders/application/services/source-fulfillment-status.service.ts` already injects `INTEGRATIONS_SERVICE_TOKEN`, so the pattern and wiring exist |
| `GET /connections/:connectionId/payment-methods/observed` | **NEW, no collision** | the only payment route is `GET/PUT connections/:connectionId/mappings/payments` (`mappings.controller.ts:150/163`, #3474 destination-label mapping). Different prefix, different meaning; not an overlap |
| `Connection.config.paymentMethodMap` | **NEW** | key unused; `ConnectionConfig` has an open index signature (documented-keys style), so adding a documented key is non-breaking |
| `sourcePaymentMethod` on the persisted snapshot | **PARTIAL (extend)** | field already exists on `IncomingOrder` (`incoming-order.types.ts:108`) and `Order` (`order.types.ts:132`) and is threaded by `order-ingestion.service.ts`, but `order-record.service.ts` does **not** write it to `orderSnapshot` (the `paymentStatus` / `paymentMethod` neighbours are written, this one is not). Plan step 5 is therefore real, not redundant |
| PrestaShop / WooCommerce `sourcePaymentMethod` reporting | **PARTIAL (extend)** | set today only by `AllegroOrderSourceAdapter`; the two shop adapters do not set it (plan step 3/4) |

## Backward-compatibility findings

### Critical
None.

### Warnings

1. **`libs/core/src/orders/types.ts` must not receive the value functions.**
   Plan step 1 says to export the new module "from `orders/index.ts` and `orders/types.ts`".
   `types.ts` is the cycle-breaker seam: its own header allows only dependency-free
   leaves with a concrete in-context consumer that cannot use the main barrel, and
   `check-types-sub-barrels.mjs` bounds it. The map reader/resolver are consumed only
   by the two integration packages and `apps/api`, all of which use the main barrel,
   so **export from `index.ts` only** (a type-only `PaymentMethodMap` type, if any
   consumer needs it, is the most `types.ts` should get). A value export there would
   turn an erased edge into a real one.
2. **Persistence of `sourcePaymentMethod` changes what lands in `order_records.orderSnapshot`.**
   Additive jsonb key, no migration, present-only so existing rows are untouched, and
   not PII (a technical gateway id), so it belongs outside the PII gate like
   `paymentMethod`. Worth one explicit spec asserting the key is absent (not
   `undefined`) when the source reports none, matching the `paymentMethod` spec.
3. **Side effect on the #3474 destination mapping.** Once PrestaShop and WooCommerce
   sources report `sourcePaymentMethod`, `PrestashopOrderProcessorManagerAdapter.resolvePaymentMethodLabel`
   (`prestashop-order-processor-manager.adapter.ts` ~L1467) starts looking up a
   mapping for their orders. That path never throws and falls back to the default
   label, and an operator can now also author Payments-tab rows that match - an
   improvement, but a behaviour change worth a line in the PR description.
4. **Existing config-shape validators are permissive, so the new key will not be
   rejected there** (`prestashop-` / `woocommerce-connection-config-shape-validator.adapter.ts`
   both run `whitelist: false, forbidNonWhitelisted: false`). Validation therefore
   has exactly one home, `ConnectionService`, as the plan states. Confirm by spec
   that a map with an invalid value is refused on **both** `create` and `update`
   (the neighbouring `validateStockAndPricingConfig` is wired at both call sites,
   `connection.service.ts` ~L842 and ~L1122).
5. **`check:invariants` exposure is low but not zero.** `apps/api` -> `@openlinker/core/orders`
   barrel and `@openlinker/core/integrations` token imports are allowed shapes; the
   new core service interface/port files follow `*.service.interface.ts` /
   `*.capability.ts`. The two new core symbols must not match a deny pattern
   (`*RepositoryPort`, `*OrmEntity`, `*Adapter`, `*Dto`) when exported - none does.

## Open questions

1. **Index support for the discovery query.** The grouping is
   `GROUP BY lower(trim("orderSnapshot"->>'sourcePaymentMethod'))` filtered by
   `"sourceConnectionId"` and a placement window. `@Index(['sourceConnectionId'])`
   serves the connection filter, and the window narrows from there, so no new index
   is required at this persona's volume. The plan's int-spec should still record the
   row count it was proven at; if a connection ever holds millions of orders, the
   query is a jsonb scan of that connection's rows only (bounded by the filter),
   not of the table.
2. **Plan §3.5 vs repository port naming.** The repository method is added to
   `OrderRecordRepositoryPort`; ensure the new row type (`ObservedSourcePaymentMethod`)
   lives in `domain/types/` and not on the port file, per the types-in-separate-files rule.

## Recommendation

Proceed to implementation. Fold Warning 1 into step 1 as a one-line correction
(export from `index.ts` only) before writing code.

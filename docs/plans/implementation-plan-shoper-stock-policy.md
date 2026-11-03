# Implementation plan - Shoper stock double-deduction policy (#3695)

Sub-issue of epic #3642. Stacked on #3698 (idempotency).

## 1. Goal, layer, non-goals
Integration layer + docs. Decide, document, ENFORCE and PROVE that OpenLinker never removes stock a second time for units a Shoper order already removed.
Non-goals: changing the reservation ledger or ATP (core, ADR-061); cancelling a Shoper order from OL (no capability yet); an ADR (the decision is local to this adapter and follows an existing principle: the master is authoritative for its own stock).

## 2. Research findings
- Shoper decrements stock when a line is created (`shopping_update_stock_on_buy`, SPIKE-3638 O6; this epic re-verified: 74 -> 72 for a qty-2 line, back to 74 after `DELETE`). `GET /application-config` already returns the flag (we read that endpoint for `warehouses_enabled`).
- **OL has exactly one code path that writes stock to an InventoryMaster: `adjustInventory`, whose only production caller is return restocking (`ReturnCustodyService`).** It is a positive correction for returned goods. The inventory sync (`master.inventory.*`) is read-only. Nothing in OL decrements a master for a sale, and the closed `InventoryAdjustment.reason` union (`return_restock | manual_correction`) has no sale reason, so core cannot even express one. The double decrement the issue fears is therefore avoided structurally; the work here is to make that an enforced, tested invariant and to define the flag-off case.
- Stock read-back is self-consistent: after `createOrder` Shoper's stock is already lower, `master.inventory.syncByExternalId` mirrors that number and propagation publishes it as an ABSOLUTE quantity - no delta, so nothing is applied twice.
- **Out of scope, stated for completeness:** the advisory reservation ledger (ADR-061) is a separate mechanism that subtracts `published` holds from available-to-promise. ADR-061 decision 1 already designs out the double subtraction of an earlier wave by stamping `atpEffect` at creation (`published` only for orders OL itself executes), and on the default `omp_fulfilled` topology holds are `diagnostic` and subtract nothing. This slice neither relies on nor changes it.

## 3. Design
1. **Policy (README):** Shoper is authoritative for its own decrement. OpenLinker never writes stock to Shoper on account of an order it created there, never compensates, and the only stock write it makes is a return restock (a positive correction).
2. **Flag awareness:** `ShoperShopContextProvider` also reads `shopping_update_stock_on_buy` into `ShoperMapContext.decrementsStockOnOrder` (cache entries without the field are refetched, as for `warehousesEnabled`). Missing/unrecognised value reads as ON (the documented default), because assuming OFF would make us claim a behaviour we did not observe.
3. **Flag OFF behaviour (proposed):** `createOrder` still creates the order and does NOT compensate with a stock write - the owner chose not to auto-decrement and may run an ERP/WMS that does it, so an OL write would be the very double deduction. It logs a warning per order naming the config key, and the README states that stock stays unchanged until the shop decrements it.
4. **Enforcement in code:** `createOrder` is allowed to touch only `/users`, `/orders`, `/order-products`, `/shippings`, `/currencies`, `/taxes`; a spec asserts it never issues a `PUT` nor any `/product-stocks` request. `ShoperInventoryMasterAdapter.adjustInventory` keeps its read-modify-write unchanged.
5. **Proof (integration-style spec, no Docker):** one stateful fake shop that emulates Shoper's decrement on `POST /order-products`, restore on `DELETE /orders`, wired to the REAL `ShoperOrderProcessorAdapter` and `ShoperInventoryMasterAdapter`: create qty 2 -> stock exactly -2 and `listInventory` agrees; a retry (lost mapping) -> still -2; failed line -> rollback -> stock restored; flag off -> stock unchanged and a warning. Plus the live smoke on the trial shop.

## 4. Steps (files)
1. `shoper-config`/`shoper-api.types.ts`: `shopping_update_stock_on_buy` on `ShoperApplicationConfig`; `shoper-product.mapper.ts` `ShoperMapContext.decrementsStockOnOrder`.
2. `shoper-shop-context.provider.ts` (+spec): read it, cache validation.
3. `shoper-order-processor.adapter.ts` (+spec): read the flag, warn when OFF; "no stock write" guard.
4. `infrastructure/adapters/__tests__/shoper-stock-policy.spec.ts`: the stateful end-to-end spec.
5. README (policy, flag-off, reservation-ledger note); smoke on the trial shop.

## 5. Open questions
Q1 Flag OFF: proceed + warn (proposed) or refuse the order? Refusing protects against overselling but blocks a merchant who deliberately keeps stock elsewhere.
Q2 The ADR-061 reservation interaction stays documented-only (core, all masters). OK?
Q3 Smoke needs ONE temporary flip of `shopping_update_stock_on_buy` on the trial shop to prove the OFF case live. It is a shop setting, not just data: OK to change it and restore it, or skip the live OFF proof?

# Implementation Plan — PrestaShop order create via `validateOrder` (OL-module endpoint)

**Trigger issue:** #898 · **Decision:** [ADR-016](../architecture/adrs/016-prestashop-order-create-via-validateorder.md) (Proposed)
**Branch:** `898-prestashop-cart-delivery-option` (rename to `898-ps-order-create-validateorder` if pivoting the PR)
**Layer:** Integration (PrestaShop) — OL PrestaShop **module** (PHP) + order-processor **adapter** (TS). No CORE/port change; no DB migration.

> Supersedes the prior field-patch approach for #898. The spike record (cheapest-available carrier re-resolution + the post-create-PUT field set) is summarized in [ADR-016](../architecture/adrs/016-prestashop-order-create-via-validateorder.md) § Context/Alternatives and the `reference_prestashop_ws_carrier_cheapest_available` memory. Rationale: see ADR-016.

---

## 1. Goal & scope

Make OL-created PrestaShop orders go through `PaymentModule::validateOrder`, so carrier, shipping (module-priced), totals, state, stock and invoice are correct by construction — replacing the raw webservice `POST /api/orders` insert that bypasses the order flow (root cause of #898 + the #503/#467/#513 cluster).

**In scope:** OL PS module `importorder` front controller; `installDynamicCarrier` group-availability fix; adapter switch from `POST /orders` to the endpoint + cart `delivery_option`; the webservice/HMAC client method; tests; doc/comment correction.
**Out of scope / unchanged:** #895 `specific_prices` line pinning and #516 sidecar (both feed `validateOrder` — keep). Customer/address provisioning (#505). CORE order model.

## 2. Design

**Order-create flow (new) — fully verified end-to-end on PS 9.1.3:**
1. Adapter (WS, as today): resolve/provision customer + addresses; create the cart with products, currency, lang, `id_carrier = resolved carrier`.
2. Adapter: write the OL sidecar (`writeCartShipping`, #516) so the OL Dynamic carrier prices during `getDeliveryOptionList`.
3. Adapter: pin line prices via cart-scoped `specific_prices` (#895).
4. Adapter: `POST` to the `importorder` endpoint (HMAC-signed) with `{ id_cart, id_order_state, amount_paid, payment_method, order_reference, id_carrier, id_address_delivery }`.
5. Module controller: `$cart->setDeliveryOption([idAddr => "$carrierId,"])` + save (PS stores it as JSON), then `Module::getInstanceByName('ps_checkpayment')->validateOrder(id_cart, stateId, amountPaid, …)` → returns `id_order`; respond `{ ok, id_order, reference }`.
6. Adapter: map `id_order` to the internal order id. **No post-create patching.**

**Verified outcome:** order lands `id_carrier = OL Dynamic`, `total_shipping = 10.95` (sidecar), `total_paid = 510.94`, state = **Payment accepted**.

**The verified recipe — all required together (see ADR-016 § Verified recipe):**
- **(a) Carrier surfacing:** the OL Dynamic carrier must be `need_range=1` + catch-all `ps_range_price` (0→∞) + `ps_delivery` rows per zone + **all customer groups** + zones. `getCarriersForOrder` gathers via `(is_module=0 OR need_range=1)`; a `need_range=0` carrier never appears. Module still prices via `getOrderShippingCostExternal`.
- **(b) Delivery-option format:** PS 9 `getDeliveryOption` parses `cart.delivery_option` with **`json_decode`**. It MUST be JSON `{"<idAddr>":"<carrier>,"}` — a PHP-serialized value is silently dropped → cheapest (free) carrier auto-selected. Setting it server-side via `$cart->setDeliveryOption([...])` produces the correct format and avoids OL hand-formatting.
- **(c) Pricing/total:** sidecar (#516) → carrier price; `specific_prices` (#895) → line prices; cart total then equals `amount_paid` → no Payment-error (`PaymentModule.php:326-332`).

## 2b. Review-driven decisions (ADR-016 tech-review, 2026-05-30)

- **Carrier migration is row-preserving.** The upgrade hook (`upgrade/upgrade-X.Y.Z.php`) mutates the *existing* `ps_carrier` row via direct SQL (`UPDATE … SET need_range=1` + INSERT range/delivery/group rows) — **never** `Carrier::save()`, which PS duplicates into a new `id_carrier` and would strand `OPENLINKER_DYNAMIC_CARRIER_ID` + historical orders (the reason `hookActionCarrierUpdate` exists). Fresh installs get the full recipe in `installDynamicCarrier`.
- **Email side-effects: suppressed by default — RESOLVED + implemented.** Mechanism: the module implements `hookActionEmailSendBefore` returning `false` (PS core cancels the send on any module's `false` — `Mail.php` array_reduce, source-verified), gated by a request-scoped static (`OpenLinker::$suppressImportMail`) the `importorder` controller sets around `validateOrder`, itself gated by `OPENLINKER_IMPORT_SEND_MAIL` (default `0` = suppress). Install + 1.2.0 upgrade register the hook + seed the config. Verified live: import order created with `ps_mail` 0→0. Controller `validateOrder` call shape is now final.
- **Authoritative total via `$dont_touch_amount=true`.** Pass it so PS accepts OL's `amount_paid` without re-rounding; combined with sidecar + `specific_prices` the cart total matches. Add a precision/rounding test (tax-inclusive, rounding-sensitive amount) to guard the `PS_OS_ERROR` boundary (`PaymentModule.php:326-332`).
- **Idempotency: adapter-reference dedup is authoritative.** The controller's `Order::getIdByCartId` guard only catches same-cart retries; a job retry rebuilds the cart (new `id_cart`) so the adapter's existing duplicate-`reference` recovery is the real guard. On endpoint failure after cart build, the adapter cleans the cart-scoped `specific_prices` (ADR-014 cleanup path) + orphan cart.
- **Module PHPUnit — scoped to PS-global-free classes; controller/module are int-spec-covered.** The module's `phpunit.xml` bootstraps `vendor/autoload.php` only (no PrestaShop kernel), and its suite covers PS-global-free `classes/` (`HmacRequestVerifier`, `EventIdGenerator`). `installDynamicCarrier`, `upgradeDynamicCarrierForValidateOrder`, and the `importorder` controller all depend on PS core classes (`Carrier`, `Db`, `Cart`, `Order`, `PaymentModule`, `Configuration`) that can't be loaded without booting PS, so they are **deliberately covered by the real-module int-spec** (ADR-016 explicitly accepts "more logic in the PHP module … covered by the PS-Testcontainer int-spec"), not by pure PHPUnit. Adding a PS bootstrap to PHPUnit is a separate harness investment, out of scope here.
- **`id_order_state` constrained + payment module configurable.** Controller validates `id_order_state` is a loadable `OrderState`; the delegate payment module name is a constant today (`ps_checkpayment`) with a clear 422 + operator log when absent (consider config later).
- **9.0.2 re-confirm is front-loaded** (the json_decode `delivery_option` + `getCarriers` semantics are version-sensitive) — run it right after Steps 1–2, not at the final gate.
- **Docs:** also correct `architecture-overview.md` § Order Synchronization Flow (still shows WS `createOrder`).

## 3. Steps

**Step 1 — Module: rework the OL Dynamic carrier into a surfacing carrier module.** `apps/prestashop-module/openlinker/openlinker.php` `installDynamicCarrier()`: set **`need_range=1`** (currently 0); after `$carrier->add()` create a catch-all `ps_range_price` (0→∞) + `ps_delivery` rows for every active zone (price 0 — module overrides) and `$carrier->setGroups(all group ids)`. Add a module **upgrade hook** to apply the same to the existing carrier row on installs that already have the `need_range=0` carrier. *AC:* a fresh install (and an upgrade) yields a carrier that appears in `getCarriersForOrder`. *(Group fix already applied; range + need_range still to add.)*

**Step 2 — Module: `importorder` front controller.** `controllers/front/importorder.php` mirroring `cartshipping.php` (HMAC, `$ajax=true`, JSON). Loads the cart, **`$cart->setDeliveryOption([idAddr => "$carrierId,"])` + save** (writes the correct JSON format), then `ps_checkpayment->validateOrder(...)`, returns `id_order`. Idempotent guard via **`Order::getIdByCartId`** (not `getOrderByCartId` — doesn't exist). *(Controller written + working; the `setDeliveryOption` step still to add; temp debug branch removed.)*

**Step 3 — Adapter: pass carrier + address to the endpoint (no cart-side `delivery_option`).** The controller owns `delivery_option` now, so the mapper does **not** hand-format it. `mapCartCreate` keeps `id_carrier`; the adapter passes `id_carrier` + `id_address_delivery` to `importOrder`.

**Step 4 — Adapter: switch create path.** `prestashop-order-processor-manager.adapter.ts` `createOrder`: after cart + sidecar + `pinLinePrices`, call `openlinkerModuleClient.importOrder({...})` instead of `httpClient.createResource('orders', …)`. Keep the duplicate-reference recovery (now keyed off the endpoint's idempotent response). Correct the stale `#503`/`#516` comments.

**Step 5 — Client: `importOrder` method.** Extend the OL module client (the one that owns `writeCartShipping`) with an HMAC-signed `importOrder` POST + typed response. No `any`.

**Step 6 — Tests.**
- Adapter unit (`*.spec.ts`, CI-visible): assert `createOrder` builds the cart with `delivery_option` + calls `importOrder` with the right `{id_cart, amount_paid, stateId, …}`; assert fail-loud on endpoint error; assert idempotent re-entry.
- Integration (`allegro-prestashop-carrier-mapping.int-spec.ts`, real-module S-path, #716-gated): **seed a free `is_free=1` carrier available to the customer group** (so the bug reproduces), then assert the created order's `id_carrier == OL Dynamic`, `total_shipping == sidecar amount`, `current_state` ≠ Payment-error. Add a mapped-static-carrier case.
- Module: covered via the int-spec (PHP unit tests are out of band); the controller's HMAC + validateOrder happy/ひerror paths exercised end-to-end.

**Step 7 — Docs.** Update `architecture-overview.md` § Order Synchronization Flow + `testing-guide.md` §"When to use it" (drop the "#503 cart id_carrier" framing) to the validateOrder model. Flip ADR-016 → Accepted on merge.

**Step 8 — Quality gate.** `pnpm lint && pnpm type-check && pnpm test`; carrier int-spec locally on **pinned PS 9.0.2** (Docker). Per memory, full `pnpm test:integration` if any manifest/capability surface shifts (not expected).

## 4. Risks / open questions

- **R1 — `validateOrder` via `ps_checkpayment` — RESOLVED.** Verified working end-to-end; `ps_checkpayment` is a PS default and records payment sensibly. Confirm presence in target shops at runtime (fall back to a clear error if absent).
- **R2 — email side-effects — RESOLVED.** Suppressed by default via `hookActionEmailSendBefore` + request-scoped flag, config-gated (`OPENLINKER_IMPORT_SEND_MAIL`). Implemented + verified (`ps_mail` 0→0 on import). See §2b.
- **R3 — `delivery_option` format — RESOLVED.** PS 9 uses `json_decode`; PHP-serialized is silently dropped. Controller sets it via `setDeliveryOption` server-side (correct format, no OL hand-formatting).
- **R4 — carrier reconfiguration / migration.** The OL Dynamic carrier changes `need_range=0 → 1` + gains range/delivery/group rows. Existing installs need an upgrade hook (Step 1). Confirm this doesn't regress the legacy WS path while both coexist during rollout.
- **R5 — version drift.** Verified on 9.1.3; `validateOrder`/`getDeliveryOption`/`getCarriersForOrder` are long-standing core — re-confirm the full flow on pinned 9.0.2 (Step 8).
- **R6 — blast radius.** Changes order-create for *all* PS orders. Mapped-static-carrier case in Step 6 guards the general path.
- **R7 — module install/upgrade in CI (#716).** The real-module int-spec is CI-gated; adapter unit tests carry the CI-visible contract.

## 5. Validate

**Architecture & boundaries**
- Change confined to `libs/integrations/prestashop` (adapter, mapper, module client) + `apps/prestashop-module` (PHP). **No `libs/core` change** — the `OrderProcessorManagerPort.createOrder(OrderCreate)` contract is unchanged; `OrderCreate` already carries shipping method, totals, addresses, and status. CORE orchestration (`OrderIngestionService`, `OrderSyncService`) is untouched. No CORE↔Integration boundary crossing added; dependency direction intact.
- No new port, DTO, ORM entity, or **migration** (the `ps_carrier_group` rows are written by the PHP module's install hook, not a TypeORM migration).

**Naming & standards**
- New controller `controllers/front/importorder.php` → `OpenLinkerImportOrderModuleFrontController` (matches `cartshipping.php`'s `OpenLinkerCartShippingModuleFrontController`). Adapter helper `importOrder(...)` on the existing OL module client. TS: no `any`, explicit return types, file headers preserved; PHP mirrors the module's existing controller conventions.

**Testing strategy**
- CI-visible adapter unit (`*.spec.ts`): cart built with `delivery_option`; `importOrder` called with `{id_cart, amount_paid, stateId, …}`; fail-loud on endpoint error; idempotent re-entry.
- Real-module int-spec (`*.int-spec.ts`, #716-gated): **seeds a free `is_free=1` carrier available to the customer group** so the bug reproduces; asserts persisted `id_carrier` + `total_shipping` + non-error state for both OL Dynamic and a mapped static carrier. Run on **pinned PS 9.0.2**.

**Security**
- New endpoint reuses the module's HMAC-SHA256 (`timestamp + "." + rawBody`, `OPENLINKER_WEBHOOK_SECRET`, constant-time) — same posture as `cartshipping.php`. `validateOrder` inputs (`id_cart`, `amount_paid`, `secure_key`) are validated server-side; `amount_paid` is the OL-supplied buyer total (authoritative), not client-recomputed. No secrets in TS/responses.

**Error handling**
- Fail-loud (`PrestashopProvisioningException`) on endpoint failure, consistent with `createOrder` / sidecar / `pinLinePrices`; idempotent on retry (endpoint returns the existing order for an already-validated cart).

## 6. Implementation status & review follow-ups (2026-05-30)

All ADR-016 tech-review findings applied:

- **Adapter unit spec reworked (BLOCKING) — done.** `prestashop-order-processor-manager.adapter.spec.ts` now asserts the `importOrder` flow (no `mapOrderCreate`/`createResource('orders')`); carrier-resolution tests assert `mapCartCreate` carrier arg; added 7 tests (importOrder args, reference-reuse, Step-0 reuse, importOrder failure → `PrestashopApiException`, `alreadyExisted`, reconciliation-drift warn, orderNumber-absent warn). **343/343** prestashop unit tests pass; package lint + type-check clean.
- **`amountPaid` ↔ cart-total reconciliation (IMPORTANT) — done.** `createOrder` logs a `warn` when `subtotal + shipping ≠ total` (catches an order-level discount not represented in the rebuilt cart, which would re-raise the `PS_OS_ERROR` banner). The S-4 int-spec asserts `total_paid == total_paid_real` on a real order.
- **Free-carrier int-spec regression (IMPORTANT) — added.** `allegro-prestashop-carrier-mapping.int-spec.ts` **S-4** enables a free `is_free=1` "Click and collect" carrier (new `enableFreePickupCarrier` helper) available to the order's group + zone, then asserts the order keeps `id_carrier == OL Dynamic` (not the free carrier), `total_shipping == 12.50`, `current_state != 8`. Enabled inside the test body so it can't perturb S-1..S-3. **Docker-gated + #716-gated off in CI — NOT run in this session; must be executed on pinned PS 9.0.2 before merge** (same gate S-3 already lives under).
- **`orderNumber`-absent dedup gap (IMPORTANT) — guarded.** When `order.orderNumber` is absent the reference dedup net is disabled and `validateOrder` would mint its own reference; `createOrder` now logs a loud `warn` (Step-0 identifier-mapping remains the primary idempotency guard). Source orders always carry an `orderNumber`, so this is a should-not-happen guard.
- **Stale `need_range=0` comment (IMPORTANT) — fixed** in `openlinker.php` `getOrderShippingCost`. File-header `@version` bumped to 1.2.0.
- **Security section added to ADR-016 (SUGGESTION) — done:** documents the higher-impact-than-cartshipping auth model (HMAC creates orders from any cart; no cart-ownership check; secret is the trust boundary), the non-atomic three-layer idempotency (concurrency deferred, matches the pre-ADR-016 WS path), and request-scoped/coarse mail suppression.
- **Mail-suppression breadth (SUGGESTION) — documented** on the hook + `OPENLINKER_IMPORT_SEND_MAIL` config key (cancels all mail in the narrow `validateOrder` window; template-name matching rejected as version-fragile).
- **`paymentMethod` JSDoc (SUGGESTION) — aligned** (`'Check payment'` to match the `ps_checkpayment` delegate; controller default `'OpenLinker'`).

**Out-of-scope harness fix (call out in the PR):** `apps/api/test/jest-integration.cjs` gained the missing `@openlinker/integrations-inpost` source mapping. This is a **pre-existing** gap unrelated to #898 — the inpost plugin was wired into `apps/api/src/plugins.ts` without the matching integration-jest `moduleNameMapper` entry, so *no* integration test could load the app module in a worktree (CI masks it by building `dist` first). It's bundled here because it blocks running the #898 int-spec; flag it explicitly in the PR description. Follow-up: the mapper is a hand-maintained list that silently drifts per new plugin — worth a guard/derivation issue so the next plugin doesn't reintroduce this.

**Remaining before merge:** rebase onto current `origin/main` and reconcile with #906 destination-order-idempotency (`order-sync.service.ts`, `order-create-lock.ts` removal) — confirm `findExistingOrderByReference` + Step-0 dedup don't conflict with #906's mechanism; re-run the Docker int-spec suite (S-1..S-4) on **pinned PS 9.0.2**; flip ADR-016 → Accepted; commit (`git commit -s`).

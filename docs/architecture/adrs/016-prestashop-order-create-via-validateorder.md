# ADR-016: Create PrestaShop orders through `validateOrder`, not the raw webservice

- **Status**: Proposed (approach empirically verified end-to-end on PS 9.1.3, 2026-05-30)
- **Date**: 2026-05-30
- **Authors**: @piotrswierzy

## Context

OpenLinker creates destination orders in PrestaShop via the webservice `POST /api/orders` — a raw `ObjectModel` insert that **bypasses `PaymentModule::validateOrder`**, PrestaShop's canonical order-creation flow. Empirically (live PS 9.1.3 spike, #898): the WS insert does not honor the posted/cart carrier — PS re-resolves to the cheapest *available* delivery option, so a shop with a free "Click and collect" carrier lands every Allegro order on it with `total_shipping=0`, the wrong carrier, and a Payment-error state.

This is not one bug. The WS-bypass is the **common root** of a cluster each previously patched in isolation: #503 (cart `id_carrier`), #505 (guest customer group), #467 (zone-zero shipping), #513 (shipping recompute → OL Dynamic carrier + sidecar), #895 (catalog vs marketplace line price → `specific_prices`), #898 (carrier + shipping loss). Each workaround re-derives, per concern, behaviour that `validateOrder` already does correctly: it reads the cart's `delivery_option` to assign the carrier (`PaymentModule.php:288-291`), prices module carriers via their shipping hook, computes totals, and sets Payment-error only on a genuine cart-total ≠ amount-paid mismatch (`:326-332`).

## Decision

Create PrestaShop orders by invoking `PaymentModule::validateOrder` **server-side inside the OpenLinker PrestaShop module**, exposed as an HMAC-authed front controller (mirroring `cartshipping.php`). The OL adapter builds the cart over the WS as today (customer, addresses, products, `specific_prices`, sidecar) **plus the cart's `delivery_option`**, then calls the new endpoint instead of `POST /api/orders`. The endpoint calls `Module::getInstanceByName('ps_checkpayment')->validateOrder($id_cart, $stateId, $amountPaid, …)` — `ps_checkpayment` is already the payment module OL records, so the order's payment provenance is unchanged.

**No CORE impact.** The change is confined to the PrestaShop integration (`libs/integrations/prestashop` adapter + mapper + module client) and the `apps/prestashop-module` PHP package. The `OrderProcessorManagerPort.createOrder(OrderCreate)` contract is unchanged — `OrderCreate` already carries everything the new path needs (shipping method, totals, addresses, status). CORE order orchestration (`OrderIngestionService`, `OrderSyncService`) calls the same port method and is untouched; no port, DTO, entity, or migration change in `libs/core`.

## Alternatives considered

- **Raw WS `POST /orders` + post-create field PUTs** (the #898 Step-A patch): proven to work but writes `ps_orders` / `ps_order_carrier` fields directly, bypassing the order flow — contradicts the codebase's own #858 precedent (which refuses raw `current_state` writes for `order_histories`). Rejected: adds to the workaround pile rather than removing its cause.
- **WS-only with cart `delivery_option`**: disproven — `POST /orders` ignores `delivery_option` because it never runs `validateOrder`.
- **Re-implement `validateOrder`'s logic in the adapter / module**: rejected — duplicates ~800 lines of PS core that changes across versions.
- **OL module extends `PaymentModule` instead of `CarrierModule`**: rejected for now — `getInstanceByName('ps_checkpayment')` avoids touching the module's base class and the OL Dynamic carrier's `CarrierModule` contract.
- **Map to a real merchant carrier (#455/#516) + `$dont_touch_amount`, no OL Dynamic carrier**: real carriers surface natively, so this works for the *mapped* case and avoids the carrier rework + migration. Rejected as the sole approach because it cannot reproduce the *exact* marketplace shipping amount (PS prices from the carrier's own ranges), reintroducing the total mismatch. Retained as a per-merchant mapping choice layered on the same `validateOrder` flow — the OL Dynamic carrier remains the mechanism for exact OL-controlled shipping.

`validateOrder` is called with `$dont_touch_amount=true` so OL's authoritative `amount_paid` is honored without PS re-rounding (sidecar + `specific_prices` make the cart total match).

## Consequences

**Pros:**
- Carrier, shipping (module-priced), totals, order state, stock, and invoice are correct **by construction** — through the flow PS intends.
- Retires/obviates the #503/#467/#513/#898 carrier workarounds; #895 `specific_prices` and #516 sidecar **remain** (they feed `validateOrder`).
- One order-create seam, version-resilient.
- **Corrects a latent payment-data bug.** The raw-WS `mapOrderCreate` hard-coded `total_paid_real = total` on *every* imported order ("same as total_paid for new orders"), so even an unpaid/`pending` order showed as fully paid. `validateOrder` derives `total_paid_real` from the order-state's `paid` flag and records an `OrderPayment` only for a paid state — so a paid marketplace order (Allegro `payment.finishedAt` set → OL `'processing'` → PS state 2 "Payment accepted") lands with `total_paid_real == amount_paid`, while a genuinely unpaid order lands at `0`. **Implication:** the status→state mapping must resolve paid marketplace orders to a *paid* PS state for `total_paid_real` to reflect reality — the existing `mapStatusToPrestashopStateId` already does this (`'processing' → 2`). `$dont_touch_amount=true` keeps OL's `amount_paid` authoritative (no PS re-round) on top of that. **Dependency:** `mapStatusToPrestashopStateId` assumes the default PrestaShop order-state catalogue (ids 1/2/4/5/6/7); on a shop that renamed/reordered its states, `'processing' → 2` may not be a *paid* state and `total_paid_real` would land at `0`. The old WS path masked this by force-setting the field; the `validateOrder` path makes payment-recording correctness depend on a faithful mapping. Per-connection state-mapping overrides are tracked in **#862** — that resolution-chain follow-up is the proper fix; do **not** re-introduce an explicit `addOrderPayment`/field-write to paper over it (that's the raw-WS anti-pattern this ADR removes).

**Cons / trade-offs:**
- The OL Dynamic carrier must be reworked into a checkout-surfacing carrier module (`need_range=1` + range + delivery rows + groups) — today it ships `need_range=0` with no groups/ranges, which is exactly why it never appears in `validateOrder`'s carrier list. See **Verified recipe** below.
- More logic moves into the PHP module (harder to unit-test than TS); covered by the PS-Testcontainer int-spec.
- Changes the core order-create mechanism — a coordinated module + adapter migration.
- **The OL PrestaShop module is now a hard prerequisite for destination order creation.** The raw WS `POST /orders` path needed nothing installed in PrestaShop; the `importorder` endpoint only exists when the module is installed (and the OL backend must resolve the shared webhook secret to sign the call). Operationally: a PrestaShop connection cannot receive orders until its module is installed + configured. For tests this means every int-spec that *creates* a PS order (carrier-mapping, fulfillment-update) is now gated behind the module install — which is itself gated off in CI by the #716 module-install-on-Linux flake — so those specs are skipped in CI and run locally / once #716 lands. The smoke spec stays module-free (it never creates an order).

**Migration path:**
- Ship the `importorder` controller + the carrier-config rework; switch the adapter behind it; keep cart build + sidecar + `specific_prices`; remove the WS `POST /orders` create + carrier-on-cart reliance. Validate on pinned PS 9.0.2.
- **Existing installs**: the OL Dynamic carrier must be *reconfigured* on module upgrade (it ships today as `need_range=0`, no groups, no ranges). The upgrade hook must apply the verified recipe below to the existing carrier row.

## Security

- **Auth model**: the `importorder` controller is a public front controller authenticated solely by the inbound HMAC contract (`timestamp + "." + rawBody`, SHA-256, constant-time, ±5 min replay window) — the same `HmacRequestVerifier` the `cartshipping` endpoint uses, keyed on the per-connection `OPENLINKER_WEBHOOK_SECRET`. It is **higher-impact** than `cartshipping`: a valid signature lets the caller turn *any* existing cart id into a real order (with stock decrement, invoice, emails). There is intentionally no "this cart belongs to OL" check — cart provenance isn't tracked PS-side, and the secret is the trust boundary. Acceptable given the secret never leaves OL's encrypted credential store and the same secret already gates the sidecar write; if cart-ownership tagging is ever added it can tighten this. Input is validated and every id is `(int)`-cast before use, so there is no SQL-injection surface.
- **Idempotency / concurrency**: order create is guarded at three adapter/endpoint layers — Step 0 identifier-mapping lookup (adapter), `findExistingOrderByReference` (adapter, the retry net since each retry rebuilds the cart with a new `id_cart`), and `Order::getIdByCartId` (endpoint, same-cart re-entry). The **multi-worker race** (two workers — e.g. a webhook job and a poll job — converging on the same order, since `sync-job.runner` locks per-job not per-order) is closed *above* the adapter by **#911**: `OrderSyncService.createOrderIdempotently` wraps every `adapter.createOrder` in a per-`(internalOrderId, destinationConnectionId)` `SyncLockPort` lock and re-reads the destination mapping after acquiring — if a peer already created the order it skips and synthesizes the ref. The adapter's three layers are the in-call / retry-after-partial-failure net and the lock's beyond-TTL fallback. Net: with #911 the concurrency gap is eliminated, not merely mitigated; the reference-based dedup here replaces the old WS duplicate-key recovery as that fallback.
- **Mail suppression** is request-scoped (a class static set only around the `validateOrder` call and reset on every exit path including the catch) and coarse by design (cancels all mail in that narrow window rather than matching template names). See `OPENLINKER_IMPORT_SEND_MAIL`.

## Verified recipe (empirical, PS 9.1.3 — order landed carrier=OL-Dynamic, shipping=sidecar, state=Payment accepted)

All three are required together; missing any one silently falls back to the cheapest (free) carrier:

1. **OL Dynamic carrier as a first-class PS carrier module** — `need_range=1` (NOT 0; `getCarriersForOrder` gathers via `(is_module=0 OR need_range=1)`) + a catch-all `ps_range_price` (0→∞) + `ps_delivery` rows per active zone (price `0` — ignored; the module overrides) + **all customer groups** (`setGroups`) + zones. Pricing stays via `getOrderShippingCostExternal` (sidecar).
2. **Cart `delivery_option` written as JSON** `{"<idAddrDelivery>":"<idCarrier>,"}` — PS 9 `Cart::getDeliveryOption` parses it with **`json_decode`**, not PHP `unserialize`; a serialized `a:1:{…}` value is silently dropped. Best implemented by the controller calling `$cart->setDeliveryOption([idAddr => "$carrierId,"])` server-side so OL never hand-formats it.
3. **`validateOrder`** via the `importorder` controller (`ps_checkpayment->validateOrder(...)`), with the sidecar (#516) + `specific_prices` (#895) already on the cart.

## References

- Related issues: #898 (trigger), #503, #505, #467, #513, #895
- Related ADRs: [ADR-014](./014-source-authoritative-order-pricing.md) (complementary — line pricing)
- Primary doc section: [docs/architecture-overview.md](../../architecture-overview.md) § Order Synchronization Flow

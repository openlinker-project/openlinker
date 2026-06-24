# Implementation Plan: Erli order → IncomingOrder mapper (#994)

**Date**: 2026-06-16
**Status**: Ready for Review
**Estimated Effort**: ~0.5–1 day (mapper + wire types + unit tests; no production wiring)
**Branch**: `994-erli-order-mapper` (stacked on the merged Erli offers chain; single-PR — plan ships with the implementation)

---

## 1. Task Summary

**Objective**: Map an Erli order resource into the neutral `IncomingOrder` DTO (the shape returned by `OrderSourcePort.getOrder`). Realises User story 5 of parent #978, per [ADR-025](../architecture/adrs/025-erli-marketplace-adapter.md).

**Context**: #993 will add the `ErliOrderSourceAdapter` (inbox poll + webhook trigger → `getOrder`). #994 carves out **only the pure mapping function** that `getOrder` will call, so the adapter issue can focus on transport/cursor/feed plumbing and consume a tested mapper. The mapper must:
- map line items, totals, shipping address;
- encode Erli's three-status set `pending | purchased | cancelled` onto the neutral order status, with the **COD-arrives-paid** semantic (COD orders land already `purchased`, unlike the PayU-pending flow);
- carry buyer/PII fields through **raw** — identity resolution is **deferred to #995** and happens downstream in core (`OrderIngestionService`), never in the adapter.

**Classification**: **Integration / Infrastructure** (mapper + wire types inside `libs/integrations/erli`). CORE is untouched.

---

## 2. Scope & Non-Goals

### In Scope
- New `erli-order.types.ts` — provisional (`#992-PROVISIONAL`) Erli order **wire shapes**, the single reconciliation point for the order resource (mirrors `erli-product.types.ts`).
- New `erli-order.mapper.ts` — a standalone, pure module that maps `ErliOrder` (wire) → `IncomingOrder` (neutral), including the status table and COD-paid encoding.
- Unit tests (`erli-order.mapper.spec.ts`) over **authored** fixtures (we cannot capture sandbox fixtures — #992 unavailable).
- Buyer/PII passthrough into `IncomingOrder.customerExternalId` / `customerEmail` / address fields — **raw**, no identifier mapping.

### Out of Scope (explicit non-goals)
- The `ErliOrderSourceAdapter` itself (`getOrder` / `listOrderFeed` / inbox-poll cursor / webhook trigger) — **#993**.
- Identity resolution / identifier mapping (customer + product ref → internal ids) — **#995** (done in core `OrderIngestionService`).
- Stock-restore-on-cancel PATCH — **#993** (ADR-025 §4a; needs the cancel signal the order source will observe).
- Payment-status reconciliation beyond the field passthrough; webhook routing; any `OrderProcessorManagerPort` work.
- CORE changes, new ports, DB migrations, module wiring.

### Constraints
- **No sandbox (#992 not done).** Build provisionally: field names are `#992-PROVISIONAL` and documented as such in `erli-order.types.ts`; fixtures are authored, not captured. The AC's "captured sandbox fixtures" cannot be satisfied — we author representative fixtures and flag a #992 revisit. (Same posture as the shipped offers half — `erli-product.types.ts` lines 1–22, 24, 85–113.)
- No new ESLint or type-check errors; unit tests pass.
- Naming per engineering-standards: `*.mapper.ts`, `*.types.ts`, `*.spec.ts`.

---

## 3. Architecture Mapping

**Target Layer**: Integration plugin — `libs/integrations/erli/src/infrastructure/`.

**Capabilities Involved**: `OrderSourcePort` (the mapper produces its `getOrder` return type). The mapper itself implements no port — it is a pure function the future `ErliOrderSourceAdapter` (#993) composes, exactly as `PrestashopOrderSourceAdapter` composes `PrestashopOrderMapper`.

**Existing Services Reused**:
- Neutral DTO contract `IncomingOrder` + nested types from `@openlinker/core/orders`:
  - `IncomingOrder` — `libs/core/src/orders/domain/types/incoming-order.types.ts:21-110`
  - `IncomingOrderItem` — `incoming-order.types.ts:112-145`
  - `IncomingOrderItemRef` (union) — `incoming-order.types.ts:153-157`
  - `IncomingOrderTotals` — `incoming-order.types.ts:159-172`
  - `IncomingOrderAddress` — `incoming-order.types.ts:174-185`
  - `OrderStatusValues` / `OrderStatus` — `libs/core/src/orders/domain/types/order.types.ts:20-35`
  - `PaymentStatusValues` / `PaymentStatus` — `libs/core/src/orders/domain/types/payment-status.types.ts:23-25`
- Erli config types (`ErliMoney` lives in `erli-product.types.ts:24-28`) — **see Q1**, we author a new `ErliMoney`-equivalent in `erli-order.types.ts` rather than couple order wire to product wire.

**New Components Required**:
- `libs/integrations/erli/src/infrastructure/adapters/erli-order.types.ts` (wire shapes).
- `libs/integrations/erli/src/infrastructure/adapters/erli-order.mapper.ts` (pure mapper).
- `libs/integrations/erli/src/infrastructure/adapters/__tests__/erli-order.mapper.spec.ts`.

**Core vs Integration Justification**: This is platform-specific translation from Erli's wire shape to the neutral DTO. The neutral DTO (`IncomingOrder`) already lives in CORE and is the published contract (`order-source.port.ts:57` returns `Promise<IncomingOrder>`). The mapper is, by definition, an adapter-layer concern — `incoming-order.types.ts:1-11` states the DTO "is intentionally decoupled from canonical persistence … so the plugin contract can remain stable." CORE remains unchanged; the integration consumes CORE only through the top-level `@openlinker/core/orders` barrel (engineering-standards § Import Aliases / Cross-context contract — domain entities & type aliases cross by value).

---

## 4. External / Domain Research

### External system (Erli)
- **API posture (ADR-025)**: reconciliation-first. Order ingestion uses webhooks as a low-latency *trigger* with a scheduled **inbox poll as the mandatory backstop**, converging on `OrderIngestionService.syncOrderFromSource` (ADR-025 §1, line 19). #994 is upstream of all that — it is the pure shape translation.
- **COD vs PayU semantics (issue #994 + ADR-025 §15 "Erli auto-decrements stock on purchase")**: COD orders arrive **already `purchased`** (the buyer is committed; payment is on delivery). The PayU-online flow can sit `pending` until payment settles. So unlike Allegro — where `status = payment.finishedAt ? 'processing' : 'pending'` keys off a payment timestamp (`allegro-order-source.adapter.ts:242`) — Erli supplies an **explicit** order status we map directly.
- **Stock-not-restored-on-cancel (ADR-025 §15, §4a, line 22)**: relevant to #993, not the mapper. We surface `cancelled` faithfully so #993 can trigger the restore.
- **Field names UNCONFIRMED (#992)**: the exact Erli order JSON keys (`status` value vocabulary, line-item field names, address keys, buyer keys, money shape, timestamps) are not verifiable without the sandbox. All wire-shape names are `#992-PROVISIONAL`.

### Internal patterns (mapper layout + status mapping + identity-deferral)
- **Standalone mapper vs private adapter method**: PrestaShop uses a **standalone mapper class** (`libs/integrations/prestashop/src/infrastructure/mappers/prestashop-order.mapper.ts`) injected into the adapter (`prestashop-order-source.adapter.ts:48`, delegated at `:138`). Allegro inlines mapping as private adapter logic (`allegro-order-source.adapter.ts:229-316`). **#994 has no adapter yet** (it is #993), so a standalone module is the only option that lets #994 ship + be tested independently and #993 consume it. → **standalone `erli-order.mapper.ts`** (decision in §6; justified in §7).
- **Status mapping precedents**: PrestaShop maps a status code via an explicit table (`prestashop-order.mapper.ts:92-110`, numeric id → neutral string). Erli mirrors this — an explicit `pending|purchased|cancelled → OrderStatus` table.
- **`IncomingOrder.status` is typed `string`** (`incoming-order.types.ts:35`), not the closed `OrderStatus` union — the adapter "provides the raw status" and core normalises. We still map onto valid `OrderStatusValues` members for forward-compat (matches Allegro/PrestaShop, which both emit canonical strings).
- **Identity resolution is explicitly NOT in the adapter**:
  - `incoming-order.types.ts:38-43` — `customerExternalId` "as provided by the source (external-only) … adapters MUST NOT emit internal OpenLinker IDs here."
  - `incoming-order.types.ts:119-124` — `productRef` "External-only … Adapters MUST NOT emit internal OpenLinker IDs here. Core resolves this reference to internal IDs."
  - `allegro-order-source.adapter.ts:59-61` — "Identifier mapping … happens downstream in `OrderIngestionService` … the adapter does not need the identifier-mapping port itself."
  - `allegro-order-source.adapter.ts:226-227` — "Returns an `IncomingOrder` with the raw buyer details; identifier mapping and identity resolution happen downstream."
  - Core resolution lives in `order-ingestion.service.ts:337-359` (`resolveCustomerId`). → #994 carries raw buyer fields only; **#995** consumes them downstream.
- **Wire-shape file location**: Erli's existing wire types live at `infrastructure/adapters/erli-product.types.ts` (NOT `domain/types/`, unlike Allegro's `domain/types/allegro-api.types.ts`). To match the in-package convention, `erli-order.types.ts` sits **beside it** in `infrastructure/adapters/`.
- **Test fixture style**: authored object literals typed against the wire interface — Allegro (`allegro-order-source.adapter.spec.ts:250-278`), PrestaShop (`prestashop-order.mapper.spec.ts:22-43`). We follow this (we cannot capture sandbox JSON).
- **`IErliHttpClient.get<T>` signature** (`erli-http-client.interface.ts:19`) — confirms #993's `getOrder` will `get<ErliOrder>(path)` then call the mapper; out of scope here, noted for the consumer seam.

---

## 5. Questions & Assumptions

### Open Questions (all `#992-PROVISIONAL`, to reconcile at the sandbox spike)
- **Q1 — `ErliMoney` reuse.** `erli-product.types.ts:24-28` already defines `ErliMoney { amount: number; currency: string }`. Do orders express money the same way? **Assumption**: yes for the *shape*, but to avoid coupling order wire to product wire (and the offers-half's `#992` churn), `erli-order.types.ts` declares its **own** money/amount shape. If the spike confirms identical shapes, a later refactor can unify. (Cross-file `#992` coupling would otherwise force lock-step edits.)
- **Q2 — Status value vocabulary.** Issue gives `pending | purchased | cancelled`. **Assumption**: these are the literal Erli wire status strings. The status mapper accepts exactly these and falls back to `pending` for any unknown value (conservative; mirrors `prestashop-order.mapper.ts:109`).
- **Q3 — COD discriminator.** How does the wire signal "this is COD (already paid-on-commitment)" vs PayU-pending? **Assumption (documented #992-PROVISIONAL)**: Erli sends `status: 'purchased'` for committed orders (COD or settled-PayU alike) and `status: 'pending'` only for not-yet-committed PayU. The mapper therefore derives `paymentStatus` from `(status, paymentMethod)`: `purchased` + COD-method → `paymentStatus: 'cod'`; `purchased` + online → `'paid'`; `pending` → `'awaiting'`. The exact `paymentMethod` field name is provisional.
- **Q4 — Totals decomposition.** Does Erli expose subtotal/tax/shipping separately, or only a grand total? **Assumption**: provisional fields for each; where tax is not decomposed, set `tax: 0` and derive `shipping = max(0, total − subtotal)` (mirrors Allegro `allegro-order-source.adapter.ts:254-290`). `taxTreatment` left `undefined` until #992 confirms gross vs net.
- **Q5 — Line-item product reference type.** `IncomingOrderItemRef` is a discriminated union (`offer|variant|product|sku`, `incoming-order.types.ts:153-157`). The Erli offers half keys the seller resource by the **OL internal variant id** (`erli-offer-manager.adapter.ts:108,395-397`), but order line items reference what the *buyer* bought on Erli. **Assumption**: Erli line items carry the seller's product/variant external id → emit `{ type: 'variant', externalId }` (provisional; the spike confirms whether it's variant, sku, or product). `productRef.externalId` stays raw external — core resolves it (#995, see `incoming-order.types.ts:119-124`).
- **Q6 — Timestamps.** Does the Erli order carry created/updated/placed timestamps? **Assumption**: provisional `createdAt`/`updatedAt`/`placedAt` ISO-ish fields; the mapper normalises to ISO strings, and falls back to `new Date().toISOString()` for missing `createdAt`/`updatedAt` (matches Allegro `allegro-order-source.adapter.ts:242-248`, which uses ingestion time when the source carries none). `placedAt` is omitted when absent.
- **Q7 — externalOrderId source.** **Assumption**: an Erli order `id`/`orderId` field is the marketplace-native order id → `IncomingOrder.externalOrderId`. Provisional key name.

### Documentation Gaps
- No captured Erli order JSON exists (sandbox blocked by #992). The plan flags every wire field `#992-PROVISIONAL` and confines them to `erli-order.types.ts` as the single reconciliation point.
- **Stale `OrderSourcePort.getOrder` JSDoc (do NOT "fix" the mapper to match it).** `OrderSourcePort.getOrder`'s JSDoc says "Returns internal IDs where possible via IdentifierMappingService" — this is **STALE**. The authoritative rule is the field-level `IncomingOrder` doc: "adapters MUST NOT emit internal OpenLinker IDs" (`incoming-order.types.ts:38-43,119-124`), which the shipped Allegro adapter follows. The mapper emits **raw external ids only**. A reviewer of #994/#993 must NOT change the mapper to resolve ids in order to honour the stale port JSDoc — raw passthrough is correct and identity resolution stays in core (#995).

---

## 6. Proposed Implementation Plan

### Phase 1 — Provisional wire shapes (single reconciliation point)
**Goal**: One file describing the Erli order resource, every field flagged `#992-PROVISIONAL`, so the spike updates exactly one place.

1. **Create `erli-order.types.ts`**
   - **File**: `libs/integrations/erli/src/infrastructure/adapters/erli-order.types.ts`
   - **Action**: Define provisional interfaces (header mirrors `erli-product.types.ts:1-22` `PROVISIONAL (#992)` block):
     - `ErliOrderMoney { amount: number; currency: string }` (Q1).
     - `ErliOrderStatus = 'pending' | 'purchased' | 'cancelled'` (Q2) — the literal wire vocabulary, with a doc note that unknowns fall back to `pending`.
     - `ErliOrderPaymentMethod` provisional discriminator (e.g. `'cod' | 'payu' | string`) (Q3).
     - `ErliOrderLineItem { id; productExternalId; quantity; price: ErliOrderMoney; sku?; name? }` (Q5).
     - `ErliOrderAddress { firstName?; lastName?; company?; street; street2?; city; region?; postalCode; countryCode; phone? }` (maps onto `IncomingOrderAddress`).
     - `ErliOrderBuyer { id; email?; firstName?; lastName?; phone? }` — raw PII (Q-identity).
     - `ErliOrderTotals { subtotal?; tax?; shipping?; total; currency }` (Q4).
     - `ErliOrder { id; status: ErliOrderStatus; paymentMethod?: ErliOrderPaymentMethod; buyer: ErliOrderBuyer; lineItems: ErliOrderLineItem[]; totals: ErliOrderTotals; shippingAddress?: ErliOrderAddress; billingAddress?: ErliOrderAddress; createdAt?; updatedAt?; placedAt?; orderNumber? }` (Q6, Q7).
   - **Acceptance**: compiles; file header documents `#992-PROVISIONAL` status and names itself the single reconciliation point; no import of `erli-product.types.ts` (decoupled per Q1).
   - **Dependencies**: none.

### Phase 2 — The mapper
**Goal**: A pure, dependency-free function `mapErliOrderToIncomingOrder(order: ErliOrder): IncomingOrder` with the status table + COD-paid encoding + raw PII passthrough.

2. **Create `erli-order.mapper.ts`**
   - **File**: `libs/integrations/erli/src/infrastructure/adapters/erli-order.mapper.ts`
   - **Action**:
     - File header (engineering-standards § File Headers) describing purpose, the `#992-PROVISIONAL` posture, and that **identity resolution is deferred to #995 / done in core `OrderIngestionService`** (cite the same rationale as `allegro-order-source.adapter.ts:59-61,226-227`).
     - Export `mapErliOrderToIncomingOrder(order: ErliOrder): IncomingOrder` (pure; no `Logger`, no http, no DI — a standalone function or a tiny static-method object, matching the PrestaShop mapper's pure-method style). **Pick a free function** (no per-connection state needed; #993 calls it directly).
     - Internal helpers:
       - `mapStatus(status: ErliOrderStatus): OrderStatus` — explicit table (§ below), unknown → `'pending'`.
       - `derivePaymentStatus(status, paymentMethod): PaymentStatus | undefined` — COD-paid encoding (Q3): `purchased`+COD → `'cod'`; `purchased`+online → `'paid'`; `pending` → `'awaiting'`; `cancelled` → `undefined` (or `'refunded'` only if a refund signal exists — left `undefined` in v1, documented).
       - `mapLineItem(li): IncomingOrderItem` — `productRef: { type: 'variant', externalId: li.productExternalId }` (Q5), `price`, `quantity`, optional `sku`/`name`.
         - **Price unwrap (explicit)**: `IncomingOrderItem.price` is a `number` (not a money object). `ErliOrderLineItem.price` is an `ErliOrderMoney { amount; currency }`. So `mapLineItem` MUST emit `price: li.price.amount` (the numeric amount) — do **not** assign the `ErliOrderMoney` object to the numeric field. Mirrors Allegro's `Number.parseFloat(lineItem.price.amount)` (`allegro-order-source.adapter.ts:273`); Erli's `amount` is already numeric so no parse is needed.
       - `mapAddress(a?): IncomingOrderAddress | undefined` — field-for-field onto `incoming-order.types.ts:174-185` (`street→address1`, `street2→address2`, `region→state`, `postalCode→postalCode`, `countryCode→country`).
       - `mapTotals(t): IncomingOrderTotals` — `subtotal ?? Σ(price×qty)`, `tax ?? 0`, `shipping ?? max(0, total − subtotal)`, `total`, `currency` (Q4; mirrors `allegro-order-source.adapter.ts:254-290`).
       - timestamp normalisation (Q6): ISO strings; `createdAt`/`updatedAt` fall back to `new Date().toISOString()`; `placedAt` omitted when absent.
     - **Raw PII passthrough**: `customerExternalId = order.buyer.id`, `customerEmail = order.buyer.email` — **no identifier mapping** (#995). Optionally place `buyer` on the returned DTO's `metadata` field (i.e. `IncomingOrder.metadata`, **not** a log line) for observability (matches Allegro `allegro-order-source.adapter.ts:303-307`).
     - **Hard constraint — no `Logger`**: the mapper is a pure function and takes **no `Logger`** (no DI, no logging at all), so raw buyer PII can never reach the logger. Buyer data lives only on the returned DTO (fields + `metadata`); it is never logged.
   - **Acceptance**: returns a fully-populated `IncomingOrder`; never references the identifier-mapping service; type-checks against the CORE DTO; lint clean.
   - **Dependencies**: Phase 1.

#### Status mapping table (the core deliverable)

| Erli wire `status` | Neutral `OrderStatus` | Derived `paymentStatus` | Notes |
|---|---|---|---|
| `purchased` (+ COD method) | `processing` | `cod` | **COD arrives already committed/paid-on-delivery** — no `pending` hop, unlike PayU. |
| `purchased` (+ online/PayU settled) | `processing` | `paid` | Payment settled at purchase. |
| `pending` | `pending` | `awaiting` | PayU-online not yet settled. |
| `cancelled` | `cancelled` | `undefined` | #993 observes this to trigger Erli's stock-restore PATCH (ADR-025 §4a). |
| _unknown / absent_ | `pending` | `undefined` | Conservative fallback (mirrors `prestashop-order.mapper.ts:109`). |

> `purchased → processing` (not a neutral `purchased`, which doesn't exist in `OrderStatusValues`: `pending|processing|shipped|delivered|cancelled|refunded`, `order.types.ts:20-35`). The COD-vs-PayU distinction is carried on `paymentStatus` (`'cod'` vs `'paid'` vs `'awaiting'`, `payment-status.types.ts:23-25`), which is exactly the neutral field designed for it (`incoming-order.types.ts:82`). This keeps "arrived already paid" legible downstream without inventing a status enum member.

### Phase 3 — Unit tests (authored fixtures)
**Goal**: Lock the mapping + status table + COD-paid encoding + raw-PII passthrough.

3. **Create `erli-order.mapper.spec.ts`**
   - **File**: `libs/integrations/erli/src/infrastructure/adapters/__tests__/erli-order.mapper.spec.ts`
   - **Action**: authored `ErliOrder` fixtures (typed literals, à la `allegro-order-source.adapter.spec.ts:250-278`). A `#992-PROVISIONAL` comment heads the fixture block flagging the revisit-on-spike.
   - **Fixture PII (explicit)**: authored fixtures MUST use obviously-fake PII — e.g. `buyer-1@example.test`, `"Jan Testowy"`, a fake street/city/postcode (e.g. `"ul. Testowa 1"`, `"00-001"`). **Never** use real customer data or any real secrets/credentials in fixtures.
   - **Test cases** (names `should … when …`, engineering-standards § Test Naming):
     - COD order → `status: 'processing'`, `paymentStatus: 'cod'` (the headline case).
     - PayU settled (`purchased` + online) → `processing` + `paid`.
     - PayU pending (`pending`) → `pending` + `awaiting`.
     - `cancelled` → `cancelled` + `paymentStatus` undefined.
     - Unknown status string → `pending` fallback.
     - Multi-line order → all items mapped, `subtotal`/`total` correct, `productRef.type==='variant'`, raw external ids preserved.
     - Missing optional fields (no `tax`, no `shipping`, no `billingAddress`, no `placedAt`, no buyer email) → safe defaults (`tax:0`, derived `shipping`, omitted optionals, `customerEmail` undefined).
     - **Raw PII passthrough**: `customerExternalId === buyer.id`, `customerEmail === buyer.email`, addresses field-for-field — and an assertion that **no internal `ol_*` id appears** anywhere in the output (guards the #995 boundary).
     - Address mapping: `street→address1`, `countryCode→country`, etc.
     - **Billing address present** → `billingAddress` mapped field-for-field onto `IncomingOrderAddress` (asserts the AC's "(+ billing) address"; Allegro sets `billingAddress: undefined`, but Erli maps it when present). The missing-optionals case above already covers `billingAddress` absent → omitted.
   - **Acceptance**: `pnpm --filter @openlinker/integrations-erli test` green; coverage on the mapper ≥ infra target (70%, realistically ~100% — pure function).
   - **Dependencies**: Phases 1–2.

### Implementation Details
- **New Components — Infrastructure**: `erli-order.types.ts` (wire), `erli-order.mapper.ts` (mapper), `__tests__/erli-order.mapper.spec.ts`.
- **Configuration Changes**: none.
- **Database Migrations**: none.
- **Events**: none.
- **Error Handling**: the mapper is pure and total — it does not throw for missing optional fields (returns safe defaults). A genuinely malformed wire object is the #993 adapter's concern (it owns the HTTP read + `ErliApiException`); the mapper assumes a well-typed `ErliOrder`. (No domain exceptions introduced.)
- **No barrel export**: like `erli-product.types.ts` and the offers mapper logic, these stay package-private under `infrastructure/adapters/` — not re-exported from `src/index.ts` (the package barrel exposes only the manifest/plugin). #993 imports the mapper via relative path.

---

## 7. Alternatives Considered

### Alternative 1: Private mapping method on a stub `ErliOrderSourceAdapter` (Allegro pattern)
- **Description**: Inline the mapping as a private method, mirroring `allegro-order-source.adapter.ts:229-316`.
- **Why Rejected**: #994 explicitly excludes the adapter (that is #993). Creating a throwaway adapter shell now would either (a) be deleted/reworked by #993, or (b) pre-empt #993's transport/cursor design. A standalone mapper is independently testable and #993 composes it cleanly — exactly the PrestaShop split (`prestashop-order-source.adapter.ts:48,138` → `prestashop-order.mapper.ts`).
- **Trade-offs**: One extra file vs. coupling two issues. Cheap; PrestaShop already validates the standalone-mapper shape.

### Alternative 2: Map onto the closed `OrderStatus` union as the function's return type for `status`
- **Description**: Type the mapper's `status` field as `OrderStatus` rather than the DTO's `string`.
- **Why Rejected**: `IncomingOrder.status` is deliberately `string` (`incoming-order.types.ts:35`) so adapters can pass raw values core normalises. We still *emit* canonical `OrderStatusValues` members (forward-compat), but typing the field stricter than the DTO buys nothing and diverges from the contract. We assert canonical values in tests instead.
- **Trade-offs**: none material.

### Alternative 3: Encode COD-paid as a distinct order `status`
- **Description**: Invent/emit a `purchased`-like status to signal "arrived paid."
- **Why Rejected**: `OrderStatusValues` has no `purchased`/`paid` member (`order.types.ts:20-35`); the neutral model carries payment state on the dedicated `paymentStatus` field (`payment-status.types.ts` `'paid'|'cod'|'awaiting'|'refunded'`). Encoding payment in the order status would conflate two axes core keeps separate.
- **Trade-offs**: none — using `paymentStatus` is the intended seam.

---

## 8. Validation & Risks

### Architecture Compliance
- ✅ Integration-only; CORE untouched; consumes CORE via the top-level `@openlinker/core/orders` barrel (allowed: domain type aliases cross by value — architecture-overview § Cross-context contract).
- ✅ Pure mapper, no framework deps (engineering-standards § Domain/adapter purity; the mapper has no NestJS/TypeORM imports).
- ✅ Identity resolution stays in core (`order-ingestion.service.ts:337-359`); adapter carries raw ids (`incoming-order.types.ts:38-43,119-124`).

### Naming Conventions
- ✅ `*.mapper.ts`, `*.types.ts`, `*.spec.ts` (engineering-standards § File naming). Wire types beside `erli-product.types.ts` (in-package convention).

### Existing Patterns
- ✅ Standalone mapper mirrors PrestaShop; status table mirrors `prestashop-order.mapper.ts:92-110`; totals-derivation mirrors `allegro-order-source.adapter.ts:254-290`; authored fixtures mirror both adapters' specs.

### Risks
- **`#992`-provisional field names diverge from the real Erli API.** *Mitigation*: every wire field confined to `erli-order.types.ts` (one reconciliation point, header-flagged); mapper + tests reference only those types, so the spike updates one file + re-asserts fixtures. Identical posture to the shipped offers half.
- **COD discriminator assumption (Q3) wrong.** *Mitigation*: payment-status derivation isolated in one helper (`derivePaymentStatus`); status mapping is unaffected even if the COD signal moves. Flagged as the top open question.
- **Line-item ref type (Q5) wrong (`variant` vs `sku`/`product`).** *Mitigation*: single `mapLineItem` helper; `IncomingOrderItemRef` union accommodates all four — one-line change. Raw external id is preserved regardless, so #995's resolver still receives a usable key.

### Edge Cases
- Missing `tax`/`shipping`/`billingAddress`/`placedAt`/buyer email → safe defaults (tested).
- Unknown/absent status → `pending` (tested).
- Multi-line totals reconciliation (tested).

### Backward Compatibility
- ✅ No public surface changes; new package-private files only. Nothing imports the mapper yet (#993 will).

---

## 9. Testing Strategy & Acceptance Criteria

### Unit Tests
- `libs/integrations/erli/src/infrastructure/adapters/__tests__/erli-order.mapper.spec.ts` — cases enumerated in Phase 3. Authored fixtures (sandbox capture impossible; flagged `#992-PROVISIONAL`).

### Integration Tests
- None for #994 (no transport/wiring). The Erli offers vertical-slice int-spec landed with #991; the orders int-spec belongs to #993 once `ErliOrderSourceAdapter` exists.

### Mocking Strategy
- None — the mapper is a pure function over typed literals (no DB/HTTP/Redis to mock). This is the cleanest possible unit.

### Acceptance Criteria
- [ ] `erli-order.types.ts` exists, all fields `#992-PROVISIONAL`-documented, single reconciliation point, no coupling to `erli-product.types.ts`.
- [ ] `erli-order.mapper.ts` maps line items, totals, shipping (+ billing) address.
- [ ] Status set `pending|purchased|cancelled` mapped per the table; **COD orders arrive `processing` + `paymentStatus:'cod'`** (already-paid encoding); PayU-pending → `pending` + `awaiting`.
- [ ] Buyer/PII fields carried **raw** (`customerExternalId`, `customerEmail`, address); **no identifier mapping** in the adapter (deferred #995) — asserted by a "no `ol_*` id in output" test.
- [ ] Unit tests cover COD, PayU-settled, PayU-pending, cancelled, unknown-status, multi-line, missing-optionals, PII-passthrough, address-mapping.
- [ ] `pnpm --filter @openlinker/integrations-erli test`, `pnpm lint`, `pnpm type-check` all green; no new errors.
- [ ] A `#992` revisit is flagged in code comments (types + fixtures).

---

## 10. Alignment Checklist

- [x] Follows hexagonal architecture (integration/infra adapter-layer mapper).
- [x] Respects CORE vs Integration boundaries (CORE untouched; consumes via barrel).
- [x] Uses existing patterns (PrestaShop standalone-mapper; status-table + totals-derivation precedents).
- [x] Idempotency considered (pure total function; #993 owns the idempotent ingestion path).
- [x] Event-driven patterns (N/A here; #993 wires the inbox-poll/webhook trigger).
- [x] Rate limits & retries (N/A — pure mapper; transport is #993).
- [x] Error handling comprehensive (mapper is total; transport errors are #993's).
- [x] Testing strategy complete (authored-fixture unit tests; #992 capture flagged).
- [x] Naming conventions followed (`*.mapper.ts` / `*.types.ts` / `*.spec.ts`).
- [x] File structure matches standards (beside `erli-product.types.ts`).
- [x] Plan is execution-ready.
- [x] Plan saved as markdown file.

---

## Related Documentation
- [Architecture Overview](../architecture-overview.md) — OrderSourcePort, Cross-context contract, Data Flow §1.
- [Engineering Standards](../engineering-standards.md) — naming, file headers, `as const` unions, import aliases.
- [ADR-025: Erli marketplace adapter](../architecture/adrs/025-erli-marketplace-adapter.md) — reconciliation-first posture, inbox-poll backstop, frozen fields, stock-not-restored-on-cancel.
- [Testing Guide](../testing-guide.md) — unit test conventions.

### Key file references (verified)
- `IncomingOrder` + nested types: `libs/core/src/orders/domain/types/incoming-order.types.ts:21-185`
- Neutral order status union: `libs/core/src/orders/domain/types/order.types.ts:20-35`
- Payment status union: `libs/core/src/orders/domain/types/payment-status.types.ts:23-25`
- `OrderSourcePort.getOrder` / `listOrderFeed`: `libs/core/src/orders/domain/ports/order-source.port.ts:48,57`
- Core identity resolution (deferred-to here): `libs/core/src/orders/application/services/order-ingestion.service.ts:337-359`
- Allegro inline mapper + status logic: `libs/integrations/allegro/src/infrastructure/adapters/allegro-order-source.adapter.ts:229-316` (status `:242`, totals `:254-290`, identity-deferral `:59-61,226-227`)
- PrestaShop standalone mapper + status table: `libs/integrations/prestashop/src/infrastructure/mappers/prestashop-order.mapper.ts:92-110` (totals `:63-71`); adapter delegation `prestashop-order-source.adapter.ts:48,138`
- Erli provisional wire-types precedent: `libs/integrations/erli/src/infrastructure/adapters/erli-product.types.ts:1-22,24-28,85-113`
- Erli offers adapter (status-map precedent, seller-key id): `libs/integrations/erli/src/infrastructure/adapters/erli-offer-manager.adapter.ts:108,395-397,535-552`
- Erli HTTP client (the #993 consumer seam): `libs/integrations/erli/src/infrastructure/http/erli-http-client.interface.ts:19`
- Fixture-style precedents: `.../allegro-order-source.adapter.spec.ts:250-278`, `.../prestashop-order.mapper.spec.ts:22-43`

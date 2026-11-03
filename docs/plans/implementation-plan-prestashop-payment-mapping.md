# Implementation Plan: PrestaShop order processor honours the payment mapping (#3474, item 2)

**Date**: 2026-10-15
**Status**: Draft - ready for review
**Estimated Effort**: 0.5-1 day

---

## 1. Task Summary

**Objective**: A payment mapping the operator configured (source payment type -> PrestaShop payment module name)
must decide the `payment_method` OpenLinker sends when it creates the order in PrestaShop, instead of the
hardcoded `'Check payment'`. No mapping, or no source payment value, keeps today's output byte for byte.

**Context**: #3474 lists four defects in `prestashop-order-processor-manager.adapter.ts`. Re-checked against
`origin/main` (c5b72fffa) on 2026-10-15:

| # | Defect | State |
|---|---|---|
| 1 | Messages promise a retry that never happens | **Fixed** (reworded at ~L974: "not retried automatically - use the destination Retry action") |
| 3 | Buyer PII in the debug log | **Fixed** (L176-187 logs a redacted projection) |
| 4 | Stale "default-install map" warning | **Fixed** (~L1540 cites #2607) |
| 2 | Payment mapping ignored | **Open** - `paymentMethod: 'Check payment'` is still hardcoded at L632 |

Why item 2 is more than one line:
- The mapping is **source-keyed** (stored under the source connection id, like carrier mappings): the key is a
  source payment type (Allegro `payment.type`, e.g. `CASH_ON_DELIVERY`), the value a PrestaShop payment module name.
- `OrderCreate` carries **no** source payment value - only the neutral `paymentStatus` - so the adapter has nothing
  to look up. The value must be threaded from the source adapter through `IncomingOrder` -> `Order` -> `OrderCreate`.
- `IMappingConfigService` has `getPaymentMappings` but **no `resolvePaymentMapping`**, unlike carrier (`resolveCarrierMapping`) and order state.

**Classification**: Integration (PrestaShop adapter) + small CORE extension (orders types, mappings service) + Allegro source adapter.

---

## 2. Scope & Non-Goals

### In Scope
- Opaque `sourcePaymentMethod?: string` on `IncomingOrder`, `Order`, `OrderCreate`.
- Allegro order source sets it from `checkoutForm.payment.type`.
- `IMappingConfigService.resolvePaymentMapping(sourceConnectionId, sourcePaymentMethod)` + implementation.
- PrestaShop adapter resolves it and sends the mapped value as `payment_method`; falls back to `'Check payment'`.
- Tests at each layer; update the UI/doc copy that over-promises (see Q1).

### Out of Scope
- The neutral `paymentMethod` vocabulary (COD / online / transfer) - that is #3294 and a different, coarser axis.
- Changing the OL PrestaShop module: `importorder.php` keeps delegating to `ps_checkpayment` (`PAYMENT_MODULE`).
- Persisting the new field in the order snapshot (no consumer; see Assumptions).
- Other sources (PrestaShop, WooCommerce, Erli, Shoper) setting `sourcePaymentMethod`; absent means fallback.
- WooCommerce / Shoper destinations (they do not hardcode through this seam; recorded in the PR).

### Constraints
- Additive and optional everywhere; no port or DTO breaks.
- A mapping read failure must never fail order creation.
- No PII in any new log line.

---

## 3. Architecture Mapping

**Target Layer**: Integration (PrestaShop adapter), CORE application (mapping service), CORE domain types.

**Capabilities Involved**: `OrderProcessorManagerPort.createOrder`, `OrderSourcePort` (Allegro), `IMappingConfigService`.

**Existing Services Reused**:
- `IMappingConfigService` already injected into the adapter (L165) and used for carrier (L1458) and order state (L1523).
- `PaymentMappingRepositoryPort.findByConnectionId`.
- `resolveCarrierMapping` as the template (source-scoped, `find` over repo rows, `null` when absent).

**New Components Required**:
- `sourcePaymentMethod` field (3 types).
- `resolvePaymentMapping` (interface + service).
- `resolvePaymentMethodLabel` private method on the adapter.

**Core vs Integration Justification**: core only carries an opaque string and resolves operator-authored config;
the PrestaShop-specific choice (label sent to the module, fallback string) stays in the adapter. Core names no
platform value.

**Reference**: [Architecture Overview - Hexagonal Architecture Structure](../architecture-overview.md#hexagonal-architecture-structure)

---

## 4. External / Domain Research

### Internal Patterns
- **Carrier path**: `order.source?.connectionId` + `order.shipping?.methodId` -> `resolveCarrierMapping(source, methodId)` -> fallback chain, with a `warn` on non-usable values. Mirror that shape.
- **Where the Order is built**: only `OrderIngestionService` calls `syncOrder` (L738), constructing `Order` from `IncomingOrder` (~L2085) and `OrderSyncService` builds `OrderCreate` (~L285). A destination retry re-enqueues `marketplace.order.sync`, i.e. re-reads the source, so the field never has to survive a snapshot round trip.
- **UI**: Payments tab is source-keyed (`connection-mappings-page.tsx`, `usePaymentMappingsQuery(sourceConnectionId)`); source options are `ALLEGRO_PAYMENT_TYPE_OPTIONS` (`ONLINE, CASH_ON_DELIVERY, BANK_TRANSFER, INSTALLMENTS, WALLET, SPLIT_PAYMENT`), destination options the static `PRESTASHOP_PAYMENT_MODULES`.
- **What `payment_method` does in PrestaShop**: the OL module passes it to `PaymentModule::validateOrder` on `ps_checkpayment`; it becomes the order's display label (`orders.payment`). It does not change the payment module or how PrestaShop books the order (that is the order state).

---

## 5. Questions & Assumptions

### Open Questions
1. **Label vs module.** The mapping UI says target = PrestaShop payment *module*; at runtime only the *label* changes. Default: send the mapped value verbatim as the label (this is what the issue's acceptance criterion states), document that the module stays `ps_checkpayment`, and reword the tab's empty-state copy ("fall back to the default payment module") so it does not promise a module switch. Making the module switch real means changing `importorder.php` + `PaymentModuleGate`, which is a separate decision.
2. **Field name.** `sourcePaymentMethod` (opaque, source-native) to avoid colliding with the neutral `paymentMethod` #3294 will add. Confirm.

### Assumptions
- Allegro is the only source whose `listPaymentMethods` values are mapping keys today; other sources simply omit the field.
- No snapshot persistence is needed (Order is rebuilt from the source on every sync, including retry).
- A blank or whitespace-only mapped value is treated as "no mapping".

### Documentation Gaps
- The Payments tab copy and `PaymentMapping` docblock describe module-level behaviour that does not exist; corrected in step 6.

---

## 6. Proposed Implementation Plan

### Phase 1 - Carry the source value
**Goal**: the adapter can see which source payment type the buyer used.

1. **Neutral types**
   - **Files**: `libs/core/src/orders/domain/types/incoming-order.types.ts`, `order.types.ts`, `order-processor.types.ts`.
   - **Action**: add `sourcePaymentMethod?: string` beside `paymentStatus`, documented as the source's own opaque payment-method id, the same vocabulary `SourceOptionsReader.listPaymentMethods` returns, used only as a mapping key; absent = source did not report it.
   - **Acceptance**: type-check clean (all optional).
2. **Pipeline pass-through**
   - **Files**: `order-ingestion.service.ts` (`Order` builder ~L2085), `order-sync.service.ts` (~L285).
   - **Action**: copy the field through, same as `paymentStatus`.
   - **Acceptance**: existing specs unchanged; new assertions below.
3. **Allegro source**
   - **File**: `libs/integrations/allegro/src/infrastructure/adapters/allegro-order-source.adapter.ts` (~L930-989).
   - **Action**: set `sourcePaymentMethod: checkoutForm.payment.type` when it is a non-empty string.
   - **Acceptance**: Allegro adapter spec asserts it for COD and for a prepaid type, and absent when `payment.type` is missing.

### Phase 2 - Resolve the mapping
**Goal**: one place answers "which PrestaShop value for this source payment type".

4. **Service**
   - **Files**: `mapping-config.service.interface.ts`, `mapping-config.service.ts`.
   - **Action**: `resolvePaymentMapping(connectionId, sourcePaymentMethod): Promise<string | null>` - source-scoped, `find` on `allegroPaymentProvider`, returns `prestashopPaymentModule` or `null`; docblock mirrors `resolveCarrierMapping`.
   - **Acceptance**: mapping-config service spec: match, no match, empty list.

### Phase 3 - PrestaShop adapter
**Goal**: the mapped value reaches PrestaShop; everything else is unchanged.

5. **Resolve + send**
   - **File**: `prestashop-order-processor-manager.adapter.ts` (L632 and a new private method beside `resolveExternalCarrierId`).
   - **Action**: `resolvePaymentMethodLabel(order)` -> if `mappingConfigService`, `order.source?.connectionId` and `order.sourcePaymentMethod` are all present, call `resolvePaymentMapping`; trim, use if non-empty; otherwise `'Check payment'` (exported constant `DEFAULT_PAYMENT_METHOD_LABEL`, not a string literal). Wrap the lookup in try/catch: log `warn` with connection ids and the source payment type (no PII), fall back. Replace the literal at L632; update the comment above it.
   - **Acceptance**: see tests.
6. **Copy corrections**
   - **Files**: `apps/web/src/pages/connections/connection-mappings-page.tsx` (empty-state text L99-100), `payment-mapping.entity.ts` docblock.
   - **Action**: state that an unmapped payment type is sent as "Check payment", and that the mapped value is shown as the order's payment label in PrestaShop. Run the UI-vocabulary check if the text sits in a scanned file.
   - **Acceptance**: `pnpm check:invariants` green.

### Implementation Details
**Error Handling**: lookup failure -> `warn` + fallback; never throws. Unusable (blank) mapped value -> fallback + `debug`.
**Idempotency/retries**: no new write; same request, different string. Re-ingestion recomputes it.
**Events / config / migrations**: none.

---

## 7. Alternatives Considered

### Alternative 1: Remove the payment-mapping surface for PrestaShop
- **Why Rejected**: the issue prefers resolving (operators already configure it), and Allegro -> PrestaShop is the main route.

### Alternative 2: Key the lookup on the neutral `paymentStatus` / #3294's `paymentMethod`
- **Why Rejected**: the saved mappings are keyed by Allegro's finer types (six values); a three-value neutral key would silently stop matching rows operators already saved.

### Alternative 3: Make the mapping change the payment module
- **Why Rejected (for now)**: needs an OL-module change and active-module validation; out of this bug's scope (Q1).

---

## 8. Validation & Risks

### Architecture Compliance
- ✅ Core carries an opaque string; the platform decision stays in the adapter.
- ✅ Mapping resolved through `IMappingConfigService`, never the repository port.
- ✅ No new cross-context edge.

### Naming Conventions
- ✅ `resolvePaymentMapping` mirrors `resolveCarrierMapping`; `*.types.ts` files only get an optional field.

### Risks
- **Operator expectation**: the mapping looks like it switches the payment module. Mitigation: copy fix + Q1.
- **Mapping read adds one DB read per order** (same cost as the carrier lookup; the existing TODO about per-session caching applies).
- **Value length/odd characters**: sent as the label; PrestaShop column is varchar(255). The mapping DTO already bounds input; no extra truncation added.

### Edge Cases
- No mapping service injected (older callers) -> fallback.
- Source has no connection ref or payment type -> fallback.
- Mapped value blank -> fallback.
- Lookup throws -> fallback + warn, order still created.

### Backward Compatibility
- ✅ Output is identical to today whenever no mapping applies; all additions optional.

---

## 9. Testing Strategy & Acceptance Criteria

### Unit Tests
- `prestashop-order-processor-manager.payment-mapping.spec.ts` (new, harness-based like the amount-paid spec): mapped value is the `paymentMethod` in `importOrder`; no mapping -> `'Check payment'`; no `sourcePaymentMethod` -> `'Check payment'` and no lookup; blank mapped value -> fallback; lookup rejects -> fallback + order created + warning; lookup called with `(sourceConnectionId, sourcePaymentMethod)`.
- `mapping-config.service.spec.ts`: `resolvePaymentMapping`.
- Allegro adapter spec: `sourcePaymentMethod` set/absent.
- `order-sync.service.spec.ts` / ingestion spec: field passes through to `OrderCreate`.
- **Run policy**: per project memory, tests are not run locally; lint and type-check are.

### Mocking Strategy
- Ports/interfaces mocked (`IMappingConfigService` partial, as in the resolution spec); no real DB.

### Acceptance Criteria
- [ ] A configured payment mapping produces that value as the PrestaShop `payment_method` (unit test).
- [ ] No mapping / no source value / blank value / lookup failure -> `'Check payment'`, order still created.
- [ ] `sourcePaymentMethod` flows Allegro -> IncomingOrder -> Order -> OrderCreate.
- [ ] Payments tab copy no longer promises a module switch.
- [ ] Items 1, 3, 4 verified fixed and noted in the PR (no code change).
- [ ] `pnpm lint` and `pnpm type-check` green.

---

## 10. Alignment Checklist

- [x] Follows hexagonal architecture
- [x] Respects CORE vs Integration boundaries
- [x] Uses existing patterns (carrier mapping template)
- [x] Idempotency considered
- [x] Event-driven patterns used where applicable (n/a)
- [x] Rate limits & retries addressed (no new outbound call; one local DB read)
- [x] Error handling comprehensive
- [x] Testing strategy complete
- [x] Naming conventions followed
- [x] File structure matches standards
- [x] Plan is execution-ready
- [x] Plan is saved as markdown file

---

## Related Documentation

- [Architecture Overview](../architecture-overview.md)
- [Engineering Standards](../engineering-standards.md)
- [Testing Guide](../testing-guide.md)
- Related plan: `docs/plans/implementation-plan-order-payment-method.md` (#3294 - touches the same write-site; do #3474 first)

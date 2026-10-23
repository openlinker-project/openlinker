# Implementation Plan: Neutral payment-method field on orders (COD vs. prepaid)

**Date**: 2026-10-15
**Status**: Draft - ready for review (issue #3294, epic #3509, OMS MVP pilot, P1)
**Estimated Effort**: 6-8 working days across 5 PRs (foundation 1d, source adapters 2-3d, COD amount 1d, write side 1d, invoice form 1-2d, FE 1d)

---

## 1. Task Summary

**Objective**: Give every ingested order a neutral, closed `paymentMethod` (*how* the buyer pays) next to the
existing `paymentStatus` (*whether it is settled*), populated by each order-source adapter or `unknown`, persisted
on `order_records`, exposed on reads, and consumed by the write side, the COD label amount and the invoice
payment form.

**Context**: #3294 was written as "nothing in OpenLinker can say COD vs. prepaid". Re-checked against
`origin/main` on 2026-10-15, that premise is **partly stale**:

| Claim in the issue | State on `origin/main` |
|---|---|
| No adapter projects a payment field | `PaymentStatus` (`paid / cod / awaiting / refunded`, #928) already exists on `Order`/`IncomingOrder` and is set by Allegro, Erli, PrestaShop (from order state), WooCommerce (`paid` only) and Shoper |
| Nothing can say "cash on delivery" | `paymentStatus === 'cod'` is produced by Allegro (`payment.type === 'CASH_ON_DELIVERY'`), Erli (`delivery.cod`), Shoper |
| COD amount on the label is typed by hand | `ShipmentDispatchService.resolveEffectiveCod` (`shipment-dispatch.service.ts` ~L322-349) already prefers `order.codToCollect`; `generate-label-form.tsx` shows a read-only "from marketplace" panel. `codToCollect` is sourced for **Allegro and Shoper only** |
| `ShipmentCod` "is only typed by hand" | Docblock in `shipment-cod.types.ts` ("caller-supplied, not order-sourced") is stale since #1435 |
| PS hardcode at `...manager.adapter.ts:548` | Moved: now `prestashop-order-processor-manager.adapter.ts:632` (`'Check payment'`) |

What is genuinely missing: (a) a **method** vocabulary (status cannot say *bank transfer* vs *online*, and cannot be
trusted for COD on WooCommerce/PrestaShop), (b) **COD amount** for PrestaShop/WooCommerce/Erli, (c) the **write
side** still hardcodes the method, (d) invoices get no **per-order payment form**, (e) the #3293 panel shows totals
only, (f) the column on `order_records`.

**Classification**: CORE (vocabulary, persistence, read model) + Integration (5 source adapters, 2 destination
adapters, 3 invoicing adapters) + Interface (DTO, MCP, FE) + migration.

---

## 2. Scope & Non-Goals

### In Scope
- Closed neutral vocabulary `PaymentMethod` + pure coercer in `libs/core/src/orders/domain/types/`.
- `paymentMethod?` on `IncomingOrder`, `Order`, `OrderCreate`; snapshot key; additive nullable `order_records.paymentMethod`.
- Source adapters: Allegro, Erli, PrestaShop, WooCommerce (D7) **and Shoper** (a fifth source already in the tree).
- Consistency between `paymentMethod` and `paymentStatus`/`codToCollect`.
- `codToCollect` for PrestaShop, WooCommerce, Erli when method is COD and the amount is known.
- Write side: PrestaShop label (replace `'Check payment'`), WooCommerce `payment_method` (replace `'other'`).
- Invoice payment form derived per order where the provider accepts one.
- FE: order detail header, #3293 payment panel, label form copy, snapshot schema.
- Tests incl. a shared adapter contract spec.

### Out of Scope
- Changing `PaymentStatus` values or the dispatch-blocking gate (`DISPATCH_BLOCKING_*`) - unchanged.
- Fraud signals (#3517) - they only *read* the new field.
- Consuming operator `PaymentMapping` rows: **done by #3474 (PR #3754)** for the PrestaShop write side, keyed by the opaque `sourcePaymentMethod` (Allegro `payment.type`). This plan reuses it and must not duplicate it; the neutral `paymentMethod` is a separate, coarser axis and only the fallback below an operator mapping.
- Operator-configurable per-connection method mapping for plugin gateways (listed as follow-up, see Q3).
- Back-filling existing orders (explicitly none, ADR-039 precedent).
- A list filter / column on `/orders` (no AC asks for it).

### Constraints
- `unknown` is a first-class value: never defaulted, never pre-fills COD, never guesses an invoice form.
- Additive only: no breaking change to `Order`, `OrderCreate` or any port (all new members optional).
- Must not weaken the WooCommerce "report `paid` or nothing" rule (comment at `woocommerce-order-source.adapter.ts` ~L215) without replacing its reason.
- Migration timestamp must be strictly greater than the tail on `main` (currently `1937370000000`); re-check at implementation.

---

## 3. Architecture Mapping

**Target Layer**: CORE (domain types, persistence, read model), Integration (adapters), Interface (DTO/MCP), App/FE.

**Capabilities Involved**: `OrderSourcePort` (read), `OrderProcessorManagerPort.createOrder` (write),
`InvoicingPort.issueInvoice` (command field), `ShippingProviderPort` via `ShipmentDispatchService` (COD resolution, unchanged contract).

**Existing Services Reused**:
- `OrderRecordService.persistOrder` snapshot assembly (`order-record.service.ts` ~L128-190, ~L420) - add the key beside `paymentStatus`.
- `OrderRecord` typed snapshot getters (`paymentStatus`, `codToCollect`) - add `paymentMethod` getter in the same style.
- `ShipmentDispatchService.resolveEffectiveCod` - extended only by the *inputs* it already reads.
- Denormalized-column pattern: `totalTaxTreatment` (migration `1870000000000`, ORM entity, repository mapping).
- FE `order-snapshot.schema.ts` + `parseOrderSnapshot`.

**New Components Required**:
- `payment-method.types.ts` (vocabulary + `readPaymentMethod` coercer + `paymentMethodImpliesCod`).
- One migration (`order_records.paymentMethod varchar NULL`).
- Per-adapter pure mappers (`allegro-payment-method.ts`, `woocommerce-payment-method.ts`, ...), co-located like `allegro-payment-status.ts`.
- Optional `paymentMethod` on `IssueInvoiceCommand`; per-provider mapping tables.
- Shared adapter contract spec for "method <-> status <-> COD amount" consistency.

**Core vs Integration Justification**:
- CORE owns the *vocabulary and the unknown rule* (as with `OrderStatus`, `PaymentStatus`, `RefundReason`). It names no platform string.
- Each adapter owns the *platform -> neutral* mapping and its own list of recognised native values; core never learns `CASH_ON_DELIVERY`, `ps_cashondelivery`, `bacs`, or `FormaPlatnosci`.
- Core -> adapter flow for the write side is data on `OrderCreate`; the adapter owns the wire spelling.

**Reference**: [Architecture Overview - Hexagonal Architecture Structure](../architecture-overview.md#hexagonal-architecture-structure)

---

## 4. External / Domain Research

### Native payment data per source (verified in code on `origin/main` unless marked)

| Source | Native field | What it can say reliably | Today |
|---|---|---|---|
| Allegro | `checkoutForm.payment.type` enum: `ONLINE, CASH_ON_DELIVERY, BANK_TRANSFER, INSTALLMENTS, WALLET, SPLIT_PAYMENT` (`allegro-payment-type.types.ts`) | all three target values | status via `deriveAllegroPaymentStatus`; `codToCollect` from `summary.totalToPay` |
| Erli | `delivery.cod` boolean (no method string) | COD, and "not COD" = online (Erli offers only those two) | status via `derivePaymentStatus(status, cod)`; **no** `codToCollect` |
| PrestaShop | `ps_orders.module` (payment module name) and `.payment` (label) - **assumption: both exposed by the Webservice `orders` resource; confirm on the dev stand in step 2.3** | core modules only: `ps_cashondelivery`, `ps_wirepayment`; third-party gateways are free text | status from order **state** (`paymentStatusOf`), method not read |
| WooCommerce | `payment_method` gateway id (typed `string?` in `woocommerce-order.types.ts`) | core ids `cod`, `bacs`; plugin ids are free text | status: `paid` or nothing; method not read |
| Shoper | `is_cash_on_delivery` boolean (already read) | COD | `codToCollect` set; method not read |

### Known pitfalls surfaced by the research
1. **WooCommerce COD likely reads as `paid` today.** `deriveWooCommercePaymentStatus` returns `paid` for status `processing`/`completed`, and a core `cod` gateway order is created `processing`. The shipment gate then **strips COD** (`paymentStatus === 'paid'` -> no `cod` on the label) and the label form hides the COD field. This is inferred from WC behaviour plus the code; **verify on a live WC store before step 2.4** and treat as a defect fixed by this plan.
2. **PrestaShop write side**: the OL module delegates to `ps_checkpayment` (`PAYMENT_MODULE` const in `importorder.php`); only the *display label* (`payment_method` request field) is free. COD semantics there are decided by the order **state** (operator mapping), not the label - changing the label must not be read as making PS treat the order as COD.
3. **Invoice payment form** today is connection-level only: Infakt `defaultPaymentMethod` (`cash | transfer`), KSeF `formaPlatnosci` codes `1..7` from connection config. No per-order input exists on `IssueInvoiceCommand`.
4. `PaymentMapping` (Allegro provider -> PS module) had authoring endpoints but no consumer when this plan was first written. **#3474 (PR #3754) now adds one** (`resolvePaymentMapping`, source-keyed, sent as the order's payment label); it changes only the label, not the payment module. Until #3754 merges, the hardcode at `...manager.adapter.ts:632` is still on `main`.

### Internal Patterns
- **Similar implementation**: `PaymentStatus` (#928) end-to-end - type file, `IncomingOrder`/`Order` field, snapshot key, `OrderRecord` getter, FE zod schema. Copy that shape.
- **Denormalized column**: `totalTaxTreatment` migration/entity/repository (`null` == "not asserted").
- **Pure rule in `*.types.ts`**: allowed by the #2231 exception (pure, is the rule for its type, changes with it).
- **Contract test kit**: `docs/testing-guide.md` "Port-contract suites" - the pure-checker + thin-jest-wrapper shape, refuse-never-skip.

---

## 5. Questions & Assumptions

### Open Questions
1. **Vocabulary breadth.** Proposed `online | bank_transfer | cash_on_delivery | unknown`. Allegro `WALLET` / `INSTALLMENTS` / `SPLIT_PAYMENT` are not obviously "online": default plan maps them to `unknown` (never a guess) - confirm, or approve mapping `WALLET`/`INSTALLMENTS` -> `online`.
2. **Shoper.** D7 says four adapters; Shoper is a fifth source with a cheap, reliable COD flag. Default: include it (small, same mapper shape). Confirm.
3. **PrestaShop / WooCommerce plugin gateways** (PayU, Przelewy24, Stripe...) -> `unknown` in this slice, so `online` is **never** produced for those two platforms. Acceptable for COD vs prepaid (status already carries "paid"), but a connection-level `gatewayMethodMap` is the follow-up if the pilot needs it.
4. **`paymentStatus` vs `paymentMethod` precedence** when they disagree (e.g. WC `processing` + gateway `cod`). Plan: **method COD wins** and the adapter reports `paymentStatus: 'cod'`; confirm this is acceptable for the WC `auto-on-paid` invoicing gate (a COD order then no longer auto-issues "on paid" - which is the correct behaviour, but a visible change).
5. **COD amount = order gross total** for PS/WC/Erli (nothing is paid in advance on a COD order). Allegro uses `totalToPay`; confirm total is acceptable where the source has no `totalToPay`.
6. **Migration column vs snapshot-only.** AC requires the column; today `paymentStatus`/`codToCollect` live only in the snapshot JSON. Plan keeps both (snapshot key for the typed getter + FE; column for queries such as #3517). Confirm the column has a named consumer, otherwise it is speculative.

### Assumptions
- PrestaShop Webservice `orders` exposes `module` and `payment` (standard `ps_orders` columns). Verified in step 2.3 against the dev stand before any mapper is written.
- Existing rows read `unknown` (NULL column, no snapshot key). Re-ingestion fills them; no backfill job.
- The fifth source (Shoper) and the invoicing adapters already tolerate an extra optional field.
- `OL_STORE_PII` does not affect this field (not personal data) - stored in both modes.

### Documentation Gaps
- `architecture-overview.md` § Orders has no paragraph for `PaymentStatus` either; add one covering both axes (done in the docs step).
- `shipment-cod.types.ts` docblock contradicts #1435 behaviour; update.

---

## 6. Proposed Implementation Plan

Five PRs, each independently mergeable and green. Branch per `{issue}-{slug}` convention; one issue, one `Closes` on the **last** PR only.

### Phase 1 - Foundation (PR 1): vocabulary, persistence, reads
**Goal**: the field exists end to end with every value `unknown`; zero behaviour change.

1. **Vocabulary + coercer**
   - **File**: `libs/core/src/orders/domain/types/payment-method.types.ts`
   - **Action**: `PaymentMethodValues = ['online','bank_transfer','cash_on_delivery','unknown'] as const`, `PaymentMethod`, `PAYMENT_METHOD` map, `readPaymentMethod(value: unknown): PaymentMethod` (anything unrecognised -> `'unknown'`), `paymentMethodImpliesCod(m)`. Export from the `orders` barrel and the `orders/types` cycle-breaker sub-barrel.
   - **Acceptance**: table-driven spec incl. `null`, numbers, `'COD'`, `''`, `undefined` -> `unknown`.
   - **Dependencies**: none.
2. **Neutral order shapes**
   - **Files**: `incoming-order.types.ts` (near L92), `order.types.ts` (near L126), `order-processor.types.ts` (near L115-130).
   - **Action**: add `paymentMethod?: PaymentMethod` beside `paymentStatus`, same doc style: absent = source did not report it.
   - **Acceptance**: `pnpm type-check` clean (all optional).
3. **Snapshot write**
   - **File**: `libs/core/src/orders/application/services/order-record.service.ts` (~L188 and ~L420).
   - **Action**: write `paymentMethod` into `orderSnapshot` only when defined, exactly like `paymentStatus`.
   - **Acceptance**: unit spec - key present when reported, absent otherwise; re-ingest without the field does not erase a stored value only if that matches `paymentStatus` behaviour (copy its semantics, assert it).
4. **`OrderRecord` getter + column**
   - **Files**: `order-record.entity.ts` (new `get paymentMethod(): PaymentMethod`), ORM entity, `OrderRecordRepository` mapping, new migration `apps/api/src/migrations/<tail+1>-add-order-record-payment-method.ts`.
   - **Action**: nullable `varchar`, `ADD COLUMN IF NOT EXISTS`, no default, no backfill; `down()` drops it. NULL reads as `'unknown'`. Per the `totalTaxTreatment` precedent the column is written in the denormalization path, and per the `buyerTaxId`/`cancelledAt` discipline it is **not** nulled by an unrelated write.
   - **Acceptance**: `pnpm --filter @openlinker/api migration:show` clean; `scripts/check-migration-timestamps.mjs` green; repository int-spec round-trips `'cash_on_delivery'` and NULL.
5. **Reads**
   - **Files**: `apps/api/src/orders/http/dto/order-record-response.dto.ts` (+ Swagger enum from `PaymentMethodValues`), `apps/api/src/mcp/tools/read/get-order.tool.ts` (allowlist projection, beside `paymentStatus`), `apps/web/src/features/orders/api/order-snapshot.schema.ts` + `orders.types.ts`.
   - **Acceptance**: DTO spec; MCP projection spec asserts the field is exposed and nothing else widened; FE schema degrades an unknown value to `'unknown'` with a warning (the `readPaymentStatus` precedent).

### Phase 2 - Source adapters (PR 2): the field becomes real
**Goal**: every source reports a method or `unknown`, consistent with `paymentStatus`.

2.1. **Allegro** - `allegro-payment-method.ts` (pure): `ONLINE->online`, `CASH_ON_DELIVERY->cash_on_delivery`, `BANK_TRANSFER->bank_transfer`, everything else (incl. `WALLET`, `INSTALLMENTS`, `SPLIT_PAYMENT`, unseen types) -> `unknown` (see Q1). Wire in `allegro-order-source.adapter.ts` (~L930-989). *Acceptance*: spec per enum member incl. an unseen string.
2.2. **Erli** - `erli-order.mapper.ts`: `cod ? cash_on_delivery : online`. `cancelled`/unknown-status orders: still derivable from `delivery.cod`, keep method. *Acceptance*: spec for cod true/false across statuses.
2.3. **PrestaShop** - **first** confirm `module`/`payment` on the dev stand and add them to the order type; then `prestashop-payment-method.ts`: `ps_cashondelivery->cash_on_delivery`, `ps_wirepayment->bank_transfer`, all other modules -> `unknown`. Wire in `prestashop-order-source.adapter.ts` (~L549-632). *Acceptance*: spec table; adapter spec asserts a PS order with no `module` -> `unknown`.
2.4. **WooCommerce** - `woocommerce-payment-method.ts`: gateway `cod->cash_on_delivery`, `bacs->bank_transfer`, other ids -> `unknown` (free-text plugin slugs are not evidence). **Fix the precedence defect**: when method is COD, `deriveWooCommercePaymentStatus` must return `cod`, not `paid` for `processing`/`completed` (Q4). Update the long docblock so the "report `paid` or nothing" reasoning is narrowed, not silently contradicted. *Acceptance*: spec: `cod` + `processing` -> `cod`; non-COD behaviour byte-identical to today.
2.5. **Shoper** - map `is_cash_on_delivery === true` -> `cash_on_delivery`; absent/false -> `unknown` (false is *not* proof of prepaid). *Acceptance*: spec.
2.6. **Shared consistency contract** - a pure checker `checkPaymentFactsConsistency({paymentMethod, paymentStatus, codToCollect})` in `libs/core/src/orders/testing/` (jest-free core + thin wrapper per the testing guide) asserting: `cash_on_delivery` => `paymentStatus` is `cod` or undefined, never `paid`; `codToCollect` present only if method is COD; `unknown` => no `codToCollect`. Each adapter spec calls it. A warn-log (never throw) in `persistOrder` on contradiction.
   *Acceptance*: the checker has one deliberate-breakage fixture per rule (refuse-never-skip), red first.

### Phase 3 - COD amount for more sources (PR 3)
**Goal**: label COD is pre-filled for PS/WC/Erli when it is known, never otherwise.

3.1. In each adapter, set `codToCollect: { amount: total.toFixed(2), currency }` **only** when method is `cash_on_delivery` and `currency` is non-empty (the Shoper mapper at `shoper-incoming-order.mapper.ts` ~L360 is the exact precedent). Amount as decimal **string**.
3.2. `ShipmentDispatchService.resolveEffectiveCod` needs no logic change (it already prefers `order.codToCollect` when `paymentStatus === 'cod'`); add a spec for `cod` + sourced amount from a PS/WC-shaped order, and for `unknown` => operator-supplied/none, never inferred.
3.3. FE `generate-label-form.tsx`: the comment block (~L285-295) says PS/WC "keep the manual-COD path"; update it and add a test that a PS COD order now renders the read-only sourced panel while `unknown` still shows the manual field.
3.4. Update `shipment-cod.types.ts` docblock (stale "caller-supplied" claim).
   *Acceptance*: dispatch spec matrix (method x status x amount x caller cod) incl. `unknown` never pre-fills.

### Phase 4 - Write side (PR 4)
**Goal**: destinations stop hardcoding the method.

4.1. **PrestaShop** - **builds on #3474 (PR #3754, draft, not yet merged)**, which already resolves the label in `resolvePaymentMethodLabel` (`prestashop-order-processor-manager.adapter.ts`): operator mapping keyed by the opaque `sourcePaymentMethod`, else `DEFAULT_PAYMENT_METHOD_LABEL` (`'Check payment'`). Do **not** reintroduce a hardcode or a second lookup; extend that method's chain to `mapping -> label from the neutral order.paymentMethod -> DEFAULT_PAYMENT_METHOD_LABEL` (`cash_on_delivery->'Cash on delivery'`, `bank_transfer->'Bank transfer'`, `online->'Online payment'`, `unknown/absent->` default, byte-identical to today). The operator's explicit mapping keeps precedence over the neutral default. Rebase on #3754 before starting this step. Do **not** touch `importorder.php`'s `PAYMENT_MODULE`; update the comment in `prestashop-openlinker-module.client.interface.ts` (~L73) that says the label must match the module. Note in code: the label does not make PS treat the order as COD - that stays the order-state mapping's job (existing `warnIfUnpaidOrderBooksAsSettled` remains).
4.2. **WooCommerce** - `woocommerce-order-processor.adapter.ts:277`: `cod->'cod'`, `bacs->'bacs'`, otherwise `'other'` (today's value); set `payment_method_title` to the same human label. `markPaid` logic untouched (`paymentStatus === 'paid'` only).
4.3. Other destinations that hardcode a method (issue says "any other"): grep showed Shoper writes only `paid`; no further hardcode found - record "none" in the PR.
   *Acceptance*: adapter specs assert the exact request body for each method and for `unknown` (unchanged from today); module int-spec on the PS Testcontainer asserts the stored `orders.payment` label for a COD order (scoped to ids the spec created, per the testing guide).

### Phase 5 - Invoice payment form (PR 5)
**Goal**: per-order form where the provider accepts one; connection default otherwise.

5.1. Add optional `paymentMethod?: PaymentMethod` to `IssueInvoiceCommand` (confirm exact file/shape first - not located during research); populate from the order in the command mapper (`order-to-issue-invoice-command.mapper.ts`). Absent/`unknown` => field omitted.
5.2. Provider mapping, each in its own adapter, each falling back to **today's connection default** when the method is absent/`unknown`:
   - **Infakt** (`infakt-invoicing.adapter.ts` ~L664, L1072): `cash_on_delivery->'cash'`, `bank_transfer->'transfer'`; `online` -> **connection default** (no honest Infakt equivalent; flag in PR).
   - **KSeF** (`Fa/Platnosc/FormaPlatnosci`, codes `1..7`): map only codes whose meaning is unambiguous (cash `1` for COD, transfer `6` for bank transfer - **verify codes against the XSD comment at `ksef-connection.types.ts` ~L68** before coding); everything else -> connection default.
   - **Subiekt GT / nexo**: research task - include only if the bridge accepts a payment form; otherwise record "not accepted" and skip (a mirror stricter than the gate is the #2240 failure).
   - **eparagony**: document is a receipt; confirm whether the vendor payload has a method (receipts may carry one) - same rule.
5.3. `unknown` never guesses a form - assert in each adapter spec.
   *Acceptance*: per-adapter spec table incl. `unknown` -> unchanged payload (golden compare to today's body).

### Phase 6 - Frontend (PR 6, may ship with PR 1-3 where noted)
6.1. `order-detail-header.tsx`: show a method chip beside the payment-status badge only when method is not `unknown`. Copy in a `*.copy.ts` (scanned by `scripts/check-ui-vocabulary.mjs`); no platform names.
6.2. `fulfillment-work-detail-body.tsx` payment section (the #3293 panel, ~L425-460): beside `OrderTotalsPanel`, render **method + status**; for COD with `codToCollect` show "Collect on delivery: {amount} {currency}"; for COD without amount say it is not known (never `0`). `unknown` renders nothing extra, not "unknown" noise.
6.3. `orders-list-page.tsx` `paymentBadge` unchanged (status only) - noted so it is not "improved" by accident.
   *Acceptance*: component tests for COD+amount, COD without amount, prepaid, unknown, legacy snapshot with no key.

### Implementation Details

**New Components**:
- **Domain**: `payment-method.types.ts`; `OrderRecord.paymentMethod` getter.
- **Application**: snapshot assembly change; `checkPaymentFactsConsistency` (testing subpath); optional `IssueInvoiceCommand.paymentMethod`.
- **Infrastructure**: per-adapter mappers; ORM column; repository mapping; one migration.
- **Interface**: DTO field, MCP projection, FE schema + two components.

**Configuration Changes**: none (no env var, no setting). A per-connection gateway map is a deferred follow-up (Q3).

**Database Migrations**: one additive, nullable, idempotent (`IF NOT EXISTS`), `down()` drops; use `/migrate`; timestamp = tail + 1 step.

**Events**: none emitted or consumed.

**Error Handling**: no new exceptions. An unrecognised native value is `unknown` + (adapters) a `debug` log naming the native value once per connection, never a throw - a payment label must not fail order ingestion. A contradiction between method and status warns in `persistOrder` and does not block.

**Idempotency / retries / rate limits**: re-ingestion is idempotent (same snapshot key, same column write). No new outbound calls (PS `module`/`payment` come in the existing order read; WC/Allegro/Erli fields are already in the payload). Write side: no new request, only a different string in an existing one.

**Reference**: [Engineering Standards - Project Structure](../engineering-standards.md#project-structure)

---

## 7. Alternatives Considered

### Alternative 1: Reuse `PaymentStatus` (add `bank_transfer` etc.)
- **Description**: widen `paymentStatus` instead of adding a second axis.
- **Why Rejected**: status answers "may this ship?" and drives `DISPATCH_BLOCKING_*`; mixing in a method makes every gate re-examine new values. The two facts vary independently (prepaid by transfer vs by card; COD unpaid).
- **Trade-offs**: one field fewer, but a breaking semantic change to a gate that blocks labels.

### Alternative 2: Snapshot-only, no column
- **Description**: like `paymentStatus`/`codToCollect`, keep it in `orderSnapshot` JSON.
- **Why Rejected (tentatively)**: the issue's AC requires the column and #3517 will filter/aggregate on it. Kept as Q6 - if no consumer is named, drop the column and ship snapshot-only (smaller, no migration).
- **Trade-offs**: no migration/index risk vs. no SQL predicate.

### Alternative 3: Per-connection mapping table for every gateway
- **Description**: operator maps each PS module / WC gateway to a method.
- **Why Rejected**: a new config surface and UI for a pilot whose goal is COD vs prepaid; core gateway ids already cover COD and transfer. Deferred (Q3).
- **Trade-offs**: would make `online` available on PS/WC; costs an authoring screen and validation.

### Alternative 4: Compute method from `paymentStatus` + total in core
- **Description**: infer `cod` from status, skip adapter work.
- **Why Rejected**: it is exactly the guess the issue forbids and fails on WC, where status cannot express COD.

---

## 8. Validation & Risks

### Architecture Compliance
- ✅ Vocabulary in CORE, mappings in adapters; no platform strings in `libs/core`.
- ✅ No new cross-context edge: `shipping` and `invoicing` already read `Order`/`orders/types`; `invoicing` imports only the `orders/types` sub-barrel type (as it does for `PAYMENT_STATUS`).
- ✅ Domain entity change is a pure getter (ADR-011).
- ✅ New file kinds follow naming (`*.types.ts`, `*-payment-method.ts` beside `allegro-payment-status.ts`).
- **Reference**: [Architecture Overview](../architecture-overview.md)

### Naming Conventions
- ✅ `PaymentMethod` / `PaymentMethodValues` / `PAYMENT_METHOD` mirror `PaymentStatus` / `PaymentStatusValues` / `PAYMENT_STATUS`.
- **Reference**: [Engineering Standards - Naming Conventions](../engineering-standards.md#naming-conventions)

### Existing Patterns
- ✅ Same path as #928 (type -> snapshot -> getter -> FE schema) and `totalTaxTreatment` (nullable column). No new abstraction beyond a pure coercer and one test checker.

### Risks
- **R1 - WooCommerce COD currently `paid` (live defect, inferred).** Confirm on a real store; the fix changes the auto-issue-on-paid behaviour for COD orders (correctly). Mitigation: Q4 sign-off + explicit PR note + spec for the unchanged non-COD path.
- **R2 - Wrong COD amount = collecting the wrong money.** Mitigation: prefill only when method is COD **and** amount derivable; `unknown` never pre-fills; amount as decimal string; FE shows the figure read-only as the existing sourced panel does; dispatch spec matrix.
- **R3 - Method/status contradiction** between adapters. Mitigation: shared consistency checker + warn log.
- **R4 - PrestaShop `module`/`payment` not exposed on some shops** -> `unknown`, behaviour unchanged. Mitigation: step 2.3 verification; adapter spec for absent field.
- **R5 - Invoice form mapping mistakes are fiscal-document errors** (KSeF code). Mitigation: map only unambiguous codes, golden-compare unchanged payloads, verify codes against the XSD note; skip providers that cannot take a form.
- **R6 - Scope creep.** Five PRs; each green alone; foundation PR is behaviour-neutral.

### Edge Cases
- Order with no payment data at all -> `unknown`, no chip, no COD UI beyond today's manual path.
- Re-ingestion changes the source method (buyer switches COD to online on a marketplace): snapshot/column follow the latest ingestion; the COD amount is dropped with it (assert in spec).
- Currency empty/zero total on a COD order -> no `codToCollect` (Shoper rule).
- Existing rows: NULL column, no snapshot key -> `unknown`.
- Unrecognised enum from a marketplace later adding a type -> `unknown` + debug log, not a failed job.

### Backward Compatibility
- ✅ All additions optional; `unknown`/absent reproduces today's output byte for byte on every write path (asserted by golden-body specs).
- ⚠ Deliberate behaviour change only for WooCommerce COD (R1) and for PS/WC/Erli COD label pre-fill - both gated on a positively identified COD method.

---

## 9. Testing Strategy & Acceptance Criteria

### Unit Tests
- `payment-method.types.spec.ts` (coercer, `paymentMethodImpliesCod`).
- Per-adapter mapper specs (Allegro, Erli, PrestaShop, WooCommerce, Shoper) - table-driven incl. unseen/blank values.
- `order-record.service.spec.ts` (snapshot key), `order-record.entity.spec.ts` (getter), DTO + MCP projection specs.
- `shipment-dispatch.service.spec.ts` matrix: method x status x sourced amount x caller COD.
- Write side: PS and WC request-body specs (each method + `unknown` golden-equal to today).
- Invoicing: per-adapter payment-form tables + `unknown` golden-equal.
- FE: snapshot schema, header chip, payment panel (5 states), label form (PS COD sourced vs `unknown` manual).
- **Files**: colocated `*.spec.ts` / `*.test.tsx`.

### Integration Tests
- `order-record` repository round trip of the new column (NULL and a value) - apps/api harness.
- PrestaShop Testcontainer: COD order through `importOrder` stores the expected `orders.payment` label (scope assertions to spec-created ids).
- A vertical slice: ingest a fake COD source order -> dispatch with no caller COD -> label command carries `codToCollect`. Prove red first by running it against the pre-change code.
- Migration parity is guarded by `check-migration-timestamps.mjs` + `migration:show`; the harness uses `synchronize`, so state this limit in the PR rather than claiming migration coverage.

### Mocking Strategy
- Ports mocked (`OrderSourcePort`, `InvoicingPort`, repositories); real mappers (pure) in adapter specs; real Postgres for the repository slice; no mocked DB (project rule).

### Acceptance Criteria
- [ ] Closed `PaymentMethod` vocabulary in `libs/core/src/orders` with `unknown` as a first-class member.
- [ ] Allegro, Erli, PrestaShop, WooCommerce (+ Shoper) report a method or `unknown`; none guesses.
- [ ] `order_records.paymentMethod` exists, nullable, additive; existing rows read `unknown`.
- [ ] Field exposed on the order DTO, MCP `get_order`, FE schema.
- [ ] COD label amount pre-filled for PS/WC/Erli COD orders when known; `unknown` never pre-fills.
- [ ] PrestaShop and WooCommerce write the real method; `unknown` output is unchanged from today.
- [ ] Invoice payment form derived per order where the provider accepts one; `unknown` never guesses.
- [ ] #3293 payment panel renders method and real COD amount when known.
- [ ] WooCommerce COD no longer reads `paid` (R1) - or R1 is disproved on a live store and the plan note removed.
- [ ] `pnpm lint`, `pnpm type-check`, `pnpm test` green per PR; `docs/architecture-overview.md` § Orders updated.

**Reference**: [Testing Guide](../testing-guide.md)

---

## 10. Alignment Checklist

- [x] Follows hexagonal architecture
- [x] Respects CORE vs Integration boundaries
- [x] Uses existing patterns (no unnecessary abstractions)
- [x] Idempotency considered (re-ingestion, write side unchanged shape)
- [x] Event-driven patterns used where applicable (n/a - none needed)
- [x] Rate limits & retries addressed (no new outbound calls)
- [x] Error handling comprehensive (`unknown` + log, never throw)
- [x] Testing strategy complete
- [x] Naming conventions followed
- [x] File structure matches standards
- [x] Plan is execution-ready (open questions have safe defaults)
- [x] Plan is saved as markdown file
- [ ] ADR: **not drafted** - the decision (second axis beside `PaymentStatus`) does not cross the ADR bar on its own and the issue does not ask for one; revisit if Q4 precedence is changed to alter the invoicing gate.

---

## Related Documentation

- [Architecture Overview](../architecture-overview.md)
- [Engineering Standards](../engineering-standards.md)
- [Testing Guide](../testing-guide.md)
- [Migrations](../migrations.md)
- [Code Review Guide](../code-review-guide.md)

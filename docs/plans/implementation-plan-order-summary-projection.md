# Implementation Plan: Order-Summary Projection for Shipments & Invoices Lists

**Date**: 2026-08-06
**Status**: Draft
**Estimated Effort**: 1–1.5 days

**Source issue**: [#1995](https://github.com/openlinker-project/openlinker/issues/1995) — "[TASK] CORE — order-summary projection for the unified Order identity cell on Shipments and Invoices"
**Consumed by**: [#1996](https://github.com/openlinker-project/openlinker/issues/1996) — one shared `OrderIdentityCell` / `ConnectionCell` across six list pages, visually specified in `docs/plans/mockups/list-identity-cells-1996.html` (accepted mockup, merged via #1999). This plan implements only the backend data gap #1996 depends on — no rendering work.

---

## 1. Task Summary

**Objective**: Add a read-only `orderSummary` projection to the `GET /shipments` and `GET /invoices` list responses, so an operator can identify which order a shipment/invoice row belongs to (order number, first line-item name + image, item count) without opening the detail page.

**Context**: Six list pages (Orders, Products, Listings, Customers, Shipments, Invoices) are being visually unified around one `OrderIdentityCell` (#1996). Orders already carries everything that cell needs via `OrderRecordResponseDto.orderSnapshot` (`orderNumber`, `items[]`). Shipments and Invoices carry only a bare `orderId` today — no amount of client-side composition can invent the missing fields, so this is a backend-only prerequisite.

**Classification**: CORE (application-layer batch read) + Interface (two list-response DTOs, two controllers).

---

## 2. Scope & Non-Goals

### In Scope
- A new `IOrderRecordService.findByIds(orderIds: string[]): Promise<OrderRecord[]>` batch method (+ matching `OrderRecordRepositoryPort.findByIds`, TypeORM implementation).
- A pure, order-context-owned helper that projects an `OrderRecord.orderSnapshot` into the neutral `orderSummary` shape (handles the untyped-JSONB / unparseable-snapshot case → `null`).
- `orderSummary` added to `ShipmentResponseDto` and `InvoiceRecordResponseDto`, assembled by a **batched** join in each controller (one `findByIds` call per page, not one read per row).
- FE transport types mirrored: `apps/web/src/features/shipments/api/shipments.types.ts`, `apps/web/src/features/invoicing/api/invoicing.types.ts` (+ a shared `OrderSummary` type, colocated per-feature per the existing hand-mirror convention — no cross-feature type sharing is required since both are structurally identical but independently owned per FE contract-mirroring convention).
- Unit tests for the projection helper (edge cases: missing record, unparseable snapshot, single item, multi item) and for both controllers' batching behavior (bounded read count independent of N).

### Out of Scope
- Any rendering work — `OrderIdentityCell`, `ConnectionCell`, and all six list-page changes are #1996, a separate (frontend) issue/plan.
- A `connectionName` projection (explicitly refused in #1995's body, § B).
- A composed `name` field on the Customers list response.
- `ean` on the Products list row (cut from #1995's scope on 2026-08-04; Products' identifier line needs no backend change).
- Sorting/filtering on the unified cells (investigated and dropped in both issues; not filed as a follow-up).
- Populating `Order.items[].imageUrl` at ingestion — per `order.types.ts`, no current adapter sets this field. `firstItemImageUrl` will legitimately be `null` for effectively all orders today; this plan only wires the passthrough, per the accepted mockup's `†` annotation convention marking not-yet-populated data.

### Constraints
- No new persistence, no new column, no migration — `orderSummary` is a server-side join over data that already exists (`order_records.orderSnapshot` JSONB).
- Must not repeat the `resolveCustomerIds` anti-pattern already present in `ShipmentController` (a de-duplicated `Promise.all` fan-out that reads one order at a time) — see `apps/api/src/shipping/http/shipment.controller.ts:433-442`. The acceptance criteria for #1995 are explicitly worded so that shape fails the batching test.
- Cross-context reads must go through `IOrderRecordService` (`@openlinker/core/orders`), never `OrderRecordRepositoryPort`, per `docs/architecture-overview.md § Cross-context dependencies in core`.

---

## 3. Architecture Mapping

**Target Layer**: CORE (`libs/core/src/orders/` — new repository/service method + pure projection helper) and Interface (`apps/api/src/shipping/`, `apps/api/src/invoicing/` — DTO + controller changes).

**Capabilities Involved**: None (no `*Port` capability adapter is touched) — this is a same-process cross-context service read, not an integration capability.

**Existing Services Reused**:
- `IOrderRecordService` (token `ORDER_RECORD_SERVICE_TOKEN`) — already injected into both `ShipmentController` and `InvoicingController`. No new DI wiring needed at either controller; both modules (`libs/core/src/shipping/shipping.module.ts`, `apps/api/src/invoicing/invoicing.module.ts`) already import `OrdersModule`.
- The `getLatestInvoicesForOrders` / `resolveDeliveryForOrders` batched-join pattern in `apps/api/src/orders/http/orders.controller.ts` (lines ~136-170, ~371-405) is the precedent to copy: one call scoped to the whole page's ids, then a `Map` join in the controller.

**New Components Required**:
- `OrderRecordRepositoryPort.findByIds(orderIds: string[]): Promise<OrderRecord[]>` (domain port method).
- `OrderRecordRepository.findByIds` TypeORM implementation (`WHERE id IN (...)`, single query).
- `IOrderRecordService.findByIds(orderIds: string[]): Promise<OrderRecord[]>` (application service passthrough, mirroring the existing `findMany` passthrough pattern).
- A pure projection function `buildOrderSummary(record: OrderRecord | undefined): OrderSummary | null` — lives in the `orders` context (it owns `orderSnapshot`'s shape) and is exported from the top-level barrel so `shipping`/`invoicing` controllers can call it.
- `OrderSummaryProjectionDto` (shared response shape, one file, reused by both response DTOs) mirroring the existing `OrderInvoiceProjectionDto` sub-DTO pattern (`apps/api/src/orders/http/dto/order-invoice-projection.dto.ts`).

**Core vs Integration Justification**: This is CORE, not an integration adapter — it reads OL's own `order_records` table (already populated by every order source) and projects a subset of an existing JSONB column. No external platform is involved. It stays inside the `orders` bounded context because `orderSnapshot`'s internal shape (how `items[]`/`orderNumber` are laid out, and how to safely parse an untyped `Record<string, unknown>`) is a fact only `orders` should know — `shipping` and `invoicing` must not duplicate that parsing logic, mirroring why `orderFromReadySnapshot` and its private `readItems` parser already live in `libs/core/src/orders/domain/`.

---

## 4. External / Domain Research

### Internal Patterns (from codebase research)

**Response DTO shapes today:**
- `ShipmentResponseDto` (`apps/api/src/shipping/http/dto/shipment-response.dto.ts:36-118`) — flat fields (`id, orderId, customerId, connectionId, ...`), built via `static fromDomain(shipment, customerId, canWrite)` (lines 127-156). `customerId` is already threaded in as an out-of-band enrichment parameter — `orderSummary` follows the same shape.
- `InvoiceRecordResponseDto` (`apps/api/src/invoicing/http/dto/invoice-record-response.dto.ts:36-105`) — flat fields, built via `static fromDomain(record: InvoiceRecord)` (lines 107-127), **no enrichment params today** — this signature needs widening to `fromDomain(record, orderSummary)`.

**List handlers:**
- `ShipmentController.list` (`shipment.controller.ts:108-133`): `this.query.list(filters, {limit, offset})` → `resolveCustomerIds(...)` → `.map(s => ShipmentResponseDto.fromDomain(s, customerByOrder.get(...), canWrite))`. The new `orderSummary` Map join slots in right next to the existing `customerByOrder` Map join.
- `InvoicingController.listInvoices` (`invoicing.controller.ts:1073-1103`): `this.invoiceService.listInvoices(filter, {limit, offset})` → `.map(record => this.toDto(record))`. `this.orders` (`IOrderRecordService`, `ORDER_RECORD_SERVICE_TOKEN`) is **already injected** into this controller for other purposes — reused here.
- **Anti-pattern already in the codebase, must not be copied**: `ShipmentController.resolveCustomerIds` (`shipment.controller.ts:433-442`) is a de-duplicated `Promise.all` over single `getOrderRecord` calls — a per-id fan-out disguised as batching. Its own code comment says a real `findByIds` batch is a tracked follow-up. #1995 is that follow-up, scoped now to also serve `orderSummary`.
- **Correct precedent**: `OrdersController` (`apps/api/src/orders/http/orders.controller.ts:136-170` `getLatestInvoicesForOrders`, `:371-405` `resolveDeliveryForOrders`) — one real batched call per page, then a `Map` join. This is the shape #1995's AC requires.

**`IOrderRecordService` today** (`libs/core/src/orders/application/interfaces/order-record.service.interface.ts`): `persistOrder`, `updateSyncStatus`, `persistIncomingSnapshot`, `getOrderRecord(id)` (single), `findMany(filters, pagination)` (paginated, not id-set-scoped), `updateFulfillmentState`, `markItemResolutionFailure`. **No batch-by-ids method exists** — confirmed gap this plan closes.

**`OrderRecordRepositoryPort`** (`libs/core/src/orders/domain/ports/order-record-repository.port.ts`): `findById`, `upsert`, `updateSyncStatus`, `findMany`, `countByHealth`, `countBySla`, `updateFulfillmentState`, `updateItemResolutionFailure`. Same gap at the port level.

**`OrderRecord.orderSnapshot`** (`libs/core/src/orders/domain/entities/order-record.entity.ts:39`): typed as `Record<string, unknown>` — untyped JSONB. `orderFromReadySnapshot` (`libs/core/src/orders/domain/order-from-ready-snapshot.ts:27-90`) is the existing rehydrator, but it **throws `OrderSnapshotUnavailableError`** when `recordStatus !== 'ready'` or the snapshot lacks a usable buyer address — **not safe to reuse for this projection**, since a `source_deleted` / `awaiting_mapping` shipment or invoice row must still render `–` gracefully, not 500. This plan needs a new, narrower, non-throwing parser that reads only `orderNumber` + `items[].name` + `items[].imageUrl` + `items.length`, tolerant of any snapshot shape.

**`Order.items[]` / `OrderItem`** (`order.types.ts:235-254`): `name` and `imageUrl` are both documented as adapter-optional (`imageUrl`: "Reserved for future enrichment — no current adapter sets this on ingestion"). This confirms `firstItemImageUrl: null` is the expected, correct value for virtually every order today — not a bug to chase in this plan.

**FE transport types**: `apps/web/src/features/shipments/api/shipments.types.ts` (`interface Shipment`, hand-mirrors the BE DTO per its file-header convention) and `apps/web/src/features/invoicing/api/invoicing.types.ts` (`interface InvoiceRecord`, same convention) — both need the new field added, matching the existing "hand-written types until the contract stabilizes" FE convention (`docs/frontend-architecture.md § API Client Conventions`).

**Module wiring**: `libs/core/src/shipping/shipping.module.ts` and `apps/api/src/invoicing/invoicing.module.ts` already import `OrdersModule` for `ORDER_RECORD_SERVICE_TOKEN` (acyclic — `OrdersModule` does not import either back). **No new module wiring required.**

### External System
Not applicable — no external platform involved.

---

## 5. Questions & Assumptions

### Open Questions
- None blocking. The issue body is unusually precise (rewritten 2026-08-04) and already resolves the ambiguous points (batching shape, assembly location, PII stance, out-of-scope items).

### Assumptions
- **`findByIds` returns `OrderRecord[]` (order unspecified), never throws for missing ids.** A missing/soft-deleted order id is simply absent from the returned array; the controller's `Map.get(orderId)` naturally yields `undefined` → `orderSummary: null`. This matches the AC "`orderSummary` is `null` when no order record resolves for the row's `orderId`."
- **The projection helper does not use `orderFromReadySnapshot`.** It reads `orderSnapshot.orderNumber` and `orderSnapshot.items` directly with defensive `unknown`-narrowing (mirroring the tolerant style of `readItems` in `order-from-ready-snapshot.ts`, but non-throwing) so a `recordStatus !== 'ready'` row still degrades to a partial or `null` `orderSummary` instead of failing the whole list request.
- **Line-item name and image are not PII** (per the issue body) — not gated by `OL_STORE_PII`.
- **Only the first line item is projected**; `itemCount` carries the rest via the existing `+N` UI convention (frontend concern, out of scope here).
- **The batch method takes an unbounded `orderIds: string[]` scoped to one page** (typically ≤ the list's page size, e.g. 20–50) — no additional chunking/pagination is needed on `findByIds` itself since callers always pass a bounded, already-paginated id set.
- **No new DI tokens or module imports are needed** — both controllers already have `IOrderRecordService` injected for other purposes.

### Documentation Gaps
- None identified; `docs/architecture-overview.md § Identifier Mapping Service` / `§ Cross-context dependencies in core` and the existing `orders.controller.ts` precedent fully cover the pattern this plan follows.

---

## 6. Proposed Implementation Plan

### Phase 1: CORE — batch read + projection helper

**Goal**: Give `orders` a real batch-by-ids read, and a pure, non-throwing projection from `OrderRecord` to the neutral `orderSummary` shape.

**Steps**:

1. **Add `findByIds` to the repository port**
   - **File**: `libs/core/src/orders/domain/ports/order-record-repository.port.ts`
   - **Action**: Add `findByIds(orderIds: string[]): Promise<OrderRecord[]>` to `OrderRecordRepositoryPort`, with a doc comment stating it returns only the records that exist (silently omits missing ids), single query, no pagination.
   - **Acceptance**: Interface compiles; no existing implementer breaks (added as a new method, not a signature change).
   - **Dependencies**: None.

2. **Implement `findByIds` in the TypeORM repository**
   - **File**: `libs/core/src/orders/infrastructure/persistence/repositories/order-record.repository.ts`
   - **Action**: `async findByIds(orderIds: string[]): Promise<OrderRecord[]> { if (orderIds.length === 0) return []; const entities = await this.ormRepository.find({ where: { id: In(orderIds) } }); return entities.map((e) => this.toDomain(e)); }` — reuse the repository's existing private `toDomain` mapper. Early-return `[]` on an empty input array avoids TypeORM emitting `WHERE id IN ()` (which some drivers reject).
   - **Acceptance**: Unit test — given 3 seeded ids + 1 non-existent id, returns exactly the 3 matching domain entities, no error on the 4th.
   - **Dependencies**: Step 1.

3. **Add `findByIds` to `IOrderRecordService` + implement in `OrderRecordService`**
   - **Files**: `libs/core/src/orders/application/interfaces/order-record.service.interface.ts`, `libs/core/src/orders/application/services/order-record.service.ts` (or the equivalent implementer file — confirm exact filename during implementation; it's the class registered under `ORDER_RECORD_SERVICE_TOKEN`).
   - **Action**: Add `findByIds(orderIds: string[]): Promise<OrderRecord[]>` to the interface with a doc comment matching the existing `findMany` doc's framing ("the cross-context surface... repository ports are forbidden across context boundaries..."). Implement as a pure passthrough to `this.repo.findByIds(orderIds)`, mirroring the existing `findMany` passthrough.
   - **Acceptance**: Unit test — service method delegates to the mocked repository port and returns its result unchanged.
   - **Dependencies**: Steps 1–2.

4. **Add a pure `buildOrderSummary` projection helper**
   - **File**: New `libs/core/src/orders/domain/order-summary-projection.ts` (domain-layer, pure function — no I/O, no framework — consistent with `order-from-ready-snapshot.ts` sitting in `domain/`).
   - **Action**:
     ```typescript
     export interface OrderSummary {
       orderNumber: string | null;
       firstItemName: string | null;
       firstItemImageUrl: string | null;
       itemCount: number;
     }

     export function buildOrderSummary(record: OrderRecord | undefined): OrderSummary | null {
       if (!record) return null;
       const snapshot = record.orderSnapshot;
       const items = Array.isArray(snapshot?.items) ? snapshot.items : [];
       if (items.length === 0) return null;
       const first = items[0] as Record<string, unknown>;
       return {
         orderNumber: typeof snapshot?.orderNumber === 'string' ? snapshot.orderNumber : null,
         firstItemName: typeof first?.name === 'string' ? first.name : null,
         firstItemImageUrl: typeof first?.imageUrl === 'string' ? first.imageUrl : null,
         itemCount: items.length,
       };
     }
     ```
     (Exact narrowing style to match project conventions — no `any`, `unknown`-narrow per field, matching engineering-standards.md § Type Safety.)
   - **Acceptance**: Unit tests — (a) `undefined` record → `null`; (b) record with empty/missing `items` → `null` (AC: "`orderSummary` is `null` when the order record exists but its snapshot has no parseable items"); (c) record with 1 item → `itemCount: 1`, fields populated; (d) record with 3 items → `itemCount: 3`, only first item's fields surfaced; (e) snapshot missing `orderNumber` → `orderNumber: null`, other fields still populated.
   - **Dependencies**: None (independent of steps 1–3, can be built in parallel).

5. **Export the new surface from the `orders` barrel**
   - **File**: `libs/core/src/orders/index.ts`
   - **Action**: Export `buildOrderSummary`, `OrderSummary` (type) from the top-level barrel (`@openlinker/core/orders`) so `apps/api/src/shipping/` and `apps/api/src/invoicing/` can import them — matches the allowed cross-context symbol shapes (`type alias`/value export) documented in `docs/architecture-overview.md § Cross-context dependencies in core`. `findByIds` reaches consumers only through `IOrderRecordService`, already exported.
   - **Acceptance**: `import { buildOrderSummary, type OrderSummary } from '@openlinker/core/orders';` resolves from `apps/api/**`.
   - **Dependencies**: Step 4.

### Phase 2: Interface — Shipments

**Goal**: `GET /shipments` returns `orderSummary` per row, batched.

**Steps**:

6. **Add `OrderSummaryProjectionDto`**
   - **File**: New `apps/api/src/orders/http/dto/order-summary-projection.dto.ts` (colocated with the existing sibling `order-invoice-projection.dto.ts`, since both are small enrichment sub-DTOs reused across contexts).
   - **Action**: Class with `@ApiProperty` decorators for `orderNumber`, `firstItemName`, `firstItemImageUrl` (all `string | null`), `itemCount` (`number`), plus a `static fromSummary(summary: OrderSummary): OrderSummaryProjectionDto` mapper.
   - **Acceptance**: Swagger schema renders correctly; unit test for `fromSummary`.
   - **Dependencies**: Phase 1 step 4 (needs the `OrderSummary` type).

7. **Add `orderSummary` to `ShipmentResponseDto`**
   - **File**: `apps/api/src/shipping/http/dto/shipment-response.dto.ts`
   - **Action**: Add `orderSummary!: OrderSummaryProjectionDto | null;` field with `@ApiProperty({ nullable: true, type: OrderSummaryProjectionDto })`. Widen `static fromDomain(shipment, customerId, canWrite, orderSummary: OrderSummary | null)` to accept and map the new param (mirrors the existing `customerId` enrichment-param pattern).
   - **Acceptance**: Existing `fromDomain` call sites (only the controller, per research) updated; DTO unit test asserts `orderSummary` round-trips.
   - **Dependencies**: Step 6.

8. **Batch-join in `ShipmentController.list`**
   - **File**: `apps/api/src/shipping/http/shipment.controller.ts`
   - **Action**: In `list(...)`, after fetching `page.items`, call `this.orders.findByIds(page.items.map((s) => s.orderId))` **once**, build `const summaryByOrderId = new Map(records.map((r) => [r.id, buildOrderSummary(r)]))`, then pass `summaryByOrderId.get(s.orderId) ?? null` into `ShipmentResponseDto.fromDomain(...)`. Import `buildOrderSummary`/`OrderSummary` from `@openlinker/core/orders`.
   - **Acceptance**: Integration/unit test asserts exactly **one** `findByIds` call per `list` invocation regardless of page size (the AC explicitly requires this to distinguish it from the `resolveCustomerIds` anti-pattern already in the file). Do **not** add a second `Promise.all`-style loop next to the existing `resolveCustomerIds` — the two Maps (`customerByOrder`, `summaryByOrderId`) can be built from sibling batched calls, or combined into one call if `findByIds` conveniently returns enough to resolve both (see step 11 for the optional consolidation note).
   - **Dependencies**: Phase 1 steps 1-5, step 7.

### Phase 3: Interface — Invoices

**Goal**: `GET /invoices` returns the same `orderSummary` shape per row, batched.

**Steps**:

9. **Add `orderSummary` to `InvoiceRecordResponseDto`**
   - **File**: `apps/api/src/invoicing/http/dto/invoice-record-response.dto.ts`
   - **Action**: Add `orderSummary!: OrderSummaryProjectionDto | null;` field. Widen `static fromDomain(record: InvoiceRecord, orderSummary: OrderSummary | null)`.
   - **Acceptance**: DTO unit test round-trips the field; existing single-arg call sites updated (`fromDomain` currently has no enrichment params, so every call site in `invoicing.controller.ts`'s `toDto` needs the new argument threaded through).
   - **Dependencies**: Step 6.

10. **Batch-join in `InvoicingController.listInvoices`**
    - **File**: `apps/api/src/invoicing/http/invoicing.controller.ts`
    - **Action**: In `listInvoices(...)`, after `this.invoiceService.listInvoices(filter, {limit, offset})` resolves `page`, call `this.orders.findByIds(page.items.map((r) => r.orderId))` once, build the `orderId → OrderSummary|null` map, thread through `this.toDto(record, summaryByOrderId.get(record.orderId) ?? null)` (widen `toDto`'s signature to accept the summary and forward it to `InvoiceRecordResponseDto.fromDomain`).
    - **Acceptance**: Same batching test as step 8 — one `findByIds` call per `listInvoices` invocation, independent of N. `InvoiceService.listInvoices` itself is **untouched** (stays a pure repository projection, per research finding #5 — the join happens in the controller, matching where `this.orders` is already injected).
    - **Dependencies**: Phase 1, step 9.

### Phase 4: Frontend transport types (mirror only — no rendering)

**Goal**: FE-side hand-mirrored types stay in sync with the BE contract, unblocking #1996's `OrderIdentityCell` work without doing any of it here.

**Steps**:

11. **Mirror `orderSummary` on both FE feature types**
    - **Files**: `apps/web/src/features/shipments/api/shipments.types.ts`, `apps/web/src/features/invoicing/api/invoicing.types.ts`
    - **Action**: Add an `OrderSummary` interface (`{ orderNumber: string | null; firstItemName: string | null; firstItemImageUrl: string | null; itemCount: number }`) and `orderSummary: OrderSummary | null;` on `Shipment` / `InvoiceRecord` respectively. Per the existing FE convention (hand-written mirrors, no shared cross-feature type for this shape yet — each feature owns its own copy, matching how both files already duplicate their BE DTO independently).
    - **Acceptance**: `pnpm type-check` passes; no runtime behavior change (the field is unused until #1996 consumes it).
    - **Dependencies**: Phase 2 + 3 (needs the final field shape).

---

### Implementation Details

**New Components**:
- **Domain** (`libs/core/src/orders/domain/`): `order-summary-projection.ts` (pure function `buildOrderSummary` + `OrderSummary` type — no new entity/exception).
- **Domain ports** (`libs/core/src/orders/domain/ports/`): `OrderRecordRepositoryPort.findByIds` (method addition, no new file).
- **Application** (`libs/core/src/orders/application/`): `IOrderRecordService.findByIds` (interface addition) + implementation in the existing service class (no new file).
- **Infrastructure** (`libs/core/src/orders/infrastructure/persistence/repositories/`): `OrderRecordRepository.findByIds` (method addition, no new file).
- **Interface** (`apps/api/src/orders/http/dto/`): new `order-summary-projection.dto.ts`.
- **Interface** (`apps/api/src/shipping/`, `apps/api/src/invoicing/`): DTO field + controller batch-join additions (no new files beyond #6).

**Configuration Changes**: None.

**Database Migrations**: None — `orderSummary` reads an existing JSONB column (`order_records.orderSnapshot`), no schema change.

**Events**: None emitted or consumed — this is a synchronous read-path projection.

**Error Handling**:
- `buildOrderSummary` never throws — it degrades to `null` or partial-`null` fields on any unexpected/missing snapshot shape (explicit design choice; see Phase 1 step 4's acceptance criteria).
- `findByIds` with an empty input array short-circuits to `[]` before hitting the database (avoids a malformed `IN ()` query).
- A missing order id (deleted, or a shipment/invoice orphaned from its order) simply doesn't appear in the `findByIds` result, and the `Map.get(...) ?? null` join degrades to `orderSummary: null` — no exception path needed at the controller layer.

---

## 7. Alternatives Considered

### Alternative 1: Add an `ids` filter to `OrderRecordFilters` and reuse `findMany` instead of a new `findByIds` method
- **Description**: Extend `OrderRecordFilters` with an optional `ids?: string[]` field, translate it to `WHERE id IN (...)` inside the existing `findMany` repository method, and call `findMany({ ids: orderIds }, { limit: orderIds.length, offset: 0 })` from the controllers.
- **Why Rejected**: `findMany` is paginated-list-shaped (returns `PaginatedOrderRecords` with a `total` count, sorting, etc.) — semantically wrong for "give me exactly these N known ids, unordered, no total needed." Forcing a page-size pagination param onto an id-set lookup is a category error that would confuse future callers. A dedicated `findByIds` is smaller, clearer, and matches `InvoiceService.getLatestInvoicesForOrders`'s already-established shape (`orderId → entity` batch lookup, no pagination).
- **Trade-offs**: One more interface method vs. widening an existing filter type. The extra method is worth it for API clarity.

### Alternative 2: Reuse `orderFromReadySnapshot` for the projection instead of a new lightweight parser
- **Description**: Call the existing `orderFromReadySnapshot(record)` rehydrator and read `.orderNumber` / `.items` off the resulting `Order`.
- **Why Rejected**: `orderFromReadySnapshot` throws `OrderSnapshotUnavailableError` whenever `recordStatus !== 'ready'` (e.g. `awaiting_mapping`, `source_deleted`) or the snapshot lacks a usable buyer address. A shipment or invoice can legitimately exist for an order in any of those states, and the whole list request must not 500 because one row's order snapshot is incomplete — it should just render `orderSummary: null` or a partial value for that row. A non-throwing, narrower parser is required.
- **Trade-offs**: Slight duplication of "how to read `items[]` off an untyped snapshot" between `readItems` (private to the rehydrator) and the new `buildOrderSummary`. Accepted because the two functions have genuinely different failure semantics (fail-fast rehydration for downstream order-processing vs. tolerant best-effort projection for a list cell) — conflating them would make one of the two behave wrong.

---

## 8. Validation & Risks

### Architecture Compliance
- ✅ Cross-context read goes through `IOrderRecordService` (a service interface + Symbol token), never `OrderRecordRepositoryPort` directly — `shipping`/`invoicing` controllers only ever import from `@openlinker/core/orders`'s top-level barrel.
- ✅ Domain layer (`buildOrderSummary`) has zero framework dependencies — pure TypeScript, no NestJS/TypeORM imports.
- ✅ No repository port or ORM entity crosses the context boundary (only the service interface, the pure helper function, and its plain `OrderSummary` type — all allowed shapes per `docs/architecture-overview.md § Cross-context dependencies in core`).

### Naming Conventions
- ✅ `order-summary-projection.ts` follows `*.types.ts`-adjacent domain-helper naming used by `order-from-ready-snapshot.ts` (a precedent for a domain-layer pure function file that isn't a `.entity.ts`/`.vo.ts`).
- ✅ `OrderSummaryProjectionDto` matches the sibling `OrderInvoiceProjectionDto` naming exactly.

### Existing Patterns
- ✅ Batched Map-join in the controller mirrors `getLatestInvoicesForOrders` / `resolveDeliveryForOrders` in `orders.controller.ts` verbatim.
- ✅ `fromDomain(entity, ...enrichmentParams)` signature widening mirrors the existing `customerId` param on `ShipmentResponseDto.fromDomain`.

### Risks
- **Risk**: A future call site of `ShipmentResponseDto.fromDomain` / `InvoiceRecordResponseDto.fromDomain` forgets to pass the new `orderSummary` param, since TypeScript won't catch a *forgotten* new required param at existing call sites only if it's optional. **Mitigation**: make the new param required (not optional) on both `fromDomain` signatures — the compiler then forces every call site to supply it (even if `null`), which is exactly what `pnpm type-check` in the quality gate will catch.
- **Risk**: `resolveCustomerIds`'s per-id fan-out already exists in `ShipmentController` — a reviewer or future contributor might copy that shape by proximity when adding the `orderSummary` join right next to it. **Mitigation**: add a short code comment at the new `findByIds` call site explicitly contrasting it with `resolveCustomerIds` below it, and cover the bounded-read-count behavior with an explicit unit test (per AC).
- **Risk**: `orderSnapshot` is `Record<string, unknown>` with no runtime schema validation — a malformed/legacy snapshot (e.g. from a schema version predating some field) could have `items` as something other than an array. **Mitigation**: `buildOrderSummary`'s `Array.isArray(snapshot?.items)` guard + per-field `typeof` narrowing already covers this defensively (Phase 1 step 4).

### Edge Cases
- Order record does not exist for `orderId` → `orderSummary: null`.
- Order record exists but `orderSnapshot.items` is missing/empty/not an array → `orderSummary: null`.
- Order record exists, `items` non-empty, but `orderNumber` missing → `orderSummary` populated with `orderNumber: null` (partial, not fully null — matches the "leads with order number, falls back to shortened id" convention documented in #1996, which the FE will handle).
- A page contains duplicate `orderId`s across rows (e.g. two shipments for the same order) → `findByIds` naturally de-dupes via the `Map` key; no repeated DB work, no double-counting in the read-count assertion (dedupe `orderIds` before calling `findByIds`, mirroring `resolveCustomerIds`'s existing `[...new Set(...)]` step — the one part of that method worth keeping).
- Empty page (`page.items.length === 0`) → `findByIds([])` short-circuits to `[]`, no DB round-trip at all.

### Backward Compatibility
- ✅ Purely additive — a new nullable field on two existing response DTOs. No existing consumer breaks; the OpenAPI schema gains one new optional/nullable property per endpoint.
- No breaking changes; no migration required.

---

## 9. Testing Strategy & Acceptance Criteria

### Unit Tests
- `libs/core/src/orders/domain/order-summary-projection.spec.ts`:
  - `undefined` record → `null`.
  - Missing/empty/non-array `items` → `null`.
  - Single-item snapshot → correct `orderNumber`/`firstItemName`/`firstItemImageUrl`/`itemCount: 1`.
  - Multi-item snapshot → only first item surfaced, `itemCount` reflects full length.
  - Missing `orderNumber` → `orderNumber: null`, rest populated.
- `libs/core/src/orders/infrastructure/persistence/repositories/order-record.repository.spec.ts`: `findByIds` — empty array input → `[]` with no query issued (mock assertion); non-empty ids → maps through `toDomain` correctly; a requested id with no matching row is simply absent from the result.
- `libs/core/src/orders/application/services/order-record.service.spec.ts` (or existing file): `findByIds` passthrough delegates to the mocked repository port.
- `apps/api/src/shipping/http/dto/shipment-response.dto.spec.ts`: `fromDomain` with a non-null `orderSummary` round-trips it onto the DTO.
- `apps/api/src/invoicing/http/dto/invoice-record-response.dto.spec.ts`: same, for `InvoiceRecordResponseDto`.
- `apps/api/src/shipping/http/shipment.controller.spec.ts`: given N shipments across M distinct order ids (M < N, to prove dedup), `list()` calls the mocked `IOrderRecordService.findByIds` **exactly once**, with the deduplicated id set; each returned DTO carries the correct `orderSummary` (or `null`) for its `orderId`.
- `apps/api/src/invoicing/http/invoicing.controller.spec.ts`: same shape for `listInvoices`.

### Integration Tests
- Not strictly required (no new schema, no new HTTP-boundary contract behavior beyond an additive field) — the unit-test coverage above (particularly the controller-level batching assertion) is sufficient per `docs/testing-guide.md`'s guidance to reserve integration tests for behavior that depends on real Postgres/Redis wiring. If the team wants belt-and-suspenders coverage, extend the existing `apps/api/test/integration/` shipments/invoices list specs (if any) to assert the new field's presence end-to-end against a seeded order + shipment/invoice row — optional, not blocking.

### Mocking Strategy
- Mock `OrderRecordRepositoryPort` in the repository/service unit tests (per `docs/engineering-standards.md § Mocking Ports`).
- Mock `IOrderRecordService` (specifically `findByIds`) in both controller unit tests — never a concrete `OrderRecordService` instance.

### Acceptance Criteria (from #1995, verbatim, mapped to this plan)
- [ ] `GET /shipments` returns `orderSummary` per row with `orderNumber`, `firstItemName`, `firstItemImageUrl`, `itemCount` — Phase 2.
- [ ] `GET /invoices` returns the same `orderSummary` shape per row — Phase 3.
- [ ] `orderSummary` is `null` when no order record resolves for the row's `orderId` — Phase 1 step 4.
- [ ] `orderSummary` is `null` when the order record exists but its snapshot has no parseable items — Phase 1 step 4.
- [ ] `itemCount` reflects the order's full item count, not the number of projected items — Phase 1 step 4.
- [ ] `firstItemImageUrl` comes from the order snapshot, not from the live product catalogue — Phase 1 step 4 (no `ProductMasterPort` call anywhere in this plan).
- [ ] A page of N rows issues a bounded number of order reads independent of N — Phase 2 step 8 / Phase 3 step 10, explicitly tested.
- [ ] No list response gained a `connectionName` field — confirmed out of scope, not touched anywhere in this plan.
- [ ] FE transport types mirror the new field on shipments and invoicing — Phase 4.
- [ ] Tests added or updated for non-trivial logic — § 9 above.
- [ ] No architecture boundary violations — § 8 Architecture Compliance.

---

## 10. Alignment Checklist

- [x] Follows hexagonal architecture — projection helper in domain, service/repository in application/infrastructure, DTOs in interface.
- [x] Respects CORE vs Integration boundaries — no integration/adapter touched; cross-context read via `IOrderRecordService` only.
- [x] Uses existing patterns (no unnecessary abstractions) — reuses the `getLatestInvoicesForOrders`/`resolveDeliveryForOrders` batched-Map-join shape and the `OrderInvoiceProjectionDto` sub-DTO precedent; no new capability port, no new module.
- [x] Idempotency considered — pure read, no side effects; N/A for mutation idempotency.
- [x] Event-driven patterns used where applicable — N/A, synchronous read-path only.
- [x] Rate limits & retries addressed — N/A, internal DB read only, no external API call.
- [x] Error handling comprehensive — `buildOrderSummary` never throws; `findByIds` short-circuits on empty input; missing ids degrade to `null` via `Map.get(...) ?? null`.
- [x] Testing strategy complete — unit coverage at every new layer, explicit batching assertion at both controllers.
- [x] Naming conventions followed — `*.port.ts` method addition, `*.service.interface.ts` method addition, `*.dto.ts` sibling to existing `OrderInvoiceProjectionDto`.
- [x] File structure matches standards — new files land in the same directories as their siblings (`domain/`, `http/dto/`).
- [x] Plan is execution-ready.
- [x] Plan is saved as markdown file.

---

## Related Documentation

- [Architecture Overview](../architecture-overview.md) — § Orders, § Cross-context dependencies in core
- [Engineering Standards](../engineering-standards.md) — § Repository Ports Pattern, § Type Safety, § Symbol DI Token Re-export Convention
- [Testing Guide](../testing-guide.md)
- [Code Review Guide](../code-review-guide.md)
- Consuming issue / mockup: [#1996](https://github.com/openlinker-project/openlinker/issues/1996), `docs/plans/mockups/list-identity-cells-1996.html`

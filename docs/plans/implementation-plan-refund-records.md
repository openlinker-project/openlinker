# Implementation Plan: Orders — Capture Return/Refund/Withdrawal as First-Class Record State

**Date**: 2026-08-12
**Status**: Draft
**Estimated Effort**: 1.5–2 days
**Source Issue**: [openlinker-project/openlinker#2036](https://github.com/openlinker-project/openlinker/issues/2036)

---

## 1. Task Summary

**Objective**: Add a minimal, capture-only `RefundRecord` concept to the `orders` bounded context so that a return, refund, or withdrawal against an order can be recorded and read back — closing the gap where `OrderStatusValues`/`PaymentStatusValues` declare a `'refunded'` value that nothing in the codebase ever writes, and no entity anywhere stores a refund amount.

**Context**: `docs/specs/product-spec-1976-analytics.md` names "no return entity anywhere" and "`refunded` exists as an unwritten enum member" as known true gaps. This blocks #1990 (Returns & refunds card on `/analytics`) and the `Net sales = GMV − refunded value` metric, and is a real operational blind spot given Poland's 14-day statutory right of withdrawal. This issue is scoped to *capturing* the fact that a refund happened and how much — not to processing a return, not to wiring `'refunded'` into any state machine, and not to automatic ingestion from marketplace-native return events.

**Classification**: CORE (primary — new domain entity, port, repository, application service, migration) + Interface (a small operator-facing controller in `apps/api`).

---

## 2. Scope & Non-Goals

### In Scope
- A `RefundRecord` domain entity in `libs/core/src/orders/domain/entities/` capturing `internalOrderId`, an amount (value + currency), a reason, an optional free-text note, and a recorded timestamp.
- A repository port + TypeORM-backed repository + migration persisting refund records in a new `refund_records` table.
- An application service (`IOrderRefundService` / `OrderRefundService`) providing: record-a-refund, list-refunds-for-an-order, and a **batch** summary read (count + total amount per order) for a set of order ids — the seam #1987/#1988/#1990 consume without reaching into `orders` internals.
- A minimal operator-facing HTTP write path: `POST /orders/:internalOrderId/refunds` (role-gated) and `GET /orders/:internalOrderId/refunds` (read, order-detail use case).
- Unit tests for the entity, repository, service, and controller. One integration test exercising the full HTTP → DB round trip.

### Out of Scope
- Automatic ingestion from a marketplace's native return/refund events (Allegro or any other `OrderSourcePort` adapter). Tracked as a per-platform follow-up if pursued.
- Wiring `'refunded'` on `OrderStatusValues` / `PaymentStatusValues` into any state machine or transition logic. Both enums are left exactly as-is.
- Any change to `order-summary-projection.ts` or a future analytics read model (#1985's projection). This issue only makes the data queryable via `IOrderRefundService`; the follow-up that threads it into an analytics projection is separate, per the issue's own "Dependencies" section.
- A public, query-string-driven batch HTTP endpoint for refund summaries. The AC requirement ("a read path... for a set of orders") is satisfied by an in-process service method (`getRefundSummariesForOrders`), consumed directly by future core/application code (e.g. #1985's projection or #1990's analytics service) the same way `IInvoiceService.getLatestInvoicesForOrders` is consumed today — not by a new FE-facing route.
- Any FE work. This is a backend-only capture primitive; a future FE surface (an "Add refund" action on the order-detail page) is a natural follow-up but not requested by this issue's acceptance criteria.
- Partial-refund reconciliation, refund-vs-order-total validation, or currency-mismatch enforcement (see Assumptions).

### Constraints
- Must not blur the CORE ↔ Integration boundary: no marketplace-specific code, capture logic lives entirely in `orders` core.
- Must not repurpose or write to `OrderStatusValues`/`PaymentStatusValues` `'refunded'` members (explicit non-goal per the issue).
- Must follow the existing `orders`-context conventions exactly (anemic entities per ADR-011, Symbol DI tokens, repository-port error conversion, decimal-string money per the `CodToCollect` precedent) rather than introducing a new `Money` value object.

---

## 3. Architecture Mapping

**Target Layer**: CORE (`libs/core/src/orders/`) for the domain/application/infrastructure work; Interface (`apps/api/src/orders/`) for the HTTP write/read path.

**Capabilities Involved**: None — this is not adapter-facing. No `*Port` capability (like `OfferManagerPort` or `OrderSourcePort`) is touched; `RefundRecord` is OL-owned data, analogous to `InvoiceRecord` in the `invoicing` context, which is also capture-only and not backed by a capability port for its persistence half.

**Existing Services Reused**:
- `IOrderRecordService.getOrderRecord(internalOrderId)` (`libs/core/src/orders/application/interfaces/order-record.service.interface.ts`) — used by the controller to verify the order exists before accepting a refund write, mirroring `InvoicingController.issueInvoice`'s `if (!record) throw new NotFoundException(...)` pattern.
- The existing `orders.tokens.ts` / `orders.module.ts` / `index.ts` wiring conventions (extended, not replaced).

**New Components Required**:
- Domain: `RefundRecord` entity, `refund-record.types.ts` (reason union, summary type, create-input type).
- Domain: `RefundRecordRepositoryPort`.
- Infrastructure: `RefundRecordOrmEntity`, `RefundRecordRepository`.
- Application: `IOrderRefundService`, `OrderRefundService`.
- Interface: `RefundsController`, request/response DTOs.
- Migration: `1833000000000-create-refund-records.ts`.

**Core vs Integration Justification**: This is capture-only, operator-authored data (an operator records that a return happened), structurally identical to how `InvoiceRecord` — also a satellite entity inside `libs/core/src/invoicing/`, itself depending on `orders` — is not adapter-backed for its own persistence. It belongs in CORE because: (1) the data has no external system of record to adapt to in v1 (manual capture only, per the issue's own scoping), (2) it must be queryable by any future analytics/reporting core service without an Integration-layer detour, and (3) `orders` already owns other order-lifecycle satellite data (`OrderRecord.fulfillmentState`, a rollup *pushed from* the `shipping` context) — `RefundRecord` follows the same "orders owns lifecycle facts about an order" precedent, just as its own table rather than a denormalized column, because refunds are 1-to-many per order (unlike a single fulfillment rollup value).

**Reference**: [Architecture Overview - Hexagonal Architecture Structure](../architecture-overview.md#hexagonal-architecture-structure)

---

## 4. External / Domain Research

### External System
Not applicable — v1 is manual/operator-facing capture only, per the issue's explicit assumption. No marketplace API, auth flow, or rate limit is touched.

### Internal Patterns
- **Closest sibling precedent — `InvoiceRecord`** (`libs/core/src/invoicing/domain/entities/invoice-record.entity.ts`): a satellite entity in a context that depends on `orders` (mirroring the direction `RefundRecord` will *not* need — it lives inside `orders` itself, so there's no cross-context dependency to add at all). Its repository port's `findLatestByOrderIds(orderIds: string[])` batch method is the direct template for the refund summary batch read.
- **Money shape — `CodToCollect`** (`libs/core/src/orders/domain/types/cod-to-collect.types.ts`): `{ amount: string; currency: string }`, a decimal string specifically to avoid float rounding across the adapter/persistence boundary. `RefundRecord.amount` follows this shape rather than a raw `number` and rather than inventing a new shared `Money` value object (none exists in `orders` to reuse).
- **Denormalized lifecycle rollup precedent — `OrderRecord.fulfillmentState`** (`order-record.entity.ts:60`, #1108): a value pushed from a sibling context via a dedicated repository method (`updateFulfillmentState`). Considered and explicitly **not** adopted for v1 (see § Alternatives Considered) — refunds are naturally 1-to-many per order, so a dedicated table (mirroring `InvoiceRecord`, not a single denormalized column) is the correct shape.
- **Batch-read + graceful-degradation pattern** (`InvoicingController.resolveOrderSummaries`, `ShipmentController.resolveOrderContext` at `apps/api/src/shipping/http/shipment.controller.ts:446`): de-dupe ids, one batch query, build a `Map` keyed by order id, degrade to an empty map on failure rather than throwing — this is the shape `getRefundSummariesForOrders` and any future controller-side enrichment helper must follow.
- **Operator-facing manual-action write endpoint** (`InvoicingController`'s `POST .../mark-paid` with `@Roles('admin')`; `ShipmentController`'s `POST /generate-label` with `@Roles('admin', 'operator')`): confirms the global `JwtAuthGuard` + `RolesGuard` (`APP_GUARD`) already covers every route — a new write route needs only its own `@Roles(...)` decorator, never a redundant `@UseGuards(JwtAuthGuard)`. Reads carry no `@Roles` at all (open to any authenticated role).
- **Migration template** — `apps/api/src/migrations/1808000000000-create-invoice-records.ts`: `CREATE TABLE` guarded by `getTable()` existence check, plain non-FK indexed `text` column referencing `order_records.internalOrderId` (confirmed `text`, not `uuid`) — the codebase's established convention of *not* adding a hard FK constraint from a sibling table into `order_records`, avoiding cross-table lock coupling. `RefundRecord.internalOrderId` follows the same plain-indexed-`text` shape.
- **Naming collision check**: no `RefundsController`/`RefundController`/`RefundRecord` exists anywhere in the repo today. `'Refund'` is accepted by `identifier-mapping`'s entity-type prefix resolver (`libs/core/src/identifier-mapping/domain/types/identifier-mapping.types.ts:40`) with no backing entity — this plan deliberately does **not** wire `RefundRecord.id` through `IdentifierMappingService`; like `InvoiceRecord`, it uses a plain UUID primary key, so no change to `identifier-mapping` is needed (see § Questions & Assumptions).
- **Latest migration timestamp tail**: `1832000000007-add-shipment-waybill-relayed-at.ts`. Next synthetic timestamp per `docs/migrations.md` § Timestamp uniqueness invariant: `1833000000000`.

---

## 5. Questions & Assumptions

### Open Questions
- Should a refund's `currency` be validated against the order's own currency at write time? No such validation exists for other order-adjacent money fields (`CodToCollect` isn't cross-validated against `OrderTotals.currency` either) — deferred as a follow-up if it proves necessary.
- Should `RefundsController` live as its own file registered alongside the existing `OrdersController` in `apps/api/src/orders/orders.module.ts`, or should the two write/read routes be added directly to `OrdersController`? This plan chooses a separate `RefundsController` file (single-responsibility, mirrors how `InvoicingController` is its own file rather than folded into `OrdersController`) but both controllers share the `orders` module and the `/orders` route prefix.

### Assumptions
- **Money shape**: `amount: string` (decimal string) + `currency: string` (ISO 4217, 3-letter), following the `CodToCollect` precedent — not a new `Money` value object, not a raw `number`.
- **Reason shape**: a small `as const` union (`RefundReasonValues`) rather than pure free text, so #1990's future "returns by reason" breakdown doesn't require a separate categorization pass later. An optional free-text `note` field covers operator context that doesn't fit the union. Values chosen to match the issue's own PL-withdrawal framing: `'withdrawal' | 'defective' | 'not_as_described' | 'wrong_item' | 'other'`.
- **Primary key**: a plain UUID (`RefundRecordOrmEntity.id`), generated via `uuid_generate_v4()` — mirroring `InvoiceRecord`, not routed through `IdentifierMappingService`. `RefundRecord` is OL-owned data with no external-platform identifier to map, so identifier-mapping's `getOrCreateInternalId` doesn't apply (it exists to translate *external* platform ids to internal ones).
- **No FK constraint** from `refund_records.internalOrderId` to `order_records.internalOrderId` — a plain indexed `text` column, matching the `invoice_records.orderId` precedent. This avoids hard cross-table lock coupling; existence is instead verified at the application/controller layer via `IOrderRecordService.getOrderRecord`.
- **No idempotency key required** for the write endpoint. Unlike sync-flow writes (which guard against at-least-once redelivery from a queue or webhook), this is a manual, operator-initiated, additive write with no external side effect to double-fire — multiple genuine partial refunds against one order are valid and expected, so no uniqueness constraint is added. A duplicate manual entry is an operator-correctable data-entry error, not a system-level double-processing risk.
- **Single currency per order assumed for aggregation**: `getRefundSummariesForOrders` sums `amount` per order assuming all of an order's refunds share one currency (matching `OrderTotals.currency`, which is itself singular per order). If refunds against one order are ever recorded in different currencies (not expected in v1, since a marketplace order is issued in one currency), the summary's `totalAmount` would silently sum mismatched currencies. Documented as a known edge case, not solved here — flagged with a code comment at the aggregation call site so a future contributor sees it before extending to multi-currency refunds.
- **No public batch HTTP endpoint**: analytics consumers (#1987/#1988/#1990) are same-process core/application code, not a separate FE fetch — so the batch read path is a service interface method, not a new REST route. If a future need requires FE-side batch refund summaries, that's a new, explicitly-scoped follow-up.

### Documentation Gaps
- `docs/architecture-overview.md` documents the `invoicing` context's satellite-of-`orders` pattern in detail but doesn't generalize a "capture-only satellite entity inside `orders` itself" pattern. This plan follows that precedent by analogy; a future documentation pass could name it explicitly if a third such entity appears.

---

## 6. Proposed Implementation Plan

### Phase 1: Domain Layer

**Goal**: Define the `RefundRecord` entity, its types, and the repository port — pure domain code, no framework dependencies.

**Steps**:

1. **Create refund record types**
   - **File**: `libs/core/src/orders/domain/types/refund-record.types.ts`
   - **Action**: Define `RefundReasonValues = ['withdrawal', 'defective', 'not_as_described', 'wrong_item', 'other'] as const;` and `export type RefundReason = (typeof RefundReasonValues)[number];`. Define `CreateRefundRecordInput { internalOrderId: string; amount: string; currency: string; reason: RefundReason; note: string | null; recordedAt: Date }`. Define `RefundSummary { count: number; totalAmount: string; currency: string }`.
   - **Acceptance**: File compiles standalone with no imports beyond TS built-ins; matches the `as const` + union pattern documented in `docs/engineering-standards.md § Union Types`.
   - **Dependencies**: None.

2. **Create the `RefundRecord` domain entity**
   - **File**: `libs/core/src/orders/domain/entities/refund-record.entity.ts`
   - **Action**: Plain class, `public readonly` constructor params: `id: string`, `internalOrderId: string`, `amount: string`, `currency: string`, `reason: RefundReason`, `note: string | null`, `recordedAt: Date`, `createdAt: Date`, `updatedAt: Date`. No domain-service methods and no mutation — per ADR-011, this entity carries no derived behavior beyond what's already needed (unlike `InvoiceRecord`'s `isIssued`/`isPaid` getters, there is no analogous boolean state to derive here in v1).
   - **Acceptance**: File imports only from `../types/refund-record.types` (type-only) and has zero framework dependencies.
   - **Dependencies**: Step 1.

3. **Create the repository port**
   - **File**: `libs/core/src/orders/domain/ports/refund-record-repository.port.ts`
   - **Action**: Define `RefundRecordRepositoryPort` with:
     - `create(input: CreateRefundRecordInput): Promise<RefundRecord>`
     - `findByOrderId(internalOrderId: string): Promise<RefundRecord[]>` — full list for the order-detail read path.
     - `summarizeByOrderIds(internalOrderIds: string[]): Promise<Map<string, RefundSummary>>` — the batch aggregate read, mirroring the doc-comment style of `OrderRecordRepositoryPort.findByIds` ("ids with no matching row are silently omitted... returns `[]`/empty map immediately for empty input").
   - **Acceptance**: Interface-only file (no implementation); JSDoc on `summarizeByOrderIds` explicitly states the empty-input short-circuit and the omit-missing-ids contract, matching `findByIds`'s documented shape.
   - **Dependencies**: Steps 1–2.

### Phase 2: Infrastructure Layer

**Goal**: Persist `RefundRecord` via TypeORM, with a migration creating `refund_records`.

**Steps**:

4. **Create the ORM entity**
   - **File**: `libs/core/src/orders/infrastructure/persistence/entities/refund-record.orm-entity.ts`
   - **Action**: `@Entity('refund_records')`. Columns: `id` (`@PrimaryColumn('uuid')`, `uuid_generate_v4()` default set at the DB layer, mirroring `InvoiceRecordOrmEntity`), `internalOrderId` (`@Column({ type: 'text' }) @Index()`), `amount` (`@Column({ type: 'text' })`), `currency` (`@Column({ type: 'varchar', length: 3 })`), `reason` (`@Column({ type: 'text' })`), `note` (`@Column({ type: 'text', nullable: true })`), `recordedAt` (`@Column({ type: 'timestamptz' })`), `createdAt` (`@CreateDateColumn()`), `updatedAt` (`@UpdateDateColumn()`).
   - **Acceptance**: Entity compiles, is registered via `TypeOrmModule.forFeature` in Step 8, and its shape matches the migration's DDL exactly (column names, types, nullability).
   - **Dependencies**: Step 2 (field parity with the domain entity).

5. **Add `RefundRecordOrmEntity` to the host-only ORM-entities sub-barrel**
   - **File**: `libs/core/src/orders/orm-entities.ts`
   - **Action**: Add `export { RefundRecordOrmEntity } from './infrastructure/persistence/entities/refund-record.orm-entity';`. Never export it from the main `index.ts` barrel (per `docs/engineering-standards.md § Import Aliases`, ORM entities are host-only).
   - **Acceptance**: `pnpm lint`'s ESLint guard for `orm-entities` sub-barrel imports passes; no plugin package imports it.
   - **Dependencies**: Step 4.

6. **Create the repository implementation**
   - **File**: `libs/core/src/orders/infrastructure/persistence/repositories/refund-record.repository.ts`
   - **Action**: `@Injectable() export class RefundRecordRepository implements RefundRecordRepositoryPort`, `@InjectRepository(RefundRecordOrmEntity)`. Private `toDomain(entity)` mapper. `create` builds and saves an ORM row, converts on return. `findByOrderId` does a simple `find({ where: { internalOrderId }, order: { recordedAt: 'DESC' } })`. `summarizeByOrderIds` short-circuits to `new Map()` for an empty array (no query issued, mirroring `findByIds`'s documented empty-input contract), otherwise runs one `createQueryBuilder` aggregate:
     ```ts
     .select('record.internalOrderId', 'internalOrderId')
     .addSelect('COUNT(*)', 'count')
     .addSelect('SUM(CAST(record.amount AS numeric))', 'totalAmount')
     .addSelect('MIN(record.currency)', 'currency') // see currency-assumption note
     .where('record.internalOrderId IN (:...ids)', { ids: internalOrderIds })
     .groupBy('record.internalOrderId')
     .getRawMany()
     ```
     then builds the `Map<string, RefundSummary>` keyed by `internalOrderId`, casting `totalAmount` back to a decimal string.
   - **Acceptance**: Unit-tested with a mocked `Repository<RefundRecordOrmEntity>`; empty-array input never calls `createQueryBuilder`.
   - **Dependencies**: Steps 3–5.

7. **Create the migration**
   - **File**: `apps/api/src/migrations/1833000000000-create-refund-records.ts`
   - **Action**: Follow the `1808000000000-create-invoice-records.ts` template exactly: guard with `queryRunner.getTable('refund_records')` existence check before creating; `CREATE TABLE "refund_records" (...)` with the columns from Step 4, `PRIMARY KEY ("id")`; a plain (non-FK) `CREATE INDEX "IDX_refund_records_internal_order_id" ON "refund_records" ("internalOrderId")`. `down()` drops the index then the table, both `IF EXISTS`-guarded.
   - **Acceptance**: `pnpm --filter @openlinker/api migration:show` lists the new migration; `scripts/check-migration-timestamps.mjs` (run via `pnpm lint`) passes (unique, class-suffix-matches-filename, strictly greater than the `1832000000007` tail).
   - **Dependencies**: Step 4 (DDL must match ORM entity exactly).

### Phase 3: Application Layer

**Goal**: Expose record/read operations behind a service interface, wired through Symbol DI tokens.

**Steps**:

8. **Add DI tokens**
   - **File**: `libs/core/src/orders/orders.tokens.ts`
   - **Action**: Append `export const ORDER_REFUND_RECORD_REPOSITORY_TOKEN = Symbol('RefundRecordRepositoryPort');` and `export const ORDER_REFUND_SERVICE_TOKEN = Symbol('IOrderRefundService');`.
   - **Acceptance**: Matches the existing flat-Symbol, `{CONTEXT}_{INTERFACE}_TOKEN` naming convention exactly (per `docs/engineering-standards.md § Symbol DI Token Re-export Convention`).
   - **Dependencies**: None (can be done any time before Step 10).

9. **Create the service interface**
   - **File**: `libs/core/src/orders/application/interfaces/order-refund.service.interface.ts`
   - **Action**: `export interface IOrderRefundService { recordRefund(input: CreateRefundRecordInput): Promise<RefundRecord>; getRefundsForOrder(internalOrderId: string): Promise<RefundRecord[]>; getRefundSummariesForOrders(internalOrderIds: string[]): Promise<Map<string, RefundSummary>>; }`.
   - **Acceptance**: Interface-only, mirrors the `IInvoiceService.getLatestInvoicesForOrders` batch-method naming/shape precedent.
   - **Dependencies**: Steps 1, 3.

10. **Create the service implementation**
    - **File**: `libs/core/src/orders/application/services/order-refund.service.ts`
    - **Action**: `@Injectable() export class OrderRefundService implements IOrderRefundService`, constructor-injects `@Inject(ORDER_REFUND_RECORD_REPOSITORY_TOKEN) private readonly refundRepository: RefundRecordRepositoryPort`. `recordRefund` delegates straight to `refundRepository.create`. `getRefundsForOrder` delegates to `findByOrderId`. `getRefundSummariesForOrders` delegates to `summarizeByOrderIds`. No business logic beyond straight delegation is needed for v1 (matches the issue's "capture, don't process" scope) — this keeps the service a thin pass-through today, with room to grow validation (e.g. "refund doesn't exceed order total") as a later, separately-scoped feature.
    - **Acceptance**: Unit-tested with a mocked `RefundRecordRepositoryPort`.
    - **Dependencies**: Steps 6, 8–9.

11. **Wire the module**
    - **File**: `libs/core/src/orders/orders.module.ts`
    - **Action**: Add `RefundRecordOrmEntity` to `TypeOrmModule.forFeature([OrderRecordOrmEntity, RefundRecordOrmEntity])`. Add `RefundRecordRepository`, `OrderRefundService` to `providers`, plus their `{ provide: TOKEN, useExisting: Class }` bindings. Export `OrderRefundService` (direct-injection class, mirroring `OrderRecordService`'s export) and both new tokens.
    - **Acceptance**: `apps/api` boots without a missing-provider error; `OrderRefundService` is resolvable via either the class or `ORDER_REFUND_SERVICE_TOKEN`.
    - **Dependencies**: Steps 4, 6, 9–10.

12. **Update the barrel**
    - **File**: `libs/core/src/orders/index.ts`
    - **Action**: Add, in the existing grouped sections: under Types, `RefundReason, RefundReasonValues, RefundSummary, CreateRefundRecordInput` from `./domain/types/refund-record.types`; under Domain entities, `RefundRecord` from `./domain/entities/refund-record.entity`; under Ports, `RefundRecordRepositoryPort` from `./domain/ports/refund-record-repository.port`; under Services, `IOrderRefundService` from `./application/interfaces/order-refund.service.interface` and `OrderRefundService` from `./application/services/order-refund.service`. `orders.tokens.ts` is already re-exported via the existing `export * from './orders.tokens';` line — no edit needed there.
    - **Acceptance**: `@openlinker/core/orders` exposes the new symbols; no ORM entity leaks onto this barrel (verified by the existing barrel-purity convention).
    - **Dependencies**: Steps 1–3, 9–10.

### Phase 4: Interface Layer

**Goal**: A minimal, role-gated HTTP write/read path so an operator can record a return without direct DB access.

**Steps**:

13. **Create request/response DTOs**
    - **Files**:
      - `apps/api/src/orders/http/dto/record-refund-request.dto.ts` — `internalOrderId` is a path param, not in the body. Body fields: `amount` (`@IsString() @Matches(/^\d+(\.\d{1,2})?$/)` — positive decimal, ≤2 decimal places), `currency` (`@IsString() @Length(3, 3)`), `reason` (`@IsIn(RefundReasonValues)`), `note` (`@IsOptional() @IsString() @MaxLength(1000)`), `recordedAt` (`@IsOptional() @IsISO8601()` — defaults to `new Date()` in the controller when omitted).
      - `apps/api/src/orders/http/dto/refund-record-response.dto.ts` — flat projection of `RefundRecord` (`id`, `internalOrderId`, `amount`, `currency`, `reason`, `note`, `recordedAt`, `createdAt`).
    - **Acceptance**: DTOs use `class-validator` decorators per `docs/engineering-standards.md § Validation`; a negative or zero amount is rejected by the regex (no leading `-`, no bare `0` — refine regex to `/^(?!0(\.0{1,2})?$)\d+(\.\d{1,2})?$/` if a `0.00` refund must be explicitly rejected, or accept `0` as a valid "recorded but waived" case — **decision: allow `0` as valid**, since an operator recording a zero-value goodwill return is a legitimate capture; only reject negative/malformed strings).
    - **Dependencies**: Step 1.

14. **Create the controller**
    - **File**: `apps/api/src/orders/http/refund.controller.ts`
    - **Action**: `@Controller('orders')`, injects `@Inject(ORDER_REFUND_SERVICE_TOKEN) private readonly refundService: IOrderRefundService` and `@Inject(ORDER_RECORD_SERVICE_TOKEN) private readonly orderRecordService: IOrderRecordService`. No `@UseGuards(JwtAuthGuard)` (global `APP_GUARD`, per the `InvoicingController` precedent).
      - `@Roles('admin', 'operator') @Post(':internalOrderId/refunds') @HttpCode(201)` — verifies the order exists via `orderRecordService.getOrderRecord(internalOrderId)`, throwing `NotFoundException` if not (mirroring `InvoicingController.issueInvoice`); calls `refundService.recordRefund({ internalOrderId, ...dto, recordedAt: dto.recordedAt ? new Date(dto.recordedAt) : new Date() })`; returns the mapped response DTO.
      - `@Get(':internalOrderId/refunds')` — no `@Roles` (read, open to any authenticated role per the read/write-gated convention); returns `refundService.getRefundsForOrder(internalOrderId)` mapped to response DTOs. Does **not** 404 on an order with zero refunds — an empty array is a valid, successful response (there is nothing to look up if the order itself isn't independently verified on the read path, matching the read-side leniency already used elsewhere for list endpoints).
    - **Acceptance**: `pnpm type-check` passes; Swagger `@ApiOperation`/`@ApiResponse` decorators present per the `InvoicingController` documentation convention.
    - **Dependencies**: Steps 9–11, 13.

15. **Register the controller**
    - **File**: `apps/api/src/orders/orders.module.ts`
    - **Action**: Add `RefundsController` to `controllers: [OrdersController, RefundsController]`. No new `imports` needed — `CoreOrdersModule` already exports `OrderRefundService` (Step 11) and `OrderRecordService` is already exported by the same module.
    - **Acceptance**: `apps/api` boots; `POST /orders/:internalOrderId/refunds` and `GET /orders/:internalOrderId/refunds` are reachable.
    - **Dependencies**: Steps 11, 14.

### Implementation Details

**New Components**:
- **Domain**: `RefundRecord` entity; `RefundReason`/`RefundReasonValues`/`RefundSummary`/`CreateRefundRecordInput` types; `RefundRecordRepositoryPort`.
- **Application**: `IOrderRefundService`, `OrderRefundService`.
- **Infrastructure**: `RefundRecordOrmEntity`, `RefundRecordRepository`.
- **Interface**: `RefundsController`, `RecordRefundRequestDto`, `RefundRecordResponseDto`.

**Configuration Changes**: None — no new environment variables.

**Database Migrations**: `apps/api/src/migrations/1833000000000-create-refund-records.ts` — creates `refund_records`.

**Events**:
- **Emitted**: None in v1. A `orders.refund.recorded` domain event is a natural future extension (e.g. to notify a future analytics cache-invalidation listener) but is not required by the AC and is deliberately deferred to avoid speculative infrastructure.
- **Consumed**: None.

**Error Handling**:
- No new domain exception classes. The only failure path exposed to callers is "order not found," handled at the controller layer with Nest's built-in `NotFoundException`, exactly mirroring `InvoicingController.issueInvoice`'s inline check — there is no repository-level not-found path to convert (no unique constraint exists to violate, no by-id lookup is exposed publicly in v1).

**Reference**: [Engineering Standards - Project Structure](../engineering-standards.md#project-structure)

---

## 7. Alternatives Considered

### Alternative 1: Denormalized rollup column on `OrderRecord` (mirroring `fulfillmentState`)
- **Description**: Instead of a new `refund_records` table, add `OrderRecord.refundedAmount: string | null` + `OrderRecord.refundCount: number`, updated via a dedicated `updateRefundRollup(internalOrderId, ...)` repository method — exactly the `fulfillmentState` (#1108) shape.
- **Why Rejected**: `fulfillmentState` is a single current-state value (an order either has shipped or hasn't); a refund is inherently 1-to-many per order (partial refunds, multiple returns on a multi-item order) and each individual refund needs its own reason/amount/timestamp for any future per-refund reporting or audit trail. Collapsing that into a rolling total on `OrderRecord` would lose the per-event detail the issue's acceptance criteria implicitly wants ("at least one write path... can record a refund" — repeatable, not a single settable field) and would make `OrderRecord` writes (already a hot, frequently-upserted row) contend with an operationally separate concern.
- **Trade-offs**: The rollup approach would make "total refunded for an order" a single-column read with zero joins; the table approach requires one aggregate query. This plan accepts that small cost in exchange for correctness/auditability of individual refund events — which is exactly what `InvoiceRecord` (a comparable satellite entity) already does for invoices, using its own table rather than a column on `OrderRecord`.

### Alternative 2: A new top-level `refunds` bounded context (mirroring `invoicing`/`shipping`)
- **Description**: Create `libs/core/src/refunds/` as an independent context depending on `orders`, following the exact `invoicing` module-import pattern the issue's own "Proposed Solution" section floats as an option.
- **Why Rejected**: The issue itself frames this as "order-lifecycle data, same context that already owns `cancelledAt`" (its own precedent reference) and explicitly says "not a full bounded context." A new context adds a `refunds.module.ts`, `refunds.tokens.ts`, a barrel, and a cross-context dependency edge (`refunds → orders`) for a single entity with three trivial operations — disproportionate ceremony for the current scope. If refund handling later grows processing logic (approval workflows, provider-side refund APIs, multi-entity aggregates), promoting it to its own context at that point is a clean, low-risk refactor since the public surface (`IOrderRefundService`) doesn't change shape, only its module of origin.
- **Trade-offs**: A separate context would pre-emptively support that future growth without a later migration; this plan trades that for keeping today's PR small and consistent with the issue's own stated intent.

---

## 8. Validation & Risks

### Architecture Compliance
- ✅ Domain layer (`refund-record.entity.ts`, `refund-record.types.ts`, `refund-record-repository.port.ts`) has zero framework imports.
- ✅ `OrderRefundService` depends on `RefundRecordRepositoryPort` (the port), never on `RefundRecordRepository` (the concrete class) — Dependency Inversion preserved.
- ✅ ORM entity confined to `infrastructure/persistence/entities/`, exposed only via the host-only `orm-entities.ts` sub-barrel, never the main `index.ts` barrel.
- ✅ `RefundsController` reaches `orders` core exclusively through `IOrderRefundService` and `IOrderRecordService` — never a repository port directly, per `docs/architecture-overview.md § Cross-context dependencies in core` (this rule technically governs *cross-context* imports, but the same "go through the service interface" discipline is followed here for consistency, even though `orders`-internal controller-to-service wiring isn't cross-context).
- **Reference**: [Architecture Overview](../architecture-overview.md)

### Naming Conventions
- ✅ `RefundRecordRepositoryPort` → `{Capability}Port`-shaped (`docs/engineering-standards.md § Ports (Interfaces)`).
- ✅ `OrderRefundService implements IOrderRefundService` — service/interface pair in separate files, per `docs/engineering-standards.md § Service Interface Implementation`.
- ✅ `RefundReasonValues` / `RefundReason` — `as const` + union pattern, not a TS enum.
- ✅ Token names `ORDER_REFUND_RECORD_REPOSITORY_TOKEN` / `ORDER_REFUND_SERVICE_TOKEN` — `{CONTEXT}_{INTERFACE}_TOKEN` shape.
- **Reference**: [Engineering Standards - Naming Conventions](../engineering-standards.md#naming-conventions)

### Existing Patterns
- ✅ Money shape mirrors `CodToCollect` (decimal string + currency), not a new value object.
- ✅ Batch-read + graceful Map-degradation shape mirrors `InvoicingController.resolveOrderSummaries` / `ShipmentController.resolveOrderContext`.
- ✅ Migration shape mirrors `1808000000000-create-invoice-records.ts` exactly (existence-guarded `CREATE TABLE`, plain non-FK indexed text column, `IF EXISTS`-guarded `down()`).

### Risks
- **Currency-mismatch silent summing**: `summarizeByOrderIds`'s `SUM(CAST(amount AS numeric))` assumes one currency per order. Mitigation: documented explicitly in code and in this plan's § Questions & Assumptions; a future currency-aware aggregation (`GROUP BY internalOrderId, currency`) is a low-risk follow-up if the assumption breaks.
- **`CAST(record.amount AS numeric)` failure on malformed data**: only a risk if a row is inserted bypassing the DTO validator (e.g. a future direct-DB seed script). Mitigation: the DTO's regex is the single validation gate for all writes through the one write path this plan creates.
- **Migration timestamp drift if this plan lands after another migration merges first**: `1833000000000` is chosen from today's tail (`1832000000007`); `scripts/check-migration-timestamps.mjs` will catch a collision or an out-of-order timestamp at `pnpm lint` time regardless, so this is self-correcting, not a silent failure mode.

### Edge Cases
- **Refund amount of `0`**: accepted (see Step 13) — a legitimate "goodwill return, no money moved" capture.
- **Order not found**: `POST` returns `404` before any write; `GET` on a nonexistent/never-refunded order returns `[]` (200), consistent with other list-shaped reads in this codebase not 404ing on "no rows."
- **Empty `internalOrderIds` array passed to `getRefundSummariesForOrders`**: returns an empty `Map` immediately, no query issued — matches the documented `findByIds` empty-input contract.
- **Multiple refunds against the same order**: fully supported by design (no uniqueness constraint) — `findByOrderId` returns all of them ordered by `recordedAt DESC`.

### Backward Compatibility
- ✅ Purely additive: new table, new module providers, new controller, new barrel exports. No existing entity, port, or endpoint is modified. `OrderStatusValues`/`PaymentStatusValues` are untouched, per the issue's explicit instruction.
- No breaking changes; no data migration of existing rows (the table starts empty).

---

## 9. Testing Strategy & Acceptance Criteria

### Unit Tests
- `libs/core/src/orders/domain/entities/refund-record.entity.spec.ts` — construction sanity (readonly fields populate correctly); trivial given the entity has no derived behavior, but still present per `docs/testing-guide.md`'s coverage expectations for domain logic.
- `libs/core/src/orders/infrastructure/persistence/repositories/refund-record.repository.spec.ts` — mock `Repository<RefundRecordOrmEntity>`; verify `create` maps input → saved entity → domain entity; verify `summarizeByOrderIds([])` never calls `createQueryBuilder`; verify a non-empty call builds the expected `WHERE ... IN` + `GROUP BY` shape (assert on the mock's call args, not on real SQL execution).
- `libs/core/src/orders/application/services/order-refund.service.spec.ts` — mock `RefundRecordRepositoryPort`; verify each `IOrderRefundService` method delegates to the correct port method with the correct arguments.
- `apps/api/src/orders/http/refund.controller.spec.ts` — mock `IOrderRefundService` + `IOrderRecordService`; verify `POST` 404s when the order record is missing; verify a valid `POST` calls `recordRefund` with a fully-formed `CreateRefundRecordInput` (including a `recordedAt` default when the DTO omits it); verify `GET` maps the service's array to response DTOs.

### Integration Tests
- `apps/api/test/integration/orders/refund-record-crud.int-spec.ts` — using the shared Postgres+Redis Testcontainers harness (`getTestHarness()`), following the `docs/testing-guide.md § Integration Tests` template:
  1. Seed an `OrderRecord` via the existing test helpers.
  2. `POST /orders/:internalOrderId/refunds` with a valid body → expect `201`, verify the response DTO shape.
  3. Verify the row lands in `refund_records` via `harness.getDataSource()`.
  4. `GET /orders/:internalOrderId/refunds` → expect the just-created refund in the array.
  5. `POST` against a nonexistent `internalOrderId` → expect `404`.

### Mocking Strategy
- Unit tests mock `RefundRecordRepositoryPort` (never the concrete `RefundRecordRepository`) and `IOrderRefundService`/`IOrderRecordService` (never concrete service classes) at the controller layer, per `docs/engineering-standards.md § Mocking Ports`.
- The integration test uses the real Postgres Testcontainer — no DB mocking, per `docs/testing-guide.md`'s "never mock the database" rule for `*.int-spec.ts`.

### Acceptance Criteria
(Restated from the source issue, mapped to concrete deliverables in this plan)
- [ ] A `RefundRecord` domain entity exists in `libs/core/src/orders/domain/` with `internalOrderId`, an amount (value + currency), a reason, and a recorded timestamp. → Phase 1, Step 2.
- [ ] A repository port + TypeORM-backed repository + migration persist refund records, following the `docs/migrations.md` workflow. → Phase 1–2, Steps 3, 6–7.
- [ ] At least one write path (manual/operator-facing) can record a refund against an existing order. → Phase 4, Step 14 (`POST /orders/:internalOrderId/refunds`).
- [ ] A read path returns refund total + count for a given order (or set of orders), sufficient for #1987/#1988/#1990 to compute return rate and refunded value without reaching into `orders` internals directly. → Phase 3, Step 9 (`getRefundSummariesForOrders`), consumable in-process by any future core service.
- [ ] No CORE ↔ Integration boundary violation — capture logic lives in `orders` core, not in a specific marketplace adapter. → No integration package touched anywhere in this plan.
- [ ] Tests added for the entity, repository, and write/read paths per `docs/testing-guide.md`. → § 9 above.

**Reference**: [Testing Guide](../testing-guide.md)

---

## 10. Alignment Checklist

- [x] Follows hexagonal architecture
- [x] Respects CORE vs Integration boundaries
- [x] Uses existing patterns (no unnecessary abstractions) — reuses `CodToCollect`-style money, `InvoiceRecord`-style satellite entity, `findByIds`-style batch contract
- [x] Idempotency considered — explicitly assessed and deemed unnecessary for this manual write (see § Questions & Assumptions)
- [ ] Event-driven patterns used where applicable — deliberately deferred (no `orders.refund.recorded` event in v1); noted as a documented non-goal
- [x] Rate limits & retries addressed — not applicable (no external system call)
- [x] Error handling comprehensive — the one failure path (order not found) is handled; no speculative exception classes added
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
- [Code Review Guide](../code-review-guide.md)
- [Migrations Guide](../migrations.md)
- [docs/specs/product-spec-1976-analytics.md](../specs/product-spec-1976-analytics.md) — names this as a known true gap
- Source issue: [openlinker-project/openlinker#2036](https://github.com/openlinker-project/openlinker/issues/2036)

---

## Note on ADR

No ADR was drafted for this plan. Per `docs/architecture/adrs/README.md § When to write an ADR`, an ADR is warranted when a decision affects multiple bounded contexts, has non-trivial trade-offs with a seriously-considered alternative, or would require coordinated cross-package migration. This change is confined to a single context (`orders`), follows an existing, already-documented precedent (`InvoiceRecord`'s satellite-entity shape) rather than establishing a new one, and the alternatives considered (§ 7) are both straightforward scope/shape choices rather than platform-wide architectural forks. The source issue also does not request an ADR.

---

## Note on Execution Mode

Per the explicit instruction accompanying this plan request ("only local, don't push, don't commit, don't comment"), this plan document was written directly to the working tree on `main` and **was not committed, pushed, or used to open a PR**, and no comment was posted to issue #2036. No worktree was created. The file is left as an uncommitted, unstaged addition at `docs/plans/implementation-plan-refund-records.md` for review before any git action is taken.

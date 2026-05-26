# Implementation Plan: Shipment read + command HTTP API (#846)

**Date**: 2026-05-26
**Status**: Ready for implementation
**Estimated Effort**: M (3–7 days) — core query + cancellation services, repo `findMany`, API module + controller + DTOs, unit + integration tests. No migration.
**Branch**: `846-shipment-read-command-api`

---

## 0. Premise reconciliation (read first)

Verified against the fresh `main` (`8827216`, after #843/#844 merged):

- ✅ **Dispatch engine exists** — `ShipmentDispatchService` (#835/PR #843) already does routing-resolution → `generateLabel` → persist → idempotency → failure-handling, with `IShipmentDispatchService` + `SHIPMENT_DISPATCH_SERVICE_TOKEN` exported from `@openlinker/core/shipping`. It is **unwired** (no trigger calls it; its docs name the trigger as #769/#771 — i.e. an HTTP endpoint that does not exist).
- ❌ **No HTTP surface** — `apps/api/src/shipping` does not exist; no shipment controller anywhere.
- ❌ **No list query** — `ShipmentRepositoryPort` has `findById` / `findByOrderId` / `findActiveByOrderId` / `findByProviderShipmentId` / `create` / `update`, but **no** filtered+paginated list.
- ❌ **No cancel orchestration** — `ShipmentCanceller` sub-capability + `isShipmentCanceller` guard exist on the port, but nothing calls `cancelShipment`.

So #846 = (a) the read surface (`GET /shipments` + by-id) over a new repo `findMany`, behind a query service; (b) the command surface that **wires the existing dispatch seam** (`POST /shipments/generate-label`) and adds the **cancel orchestration** absorbed from #845 (`POST /shipments/:id/cancel`). #845's engine is superseded by #835 — only its cancel residual lands here.

---

## 1. Goal & layer

**Goal**: Expose shipment reads + commands over HTTP so the FE shipment surfaces (#769 order panel, #770 `/shipments`, #839 Allegro Delivery) can list/inspect shipments and trigger label generation / cancellation.

**Layers touched**:
- **CORE** (`libs/core/src/shipping`): repo `findMany`, query service, cancellation service, one domain exception, two tokens, barrel + module wiring.
- **INTERFACE** (`apps/api/src/shipping`): API module, controller, DTOs.

**Explicit non-goals**:
- Re-building the dispatch engine (done — #835).
- Status read-back / propagation to Allegro/PS (#768 webhook, #772 polling, #838 Allegro poll).
- Order→recipient/parcel assembly (operator input / #767 paczkomat-from-PS-module / PII sourcing — the caller supplies the label payload, per #835's Design A).
- FE pages/components (#769/#770/#839).
- Bulk actions, CSV export, analytics (v2 per #727 A5).
- A migration (none — `findMany` and cancel use existing columns/indexes).

---

## 2. Architecture compliance (the load-bearing constraint)

`scripts/check-cross-context-imports.mjs` (under `pnpm lint`) **forbids** importing `*RepositoryPort` from `@openlinker/core/<ctx>` in `apps/**` unless allow-listed. The sync read controller's `SyncJobRepositoryPort` import is an allow-listed *legacy* coupling ("rewire via ISyncJobsService"). A **new** controller importing `ShipmentRepositoryPort` would fail the gate.

**⇒ The controller injects `I*Service` interfaces only** (allowed cross-context surface): `IShipmentQueryService`, `IShipmentDispatchService`, `IShipmentCancellationService`, their Symbol tokens, the `Shipment` entity, `as const` status/method values, type aliases (`ShipmentFilters`, `ShipmentDispatchInput`, …) and exceptions. No repo-port import in `apps/api`. The repo `findMany` stays intra-context behind the query service.

This also satisfies engineering-standards §"Services must always implement an interface".

---

## 3. Data flow

```
GET /shipments?status&connectionId&method&hasTracking&orderId&createdFrom&createdTo&limit&offset
  ShipmentController.list(query)
   → IShipmentQueryService.list(filters, pagination)
     → ShipmentRepositoryPort.findMany(filters, pagination)  [findAndCount, createdAt DESC]
   → PaginatedShipmentsResponseDto { items, total, limit, offset }

GET /shipments/:id
  → IShipmentQueryService.getById(id) → 404 ShipmentNotFound if null → ShipmentResponseDto

POST /shipments/generate-label  (body ≅ ShipmentDispatchInput)
  → IShipmentDispatchService.dispatch(input)           [existing #835 seam]
   → { kind:'dispatched', shipment } | { kind:'omp_fulfilled' }
   → DispatchResultResponseDto  (generateLabel failure → domain error → mapped HTTP)

POST /shipments/:id/cancel
  → IShipmentCancellationService.cancel(id)
   → repo.findById → guard state → integrations.getCapabilityAdapter('ShippingProviderManager')
     → isShipmentCanceller? → adapter.cancelShipment({ providerShipmentId }) (when present)
   → repo.update(id, { status:'cancelled', cancelledAt }) → ShipmentResponseDto
```

---

## 4. Step-by-step (each tied to a path + acceptance)

### CORE

1. **`libs/core/src/shipping/domain/types/shipment-query.types.ts`** (new)
   - `ShipmentFilters` = `{ orderId?, status?: ShipmentStatus, connectionId?, shippingMethod?: ShippingMethod, hasTracking?: boolean, createdFrom?: Date, createdTo?: Date }`.
   - `ShipmentPagination` = `{ limit: number; offset: number }`.
   - `PaginatedShipments` = `{ items: readonly Shipment[]; total: number }`.
   - *AC*: types-only file, header comment; mirrors sync's `SyncJobFilters`/`PaginatedSyncJobs`.

2. **`libs/core/src/shipping/domain/ports/shipment-repository.port.ts`** (edit)
   - Add `findMany(filters: ShipmentFilters, pagination: ShipmentPagination): Promise<PaginatedShipments>`.
   - *AC*: doc comment; no other methods touched.

3. **`libs/core/src/shipping/infrastructure/persistence/repositories/shipment.repository.ts`** (edit)
   - Implement `findMany` via `repository.findAndCount({ where, order:{ createdAt:'DESC' }, skip:offset, take:limit })`. Build `where` dynamically: equality for `orderId`/`status`/`connectionId`/`shippingMethod`; `hasTracking===true → Not(IsNull())`, `===false → IsNull()`; date range → `Between` / `MoreThanOrEqual` / `LessThanOrEqual` on `createdAt`. Map rows via existing `toDomain`. Add `findActiveByOrderId` is already present — reused by the query service (step 4).
   - *AC*: all filters combine (AND); returns `{ items, total }`; covered by integration test.
   - *Index note (deferred, per review)*: `createdAt` ordering + range filter has no supporting index (existing indexes cover `orderId`/`connectionId`/`status`). Acceptable at MVP shipment volume — a deliberate deferral, not an oversight.

4. **`libs/core/src/shipping/application/interfaces/shipment-query.service.interface.ts`** (new)
   - `IShipmentQueryService` { `list(filters, pagination): Promise<PaginatedShipments>`; `getById(id: string): Promise<Shipment | null>`; `getActiveByOrderId(orderId: string): Promise<Shipment | null>` }.
   - `getActiveByOrderId` added per review — serves #769's order panel from the domain's own "active" definition (`TerminalShipmentStatusValues` via `findActiveByOrderId`) instead of making the FE re-derive terminal-state logic.

5. **`libs/core/src/shipping/application/services/shipment-query.service.ts`** (new)
   - `ShipmentQueryService implements IShipmentQueryService`, `@Inject(SHIPMENT_REPOSITORY_TOKEN)`. Thin delegation to `findMany` / `findById` / `findActiveByOrderId`.
   - *AC*: implements interface; no business logic beyond pass-through; unit-tested.
   - *Header note (per review)*: the file header must state this service exists to keep the controller off `ShipmentRepositoryPort` (the `*RepositoryPort` cross-context import is banned in `apps/**` — see §2), so a future reader doesn't "simplify" it by injecting the repo into the controller and reintroducing the violation.

6. **`libs/core/src/shipping/domain/exceptions/shipment-not-cancellable.exception.ts`** + **`.../shipment-cancellation-not-supported.exception.ts`** (new — split per review)
   - `ShipmentNotCancellableException(shipmentId, reason)` — wrong **state** (terminal / already `dispatched` / `in-transit`). → 409.
   - `ShipmentCancellationNotSupportedException(shipmentId, connectionId)` — the resolved provider adapter does **not** implement `ShipmentCanceller`. → 422. Split so #769 can distinguish "can't cancel anymore" from "this carrier doesn't support cancel" (review SUGGESTION). Both extend `Error` (pattern of `ShipmentNotFoundException`).

7. **`libs/core/src/shipping/application/interfaces/shipment-cancellation.service.interface.ts`** (new)
   - `IShipmentCancellationService` { `cancel(shipmentId: string): Promise<Shipment>` }.

8. **`libs/core/src/shipping/application/services/shipment-cancellation.service.ts`** (new)
   - Injects `SHIPMENT_REPOSITORY_TOKEN` + `INTEGRATIONS_SERVICE_TOKEN`.
   - `cancel(id)`: `findById` → `ShipmentNotFoundException` if null; if status already `cancelled` → return as-is (idempotent); if terminal (`delivered`/`failed`) or already `dispatched`/`in-transit` → `ShipmentNotCancellableException`; resolve adapter via `getCapabilityAdapter<ShippingProviderManagerPort>(connectionId,'ShippingProviderManager')`; `isShipmentCanceller(adapter)` false → `ShipmentCancellationNotSupportedException`; when `providerShipmentId` present, `adapter.cancelShipment({ providerShipmentId })`; `repo.update(id, { status:'cancelled', cancelledAt: new Date() })`.
   - Cancellable states: `draft`, `generated` (pre-dispatch only — matches `ShipmentCanceller` contract). `log.warn` on adapter error then rethrow.
   - *AC*: all branches unit-tested.

9. **`libs/core/src/shipping/shipping.tokens.ts`** (edit)
   - Add `SHIPMENT_QUERY_SERVICE_TOKEN = Symbol('IShipmentQueryService')`, `SHIPMENT_CANCELLATION_SERVICE_TOKEN = Symbol('IShipmentCancellationService')`.

10. **`libs/core/src/shipping/shipping.module.ts`** (edit)
    - Provide `ShipmentQueryService` + `ShipmentCancellationService`; bind both tokens (`useExisting`); add to `exports`. (`IntegrationsModule` already imported for the dispatch seam — covers the cancellation service's `INTEGRATIONS_SERVICE_TOKEN`.)

11. **`libs/core/src/shipping/index.ts`** (edit)
    - Export type `IShipmentQueryService`, `IShipmentCancellationService`; types `ShipmentFilters`, `ShipmentPagination`, `PaginatedShipments`; `ShipmentNotCancellableException` + `ShipmentCancellationNotSupportedException` (values). Tokens auto-exported via `export * from './shipping.tokens'`.

12. **Unit specs** — `shipment-query.service.spec.ts`, `shipment-cancellation.service.spec.ts` (mock ports per standards).

### INTERFACE (`apps/api/src/shipping`)

13. **`http/dto/list-shipments-query.dto.ts`** — `status?` (`@IsEnum(ShipmentStatusValues)`), `connectionId?` (`@IsUUID`), `shippingMethod?` (`@IsEnum(ShippingMethodValues)`), `orderId?` (`@IsString`), `limit=20` (`@Type(()=>Number) @IsInt @Min(1) @Max(100)`), `offset=0` (`@Type(()=>Number) @IsInt @Min(0)`). Enum/uuid/int fields mirror `list-sync-jobs-query.dto.ts`.
    - **Query-param coercion (per review — the sync DTO has no bool/date params, so its idiom does NOT transfer):**
      - `hasTracking?`: `@IsOptional() @Transform(({ value }) => value === 'true' ? true : value === 'false' ? false : value) @IsBoolean()`. **Not** `@Type(() => Boolean)` — `Boolean("false") === true`.
      - `createdFrom?` / `createdTo?`: `@IsOptional() @IsDateString()` — validate the **raw ISO string**; the controller/service converts to `Date` for the repo `Between`/`MoreThanOrEqual`/`LessThanOrEqual`. **Not** `@Type(() => Date)` + `@IsISO8601()` (the transform hands `@IsISO8601` a `Date`, which fails).

14. **`http/dto/shipment-response.dto.ts`** — flat projection of `Shipment` + `static fromDomain(s: Shipment)`. Swagger-annotated.

15. **`http/dto/paginated-shipments-response.dto.ts`** — `{ items: ShipmentResponseDto[]; total; limit; offset }` (mirror sync).

16. **`http/dto/generate-label.dto.ts`** — request body ≅ `ShipmentDispatchInput`: `sourceConnectionId` (`@IsUUID`), `sourceDeliveryMethodId: string | null` (`@IsString @IsOptional`/nullable), `orderId` (`@IsString`), `shippingMethod` (`@IsEnum(ShippingMethodValues)`), `paczkomatId?`, nested `recipient` (`@ValidateNested @Type` → `RecipientDto` with nested `AddressDto`), nested `parcel` (`@ValidateNested @Type` → `ParcelDto` with nested `DimensionsDto`). Maps 1:1 to `ShipmentDispatchInput`.

17. **`http/dto/dispatch-result-response.dto.ts`** — `{ kind: 'dispatched' | 'omp_fulfilled'; shipment?: ShipmentResponseDto }`.

18. **`http/shipment.controller.ts`** — `@ApiTags('shipments') @ApiBearerAuth() @Roles('admin') @Controller('shipments')`:
    - `@Get()` `list(@Query() q)` → convert `createdFrom`/`createdTo` strings → `Date`, build `ShipmentFilters` → `IShipmentQueryService.list` → paginated DTO.
    - `@Get('active')` `getActive(@Query('orderId') orderId)` → `IShipmentQueryService.getActiveByOrderId` → `ShipmentResponseDto` or 404. **Declare BEFORE `@Get(':id')`** — Express matches in order, so `:id` would otherwise capture `active`.
    - `@Get(':id')` → `getById` → `NotFoundException` if null → `ShipmentResponseDto`.
    - `@Post('generate-label')` `@HttpCode(200)` → build `ShipmentDispatchInput` from DTO → `IShipmentDispatchService.dispatch` → `DispatchResultResponseDto`.
    - `@Post(':id/cancel')` `@HttpCode(200)` → `IShipmentCancellationService.cancel` → `ShipmentResponseDto`.
    - Private `toHttpException(e)`: `ShipmentNotFoundException`→404, `ShipmentNotCancellableException`→409, `ShipmentCancellationNotSupportedException`→422, `UndispatchableResolutionException`→422, other (generateLabel provider failure)→`BadGatewayException` (502) preserving message. Mirrors `fulfillment-routing.controller.ts`.
    - **Generate-label serialization (per review — documented v1 decision):** this endpoint is the first *live* caller of `ShipmentDispatchService`, whose idempotency (`findActiveByOrderId → create`) is explicitly **non-atomic** (the schema allows N shipments/order; no DB guard). v1 accepts the best-effort guard (a duplicate rapid submit is caught by `findActiveByOrderId` in the overwhelming-majority single-operator case) + the FE disabling the button while in-flight (#769). A hard guard (idempotency key / partial unique index on active-per-order) is a deliberate follow-up, **recorded in the PR body** so the trade-off is explicit. No silent inheritance of the seam's precondition.

19. **`apps/api/src/shipping/shipping.module.ts`** (`ShippingApiModule`, new) — `imports:[CoreShippingModule]`, `controllers:[ShipmentController]`.

20. **`apps/api/src/app.module.ts`** (edit) — register `ShippingApiModule` in `imports`. Per review, route the core `ShippingModule` in *through* `ShippingApiModule` only and **drop the now-redundant direct `ShippingModule` import** — but first grep `apps/api` for other direct injectors of `SHIPMENT_*_TOKEN` outside the new controller; if any exist, keep the direct import too. (Tokens stay in the graph either way since `ShippingApiModule` imports core `ShippingModule`.)

21. **`http/shipment.controller.spec.ts`** — unit: list mapping + pagination echo; getById 404; generate-label delegation + both result kinds; cancel delegation; `toHttpException` mapping per exception.

22. **`apps/api/test/integration/shipments-read.int-spec.ts`** — mirror `sync-jobs-read.int-spec.ts`: seed shipments (repo/ORM), assert list shape + each filter (incl. `hasTracking=false` proving the coercion fix) + pagination no-overlap + by-id + 404 + active-by-order; cancel happy path + non-cancellable-state + cancellation-not-supported; generate-label happy path + omp_fulfilled — reuse `helpers/inpost-test-shipping-stub.helper.ts` + a `replaceRules` routing rule, as `shipment-dispatch.int-spec.ts` does. (`'shipments'` already in `setup.ts` `tablesToTruncate`.)
    - **Stub verification (per review):** confirm `inpost-test-shipping-stub.helper.ts` actually implements `ShipmentCanceller` (`cancelShipment`). #835 only needed `generateLabel`/`getTracking`/`getSupportedMethods`, so it may not. If absent, **extending the stub to implement `cancelShipment` is an in-scope step of #846** (needed for the cancel happy-path test); a second no-`ShipmentCanceller` stub (or a flag) backs the `ShipmentCancellationNotSupportedException` case.

---

## 5. Validation

- **Architecture**: controller depends only on `I*Service` + tokens + entity + type aliases + exceptions → passes `check-cross-context-imports`. Repo port stays intra-context. Domain entity stays anemic (ADR-011) — cancellation logic in the application service, not on `Shipment`. New tokens follow #595 (`<NAME>_TOKEN = Symbol('Interface')` in `shipping.tokens.ts`, auto-exported by the sub-barrel). Types in `*.types.ts`. Services implement interfaces in separate files.
- **Security**: all endpoints behind app-global `JwtAuthGuard` + `@Roles('admin')`; DTO validation at the boundary (`class-validator`, nested validation on recipient/parcel); response DTOs project only shipment fields — no secrets/credentials. `connectionId` is a UUID reference, not a credential.
- **Testing**: unit ≥ standards (services + controller); integration covers read/filter/pagination/by-id/404 + cancel + generate-label. `pnpm lint && pnpm type-check && pnpm test` green; integration via `pnpm test:integration`.
- **Migration**: none — `pnpm --filter @openlinker/api migration:show` must show nothing pending.

## 6. Risks / open questions

- **R1 — `@Roles('admin')`**: chosen to match the just-merged `fulfillment-routing.controller`. If shipments should be operator-visible under a non-admin role, adjust the decorator. *(Default: admin.)*
- **R2 — generate-label DTO weight**: the body mirrors `ShipmentDispatchInput` (recipient + parcel), which is heavy but is exactly what #835's seam consumes and what #769 will build. Keeping it a 1:1 reshape minimises drift (same rationale as #835's `ShipmentDispatchInput`).
- **R3 — generateLabel failure HTTP code**: mapping the rethrown provider error to `502 Bad Gateway` (upstream failure) vs `400`. Default 502 with the domain message; revisit if a validation-class error needs 400.
- **R4 — cancel of a `draft` with no `providerShipmentId`**: no provider call needed — just flip to `cancelled`. Handled (adapter call gated on `providerShipmentId` presence).
- **R5 — generate-label double-submit (review IMPORTANT)**: the HTTP endpoint is the first live caller of the non-atomic dispatch seam; concurrent submits can double-create shipments → duplicate labels/cost. **v1 decision**: accept the best-effort `findActiveByOrderId` guard + FE in-flight button-disable (#769); a hard guard (idempotency key / partial unique index on active-per-order) is a tracked follow-up. Recorded in the PR body.
- **R6 — query-param coercion (review IMPORTANT)**: `hasTracking`/`createdFrom`/`createdTo` use `@Transform`/`@IsDateString` (not `@Type(()=>Boolean|Date)`); the `hasTracking=false` integration assertion guards the regression.

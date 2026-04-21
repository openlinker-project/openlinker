# Implementation Plan — Create-offer endpoint (#259) + Seller policies endpoint (#260)

**Branch:** `259-260-create-offer-seller-policies`
**Scope:** One PR bundling both endpoints. They share a controller (`ListingsController`) and both unblock the FE offer-creation wizard (#261).
**Layer:** Core application (seller policies) + Integration (Allegro) + Interface (REST).

The create-offer adapter method, worker handler, `OfferCreationExecutionService`, `OfferCreationRecord` entity/repo/migration, and `MarketplaceOfferCreatePayloadV1` already exist (#254/#257/#258/#289). This PR wires the HTTP endpoints in front of them and adds the seller-policies read path end-to-end.

---

## 1. Goal & non-goals

**Goal (#259):** Add `POST /listings/connections/:connectionId/offers` (202 async) and `GET /listings/connections/:connectionId/offers/creation/:offerCreationRecordId` (status poll).

**Goal (#260):** Add `GET /listings/connections/:connectionId/seller-policies` returning delivery + return + warranty + implied-warranty lists for the connection's marketplace adapter, with a 10-minute cache to absorb repeated wizard loads.

**Non-goals:**
- Frontend wizard (#261 — separate PR).
- A `pollCreationStatus` job handler to advance `validating → active` (the worker handler leaves `validating` as a terminal state today with a warn log; follow-up issue territory).
- Extending `fetchSellerPolicies` to non-Allegro adapters (port method is optional; only Allegro implements it here).
- Generalising the cache layer into a reusable abstraction. `SellerPoliciesCache` follows the same shape as the existing `AllegroCategoryCache` — single-purpose ORM table.
- Authorisation beyond the existing `@Roles('admin')` — seller-policies contain no secrets, so no additional guard.

---

## 2. Layer classification & doc alignment

| Component | Layer | Location |
|---|---|---|
| `SellerPolicies` / `SellerPolicy` types | Domain (integrations) | `libs/core/src/integrations/domain/types/` |
| `fetchSellerPolicies` port method | Domain (integrations) | `libs/core/src/integrations/domain/ports/marketplace.port.ts` |
| Allegro implementation | Integration | `libs/integrations/allegro/src/infrastructure/adapters/` |
| `SellerPoliciesCacheRepositoryPort` | Domain (listings) | `libs/core/src/listings/domain/ports/` |
| `SellerPoliciesCacheOrmEntity` + repo impl | Infrastructure (listings) | `libs/core/src/listings/infrastructure/persistence/` |
| `SellerPoliciesService` | Application (listings) | `libs/core/src/listings/application/services/` |
| `ListingsController` additions | Interface | `apps/api/src/listings/http/` |
| Migration | API | `apps/api/src/migrations/` |

**Deviations from issue text (documented here so reviewers can see the reasoning):**

1. **Controller path.** Issue #259 references `apps/api/src/listings/interfaces/http/` — the actual project uses `apps/api/src/listings/http/`. Following the repo.
2. **Auth decorator.** Issue #259 says `@UseGuards(JwtAuthGuard)`. Codebase uses class-level `@Roles('admin') + @ApiBearerAuth()`. Following the repo.
3. **Cache backend.** Issue #260 says "Redis cache for 10 minutes". The codebase has **no Redis cache abstraction** — caching is DB-backed via TypeORM tables (e.g., `AllegroCategoryCacheOrmEntity` + `CategoriesCacheService`). I'll follow the codebase convention. Cost/benefit: a DB row read is fine for an operator-triggered lookup (the wizard opens a handful of times per day per connection); the consistency win beats the latency win Redis would give.
4. **DTO validation.** Issue #259 lists `@IsUUID() internalVariantId`. Internal IDs in OpenLinker use the `ol_{entityType}_{hex}` format — they're `TEXT`, not strict UUIDs (per `architecture-overview.md` §"Internal Identifier Format"). Using `@IsString() @IsNotEmpty() @Matches(/^ol_variant_/)` instead.
5. **Capability check.** `IIntegrationsService.getCapabilityAdapter` already throws `CapabilityNotSupportedException` at the capability level (`'Marketplace'`). `createOffer` is optional *within* the `MarketplacePort` interface — adapters may support `Marketplace` but not `createOffer`. I'll throw `UnprocessableEntityException` on a missing `createOffer` method to match the issue's 422 expectation.
6. **No new application service for #259.** `OfferCreationExecutionService` already owns the orchestration; the worker handler already delegates to it. The HTTP endpoint only needs to (a) validate connection/capability, (b) pre-create the `OfferCreationRecord`, (c) enqueue the job with `offerCreationRecordId` in the payload. This is thin enough to live inline in the controller, mirroring `updateOfferFields` which also uses `JobEnqueuePort` directly.

Conventions I'll enforce:
- Types in separate `*.types.ts` files.
- Service interface in a separate `*.service.interface.ts` (for `SellerPoliciesService`).
- Repository port defined in `domain/ports/`, implementation in `infrastructure/persistence/repositories/` (per `docs/engineering-standards.md` → *Repository Ports Pattern*). The cache repo is behind a port like every other application-visible repository in the codebase — service-layer testability is the reason.
- Ports injected via Symbol tokens; `useExisting` binding in module.
- No `any`, no `console.log`, no `eslint-disable`.
- Repository throws domain errors, not infrastructure errors; TypeORM exceptions stay private inside the concrete repo impl.

---

## 3. Design

### 3.1 Seller policies (#260)

#### 3.1.1 Core types

**Location: integrations layer (with the port that returns them).** `libs/core/src/integrations/domain/types/seller-policies.types.ts`:

```typescript
export interface SellerPolicy {
  id: string;
  name: string;
}

export interface SellerPolicies {
  deliveryPolicies: SellerPolicy[];
  returnPolicies: SellerPolicy[];
  warranties: SellerPolicy[];
  impliedWarranties: SellerPolicy[];
}
```

Framework-free (no `@ApiProperty`). Controller DTOs add Swagger decoration. **Rationale for placement:** the port defines the shape it returns. `CreateOfferCommand` / `CreateOfferResult` / `CreateOfferOverrides` already live in `libs/core/src/integrations/domain/types/` for the same reason. Putting `SellerPolicies` anywhere else (e.g., `libs/core/src/listings/application/types/`) creates an unnecessary import from `integrations/domain/ports/` → `listings/application/types/`, which also risks a circular dependency. The listings barrel re-exports for FE/API convenience (see §3.4) — but the canonical home is integrations.

#### 3.1.2 Port method

Extend `libs/core/src/integrations/domain/ports/marketplace.port.ts`:

```typescript
/**
 * Return the seller-configured policies the marketplace requires when
 * creating an offer (delivery, return, warranty, implied-warranty).
 * Optional — adapters that do not need policy IDs for offer creation
 * omit this method; callers must check for presence before invoking.
 */
fetchSellerPolicies?(): Promise<SellerPolicies>;
```

Import path: `SellerPolicies` is colocated with the port in `libs/core/src/integrations/domain/types/` — no cross-layer import needed.

#### 3.1.3 Allegro adapter implementation

`libs/integrations/allegro/src/infrastructure/adapters/allegro-marketplace.adapter.ts` — add method + 4 API types in `allegro-api.types.ts`:

- `AllegroDeliverySettings` (from `GET /sale/delivery-settings` → array of `settings[].id + name`)
- `AllegroReturnPolicy`, `AllegroWarranty`, `AllegroImpliedWarranty` (from `GET /after-sales-service-conditions/return-policies` / `/warranties` / `/implied-warranties`)

Method body:
```typescript
async fetchSellerPolicies(): Promise<SellerPolicies> {
  const [delivery, returns, warranties, impliedWarranties] = await Promise.all([
    this.httpClient.get<{ deliverySettings: AllegroDeliverySettings[] }>('/sale/delivery-settings'),
    this.httpClient.get<{ returnPolicies: AllegroReturnPolicy[] }>('/after-sales-service-conditions/return-policies'),
    this.httpClient.get<{ warranties: AllegroWarranty[] }>('/after-sales-service-conditions/warranties'),
    this.httpClient.get<{ impliedWarranties: AllegroImpliedWarranty[] }>('/after-sales-service-conditions/implied-warranties'),
  ]);
  return {
    deliveryPolicies: delivery.deliverySettings.map((p) => ({ id: p.id, name: p.name })),
    returnPolicies: returns.returnPolicies.map((p) => ({ id: p.id, name: p.name })),
    warranties: warranties.warranties.map((p) => ({ id: p.id, name: p.name })),
    impliedWarranties: impliedWarranties.impliedWarranties.map((p) => ({ id: p.id, name: p.name })),
  };
}
```

Verify the response envelope names against Allegro docs during implementation; adjust mapping if needed. Any HTTP error propagates — the Allegro HTTP client already wraps non-2xx into `AllegroApiException`, which the application service surfaces as a 500 (acceptable — policy fetch failure is rare and recoverable by retry).

#### 3.1.4 Cache ORM entity + migration

`libs/core/src/listings/infrastructure/persistence/entities/seller-policies-cache.orm-entity.ts`:

```typescript
@Entity('seller_policies_cache')
export class SellerPoliciesCacheOrmEntity {
  @PrimaryColumn({ type: 'uuid' }) connectionId!: string;
  @Column({ type: 'jsonb' }) policies!: SellerPolicies;
  @Column({ type: 'timestamptz' }) fetchedAt!: Date;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updatedAt!: Date;
}
```

`connectionId` is the primary key (one row per connection is the contract — no surrogate id or unique index needed). Platform is already captured by the connection (`connections.platform_type` is immutable), so adding `platformType` to the key is redundant.

**Migration** (`pnpm --filter @openlinker/api migration:generate -- src/migrations/CreateSellerPoliciesCache`):
- Table `seller_policies_cache` with those columns
- Unique index on `connection_id`
- Verify `up` and `down` both clean (test with `migration:run` then `migration:revert`)

#### 3.1.5 `SellerPoliciesService` + cache port

**Repository port (domain).** `libs/core/src/listings/domain/ports/seller-policies-cache-repository.port.ts`:

```typescript
import { SellerPolicies } from '@openlinker/core/integrations';

export interface CachedSellerPolicies {
  connectionId: string;
  policies: SellerPolicies;
  fetchedAt: Date;
}

export interface SellerPoliciesCacheRepositoryPort {
  findByConnectionId(connectionId: string): Promise<CachedSellerPolicies | null>;
  upsert(entry: CachedSellerPolicies): Promise<void>;
}
```

**Why a port (not a concrete class):** `docs/engineering-standards.md` → *Repository Ports Pattern* is unconditional: "Application services must never depend on concrete infrastructure repositories. They must depend on repository ports (interfaces) defined in the domain layer." This applies even for a thin cache wrapper — the service layer must stay testable with a port mock, not a TypeORM mock. Mirrors `OfferCreationRecordRepositoryPort` in the same module.

**Concrete repo.** `libs/core/src/listings/infrastructure/persistence/repositories/seller-policies-cache.repository.ts` — implements `SellerPoliciesCacheRepositoryPort`, injects `@InjectRepository(SellerPoliciesCacheOrmEntity)`, private ORM ↔ domain mapping methods.

**Service interface.** `application/services/seller-policies.service.interface.ts`:
```typescript
export interface ISellerPoliciesService {
  /**
   * Get seller policies for a connection. Hits cache if fresh (<10 min),
   * otherwise fetches from the adapter and repopulates cache. Throws
   * `UnprocessableEntityException` if adapter does not implement
   * `fetchSellerPolicies`.
   */
  getSellerPolicies(connectionId: string): Promise<SellerPolicies>;
}
```

Interface file colocated with the impl in `application/services/` — matching the listings module convention (verified: `offer-creation-execution.service.interface.ts`, `offer-builder.service.interface.ts` all colocate with their impls in `application/interfaces/`; I'll place the new interface in whichever folder the existing listings interfaces use once I open the directory).

**Service impl.** `application/services/seller-policies.service.ts`:
- Inject `INTEGRATIONS_SERVICE_TOKEN` (for `getCapabilityAdapter<MarketplacePort>`) + `SELLER_POLICIES_CACHE_TOKEN` bound to `SellerPoliciesCacheRepositoryPort`.
- `SELLER_POLICIES_TTL_MS = 10 * 60 * 1000`
- Flow:
  1. Lookup cache row by `connectionId`. If present and `fetchedAt > now - TTL`, return `row.policies`.
  2. Resolve Marketplace adapter via `integrationsService.getCapabilityAdapter<MarketplacePort>(connectionId, 'Marketplace')`. (This throws `ConnectionNotFoundException` → 404, `ConnectionDisabledException` → 409, `CapabilityNotSupportedException` → 422.)
  3. If `!adapter.fetchSellerPolicies`, throw `UnprocessableEntityException(\`Adapter for connection \${connectionId} does not support seller-policy listing\`)`.
  4. Call `adapter.fetchSellerPolicies()`. Upsert into cache — **on upsert failure, log a warning and return the fresh policies anyway** (cache-aside semantics; a transient DB blip must not make the endpoint fail when we already have the data).
- Tokens `SELLER_POLICIES_SERVICE_TOKEN = Symbol('ISellerPoliciesService')` and `SELLER_POLICIES_CACHE_TOKEN = Symbol('SellerPoliciesCacheRepositoryPort')` in `listings.tokens.ts`. Bind both with `useExisting` in `listings.module.ts`, export both.

#### 3.1.6 Controller endpoint

`apps/api/src/listings/http/listings.controller.ts` — add:

```typescript
@Get('connections/:connectionId/seller-policies')
@HttpCode(HttpStatus.OK)
@ApiParam({ name: 'connectionId', description: 'Marketplace connection ID' })
@ApiOperation({
  summary: 'List seller-configured marketplace policies',
  description: 'Returns delivery, return, warranty, and implied-warranty policy options for the connection.',
})
@ApiResponse({ status: 200, type: SellerPoliciesResponseDto })
@ApiResponse({ status: 404, description: 'Connection not found' })
@ApiResponse({ status: 409, description: 'Connection disabled' })
@ApiResponse({ status: 422, description: 'Adapter does not support seller-policy listing' })
async getSellerPolicies(
  @Param('connectionId') connectionId: string,
): Promise<SellerPoliciesResponseDto> {
  return this.sellerPoliciesService.getSellerPolicies(connectionId);
}
```

DTO: `apps/api/src/listings/http/dto/seller-policies-response.dto.ts` — four `@ApiProperty` arrays of `{ id, name }`. Identical structure to `SellerPolicies` but decorated.

Inject `SELLER_POLICIES_SERVICE_TOKEN` into the controller.

### 3.2 Create-offer endpoint (#259)

#### 3.2.1 Request DTO

`apps/api/src/listings/http/dto/create-offer.dto.ts`:

```typescript
export class CreateOfferPriceDto {
  @IsNumber() @IsPositive() amount!: number;
  @IsString() @IsNotEmpty() currency!: string;
}

export class CreateOfferOverridesDto {
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsString() description?: string | null;
  @IsOptional() @IsString() categoryId?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) imageUrls?: string[] | null;
  @IsOptional() @IsObject() platformParams?: Record<string, unknown>;
}

export class CreateOfferDto {
  @IsString() @IsNotEmpty() @Matches(/^ol_variant_/)
  internalVariantId!: string;

  @IsInt() @Min(0)
  stock!: number;

  @IsBoolean()
  publishImmediately!: boolean;

  @IsOptional() @ValidateNested() @Type(() => CreateOfferPriceDto)
  price?: CreateOfferPriceDto;

  @IsOptional() @ValidateNested() @Type(() => CreateOfferOverridesDto)
  overrides?: CreateOfferOverridesDto;
}
```

**Note on `description`/`imageUrls` accepting `null`:** matches `CreateOfferOverrides` in `@openlinker/core/integrations` after PR #295. Keep the HTTP DTO aligned.

**Note on `@Matches(/^ol_variant_/)`.** Internal IDs follow the `ol_{entityType}_{hex}` format (see `architecture-overview.md` → *Internal Identifier Format*). At implementation time, check whether a shared prefix constant or type guard already exists in `@openlinker/core/products` or `@openlinker/core/identifier-mapping` — if yes, reference it instead of an inline regex. If not, keep the regex and follow the neighbours (don't introduce a new helper purely for this one DTO).

**Note on `platformParams` shape.** `Record<string, unknown>` is the documented escape hatch (#254), so the DTO intentionally lets anything object-shaped through. But `@IsObject()` alone lets a client push multi-MB payloads into the Redis Streams job payload. Add a soft upper bound in the DTO (e.g., `@MaxLength` via a custom `@MaxObjectJsonSize(4096)` validator, or a post-transform byte check). Target: reject anything over ~4 KB serialised — well above the handful of policy-id fields Allegro actually reads, well below anything that could stress the stream. This is operational hygiene, not a security control.

**Note on DTO ↔ `CreateOfferOverrides` drift.** The DTO mirrors `CreateOfferOverrides` field-for-field today. If the core type later gains a field (another PR in the #286/#293/#295 line), this DTO silently misses it. Add a type-level assertion alongside the DTO (e.g., `type _DtoMatchesOverrides = AssertEqual<CreateOfferOverridesDto, Required<CreateOfferOverrides>>;` with a small `AssertEqual<A, B>` utility) so the next drift breaks type-check. Optional — skip if there's no existing `AssertEqual` utility in the repo.

#### 3.2.2 Response DTOs

```typescript
// create-offer-response.dto.ts
export class CreateOfferResponseDto {
  @ApiProperty() jobId!: string;
  @ApiProperty() offerCreationRecordId!: string;
}

// offer-creation-status-response.dto.ts
export class OfferCreationStatusResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() internalVariantId!: string;
  @ApiProperty() connectionId!: string;
  @ApiPropertyOptional({ nullable: true }) externalOfferId!: string | null;
  @ApiProperty({ enum: OfferCreationStatusValues }) status!: OfferCreationStatus;
  @ApiPropertyOptional({ nullable: true, type: 'array' }) errors!: OfferCreationError[] | null;
  @ApiProperty() publishImmediately!: boolean;
  @ApiProperty() createdAt!: string; // ISO string
  @ApiProperty() updatedAt!: string;
}
```

#### 3.2.3 Controller handlers

Add to `ListingsController` — inject two more tokens (`INTEGRATIONS_SERVICE_TOKEN`, `OFFER_CREATION_RECORD_REPOSITORY_TOKEN`):

**POST handler:**
```typescript
@Post('connections/:connectionId/offers')
@HttpCode(HttpStatus.ACCEPTED)
async createOffer(
  @Param('connectionId') connectionId: string,
  @Body() dto: CreateOfferDto,
  @Headers('x-idempotency-key') clientIdempotencyKey?: string,
): Promise<CreateOfferResponseDto> {
  // 1. Validate connection + Marketplace capability.
  //    getCapabilityAdapter throws ConnectionNotFoundException (404) / ConnectionDisabledException (409) / CapabilityNotSupportedException (422).
  const adapter = await this.integrationsService.getCapabilityAdapter<MarketplacePort>(
    connectionId,
    'Marketplace',
  );
  if (!adapter.createOffer) {
    throw new UnprocessableEntityException(
      `Adapter for connection ${connectionId} does not support offer creation`,
    );
  }

  // 2. Pre-create record so it's visible before the job runs.
  const record = await this.offerCreationRecords.create({
    internalVariantId: dto.internalVariantId,
    connectionId,
    externalOfferId: null,
    status: 'pending',
    errors: null,
    publishImmediately: dto.publishImmediately,
  });

  // 3. Enqueue the job.
  const { jobId } = await this.jobEnqueue.enqueueJob({
    jobType: 'marketplace.offer.create',
    connectionId,
    idempotencyKey: clientIdempotencyKey ?? `offer-create:${record.id}`,
    payload: {
      schemaVersion: 1,
      internalVariantId: dto.internalVariantId,
      stock: dto.stock,
      publishImmediately: dto.publishImmediately,
      ...(dto.price && { price: dto.price }),
      ...(dto.overrides && { overrides: dto.overrides }),
      offerCreationRecordId: record.id,
    } satisfies MarketplaceOfferCreatePayloadV1,
  });

  return { jobId, offerCreationRecordId: record.id };
}
```

**Notes on the idempotency key.** The default `offer-create:${record.id}` is **per-call unique** because the record is freshly created on every POST — so without an `x-idempotency-key` header, two rapid double-submits will create two distinct `OfferCreationRecord` rows and two distinct jobs. That matches the `updateOfferFields` behaviour (which defaults to `randomUUID()`) and is intentional: the record id is the only thing that ties the HTTP response back to a specific creation attempt, so a second submit legitimately represents a second attempt.

**If we wanted client-header-less dedupe** (e.g., collapse two near-simultaneous POSTs for the same variant+connection into one record + one job), the key would need to be deterministic from request inputs — e.g., `offer-create:${connectionId}:${dto.internalVariantId}`. That changes behaviour meaningfully (a client that legitimately wanted to create two offers for the same variant on the same connection would be blocked until the first job's dedupe TTL elapsed), so I'm **not** adopting it. Clients that need dedupe send `x-idempotency-key`; this will be surfaced in the FE wizard (#261).

**GET status handler:**
```typescript
@Get('connections/:connectionId/offers/creation/:offerCreationRecordId')
@HttpCode(HttpStatus.OK)
async getOfferCreationStatus(
  @Param('connectionId') connectionId: string,
  @Param('offerCreationRecordId') recordId: string,
): Promise<OfferCreationStatusResponseDto> {
  const record = await this.offerCreationRecords.findById(recordId);
  if (!record || record.connectionId !== connectionId) {
    throw new NotFoundException(`Offer creation record not found: ${recordId}`);
  }
  return this.toOfferCreationStatusDto(record);
}
```

Why the connectionId cross-check: defence against URL-tampering (`GET /.../conn-a/offers/creation/:id` where the record actually belongs to `conn-b`). Cheap belt-and-braces; same pattern the worker handler wouldn't need but the HTTP surface should.

Private `toOfferCreationStatusDto(record: OfferCreationRecord)`: flat mapping, `Date → ISO string`.

**Note on upfront validation cost.** Calling `integrationsService.getCapabilityAdapter<MarketplacePort>(...)` constructs the full adapter (credentials lookup, HTTP client setup) just to check `!adapter.createOffer`, then throws it away — the worker constructs the adapter again when it picks up the job. This is a UX-for-cost tradeoff the issue explicitly asks for: fail-fast 404/409/422 at enqueue time rather than silently enqueuing a job that will fail on the first worker attempt. Acceptable for low-frequency operator-initiated POSTs; revisit if we ever move offer creation to high-volume automation.

### 3.3 Tests

**New service spec** — `libs/core/src/listings/application/services/__tests__/seller-policies.service.spec.ts`:
1. Cache hit (fresh) → returns cached, does NOT call adapter.
2. Cache miss (stale) → calls adapter, upserts cache, returns adapter result.
3. Cache empty → calls adapter, upserts cache, returns.
4. Adapter resolves but missing `fetchSellerPolicies` method → throws `UnprocessableEntityException`.
5. `getCapabilityAdapter` throws `ConnectionNotFoundException` → propagates (no swallowing, controller will map to 404).
6. Adapter returns successfully but cache `upsert` throws → service still returns fresh policies; warning is logged (cache-aside resilience).

Mocks: `jest.Mocked<IIntegrationsService>`, `jest.Mocked<SellerPoliciesCacheRepositoryPort>` (port interface, not the concrete repo). Fake timers for the TTL boundary case (`fetchedAt` exactly at `now - TTL`).

**New controller spec** — extend `apps/api/src/listings/http/listings.controller.spec.ts`:
- Mock `ISellerPoliciesService`, `IIntegrationsService`, `OfferCreationRecordRepositoryPort`, existing `JobEnqueuePort`.
- **GET seller-policies**: service called, response shape mirrors `SellerPolicies`.
- **POST create-offer**, happy path: calls `getCapabilityAdapter`, creates record, enqueues job with `offerCreationRecordId`, returns 202 `{ jobId, offerCreationRecordId }`.
- **POST create-offer**, adapter without `createOffer` → `UnprocessableEntityException` (422).
- **POST create-offer**, `ConnectionDisabledException` from `getCapabilityAdapter` → propagates (Nest maps 409).
- **GET status** happy path: ISO dates, flat DTO.
- **GET status**, record belongs to different connection → `NotFoundException`.
- **GET status**, unknown id → `NotFoundException`.

**Allegro adapter spec** — extend `libs/integrations/allegro/src/infrastructure/adapters/__tests__/allegro-marketplace.adapter.spec.ts`:
- `fetchSellerPolicies` dispatches 4 GETs in parallel.
- Maps Allegro response envelopes to `SellerPolicy[]` correctly.
- Propagates `AllegroApiException` on non-2xx (one failure fails the whole call — `Promise.all`).

**Integration test** — new `apps/api/test/integration/listings-create-offer.int-spec.ts`:
- POST create-offer with a seeded variant + active Allegro connection (using fixtures) → 202 response shape, row appears in `offer_creation_records` with `status='pending'`, job appears in `sync_jobs` with the right payload.
- GET status → returns the created record.
- Cross-connection GET → 404.

**Seller-policies integration test** — new `apps/api/test/integration/listings-seller-policies.int-spec.ts`. Lightweight: does **not** mock Allegro, instead exercises the cache+Nest wiring path by pre-seeding a fresh row in `seller_policies_cache` for a test connection, then hitting `GET /listings/connections/:id/seller-policies` and asserting the shape comes back through Nest. One positive case is enough — unit tests cover the adapter + service logic; this just proves the DB plumbing, route registration, and DTO serialization work end-to-end. Skip the cache-miss + live-Allegro-fetch path in integration (it's flaky and already covered by unit tests).

### 3.4 Module wiring summary

`libs/core/src/listings/listings.module.ts`:
- Import `SellerPoliciesCacheOrmEntity` via `TypeOrmModule.forFeature(...)`.
- Register `SellerPoliciesService`, `SellerPoliciesCacheRepository` as providers.
- Add `SELLER_POLICIES_SERVICE_TOKEN` with `useExisting: SellerPoliciesService`, export.
- Add `SELLER_POLICIES_CACHE_TOKEN` with `useExisting: SellerPoliciesCacheRepository`, export (so tests and future consumers can mock the port).

`libs/core/src/listings/listings.tokens.ts`:
- Add `export const SELLER_POLICIES_SERVICE_TOKEN = Symbol('ISellerPoliciesService');`
- Add `export const SELLER_POLICIES_CACHE_TOKEN = Symbol('SellerPoliciesCacheRepositoryPort');`

`libs/core/src/integrations/index.ts`:
- Export `SellerPolicies`, `SellerPolicy` from `./domain/types/seller-policies.types`.

`libs/core/src/listings/index.ts`:
- Export `SellerPoliciesService`, `ISellerPoliciesService`, `SELLER_POLICIES_SERVICE_TOKEN`, `SELLER_POLICIES_CACHE_TOKEN`, `SellerPoliciesCacheRepositoryPort`.
- **Do not** re-export `SellerPolicies` / `SellerPolicy` — they belong to integrations; consumers import them from `@openlinker/core/integrations` directly.

`apps/api/src/listings/listings.module.ts`:
- No change (it already imports core listings module — the new providers + token ride in).

`apps/api/src/database/data-source.ts`:
- Verify the glob picks up the new `.orm-entity.ts`; usually covered by `libs/core/src/**/*.orm-entity.ts`. No code change expected.

---

## 4. Step-by-step

| # | File | Action |
|---|---|---|
| 1.1 | `libs/core/src/integrations/domain/types/seller-policies.types.ts` | **New.** `SellerPolicy`, `SellerPolicies` — colocated with `MarketplacePort` which returns them. |
| 1.2 | `libs/core/src/integrations/index.ts` | Re-export `SellerPolicy`, `SellerPolicies` from the barrel. |
| 1.3 | `libs/core/src/integrations/domain/ports/marketplace.port.ts` | Add optional `fetchSellerPolicies?(): Promise<SellerPolicies>`. Local import from `../types/seller-policies.types` — no cross-module import. |
| 1.4 | `libs/integrations/allegro/src/infrastructure/types/allegro-api.types.ts` | Add `AllegroDeliverySettings`, `AllegroReturnPolicy`, `AllegroWarranty`, `AllegroImpliedWarranty` response shapes. |
| 1.5 | `libs/integrations/allegro/src/infrastructure/adapters/allegro-marketplace.adapter.ts` | Implement `fetchSellerPolicies` with 4-parallel GETs. |
| 2.1 | `libs/core/src/listings/infrastructure/persistence/entities/seller-policies-cache.orm-entity.ts` | **New.** ORM entity; `connectionId` as PK. |
| 2.2 | `libs/core/src/listings/domain/ports/seller-policies-cache-repository.port.ts` | **New.** `SellerPoliciesCacheRepositoryPort` + `CachedSellerPolicies` type (per engineering-standards Repository Ports Pattern). |
| 2.3 | `libs/core/src/listings/infrastructure/persistence/repositories/seller-policies-cache.repository.ts` | **New.** Implements `SellerPoliciesCacheRepositoryPort`; private ORM ↔ domain mapping. |
| 2.4 | `apps/api/src/migrations/{timestamp}-CreateSellerPoliciesCache.ts` | **New.** Generated via TypeORM CLI; test `up`/`down`. |
| 3.1 | `libs/core/src/listings/listings.tokens.ts` | Add `SELLER_POLICIES_SERVICE_TOKEN` + `SELLER_POLICIES_CACHE_TOKEN`. |
| 3.2 | `libs/core/src/listings/application/services/seller-policies.service.interface.ts` | **New.** `ISellerPoliciesService`. (Place in whichever folder the sibling listings service interfaces use — `application/services/` or `application/interfaces/`; verify on disk.) |
| 3.3 | `libs/core/src/listings/application/services/seller-policies.service.ts` | **New.** Cache-aware impl; injects via `INTEGRATIONS_SERVICE_TOKEN` + `SELLER_POLICIES_CACHE_TOKEN`; swallows cache-write failure with warn log. |
| 3.4 | `libs/core/src/listings/listings.module.ts` | Register `SellerPoliciesCacheRepository` + `SellerPoliciesService` as providers; `forFeature(SellerPoliciesCacheOrmEntity)`; `useExisting` bindings for both tokens; export both tokens. |
| 3.5 | `libs/core/src/listings/index.ts` | Re-export `SellerPoliciesService`, `ISellerPoliciesService`, both tokens, `SellerPoliciesCacheRepositoryPort`. Do NOT re-export `SellerPolicies`/`SellerPolicy` — those live in integrations. |
| 4.1 | `libs/core/src/listings/application/services/__tests__/seller-policies.service.spec.ts` | **New.** 6 unit tests per §3.3. |
| 4.2 | `libs/integrations/allegro/src/infrastructure/adapters/__tests__/allegro-marketplace.adapter.spec.ts` | Add 2–3 tests for `fetchSellerPolicies`. |
| 5.1 | `apps/api/src/listings/http/dto/seller-policies-response.dto.ts` | **New.** Swagger-decorated mirror of `SellerPolicies`. |
| 5.2 | `apps/api/src/listings/http/dto/create-offer.dto.ts` | **New.** Request DTOs; include `@MaxObjectJsonSize(4096)` (or equivalent) on `platformParams` if a helper exists, otherwise soft-skip. |
| 5.3 | `apps/api/src/listings/http/dto/create-offer-response.dto.ts` | **New.** `{ jobId, offerCreationRecordId }`. |
| 5.4 | `apps/api/src/listings/http/dto/offer-creation-status-response.dto.ts` | **New.** Flat status DTO. |
| 6.1 | `apps/api/src/listings/http/listings.controller.ts` | Inject 3 new tokens (`SELLER_POLICIES_SERVICE_TOKEN`, `INTEGRATIONS_SERVICE_TOKEN`, `OFFER_CREATION_RECORD_REPOSITORY_TOKEN`); add 3 endpoints (GET policies, POST create, GET status); private `toOfferCreationStatusDto`. |
| 6.2 | `apps/api/src/listings/http/listings.controller.spec.ts` | Add mocks + 7 new tests per §3.3. |
| 7.1 | `apps/api/test/integration/listings-create-offer.int-spec.ts` | **New.** 3 integration cases. |
| 7.2 | `apps/api/test/integration/listings-seller-policies.int-spec.ts` | **New.** 1 integration case: pre-seeded cache row → `GET /listings/connections/:id/seller-policies` returns the policies. |
| 8 | Quality gate | `pnpm --filter @openlinker/api migration:show` + `pnpm lint && pnpm type-check && pnpm test && pnpm test:integration`. |

---

## 5. Risks & mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| Allegro response envelopes differ from assumed names (`deliverySettings`, `returnPolicies`, `warranties`, `impliedWarranties`) | Medium | Confirm against Allegro docs during implementation; adapter spec tests pin the shape. |
| Cache row count grows unbounded (one per connection) | Very low | Connections are low-cardinality (≤ 100s). Primary-keyed by `connectionId`. If cardinality becomes a concern, add a TTL-driven cleanup job — out of scope here. |
| Cache write transient failure masks successful Allegro fetch | Very low | Service logs a warning and returns the fresh value anyway (cache-aside semantics, §3.1.5). Next request either reads a fresh cache entry or refetches; no operator-visible error. Test #6 in the service spec pins this behaviour. |
| `platformParams` forwarded unchecked from HTTP → Allegro | Low | The adapter reads only the keys it knows (`deliveryPolicyId`, `returnPolicyId`, `warrantyId`, `impliedWarrantyId`). Extra keys are ignored. DTO validation lets the object through as `Record<string, unknown>` intentionally — this is the documented escape hatch per #254. Soft size cap (§3.2.1) prevents operational abuse. |
| `offerCreationRecordId` in the payload gets stale if the worker picks up a record whose row was manually deleted | Very low | `OfferCreationExecutionService.loadOrCreateRecord` throws `OfferCreationRecordNotFoundException` in that case; worker surfaces it as a job failure. Acceptable. |
| 10-minute TTL too aggressive — operator rotates policies and can't see new ones for up to 10 min | Low | Add a follow-up if it becomes a real pain; for MVP, 10 min is the trade-off the issue specified. |
| Integration test flakes because of Allegro HTTP mocking complexity | Low | Seller-policies integration test seeds cache directly and hits the endpoint (§3.3) — no Allegro HTTP in the loop. Unit tests cover the adapter + service logic. |

---

## 6. Architecture compliance check

- ✅ Domain layer (`libs/core/src/integrations/domain/ports/`) gets one new optional method, no framework imports. `SellerPolicies` / `SellerPolicy` colocated in `integrations/domain/types/` with the port that returns them.
- ✅ `SellerPoliciesService` depends only on port interfaces (`IIntegrationsService`, `MarketplacePort`, `SellerPoliciesCacheRepositoryPort`) — no concrete repo or adapter classes. Satisfies `docs/engineering-standards.md` → *Repository Ports Pattern* without exceptions.
- ✅ Repository port `SellerPoliciesCacheRepositoryPort` defined in the domain layer; concrete repo in infrastructure implements it.
- ✅ Types in separate `*.types.ts`.
- ✅ Service interface in separate `*.service.interface.ts`.
- ✅ Symbol token + `useExisting` + barrel export pattern for both service and cache port.
- ✅ Controller injects via tokens only (`OFFER_CREATION_RECORD_REPOSITORY_TOKEN`, `INTEGRATIONS_SERVICE_TOKEN`, `SELLER_POLICIES_SERVICE_TOKEN`, existing `JOB_ENQUEUE_TOKEN`, existing `OFFER_MAPPING_REPOSITORY_TOKEN`).
- ✅ No `any`, no `console.log`, no new `synchronize: true`.
- ✅ Migration for schema change (per `docs/migrations.md`).
- ✅ Tests mock ports, never concrete classes.
- ✅ `@Roles('admin') + @ApiBearerAuth()` auth on the controller class — existing endpoints unchanged.

---

## 7. Rollout

Single commit, single PR, closes both issues. Reversible via `git revert`. Migration ships with the PR; CI/CD runs migrations before app start per `docs/migrations.md`. No env var or config changes.

**PR body** lists each endpoint + acceptance from both issues, deviations from spec (§2 above), and a test plan checklist (lint, type-check, test, test:integration, `migration:show` clean).

Follow-ups to open after merge:
- `marketplace.offer.pollCreationStatus` handler to advance Allegro `validating → active` (referenced by the warn log in `OfferCreationExecutionService`).
- FE wizard (#261) — now unblocked.

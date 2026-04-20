# Implementation Plan — Offer Creation Foundation (#254 + #258)

**Branch:** `254-258-offer-create-port-and-record-entity`
**Scope:** Foundation layer for OpenLinker-initiated Allegro/Marketplace offer creation.

---

## 1. Understand the Task

### Goal
Lay the groundwork for the `MarketplacePort.createOffer()` capability and the `OfferCreationRecord` entity that tracks the OL-initiated lifecycle of a newly created offer.

### Layer classification
- **CORE — Domain layer**: new types (`CreateOfferCommand`, `CreateOfferResult`, `OfferCreationStatus`), new domain entity `OfferCreationRecord`, new repository port, new exception.
- **CORE — Infrastructure layer**: new ORM entity, new repository implementation, new migration.
- **CORE — Integrations domain layer**: extension of `MarketplacePort` with optional `createOffer?()`.

### Explicit non-goals (deferred to later issues)
- Allegro adapter `createOffer()` implementation — issue #255
- `OfferBuilderService` — issue #256
- Worker job handlers — issue #257
- HTTP REST endpoint — issue #259
- Seller policies endpoint — issue #260
- Frontend wizard — issue #261
- No `OfferCreationRecord` domain behaviour beyond holding state — no domain services here.

---

## 2. Research Findings (from codebase)

### MarketplacePort (`libs/core/src/integrations/domain/ports/marketplace.port.ts`)
- Optional methods use TypeScript optional property syntax: `method?(cmd: X): Promise<Y>`.
- Mutation commands follow the `{Verb}{Noun}Command` / `{Verb}{Noun}Result` pattern (e.g. `UpdateOfferFieldsCommand`, `UpdateOfferQuantitiesBatchResult`).
- Command/result types live in `libs/core/src/integrations/domain/types/marketplace-*.types.ts` alongside other marketplace types — **not** in the listings domain.
- Types are imported as `import type {...}` when only used as types (no runtime import).

### Capability values (`libs/core/src/integrations/domain/types/adapter.types.ts`)
- `CapabilityValues` already includes `'Marketplace'`. No new capability needed — `createOffer` is a method *on* the `Marketplace` capability.

### Listings module wiring (`libs/core/src/listings/listings.module.ts`, `listings.tokens.ts`)
- Pattern: export `Symbol('X')` tokens from `listings.tokens.ts`, wire via `{ provide: TOKEN, useExisting: ConcreteClass }` in the module, and also expose a string fallback token for legacy lookups.
- Module imports `TypeOrmModule.forFeature([...])` for the ORM entities it owns.
- `OfferMappingRepositoryPort` binds with `OFFER_MAPPING_REPOSITORY_TOKEN = Symbol('OfferMappingRepositoryPort')`.

### Migration convention (`apps/api/src/migrations/`)
- Filename: `{unix-timestamp-ms}-{kebab-description}.ts`
- Class: `{PascalDescription}{Timestamp} implements MigrationInterface` with `name` field matching class name.
- `up()` checks `queryRunner.getTable(...)` before `CREATE TABLE` (defensive against re-runs).
- `down()` drops indexes then table.
- Latest migration timestamp in repo: `1782000000000`. **Initial timestamp was `1783000000000`; bumped to `1784000000000` after rebasing on `origin/main` which had merged a separate `1783000000000-add-order-record-status.ts` migration from PR #262.**

### Reference entity/repo pair (`Connection` + `connection.orm-entity.ts` + `connection.repository.ts`)
- Domain entity: plain class, readonly constructor params, no framework imports.
- ORM entity: `@Entity('table_name')`, `@PrimaryGeneratedColumn('uuid')`, `@Column(...)`, `@CreateDateColumn()`, `@UpdateDateColumn()`, `@Index([...])` for composite indexes.
- Domain exceptions live in `libs/core/src/{domain}/domain/exceptions/`.

### Status type pattern (`sync-job.types.ts`, `order.types.ts`, `webhook-delivery.types.ts`)
- `export const XValues = [...] as const;` + `export type X = (typeof XValues)[number];`
- Always exports both the runtime array and the derived union type.

---

## 3. Design

### Files to create

**Integrations domain (marketplace types + port extension):**
- `libs/core/src/integrations/domain/types/marketplace-offer-create.types.ts` — `CreateOfferCommand`, `CreateOfferResult`, `CreateOfferStatus` + values
- `libs/core/src/integrations/domain/ports/marketplace.port.ts` — **modify**: add optional `createOffer?()`

**Listings domain:**
- `libs/core/src/listings/domain/entities/offer-creation-record.entity.ts` — domain entity
- `libs/core/src/listings/domain/types/offer-creation-record.types.ts` — `OfferCreationStatusValues`, `OfferCreationStatus`, `OfferCreationError`
- `libs/core/src/listings/domain/ports/offer-creation-record-repository.port.ts` — repository port
- `libs/core/src/listings/domain/exceptions/offer-creation-record-not-found.exception.ts` — domain exception (`OfferCreationRecordNotFoundException`, matching the `ProductNotFoundException` / `connection-not-found.exception.ts` convention)

**Listings infrastructure:**
- `libs/core/src/listings/infrastructure/persistence/entities/offer-creation-record.orm-entity.ts` — ORM entity
- `libs/core/src/listings/infrastructure/persistence/repositories/offer-creation-record.repository.ts` — repository impl

**Module wiring:**
- `libs/core/src/listings/listings.tokens.ts` — **modify**: add `OFFER_CREATION_RECORD_REPOSITORY_TOKEN`
- `libs/core/src/listings/listings.module.ts` — **modify**: register ORM entity + repo provider + export token
- `libs/core/src/listings/index.ts` — **modify**: re-export new domain types, entity, port, token

**Migration:**
- `apps/api/src/migrations/1783000000000-add-offer-creation-records-table.ts`
- Also add the new ORM entity to API's TypeORM data source config if it's not auto-discovered (will verify in step 1).

**Tests:**
- `libs/core/src/listings/infrastructure/persistence/repositories/offer-creation-record.repository.spec.ts` — unit tests with mocked TypeORM repository
- `libs/core/src/listings/domain/entities/offer-creation-record.entity.spec.ts` — light tests for entity construction

### Key type shapes

**`CreateOfferCommand`** (in `marketplace-offer-create.types.ts`):
```ts
export interface CreateOfferCommand {
  internalVariantId: string;
  connectionId: string;
  price: { amount: number; currency: string };
  stock: number;
  publishImmediately: boolean;
  overrides?: CreateOfferOverrides;
  idempotencyKey?: string;
}

export interface CreateOfferOverrides {
  title?: string;
  description?: string;
  categoryId?: string;
  imageUrls?: string[];
  platformParams?: Record<string, unknown>;
}

export const CreateOfferResultStatusValues = ['draft', 'validating', 'active'] as const;
export type CreateOfferResultStatus = (typeof CreateOfferResultStatusValues)[number];

export interface CreateOfferResult {
  externalOfferId: string;
  status: CreateOfferResultStatus;
}
```

**`OfferCreationStatus`** (in `offer-creation-record.types.ts`):
```ts
export const OfferCreationStatusValues = [
  'pending',     // job enqueued, adapter not yet called
  'draft',       // created on platform, not published
  'validating',  // platform is async-validating
  'active',      // published and live
  'failed',      // creation or validation failed
] as const;
export type OfferCreationStatus = (typeof OfferCreationStatusValues)[number];

export interface OfferCreationError {
  field?: string;
  code: string;
  message: string;
}
```

**`OfferCreationRecord` domain entity** — plain class, readonly props:
```ts
constructor(
  public readonly id: string,                     // uuid
  public readonly internalVariantId: string,
  public readonly connectionId: string,
  public readonly externalOfferId: string | null, // null until adapter returns it
  public readonly status: OfferCreationStatus,
  public readonly errors: OfferCreationError[] | null,
  public readonly publishImmediately: boolean,
  public readonly createdAt: Date,
  public readonly updatedAt: Date,
)
```

**`CreateOfferCreationRecordInput`** (dedicated input type, in `offer-creation-record.types.ts`):
```ts
export interface CreateOfferCreationRecordInput {
  internalVariantId: string;
  connectionId: string;
  status: OfferCreationStatus;
  publishImmediately: boolean;
  externalOfferId?: string | null;
  errors?: OfferCreationError[] | null;
}
```
Explicit input type (not `Omit<OfferCreationRecord, ...>`) decouples the write contract from the entity shape and avoids the readonly-propagation awkwardness of omit-over-class.

**`OfferCreationRecordRepositoryPort`** — minimal, only methods needed by future consumers (#257, #259):
```ts
create(input: CreateOfferCreationRecordInput): Promise<OfferCreationRecord>;
findById(id: string): Promise<OfferCreationRecord | null>;
/** Returns the most-recently-created record for (variantId, connectionId), ordered createdAt DESC. Null if none. */
findLatestByVariantAndConnection(variantId: string, connectionId: string): Promise<OfferCreationRecord | null>;
updateStatus(id: string, status: OfferCreationStatus, errors?: OfferCreationError[] | null): Promise<OfferCreationRecord>;
updateExternalOfferId(id: string, externalOfferId: string): Promise<OfferCreationRecord>;
```
(Renamed `findByVariantAndConnection` → `findLatestByVariantAndConnection` so the ordering contract is visible at the call site, not only in JSDoc.)

### Two distinct status unions — do not merge

- **`CreateOfferResultStatus`** (`'draft' | 'validating' | 'active'`) — momentary status returned by the *adapter* right after the platform API call. Cannot be `pending` (adapter was already invoked) and cannot be `failed` (that would have thrown a domain exception). Lives in `marketplace-offer-create.types.ts`.
- **`OfferCreationStatus`** (`'pending' | 'draft' | 'validating' | 'active' | 'failed'`) — persisted lifecycle state on `OfferCreationRecord`. Includes `pending` (job enqueued, adapter not yet called) and `failed` (post-validation failure). Lives in `offer-creation-record.types.ts`.

These are not the same enum. Do not collapse them in the implementation.

### Table shape (`offer_creation_records`)

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `id` | uuid | NO | PK, `uuid_generate_v4()` default |
| `internalVariantId` | text | NO | OL variant id (`ol_variant_...`) |
| `connectionId` | uuid | NO | FK-like reference to `connections.id` |
| `externalOfferId` | text | YES | null until platform returns it |
| `status` | text | NO | one of `OfferCreationStatusValues` |
| `errors` | jsonb | YES | array of `OfferCreationError` when status=failed |
| `publishImmediately` | boolean | NO | default false |
| `createdAt` | timestamp | NO | `now()` default |
| `updatedAt` | timestamp | NO | `now()` default |

**Indexes:**
- `IDX_offer_creation_records_variant_connection` on `(internalVariantId, connectionId)` — lookup in `findByVariantAndConnection`
- `IDX_offer_creation_records_status` on `(status)` — future polling handler queries
- `IDX_offer_creation_records_connection` on `(connectionId)` — admin queries

No unique constraint on `(variantId, connectionId)` — a variant may have multiple creation attempts over time (e.g., after a failed one). `findByVariantAndConnection` returns the latest by `createdAt DESC`.

---

## 4. Step-by-Step Implementation

### Step 1 (gating) — TypeORM data source config check
- **File:** read `apps/api/src/database/data-source.ts` (per `docs/migrations.md`).
- **Action:** verify the entity glob (e.g. `libs/core/src/**/*.orm-entity.{ts,js}`) will pick up the new `OfferCreationRecordOrmEntity` automatically. If explicit registration is required, capture that in Step 12.
- **Acceptance:** gating — no other code is written until this is resolved. Prevents the "migration runs but app can't use the repo" failure mode.

### Step 2 — Extend `MarketplacePort` with `createOffer?()`
- **File:** `libs/core/src/integrations/domain/types/marketplace-offer-create.types.ts` (new)
- **File:** `libs/core/src/integrations/domain/ports/marketplace.port.ts` (modify)
- **Action:** define `CreateOfferCommand`, `CreateOfferOverrides`, `CreateOfferResult`, `CreateOfferResultStatusValues`, `CreateOfferResultStatus`. Add `createOffer?()` to the port with JSDoc explaining async semantics.
- **Acceptance:** `pnpm type-check` passes; existing `AllegroMarketplaceAdapter` and `PrestashopOrderProcessorAdapter` still compile (they don't implement `MarketplacePort` adapters except the Allegro one, which has optional methods anyway).

### Step 3 — Listings domain types
- **File:** `libs/core/src/listings/domain/types/offer-creation-record.types.ts` (new)
- **Action:** define `OfferCreationStatusValues`, `OfferCreationStatus`, `OfferCreationError`.
- **Acceptance:** matches `as const` + union pattern from `sync-job.types.ts`.

### Step 4 — Domain entity `OfferCreationRecord`
- **File:** `libs/core/src/listings/domain/entities/offer-creation-record.entity.ts` (new)
- **Action:** plain class with readonly constructor params. File header JSDoc. No framework imports.
- **Acceptance:** no `@nestjs/*` or `typeorm` imports; `pnpm type-check` passes.

### Step 5 — Domain exception
- **File:** `libs/core/src/listings/domain/exceptions/offer-creation-record-not-found.exception.ts` (new)
- **Action:** `OfferCreationRecordNotFoundException extends Error` with `name = 'OfferCreationRecordNotFoundException'` and `Error.captureStackTrace(this, this.constructor)`.
- **Acceptance:** class/file naming matches the `ProductNotFoundException` pattern (Engineering Standards §Error Handling) and the existing `connection-not-found.exception.ts` file.

### Step 6 — Repository port
- **File:** `libs/core/src/listings/domain/ports/offer-creation-record-repository.port.ts` (new)
- **Action:** define `OfferCreationRecordRepositoryPort` interface with the 5 methods in Section 3. Every method has JSDoc; `findLatestByVariantAndConnection` explicitly documents the `createdAt DESC` ordering contract.
- **Acceptance:** port returns domain entity (`OfferCreationRecord`), never ORM entity. Uses `CreateOfferCreationRecordInput`, not `Omit<OfferCreationRecord, ...>`.

### Step 7 — ORM entity
- **File:** `libs/core/src/listings/infrastructure/persistence/entities/offer-creation-record.orm-entity.ts` (new)
- **Action:** `@Entity('offer_creation_records')` with all columns from Section 3 and `@Index` for the three composite/single indexes.
- **Acceptance:** compiles, field types match the table spec exactly.

### Step 8 — Repository implementation
- **File:** `libs/core/src/listings/infrastructure/persistence/repositories/offer-creation-record.repository.ts` (new)
- **Action:** `OfferCreationRecordRepository implements OfferCreationRecordRepositoryPort`. Uses `@InjectRepository(OfferCreationRecordOrmEntity)`. Private `toDomain()` method and a private helper to build ORM entity from `CreateOfferCreationRecordInput`. `updateStatus` and `updateExternalOfferId` throw `OfferCreationRecordNotFoundException` if row missing.
- **Acceptance:** mapping stays inside the repository (per standards), never leaks ORM entity.

### Step 9 — Token registration
- **File:** `libs/core/src/listings/listings.tokens.ts` (modify)
- **Action:** add `export const OFFER_CREATION_RECORD_REPOSITORY_TOKEN = Symbol('OfferCreationRecordRepositoryPort');`.

### Step 10 — Module wiring
- **File:** `libs/core/src/listings/listings.module.ts` (modify)
- **Action:**
  - Import `OfferCreationRecordOrmEntity` and add to `TypeOrmModule.forFeature([...])`.
  - Import `OfferCreationRecordRepository`.
  - Register token binding: `{ provide: OFFER_CREATION_RECORD_REPOSITORY_TOKEN, useExisting: OfferCreationRecordRepository }`.
  - Add string fallback: `{ provide: 'OfferCreationRecordRepositoryPort', useExisting: OFFER_CREATION_RECORD_REPOSITORY_TOKEN }`.
  - Add to `exports` array.
  - Re-export token at top of file (match existing pattern).

### Step 11 — Barrel exports
- **File:** `libs/core/src/listings/index.ts` (modify)
- **Action:** export `OfferCreationRecord`, `OfferCreationStatusValues`, `OfferCreationStatus`, `OfferCreationError`, `OfferCreationRecordRepositoryPort`, `OfferCreationRecordNotFoundError`, `OFFER_CREATION_RECORD_REPOSITORY_TOKEN`.

### Step 12 — API TypeORM registration
- **File:** locate where ORM entities are listed (data source or `app.module.ts`). Add `OfferCreationRecordOrmEntity` if not autoloaded.
- **Acceptance:** `pnpm --filter @openlinker/api migration:show` runs without complaining.

### Step 13 — Migration
- **File:** `apps/api/src/migrations/1784000000000-add-offer-creation-records-table.ts` (new)
- **Action:**
  - `up()`: check `getTable('offer_creation_records')`; if absent, CREATE TABLE with all columns, PK on `id` with `uuid_generate_v4()` default, plus three indexes.
  - `down()`: drop three indexes, then DROP TABLE.
- **Acceptance:**
  - `pnpm --filter @openlinker/api migration:show` lists it as pending
  - `pnpm --filter @openlinker/api migration:run` applies cleanly
  - `pnpm --filter @openlinker/api migration:revert` rolls back cleanly
  - Re-run does not double-create (defensive check works)

### Step 14 — Unit tests

- **File:** `libs/core/src/listings/domain/entities/offer-creation-record.entity.spec.ts` (new)
  - Verifies entity construction preserves all fields; tests are minimal (it's a data class).

- **File:** `libs/core/src/listings/infrastructure/persistence/repositories/offer-creation-record.repository.spec.ts` (new)
  - Mocks `Repository<OfferCreationRecordOrmEntity>`.
  - Covers: `create` returns domain entity; `findById` returns null when absent; `findLatestByVariantAndConnection` orders by `createdAt DESC`; `updateStatus` throws `OfferCreationRecordNotFoundException` when row missing; `updateExternalOfferId` throws when missing; round-trip `toDomain` preserves fields.

### Step 15 — Quality gate
```bash
pnpm lint
pnpm type-check
pnpm test
pnpm --filter @openlinker/api migration:show
pnpm --filter @openlinker/api migration:run
pnpm --filter @openlinker/api migration:revert
```
All must pass.

---

## 5. Validation

### Architecture compliance
- ✅ Domain layer (`entities`, `types`, `ports`, `exceptions`) has no NestJS / TypeORM imports
- ✅ Repository port defined in `domain/ports/`, implementation in `infrastructure/persistence/repositories/`
- ✅ Symbol token wired per standards, string fallback for consistency with existing module
- ✅ Port returns domain entity; ORM mapping is private inside repository
- ✅ Repository throws domain exception (`OfferCreationRecordNotFoundException`), never TypeORM error
- ✅ `MarketplacePort.createOffer?()` is optional (adapters can opt out), matching existing pattern
- ✅ `createOffer` lives on existing `Marketplace` capability — no new capability enum value
- ✅ Every new source file includes the standard `@module` header JSDoc per Engineering Standards §File Headers

### Naming compliance
- ✅ `*.entity.ts` for domain entity, `*.orm-entity.ts` for ORM, `*.port.ts` for port, `*.repository.ts` for impl
- ✅ `*.types.ts` for types (separate file per engineering standards)
- ✅ Token: `Symbol('OfferCreationRecordRepositoryPort')` — matches existing convention
- ✅ Migration filename/class: `1783000000000-add-offer-creation-records-table.ts` → `AddOfferCreationRecordsTable1783000000000`

### Testing strategy
- Unit tests for the repository (mocked TypeORM repo) — matches `infrastructure/persistence/repositories/*.repository.spec.ts` pattern if it exists, else follow Jest conventions.
- Integration tests deferred — they can be added in #257/#259 when there's a meaningful end-to-end flow to test. Single-table CRUD is thoroughly covered by the unit tests and migration run/revert.

### Security
- No user input surface added in this PR (no HTTP endpoint yet) — no class-validator DTOs needed at this layer.
- No secrets in code / migrations.
- `errors` JSONB is written only from trusted server code; not a user-input path.
- No raw SQL interpolation of user values (migrations are DDL only, repository uses query builder).

### Risks / open questions
- **None are blocking.** Potential minor ambiguities:
  - Should `OfferCreationRecord` track `publishImmediately` or is that only a command-time concern? → **Decision:** keep it on the record so retries/polling jobs can re-apply the intent without re-fetching the command; low cost (1 column).
  - Should we denormalize `platformType` like `identifier_mappings` does? → **No.** The `connectionId` column lets you join to `connections` if needed; platform type isn't a hot filter on this table.
  - Unique constraint on `(variantId, connectionId)`? → **No.** Multiple attempts are expected. Caller uses `findByVariantAndConnection` returning latest.

---

## Branch & commit plan

- Single branch: `254-258-offer-create-port-and-record-entity`
- Two logical commits for cleaner `git log` navigation:
  1. `feat(integrations): add createOffer to MarketplacePort` (#254)
  2. `feat(listings): add OfferCreationRecord entity and repository` (#258)
- PR body: `Closes #254\nCloses #258`

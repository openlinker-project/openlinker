# Implementation Plan — BulkOfferCreationBatch foundation (#734)

**Issue**: [#734 — feat(listings): BulkOfferCreationBatch domain entity + repository + migration](https://github.com/openlinker-project/openlinker/issues/734)
**Parent epic**: [#726 — Allegro Smart! + bulk listing](https://github.com/openlinker-project/openlinker/issues/726)
**Spec**: `docs/specs/product-spec-726-allegro-bulk-listing.md`
**Branch**: `734-bulk-offer-creation-batch`

---

## 0. Goal

Lay the persistence foundation for bulk offer creation. After this PR, the rest of the bulk-offer epic (#735–#742) can build on a stable `BulkOfferCreationBatch` aggregate without rewriting schema.

**Non-goals** (explicitly out of scope per #734):
- HTTP API endpoints (→ #736)
- Bulk submission service / job orchestration (→ #736 / #737)
- **State-transition rule** ("succeeded + failed === total → terminal status"). Lives in `BulkBatchProgressService` in #736 per `architecture-overview.md § 7`: orchestration policies belong in core application services, not in worker handlers and not in repository ports.
- Frontend (→ #739–#741)
- Smart-classification readback (→ #737)
- EAN auto-match (→ #735)
- `findByConnection` repository method — dropped during grill-me (no caller in scope; #734's AC framed it as test coverage). #736 will design the right-shape query (paginated, filterable) when a real caller arrives.
- Rich entity behavior (anemic stays the convention for this slice). Long-term direction tracked in [#750 — Decide long-term direction for domain entity behavior](https://github.com/openlinker-project/openlinker/issues/750).

---

## 1. Layer mapping

Pure CORE foundation work. Closest precedent: `OfferCreationRecord` (entity + types + port + ORM + repository + token + tests) — a 1:1 stack copy.

| File | Layer | Role |
|---|---|---|
| `libs/core/src/listings/domain/entities/bulk-offer-creation-batch.entity.ts` | CORE — Domain | Pure readonly entity |
| `libs/core/src/listings/domain/types/bulk-offer-creation-batch.types.ts` | CORE — Domain | `BulkBatchStatusValues` (as-const) + derived `BulkBatchStatus` union + `CreateBulkOfferCreationBatchInput` + named-status map |
| `libs/core/src/listings/domain/ports/bulk-offer-creation-batch-repository.port.ts` | CORE — Domain | Persistence contract — 4 methods: `create`, `findById`, `incrementCounters`, `updateStatus` |
| `libs/core/src/listings/domain/exceptions/bulk-offer-creation-batch-not-found.exception.ts` | CORE — Domain | Thrown by `incrementCounters` / `updateStatus` on missing id |
| `libs/core/src/listings/infrastructure/persistence/entities/bulk-offer-creation-batch.orm-entity.ts` | CORE — Infra | TypeORM entity for `bulk_offer_creation_batches` table |
| `libs/core/src/listings/infrastructure/persistence/repositories/bulk-offer-creation-batch.repository.ts` | CORE — Infra | Repository impl + private ORM↔domain mapping |
| `libs/core/src/listings/infrastructure/persistence/repositories/bulk-offer-creation-batch.repository.spec.ts` | CORE — Infra (test) | Repository unit spec |
| `libs/core/src/listings/listings.tokens.ts` | CORE — DI | New Symbol token `BULK_OFFER_CREATION_BATCH_REPOSITORY_TOKEN` |
| `libs/core/src/listings/listings.module.ts` | CORE — wiring | Register ORM entity, repository, token binding, exports |
| `libs/core/src/listings/index.ts` | CORE — barrel | Re-export entity / types / port / exception |
| `libs/core/src/listings/infrastructure/persistence/entities/offer-creation-record.orm-entity.ts` | CORE — Infra | Add optional `bulkBatchId` column (#734 explicit ask) |
| `apps/api/src/migrations/{timestamp}-add-bulk-offer-creation-batches.ts` | DX — migrations | Create batch table + add nullable column to existing `offer_creation_records` |

---

## 2. Domain shape

### 2.1 `BulkBatchStatus` (as-const union — 5 values, **deviation from #734's 4-value spec**)

`pending → running → (completed | partially-failed | failed)`

- `pending` — batch persisted; jobs not yet dispatched.
- `running` — at least one offer-creation job has started.
- `completed` — all child jobs finished with `failedCount === 0` (every child succeeded).
- `partially-failed` — all child jobs finished, `succeededCount > 0 && failedCount > 0` (mixed terminal).
- `failed` — all child jobs finished, `succeededCount === 0 && failedCount > 0` (every child failed).

**Deviation from #734**: the issue specifies four values (`pending | running | completed | partially-failed`) and would land an all-failed batch in `partially-failed` — semantically wrong. Operators reading "Batch partially failed" when 100 of 100 offers failed will be confused. The 5-value union is the correct domain model; adding `failed` is one literal beyond the issue text. PR body will justify the deviation.

Named-constant map (`BULK_BATCH_STATUS`) follows the `OFFER_CREATION_STATUS` precedent in `offer-creation-record.types.ts` so call sites can write `BULK_BATCH_STATUS.PartiallyFailed` instead of bare literals. Same `as const satisfies Record<Capitalize<…>, …>` shape — both axes are kept in lockstep with the union.

### 2.2 `BulkOfferCreationBatch` entity

```ts
export class BulkOfferCreationBatch {
  constructor(
    public readonly id: string,
    public readonly connectionId: string,
    public readonly initiatedBy: string, // operator user id; bulk is always user-initiated per US-1
    public readonly status: BulkBatchStatus,
    public readonly totalCount: number,
    public readonly succeededCount: number,
    public readonly failedCount: number,
    public readonly sharedConfig: Record<string, unknown>, // free-form; shape owned by #736 (submission service)
    public readonly createdAt: Date,
    public readonly updatedAt: Date,
  ) {}
}
```

**`sharedConfig` rationale**: §4.2 of the spec lists shipping-rate-package, publish-immediately, and Smart-eligibility flags as candidate fields, but the exact shape is the bulk-submission-service's concern (#736). Persisting as `Record<string, unknown>` keeps this foundation slice unblocked; #736 will type the shape behind a domain-side helper without a schema change.

**`initiatedBy` rationale**: required `string` (not nullable). Bulk creation is always operator-initiated per AC-1; a system-triggered bulk path is not a real use case for v1.

### 2.3 `CreateBulkOfferCreationBatchInput`

Dedicated input type (slice-1 pattern: decouple write contract from entity's readonly shape):

```ts
export interface CreateBulkOfferCreationBatchInput {
  connectionId: string;
  initiatedBy: string;
  totalCount: number;
  sharedConfig: Record<string, unknown>;
  // status defaults to 'pending' at repository layer; counters default to 0
}
```

`status`, `succeededCount`, `failedCount`, `id`, `createdAt`, `updatedAt` are assigned by the repository at write time — callers can't set them.

### 2.4 Repository port — 4 dumb-persistence methods

```ts
export interface BulkOfferCreationBatchRepositoryPort {
  /** Persist a new batch. Initial status='pending', counters=0, id/createdAt/updatedAt assigned by repo. */
  create(input: CreateBulkOfferCreationBatchInput): Promise<BulkOfferCreationBatch>;

  /** Find by primary key. */
  findById(id: string): Promise<BulkOfferCreationBatch | null>;

  /**
   * Atomically increment counter columns via single-column UPDATE statements
   * (`UPDATE … SET succeededCount = succeededCount + N WHERE id = $1`).
   * Race-safe across concurrent worker callbacks. Deltas are permissive
   * (negative allowed for future admin compensation flows).
   * Throws BulkOfferCreationBatchNotFoundException if the row is missing.
   */
  incrementCounters(
    id: string,
    deltas: { succeeded?: number; failed?: number },
  ): Promise<BulkOfferCreationBatch>;

  /**
   * Update batch lifecycle status. Idempotent at the same status value.
   * No state-machine guard at the port — the application service in #736
   * owns transition validity (per architecture-overview.md §7: orchestration
   * rules live in core application services, not in repositories).
   * Throws BulkOfferCreationBatchNotFoundException if the row is missing.
   */
  updateStatus(id: string, status: BulkBatchStatus): Promise<BulkOfferCreationBatch>;
}
```

**`findByConnection` dropped during grill-me**: the issue's AC named it ("Repository unit-spec covers `create`, `findById`, `updateCounters` (atomic), `findByConnection`"), but there's no caller in scope — the per-batch progress page uses `findById`; the "list all batches for connection" use case (history view, concurrency guard, dashboard) has four plausible shapes (paginated history, predicate-scoped `findActiveByConnection`, aggregate metrics, etc.) and none of them are concretely in #736's plan yet. Per `engineering-standards.md § Repository Ports Pattern` ("Keep it minimal — only methods needed by application services"), better to ship the right-shape method in #736 with a real caller than guess at the shape now and refactor later.

**Naming deviation `incrementCounters` vs the issue's "updateCounters"**: the issue lists "updateCounters (atomic)" in the AC. The implementation name uses `incrementCounters` because the *semantics* the AC demands (atomic, race-safe under concurrent worker callbacks) are increments, not set-to-absolute. PR body will state the rationale (atomic semantics are increments, not absolute sets) so the deviation isn't read as drift from the issue.

---

## 3. ORM shape

### 3.1 New table `bulk_offer_creation_batches`

```ts
@Entity('bulk_offer_creation_batches')
@Index('IDX_bulk_offer_creation_batches_connectionId', ['connectionId'])
@Index('IDX_bulk_offer_creation_batches_status', ['status'])
export class BulkOfferCreationBatchOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  connectionId!: string;

  @Column({ type: 'text' })
  initiatedBy!: string;

  @Column({ type: 'text' })
  status!: BulkBatchStatus;

  @Column({ type: 'integer' })
  totalCount!: number;

  @Column({ type: 'integer', default: 0 })
  succeededCount!: number;

  @Column({ type: 'integer', default: 0 })
  failedCount!: number;

  @Column({ type: 'jsonb' })
  sharedConfig!: Record<string, unknown>;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
```

Indexes mirror the `OfferCreationRecordOrmEntity` precedent (`connectionId` for `findByConnection`; `status` for future dashboard queries).

### 3.2 Modify `offer_creation_records`

Add nullable column:

```ts
@Column({ type: 'uuid', nullable: true })
@Index('IDX_offer_creation_records_bulkBatchId') // for "find all records in batch X" — needed by progress endpoint (#736)
bulkBatchId!: string | null;
```

**Explicit index names** mirror the `OfferCreationRecordOrmEntity` precedent (e.g. `IDX_offer_creation_records_external_offer_connection`). Without explicit names, TypeORM auto-generates index names that won't match the migration-created names — a future `migration:generate` dry-run would produce a phantom diff trying to "rename" the index.

**No foreign key constraint** — matches the codebase precedent (`connectionId` references aren't FK'd either; the application maintains referential integrity). Avoids migration-ordering coupling and supports historical records (`null` for pre-bulk records, which is the migration default).

### 3.3 Migration shape

`apps/api/src/migrations/1797000000000-add-bulk-offer-creation-batches.ts`:

```ts
public async up(queryRunner: QueryRunner): Promise<void> {
  await queryRunner.query(`
    CREATE TABLE "bulk_offer_creation_batches" (
      "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
      "connectionId" uuid NOT NULL,
      "initiatedBy" text NOT NULL,
      "status" text NOT NULL,
      "totalCount" integer NOT NULL,
      "succeededCount" integer NOT NULL DEFAULT 0,
      "failedCount" integer NOT NULL DEFAULT 0,
      "sharedConfig" jsonb NOT NULL,
      "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
      "updatedAt" TIMESTAMP NOT NULL DEFAULT now()
    )
  `);
  await queryRunner.query(`CREATE INDEX "IDX_bulk_offer_creation_batches_connectionId" ON "bulk_offer_creation_batches" ("connectionId")`);
  await queryRunner.query(`CREATE INDEX "IDX_bulk_offer_creation_batches_status" ON "bulk_offer_creation_batches" ("status")`);
  await queryRunner.query(`ALTER TABLE "offer_creation_records" ADD COLUMN "bulkBatchId" uuid`);
  await queryRunner.query(`CREATE INDEX "IDX_offer_creation_records_bulkBatchId" ON "offer_creation_records" ("bulkBatchId")`);
}

public async down(queryRunner: QueryRunner): Promise<void> {
  await queryRunner.query(`DROP INDEX "IDX_offer_creation_records_bulkBatchId"`);
  await queryRunner.query(`ALTER TABLE "offer_creation_records" DROP COLUMN "bulkBatchId"`);
  await queryRunner.query(`DROP INDEX "IDX_bulk_offer_creation_batches_status"`);
  await queryRunner.query(`DROP INDEX "IDX_bulk_offer_creation_batches_connectionId"`);
  await queryRunner.query(`DROP TABLE "bulk_offer_creation_batches"`);
}
```

Timestamp `1797000000000` continues the sequence after `1796000000000-add-refresh-tokens.ts` (most recent migration). Will bump if a colliding migration lands first.

Generated migration is hand-authored (not `migration:generate`) for clarity — the table-create + column-add are small enough that a hand-rolled SQL file is more reviewable than a TypeORM `Table`/`TableColumn` API call sequence.

**Behavioural note**: the `offer_creation_records.bulkBatchId` column is nullable with no default, so the ALTER is a metadata-only operation in PG 11+. No backfill needed; existing rows have `bulkBatchId IS NULL` (single offers).

---

## 4. Atomic counter increment

The acceptance criterion calls for an atomic counter update. The implementation uses TypeORM's `Repository.increment` (single SQL statement: `UPDATE … SET col = col + N WHERE id = $1`) for each delta, executed in a single `manager.transaction` to serialize the two increments when both `succeeded` and `failed` deltas are non-zero (the realistic case is always one or the other, but the transaction guards correctness regardless).

Alternative considered and rejected: a raw `queryBuilder.update()` with both columns in one SET clause. Cleaner SQL, but `Repository.increment` is the idiomatic TypeORM helper and removes the risk of a typo in raw SQL. Both produce equivalent statements.

```ts
async incrementCounters(
  id: string,
  deltas: { succeeded?: number; failed?: number },
): Promise<BulkOfferCreationBatch> {
  if (deltas.succeeded !== undefined && deltas.succeeded !== 0) {
    const r = await this.repository.increment({ id }, 'succeededCount', deltas.succeeded);
    if (r.affected === 0) throw new BulkOfferCreationBatchNotFoundException(id);
  }
  if (deltas.failed !== undefined && deltas.failed !== 0) {
    const r = await this.repository.increment({ id }, 'failedCount', deltas.failed);
    if (r.affected === 0) throw new BulkOfferCreationBatchNotFoundException(id);
  }
  const refreshed = await this.findById(id);
  if (!refreshed) throw new BulkOfferCreationBatchNotFoundException(id); // race: row deleted between increment and read
  return refreshed;
}
```

**No transaction wrapper.** The realistic call shape from the (future) application service in #736 is always one delta per call — `{ succeeded: 1 }` after a successful child job, `{ failed: 1 }` after a failed one. Each `Repository.increment` is a single SQL statement, atomic on its own. Wrapping in a transaction would only matter if both deltas were ever non-zero in one call (a hypothetical "1 succeeded + 1 failed in the same write" case that has no caller). Per `engineering-standards.md` — don't add features beyond what the task requires.

The trailing `findById` returns the post-update entity (TypeORM's `increment` returns `UpdateResult`, not the row). Acceptable because the call site (the application service in #736) needs the new counts to decide whether to call `updateStatus` — so the read is needed regardless.

---

## 5. Wiring

### 5.1 `listings.tokens.ts`

Add one line:

```ts
export const BULK_OFFER_CREATION_BATCH_REPOSITORY_TOKEN = Symbol('BulkOfferCreationBatchRepositoryPort');
```

Auto-exported via the existing `export *` from `listings.tokens` on the listings barrel.

### 5.2 `listings.module.ts`

- `imports`: add `BulkOfferCreationBatchOrmEntity` to the `TypeOrmModule.forFeature` array.
- `providers`: add `BulkOfferCreationBatchRepository` + token binding.
- `exports`: add the token to both the `exports` array and the standalone re-export.

### 5.3 `listings/index.ts` (main barrel)

Add four exports next to the existing `OfferCreationRecord*` group:

```ts
export { BulkOfferCreationBatch } from './domain/entities/bulk-offer-creation-batch.entity';
export {
  BulkBatchStatusValues,
  BULK_BATCH_STATUS,
} from './domain/types/bulk-offer-creation-batch.types';
export type {
  BulkBatchStatus,
  CreateBulkOfferCreationBatchInput,
} from './domain/types/bulk-offer-creation-batch.types';
export type { BulkOfferCreationBatchRepositoryPort } from './domain/ports/bulk-offer-creation-batch-repository.port';
export { BulkOfferCreationBatchNotFoundException } from './domain/exceptions/bulk-offer-creation-batch-not-found.exception';
```

---

## 6. Tests

### 6.1 Repository unit spec (`bulk-offer-creation-batch.repository.spec.ts`)

Mirrors `offer-creation-record.repository.spec.ts` — jest.Mocked TypeORM `Repository`, no Testcontainers. Required cases per AC:

| Method | Cases |
|---|---|
| `create` | Forwards input → ORM entity → domain entity; assigns id/createdAt/updatedAt; defaults status='pending', counters=0. |
| `findById` | Hit → domain entity; miss → null. |
| `incrementCounters` | Forwards succeeded delta only (zero-delta short-circuits); forwards failed delta only; both deltas in same call (sequential, each its own statement); missing id → `BulkOfferCreationBatchNotFoundException`. |
| `updateStatus` | Forwards new status; idempotent at same value; missing id throws. |

Mock surface: `jest.Mocked<Repository<BulkOfferCreationBatchOrmEntity>>` with `findOne`, `save`, `increment`. No transaction wrapper to stub (dropped during grill-me, §4).

### 6.2 Entity smoke spec (`bulk-offer-creation-batch.entity.spec.ts`)

Light spec mirroring `offer-creation-record.entity.spec.ts` — confirms the constructor assigns readonly fields and freezes the object shape. One test, ~10 lines.

### 6.3 Migration round-trip

The acceptance criterion calls for "Migration up + down round-trips cleanly against a Testcontainer Postgres". The integration-test harness (`apps/api/test/integration/setup.ts`) runs `dataSource.runMigrations()` on every harness boot, so any int-spec exercising the harness validates the **up** path.

**Down path**: verified manually against the dev-stack Postgres (`pnpm --filter @openlinker/api migration:revert`, then `migration:run`). No precedent for per-migration int-specs in the repo; the dev-stack round-trip + the harness's up-on-boot covers both directions.

The PR body will explicitly state: "Verified `migration:show` lists the new migration; `migration:run` + `migration:revert` round-trip cleanly against dev Postgres; all existing int-specs pass against the migrated schema."

---

## 7. Implementation steps (ordered, with acceptance criteria)

| # | Step | File(s) | AC |
|---|---|---|---|
| 1 | Create `bulk-offer-creation-batch.types.ts` (Values, type, named map, input type) | `libs/core/src/listings/domain/types/` | as-const pattern matches `OfferCreationStatusValues` shape |
| 2 | Create `bulk-offer-creation-batch.entity.ts` (readonly entity class) | `libs/core/src/listings/domain/entities/` | constructor assigns all fields |
| 3 | Create `bulk-offer-creation-batch-not-found.exception.ts` | `libs/core/src/listings/domain/exceptions/` | extends Error, mirrors `OfferCreationRecordNotFoundException` |
| 4 | Create `bulk-offer-creation-batch-repository.port.ts` (4 methods) | `libs/core/src/listings/domain/ports/` | type-only, no framework deps |
| 5 | Create `bulk-offer-creation-batch.orm-entity.ts` (TypeORM + indexes) | `libs/core/src/listings/infrastructure/persistence/entities/` | columns match §3.1, includes 2 indexes |
| 6 | Add `bulkBatchId` column to `offer-creation-record.orm-entity.ts` | same file | nullable uuid, single-col index |
| 7 | Create `bulk-offer-creation-batch.repository.ts` (4 methods, atomic single-column increments) | `libs/core/src/listings/infrastructure/persistence/repositories/` | impl matches port; not-found throws domain exception |
| 8 | Write `bulk-offer-creation-batch.repository.spec.ts` | same dir | all 4 method paths + not-found cases |
| 9 | Write `bulk-offer-creation-batch.entity.spec.ts` (smoke) | `libs/core/src/listings/domain/entities/` | one test |
| 10 | Add token to `listings.tokens.ts` | `libs/core/src/listings/` | one line |
| 11 | Wire `ListingsModule` (ORM forFeature, provider, token binding, exports) | `libs/core/src/listings/listings.module.ts` | matches `OfferCreationRecord` precedent |
| 12 | Add main-barrel re-exports | `libs/core/src/listings/index.ts` | 5 exports per §5.3 |
| 13 | Write migration `1797000000000-add-bulk-offer-creation-batches.ts` | `apps/api/src/migrations/` | class name `AddBulkOfferCreationBatches1797000000000` (filename prefix = class suffix per `docs/migrations.md § Timestamp uniqueness invariant`); up + down per §3.3 |
| 14 | Verify migration round-trip (run + revert) on dev Postgres | — | passes; capture in PR body |
| 15 | Quality gate: `pnpm lint && pnpm type-check && pnpm test` | — | 0 errors, all green |

---

## 8. Acceptance criteria check (issue #734)

- [x] Migration up + down round-trips cleanly → §6.3 (dev Postgres + harness boot).
- [x] Repository unit-spec covers `create`, `findById`, `incrementCounters` (atomic), `updateStatus` → §6.1. **Deviation**: dropped `findByConnection` (no caller in scope, see §2.4); added `updateStatus` (needed by the future application service to flip terminal status).
- [x] Token exported via `@openlinker/core/listings` top-level barrel → §5.1 (auto via `export *` from `listings.tokens`).
- [x] No `any` types → enforced by lint.
- [x] Tests pass; lint passes; type-check passes → step 15.

**Deviations from #734 to flag in the PR body:**

1. **Status union: 5 values instead of 4** — added `failed` per Q1 of grilling (semantically correct for all-failed batches; one literal beyond the issue text).
2. **Port method names**: `incrementCounters` (vs issue's "updateCounters") — semantic clarity, same atomicity guarantee.
3. **Port surface: 4 methods, not 5** — `findByConnection` dropped (no caller in scope).
4. **5th port method added** — `updateStatus` (not in issue's AC list, but required by the future application service to flip terminal status after the last child job finishes; per `architecture-overview.md § 7` this transition rule lives in the core application service, not the port itself).

---

## 9. Decisions locked during grilling (architectural)

Recorded so the PR review can verify each consciously rather than re-litigate.

| # | Decision | Why |
|---|---|---|
| 1 | **5-value status union** (added `failed`) | Domain-correct; all-failed batches deserve their own terminal value. |
| 2 | **Dumb port + smart core application service** | Per `architecture-overview.md § 7`: orchestration policies in core services, not workers, not ports. Terminal-transition rule lives in `BulkBatchProgressService` in #736. Worker handler (#737) is a thin shell — same pattern as `marketplace-offer-create.handler.ts` cites in its own header. |
| 3 | **`incrementCounters({ succeeded?, failed? })` — data-shaped deltas** | Matches `OfferCreationRecordRepositoryPort` precedent (data-shaped methods, not event-shaped). Event vocabulary lives in the application service layer above. |
| 4 | **Permissive deltas (negative allowed)** | Future admin compensation flows. Port's data-shaped contract doesn't enforce a constraint the underlying primitive doesn't need. |
| 5 | **Anemic entity (no behavior)** | Codebase precedent uniform; local drift to rich entities would be incoherent. Long-term direction tracked in [#750](https://github.com/openlinker-project/openlinker/issues/750). |
| 6 | **No `findByConnection`** | No caller in scope. Will be designed in #736 with a real caller. |
| 7 | **`sharedConfig: Record<string, unknown>` at entity/port/ORM** | Matches `Connection.config` / `IntegrationCredential.credentialsJson` precedent. Shape belongs at application layer (#736). |
| 8 | **`initiatedBy: string` non-nullable** | Bulk is always operator-initiated per US-1. No system-triggered path exists. |
| 9 | **Single `bulkBatchId uuid NULL` column** (1:N), ship in this slice | Matches issue scope. Forward-compat for #736 to write without a separate schema PR. |
| 10 | **No `CHECK` constraints** | No codebase precedent for cross-field `CHECK`; service-layer validation is the documented pattern. Aligns with Q4 (permissive deltas — `CHECK` would block compensation flows). |
| 11 | **`CreateBulkOfferCreationBatchInput` doesn't accept `status`** | Bulk has one legitimate initial state (`pending`). Defaulting at repository captures the invariant in the type. |

## 9.5 Residual risks

- **Migration timestamp collision risk**: timestamps in the repo are `1790…` – `1796…`. `1797000000000` is the next free slot. If a colliding migration lands first, bump to `1798…` and update the class name to match (`AddBulkOfferCreationBatches1798…`). The `check-migration-timestamps.mjs` lint invariant catches collisions immediately.
- **No bulk → record FK enforced at schema** — `offer_creation_records.bulkBatchId` is a plain nullable uuid, no FK. Application code maintains referential integrity (the bulk-submission service in #736 sets the column when fan-out fires). Matches codebase precedent (`connectionId` is the same pattern). If broken integrity ever surfaces, adding a deferred FK is a one-line follow-up migration.

---

## 10. After this PR

- #735 (EAN auto-match service) — independent, can land in parallel.
- #736 (bulk submission service + HTTP API) — depends on this issue's entity + repository.
- #737 (worker handler) — depends on #736.
- #739–#741 (FE) — depends on #736 (HTTP API exists).

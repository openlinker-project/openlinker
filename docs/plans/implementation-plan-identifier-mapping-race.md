# Implementation Plan — Fix concurrency race in `IdentifierMappingService`

**Issue:** #656 — [BUG] Concurrency race in `IdentifierMappingService.getOrCreateInternalId`
**Branch:** `656-identifier-mapping-race`
**Layer:** CORE / Application service (`libs/core/src/identifier-mapping/`)
**Owner:** Piotr Swierzy

---

## 1. Goal

Eliminate the read-before-write race window in `IdentifierMappingService` by switching all get-or-create paths to a pure **insert-then-recover** pattern, per `docs/engineering-standards.md` § _Error handling in concurrent operations_. Remove the long-standing TODO at `identifier-mapping.service.ts:316`.

### Non-goals

- No port/interface signature changes.
- No new public methods.
- No persistence/schema changes (existing unique index `(entityType, platformType, connectionId, externalId)` is already sufficient and confirmed present on `IdentifierMappingOrmEntity`).
- No batch-size chunking changes for `batchGetOrCreateInternalIds` (the existing concurrency note remains correct; fixing the helper is enough).

---

## 2. Where the race actually is

Three call sites currently mix check-then-insert:

| Method | Read-before-write? | Recovery on race? | Notes |
|---|---|---|---|
| `getOrCreateInternalIdWithPlatform` (private helper, used by `getOrCreateInternalId` + batch) | Yes (fast-path `findByExternalKey`) | Yes (catches `DuplicateIdentifierMappingError`) | Race already *closed* by recovery, but the upfront read still violates the "no read-before-write race window" acceptance criterion. |
| `createMapping` (public) | Yes | **No** — `repository.create()` does plain `.save()` and surfaces raw `QueryFailedError` | Real race; concurrent callers see infrastructure error leak. |
| `getOrCreateExactMapping` (public) | Yes (twice — once directly, then again inside `createMapping`) | **No** — same as `createMapping` | Real race; carries the TODO at line 316 explicitly acknowledging the bug. |

`batchGetOrCreateInternalIds` delegates to the helper, so it inherits whatever the helper does. No separate fix needed.

`repository.insertMapping` already translates PG `23505` → `DuplicateIdentifierMappingError` (confirmed at `identifier-mapping.repository.ts:92-113`). `repository.create` does **not**.

---

## 3. Design — pure insert-then-recover

Apply the canonical pattern from `docs/engineering-standards.md`:

```ts
try {
  await this.repository.insertMapping(mapping);   // unconditional insert
  return internalId;
} catch (error) {
  if (error instanceof DuplicateIdentifierMappingError) {
    const winner = await this.repository.findByExternalKey(...);
    if (winner) return winner.internalId;
  }
  throw error;   // re-throw if not a duplicate, or if winner vanished
}
```

Apply with method-specific tweaks:

- **`getOrCreateInternalIdWithPlatform`**: drop the upfront `findByExternalKey`. Always generate an internalId, always try `insertMapping`, recover on duplicate. Same external contract: returns the winning `internalId`.
- **`createMapping`** (public — keeps "explicit create, fail if duplicate" semantics): drop the upfront `findByExternalKey`. Always try `insertMapping`. On duplicate → SELECT winner → throw `MappingAlreadyExistsError(... winner.internalId)`. This preserves the existing public contract: callers still see `MappingAlreadyExistsError`, not a raw infrastructure error.
- **`getOrCreateExactMapping`** (public — explicit-mapping with "existing-equal is OK" semantics): drop both upfront reads. Always try `insertMapping` with the *provided* internalId. On duplicate → SELECT winner → if `winner.internalId === requestedInternalId` return success, else throw `IdentifierMappingConflictException`. Remove the TODO.

The pattern is consistent everywhere: insert → catch `DuplicateIdentifierMappingError` → SELECT winner → translate the winner into whatever the public method's contract demands.

### Cost note (deliberate trade-off)

Removing the fast-path read is a **deliberate performance regression on the dominant workload** (sync jobs re-hitting known external IDs). Two readings of the issue's acceptance criterion ("no read-before-write race window") are defensible:

- **Strict reading** — eliminate the read-before-write code path entirely. This plan follows this reading.
- **Lenient reading** — close the *race* in the read-before-write path. The existing catch on `DuplicateIdentifierMappingError` already does this.

The strict reading wins here because (a) the engineering-standards.md sample is pure insert-then-recover with no upfront read, (b) following the documented pattern verbatim means the next reader of this code can't conclude "the fast-path is fine to add back" without first revisiting the standard, and (c) the cost is small: an insert against a unique index that already has the row is a single PG `23505` failure — no WAL extension, returns immediately.

The PR description must call this out explicitly so future "perf optimization" PRs don't silently reintroduce the fast-path and undo the work. Adapters that legitimately need raw-read performance should call `getInternalId` directly — that path is unchanged and remains a pure read.

---

## 4. Step-by-step implementation

### Step 4.1 — Refactor `getOrCreateInternalIdWithPlatform`

**File:** `libs/core/src/identifier-mapping/application/services/identifier-mapping.service.ts`

Replace the body of `getOrCreateInternalIdWithPlatform` with pure insert-then-recover:

```ts
private async getOrCreateInternalIdWithPlatform(
  entityType: string,
  externalId: string,
  connectionId: string,
  platformType: string,
  context?: MappingContext,
): Promise<string> {
  const internalId = this.generateInternalId(entityType);
  const mapping = new IdentifierMapping(
    randomUUID(),
    entityType,
    internalId,
    externalId,
    platformType,
    connectionId,
    context ?? null,
    new Date(),
    new Date(),
  );

  try {
    await this.repository.insertMapping(mapping);
    this.logger.log(
      `Created new mapping for ${entityType}:${externalId}@${connectionId} -> ${internalId}`,
    );
    return internalId;
  } catch (error) {
    if (error instanceof DuplicateIdentifierMappingError) {
      const winner = await this.repository.findByExternalKey(
        entityType, platformType, connectionId, externalId,
      );
      if (winner) {
        this.logger.debug(
          `Mapping already exists for ${entityType}:${externalId}@${connectionId} -> ${winner.internalId}`,
        );
        return winner.internalId;
      }
    }
    throw error;
  }
}
```

**Acceptance:**
- No upfront `findByExternalKey` call in this helper.
- JSDoc updated: the "handles `DuplicateIdentifierMappingError` (concurrent insert)" parenthetical is widened to "handles duplicate mappings — pre-existing or from concurrent insert", since the duplicate path now covers both cases.
- Existing JSDoc note about `InternalIdCollisionError` is retained.

### Step 4.2 — Refactor `createMapping` (public)

Same file.

```ts
async createMapping(
  entityType: string,
  externalId: string,
  connectionId: string,
  internalId: string,
  context?: MappingContext,
): Promise<void> {
  const connection = await this.connectionPort.get(connectionId);
  const platformType = connection.platformType;

  const mapping = new IdentifierMapping(
    randomUUID(),
    entityType,
    internalId,
    externalId,
    platformType,
    connectionId,
    context ?? null,
    new Date(),
    new Date(),
  );

  try {
    await this.repository.insertMapping(mapping);
  } catch (error) {
    if (error instanceof DuplicateIdentifierMappingError) {
      const winner = await this.repository.findByExternalKey(
        entityType, platformType, connectionId, externalId,
      );
      if (winner) {
        throw new MappingAlreadyExistsError(
          entityType, externalId, connectionId, winner.internalId,
        );
      }
    }
    throw error;
  }
}
```

**Acceptance:**
- Public contract preserved for the common case: `MappingAlreadyExistsError` still thrown when a duplicate exists (whether pre-existing or from concurrent insert).
- Switches from `repository.create()` to `repository.insertMapping()` (the duplicate-translating variant).
- **Documented contract drift in the corner case**: if `insertMapping` throws `DuplicateIdentifierMappingError` AND the follow-up `findByExternalKey` returns `null` (concurrent insert + concurrent delete window — microsecond-wide), the method re-throws the underlying `DuplicateIdentifierMappingError` instead of synthesizing a fake `MappingAlreadyExistsError`. The JSDoc on `createMapping` documents this: `@throws MappingAlreadyExistsError` in the normal duplicate case, `@throws DuplicateIdentifierMappingError` if the winner row has been deleted between the insert failure and the SELECT.

### Step 4.3 — Refactor `getOrCreateExactMapping` and remove the TODO

Same file. Inline the logic rather than calling the now-changed `createMapping` (since this method has different "existing-equal is OK" semantics):

```ts
async getOrCreateExactMapping(
  entityType: string,
  externalId: string,
  internalId: string,
  connectionId: string,
  context?: MappingContext,
): Promise<string> {
  const connection = await this.connectionPort.get(connectionId);
  const platformType = connection.platformType;

  const mapping = new IdentifierMapping(
    randomUUID(),
    entityType,
    internalId,
    externalId,
    platformType,
    connectionId,
    context ?? null,
    new Date(),
    new Date(),
  );

  try {
    await this.repository.insertMapping(mapping);
    this.logger.debug(
      `Created mapping: ${entityType}:${externalId}@${connectionId} -> ${internalId}`,
    );
    return externalId;
  } catch (error) {
    if (error instanceof DuplicateIdentifierMappingError) {
      const winner = await this.repository.findByExternalKey(
        entityType, platformType, connectionId, externalId,
      );
      if (winner) {
        if (winner.internalId === internalId) {
          this.logger.debug(
            `Mapping already exists: ${entityType}:${externalId}@${connectionId} -> ${internalId}`,
          );
          return externalId;
        }
        throw new IdentifierMappingConflictException(
          entityType, externalId, connectionId, winner.internalId, internalId,
        );
      }
    }
    throw error;
  }
}
```

**Acceptance:**
- TODO comment at the old line 316 is gone.
- Same public behaviour: perfect-match no-op returns `externalId`; mismatch throws `IdentifierMappingConflictException`.

### Step 4.4 — Update existing unit tests

**File:** `libs/core/src/identifier-mapping/application/services/identifier-mapping.service.spec.ts`

Two existing tests assume the old fast-path read:

1. `'should return existing internal ID if mapping exists'` (around line 78). Rewrite expectations: `insertMapping` IS called, throws `DuplicateIdentifierMappingError`, then `findByExternalKey` returns the existing mapping. Assert returned internalId equals the existing one.
2. `'should create mapping when it does not exist'` under `describe('createMapping')` (around line 356). Switch the mocked successful path from `repository.create` to `repository.insertMapping`. Likewise update `'should throw error if mapping already exists'` to drive the path via `insertMapping.mockRejectedValue(duplicateError)` + `findByExternalKey.mockResolvedValue(existing)`.

The "concurrent insert detected" tests and "should re-throw … when winner cannot be found" tests carry over unchanged.

### Step 4.5 — Add a `Promise.all` concurrency unit test

Same spec file. Drive N parallel `getOrCreateInternalId` calls; mock `insertMapping` so the first call resolves and the rest reject with `DuplicateIdentifierMappingError`; mock `findByExternalKey` to return the winning mapping. Assert all N callers return the same internalId and `insertMapping` was called N times (one success + N-1 duplicates).

```ts
it('should converge on a single internalId when N concurrent callers race', async () => {
  const N = 10;
  let savedMapping: IdentifierMapping | null = null;

  repository.insertMapping.mockImplementation(async (mapping) => {
    if (!savedMapping) {
      savedMapping = mapping;
      return mapping;
    }
    throw new DuplicateIdentifierMappingError(
      mapping.entityType, mapping.externalId, mapping.platformType, mapping.connectionId,
    );
  });
  repository.findByExternalKey.mockImplementation(async () => savedMapping);

  const results = await Promise.all(
    Array.from({ length: N }, () =>
      service.getOrCreateInternalId('Product', 'external-race', connectionId),
    ),
  );

  expect(new Set(results).size).toBe(1);                  // all converged
  expect(results[0]).toMatch(/^ol_product_[a-f0-9]{32}$/);
  expect(repository.insertMapping).toHaveBeenCalledTimes(N);
});
```

### Step 4.6 — Add a real-DB concurrency integration test

**New file:** `apps/api/test/integration/identifier-mapping/identifier-mapping-concurrency.int-spec.ts`

The unit test in Step 4.5 only proves the recovery logic *given* `DuplicateIdentifierMappingError`. It cannot catch a regression where the repository stops translating PG `23505` correctly (e.g., TypeORM version bump changes the `QueryFailedError` shape). The translation seam at `identifier-mapping.repository.ts:92-113` is currently un-tested.

Add a Testcontainers-backed int-spec that:

1. Uses `getTestHarness()` to spin up real Postgres + run migrations.
2. Inserts a real `Connection` row (so the connection-port resolution path is real, not mocked).
3. Drives N concurrent `service.getOrCreateInternalId(...)` calls with the same `(entityType, externalId, connectionId)` via `Promise.all`.
4. Asserts: exactly one `identifier_mappings` row persists, and every caller resolves to the same `internalId`.
5. `resetTestHarness()` between cases so the table is clean per test.

This belongs alongside any future identifier-mapping int-specs; if no folder exists yet, create `apps/api/test/integration/identifier-mapping/` — the testing-guide.md pattern allows per-context folders.

### Step 4.7 — Quality gate

```bash
pnpm lint
pnpm type-check
pnpm test
```

All must pass with zero errors. No migration step needed (no schema change).

---

## 5. Validation

### 5.1 Architecture

- ✅ Domain layer untouched (no framework imports added).
- ✅ Application service still depends only on ports (`IdentifierMappingRepositoryPort`, `ConnectionPort`).
- ✅ Public method signatures unchanged → no caller updates needed across the repo.
- ✅ Repository contract unchanged.

### 5.2 Naming / conventions

- ✅ No new files, no renames.
- ✅ No new types or constants.

### 5.3 Testing strategy

- **Unit spec** (Step 4.5) covers the application-layer recovery logic given a stubbed `DuplicateIdentifierMappingError`.
- **Integration spec** (Step 4.6) covers the repository's PG `23505` → `DuplicateIdentifierMappingError` translation seam against a real Postgres unique index, plus the end-to-end concurrent-insert convergence. This catches regressions the unit spec is blind to (TypeORM error-shape drift, unique-index name drift, migration-state mismatch).
- Both are needed because they cover different layers of the same guarantee — the unit spec gives fast feedback, the int-spec is the regression backstop at the seam that matters.

### 5.4 Security / performance

- No security impact.
- Performance trade-off (extra insert attempt per repeat lookup) acknowledged above; acceptable for correctness.

### 5.5 Open questions

None known. The repository port already exposes everything needed (`insertMapping` + `findByExternalKey`).

---

## 6. Acceptance checklist (from issue #656 + scope additions)

- [ ] `getOrCreateInternalId` follows the insert-then-recover pattern; no read-before-write race window.
- [ ] Concurrency test (unit): spawn N parallel calls with the same `(entityType, externalId, connectionId)` — exactly one mapping persists, all callers return the same `internalId`. Added as a unit spec with `Promise.all`.
- [ ] Concurrency test (integration): same shape against a real Postgres + Connection row, also covering the repository's `23505` → `DuplicateIdentifierMappingError` translation seam.
- [ ] TODO at line 316 removed.
- [ ] `batchGetOrCreateInternalIds` reviewed for the same pattern; fix flows through the shared helper (no separate change needed).
- [ ] **Scope addition**: `createMapping` switched from `repository.create()` to `repository.insertMapping()`. Public exception contract documented in JSDoc: `MappingAlreadyExistsError` in the normal duplicate case, `DuplicateIdentifierMappingError` in the rare insert-fails-then-winner-deleted window.
- [ ] **Scope addition**: `getOrCreateExactMapping` rewritten to the same pattern; behaviour preserved for both perfect-match (no-op) and mismatch (`IdentifierMappingConflictException`) branches.
- [ ] Helper JSDoc on `getOrCreateInternalIdWithPlatform` updated: "concurrent insert" → "duplicate mappings — pre-existing or from concurrent insert".
- [ ] PR description explicitly calls out the fast-path-read removal as a deliberate trade-off (not just literal spec compliance) so future "perf optimization" PRs don't silently reintroduce it.
- [ ] `pnpm lint && pnpm type-check && pnpm test` pass; `pnpm test:integration` passes the new concurrency spec.

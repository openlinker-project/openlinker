# Implementation Plan: Fix Identifier Mapping Concurrency

**Date**: 2026-04-06  
**Status**: Ready for Review  
**Estimated Effort**: 1–2 hours  
**Issue**: [#97](https://github.com/SilkSoftwareHouse/openlinker/issues/97)

---

## 1. Task Summary

**Objective**: Fix `getOrCreateInternalId()` in `IdentifierMappingService` so that concurrent inserts of the same external key are handled gracefully — returning the existing mapping instead of surfacing an unhandled `DuplicateIdentifierMappingError`.

**Context**: Under concurrent sync jobs, two workers can race to insert the same `(entityType, platformType, connectionId, externalId)` key. The database unique constraint fires on the second insert, raising a `DuplicateIdentifierMappingError` from the repository. The current catch block logs the error but then **re-throws**, turning a normal concurrency event into an unhandled exception.

The correct pattern (read-then-return on duplicate) already exists in the private helper `getOrCreateInternalIdWithPlatform()` (used by `batchGetOrCreateInternalIds()`). This fix makes `getOrCreateInternalId()` consistent with it.

**Classification**: CORE / Infrastructure — `libs/core/src/identifier-mapping/`

---

## 2. Scope & Non-Goals

### In Scope
- Fix `getOrCreateInternalId()` catch block to handle `DuplicateIdentifierMappingError` with a read-then-return retry
- Remove the verbose multi-line error logging that fires for all error types (replace with appropriate log levels)
- Update the existing spec test titled "should throw DuplicateIdentifierMappingError on unique violation (concurrency not handled yet)" to reflect the corrected behaviour
- Add a new spec test that asserts the concurrency happy-path: duplicate insert → read winner → return `internalId`

### Out of Scope
- Changes to `getOrCreateInternalIdWithPlatform()` — it already has the correct pattern and is the reference implementation
- Changes to `batchGetOrCreateInternalIds()` — calls the already-correct helper
- Changes to the repository layer, ORM entities, or DB schema
- Integration tests (unit tests are sufficient for this logic; the database constraint path is covered by mocking `DuplicateIdentifierMappingError`)

### Constraints
- No new files required
- No migrations required
- Changes must remain backward-compatible (public API contract unchanged)
- Must pass `pnpm lint`, `pnpm type-check`, `pnpm test`

---

## 3. Architecture Mapping

**Target Layer**: CORE — Application Services  
`libs/core/src/identifier-mapping/application/services/`

**Capabilities Involved**: `IdentifierMappingPort` (already exists — no port changes needed)

**Existing Services Reused**:
- `IdentifierMappingRepositoryPort.findByExternalKey()` — used for the post-duplicate read
- `IdentifierMappingRepositoryPort.insertMapping()` — already throws `DuplicateIdentifierMappingError` on unique violation (correct)
- `getOrCreateInternalIdWithPlatform()` (private helper) — reference implementation for the correct pattern

**New Components Required**: None

**Core vs Integration Justification**: This is a bug fix inside the CORE application service. It does not touch Integration boundaries.

**Reference**: [Architecture Overview — Hexagonal Architecture Structure](../architecture-overview.md#hexagonal-architecture-structure)

---

## 4. External / Domain Research

### Internal Patterns

**Reference implementation** — `getOrCreateInternalIdWithPlatform()` (lines 295–358 of `identifier-mapping.service.ts`):

```typescript
try {
  await this.repository.insertMapping(mapping);
  // ... log success
  return internalId;
} catch (error) {
  if (error instanceof DuplicateIdentifierMappingError) {
    const winner = await this.repository.findByExternalKey(
      entityType, platformType, connectionId, externalId,
    );
    if (winner) {
      this.logger.debug(`Concurrent insert detected, returning existing mapping ...`);
      return winner.internalId;
    }
  }
  throw error; // Re-throw if not a duplicate or winner not found
}
```

This is the pattern to replicate in `getOrCreateInternalId()`.

**Existing bug in `getOrCreateInternalId()`** (lines 92–116):
- Lines 93–105: logs error type, message, and stack at `error` level for **all** error types — including the internal ID collision path that is already handled gracefully below. This should be removed; each specific branch should log at the appropriate level.
- Lines 107–116: catches `DuplicateIdentifierMappingError` and re-throws it — the bug.
- Lines 118–158: handles internal ID collision (existing correct behaviour — retain as-is).

---

## 5. Questions & Assumptions

### Open Questions
- None. The correct fix is unambiguous from the reference implementation and issue description.

### Assumptions
1. `findByExternalKey()` after a `DuplicateIdentifierMappingError` will always return a row (the concurrent winner). In the near-impossible edge case where it returns `null` (record deleted immediately after insert by another process), we re-throw the original error — same as the reference implementation.
2. The internal ID collision path (lines 118–158) is independent and correct; it stays unchanged.
3. The log level for a normal concurrency event should be `debug`, not `error`.

### Documentation Gaps
- None identified.

---

## 6. Proposed Implementation Plan

### Phase 1 — Fix the Service

**Goal**: Replace the re-throw on `DuplicateIdentifierMappingError` with the read-then-return retry pattern.

#### Step 1 — Fix `getOrCreateInternalId()` catch block

**File**: `libs/core/src/identifier-mapping/application/services/identifier-mapping.service.ts`

**Action**:

Replace the entire catch block (lines 92–162) with a cleaner version:

```typescript
} catch (error) {
  // Concurrent insert: another worker created the same mapping first.
  // Read the winner and return its internalId (idempotent result).
  if (error instanceof DuplicateIdentifierMappingError) {
    const winner = await this.repository.findByExternalKey(
      entityType,
      platformType,
      connectionId,
      externalId,
    );
    if (winner) {
      this.logger.debug(
        `Concurrent insert detected for ${entityType}:${externalId}@${connectionId}, returning existing mapping -> ${winner.internalId}`,
      );
      return winner.internalId;
    }
    // Winner not found — should not happen; re-throw original error
    throw error;
  }

  // Internal ID collision (very rare): generated internalId already exists
  // for a different externalId. Retry once with a new ID.
  if (
    error instanceof QueryFailedError &&
    (error.message.includes('IDX_84b761294149aed081cfba5c95') ||
      (error.message.includes('duplicate key value') &&
        error.message.includes('internalId')))
  ) {
    this.logger.warn(
      `Internal ID collision for ${entityType}:${externalId}@${connectionId} (internalId: ${internalId}), retrying with new ID...`,
    );
    internalId = this.generateInternalId(entityType);
    const retryMapping = new IdentifierMapping(
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
    await this.repository.insertMapping(retryMapping);
    this.logger.log(
      `Created mapping after ID collision retry for ${entityType}:${externalId}@${connectionId} -> ${internalId}`,
    );
    return internalId;
  }

  throw error;
}
```

**Key changes from current code**:
- Remove the 13-line verbose error logging block (lines 93–105) — each branch now logs at the appropriate level only
- Replace the re-throw on `DuplicateIdentifierMappingError` with the read-then-return pattern
- Simplify the internal ID collision retry path: it no longer needs its own try/catch because any error from the retry will propagate naturally
- No changes to the happy path (lines 86–91) or the `generateInternalId` call

**Acceptance**: Service no longer throws `DuplicateIdentifierMappingError` on concurrent inserts.

---

### Phase 2 — Update and Extend Tests

**Goal**: Tests accurately reflect the corrected behaviour.

#### Step 2 — Update the existing "concurrency not handled" test

**File**: `libs/core/src/identifier-mapping/application/services/identifier-mapping.service.spec.ts`

**Action**: Replace the test at line 132 (`'should throw DuplicateIdentifierMappingError on unique violation (concurrency not handled yet)'`) with the correct expectation:

```typescript
it('should return existing internalId when concurrent insert is detected', async () => {
  const existingMapping = new IdentifierMapping(
    'id-winner',
    'Product',
    'ol_product_winner',
    'external-123',
    platformType,
    connectionId,
    null,
    new Date(),
    new Date(),
  );

  // First findByExternalKey call returns null (no mapping yet → triggers insert)
  // Second call (after duplicate error) returns the winner row
  repository.findByExternalKey
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce(existingMapping);

  const duplicateError = new DuplicateIdentifierMappingError(
    'Product',
    'external-123',
    platformType,
    connectionId,
  );
  repository.insertMapping.mockRejectedValue(duplicateError);

  const result = await service.getOrCreateInternalId('Product', 'external-123', connectionId);

  expect(result).toBe('ol_product_winner');
  expect(repository.insertMapping).toHaveBeenCalledTimes(1);
  expect(repository.findByExternalKey).toHaveBeenCalledTimes(2);
});
```

#### Step 3 — Add edge case: winner not found after duplicate

**File**: same spec file

**Action**: Add a test asserting that if `findByExternalKey` returns `null` after a `DuplicateIdentifierMappingError` (edge case), the original error is re-thrown:

```typescript
it('should re-throw DuplicateIdentifierMappingError when winner cannot be found after concurrent insert', async () => {
  repository.findByExternalKey.mockResolvedValue(null); // Both calls return null

  const duplicateError = new DuplicateIdentifierMappingError(
    'Product',
    'external-123',
    platformType,
    connectionId,
  );
  repository.insertMapping.mockRejectedValue(duplicateError);

  await expect(
    service.getOrCreateInternalId('Product', 'external-123', connectionId),
  ).rejects.toThrow(DuplicateIdentifierMappingError);

  expect(repository.findByExternalKey).toHaveBeenCalledTimes(2);
});
```

**Acceptance**: Both tests pass; the updated test title no longer carries the "(concurrency not handled yet)" qualifier.

---

### Phase 3 — Quality Gate

**Goal**: All checks pass before commit.

#### Step 4 — Run quality gate

```bash
pnpm lint        # zero errors
pnpm type-check  # zero errors
pnpm test        # all unit tests pass (including the 2 updated/new tests)
```

**Acceptance**: Clean output on all three commands.

---

## 7. Alternatives Considered

### Alternative 1: Extract concurrency retry into a shared private method
**Description**: Create a private `getOrCreateWithConcurrencyRetry(entityType, externalId, connectionId, platformType, context)` that both `getOrCreateInternalId()` and `getOrCreateInternalIdWithPlatform()` call.

**Why Rejected**: The duplication between the two methods is minor (a 10-line catch block). Extracting it now would create an abstraction for two call sites that already converge correctly. The rule of three doesn't apply here — this fix produces two nearly-identical sites but keeps the code easy to read and avoids over-engineering.

**Trade-offs**: Slight duplication; slightly less DRY. Acceptable at MVP scale.

### Alternative 2: Merge `getOrCreateInternalIdWithPlatform()` into `getOrCreateInternalId()`
**Description**: After fixing `getOrCreateInternalId()`, eliminate the private helper and have `batchGetOrCreateInternalIds()` call `getOrCreateInternalId()` directly (accepting the extra connection lookup per request).

**Why Rejected**: `batchGetOrCreateInternalIds()` batches connection lookups to avoid N connection reads for N requests. Removing the helper would re-introduce those extra round-trips. Optimisation is correct and should be preserved.

---

## 8. Validation & Risks

### Architecture Compliance
- ✅ Change stays within the application service layer — no layer boundary crossed
- ✅ No direct infrastructure imports added to the service
- ✅ Domain error (`DuplicateIdentifierMappingError`) used throughout — no `QueryFailedError` leaks into the concurrency path

### Naming Conventions
- ✅ No new files or classes — existing naming unchanged

### Existing Patterns
- ✅ Pattern is directly copied from `getOrCreateInternalIdWithPlatform()` — fully consistent

### Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| `findByExternalKey` returns `null` after duplicate error | Very low (requires a delete between insert failure and read) | Re-throw original error — safe fallback |
| Internal ID collision retry path broken by refactor | Low | Kept structurally identical; covered by existing test for internal ID collision scenario |
| Removing verbose error logging hides bugs | Low | Each specific error path now logs at the correct level (`debug` for concurrency, `warn` for ID collision); non-retriable errors propagate to the caller |

### Edge Cases

- **Winner not found**: Handled — re-throws `DuplicateIdentifierMappingError` (see Step 3 test)
- **Internal ID collision during retry**: Propagates naturally; caller sees the error
- **Non-duplicate, non-collision errors**: Fall through to `throw error` unchanged

### Backward Compatibility
- ✅ `getOrCreateInternalId()` public signature unchanged
- ✅ Previously, callers that caught `DuplicateIdentifierMappingError` from this method would now receive a successful result instead — this is **the intended fix**, not a breaking change. No known caller handles this error.

---

## 9. Testing Strategy & Acceptance Criteria

### Unit Tests

**File**: `libs/core/src/identifier-mapping/application/services/identifier-mapping.service.spec.ts`

| Test | Scenario | Expected Result |
|---|---|---|
| (updated) concurrent insert detected | `insertMapping` throws `DuplicateIdentifierMappingError`, second `findByExternalKey` returns winner | Returns `winner.internalId` |
| (new) winner not found after duplicate | `insertMapping` throws `DuplicateIdentifierMappingError`, both `findByExternalKey` calls return `null` | Re-throws `DuplicateIdentifierMappingError` |
| (existing) returns existing ID | `findByExternalKey` returns existing mapping | Returns existing `internalId`, no insert |
| (existing) creates new mapping | `findByExternalKey` returns null, insert succeeds | Returns new `internalId` |
| (existing) resolves platformType from Connection | — | `findByExternalKey` called with resolved `platformType` |

### Integration Tests
Not required. The concurrent insert scenario is a race condition between two in-process calls that share a database. The behaviour is fully deterministic when the repository is mocked to throw `DuplicateIdentifierMappingError`. An integration test would need two concurrent transactions and adds complexity without new signal.

### Mocking Strategy
- `IdentifierMappingRepositoryPort` — mocked (Jest)
- `ConnectionPort` — mocked (Jest)

### Acceptance Criteria (from issue #97)
- [ ] Concurrent inserts of the same external key do not throw unhandled exceptions
- [ ] The operation returns the existing mapping (`internalId`) when a race is lost
- [ ] Unit tests cover the concurrent insert scenario (happy path + edge case)
- [ ] `pnpm lint` passes with zero errors
- [ ] `pnpm type-check` passes with zero errors
- [ ] `pnpm test` passes with all tests green

---

## 10. Alignment Checklist

- [x] Follows hexagonal architecture — change contained within application service
- [x] Respects CORE vs Integration boundaries — no boundary crossed
- [x] Uses existing patterns — mirrors `getOrCreateInternalIdWithPlatform()` exactly
- [x] Idempotency considered — operation now returns consistent result under concurrency
- [x] Event-driven patterns used where applicable — N/A (no events in this path)
- [x] Rate limits & retries addressed — N/A (internal DB operation)
- [x] Error handling comprehensive — duplicate → read-then-return; winner-not-found → re-throw; other errors → re-throw
- [x] Testing strategy complete — updated + new unit tests cover all branches
- [x] Naming conventions followed — no new names introduced
- [x] File structure matches standards — no new files
- [x] Plan is execution-ready
- [x] Plan is saved as markdown file

---

## Related Documentation

- [Architecture Overview](../architecture-overview.md)
- [Engineering Standards](../engineering-standards.md)
- [Testing Guide](../testing-guide.md)
- [Code Review Guide](../code-review-guide.md)

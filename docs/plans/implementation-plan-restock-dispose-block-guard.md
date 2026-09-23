# Implementation Plan — Restock Dispose Block Guard (#3466)

## 1. Understand the task

**Goal**: stop an operator from submitting a second (third, ...) `Dispose` on a
return line while a previous restock attempt on that same line is still an
unresolved `blocked`/`in_doubt` `return_line_events` row. Today nothing gates
this — `outstandingToDispose` deliberately never decreases after a blocked
attempt (the counter stays honest about what the master actually confirmed),
and `canDispose` on the frontend reads only that number — so every resubmit
creates a fresh act under a fresh idempotency-key `seq`, and the restock-blocked
banner (which sums `quantity` across every outstanding block for the line)
grows without bound.

**Layer**: CORE (Application) for the write guard + a new domain exception;
Interface for the HTTP status mapping; Frontend for the form-gating half.

**Non-goals** (explicitly out of scope, per the issue and prior discussion):
- No edit or cancellation of a recorded disposition — the ledger stays
  append-only (ADR-060). The only way out of a block remains
  `markStockHandledManually`.
- No change to `scrap` dispositions — they never touch a master and can never
  produce a block, so they are unaffected by this guard.
- No change to per-quantity tracking — the guard is per LINE (all-or-nothing),
  because the counters have no sub-line-quantity concept of "already attempted."

## 2. Research the codebase

- `libs/core/src/returns/application/services/return-custody.service.ts:181`
  — `disposeLine`: branches on `scrap` (no lock, no master) vs `restock`
  (asserts attribution, acquires the per-line `SyncLockPort` lock via
  `returnCustodyLockKey`, calls `disposeRestock`, releases the lock).
- `findOutstandingRestockEvents(lineId): Promise<ReturnLineEvent[]>` already
  exists on `ReturnRepositoryPort` (`return-repository.port.ts:522`) and is
  already used by `markStockHandledManually` — this is the exact read the new
  guard needs, no new repository method required.
- Sibling domain exceptions to follow as the template:
  `return-custody-contended.error.ts` (no `reason` field, simple message) and
  `return-restock-attestation-invalid.error.ts` (same shape, different
  condition). The new error follows this shape, but adds a `reason` constant
  so it renders through the *existing* generic frontend reason-mapping path
  (see below) rather than needing new frontend error-parsing code.
- `apps/api/src/common/filters/returns-exception.filter.ts` — the single place
  that maps every `returns` domain refusal to an HTTP status + JSON body
  (`{statusCode, error, message, reason?}`). New error joins the `CONFLICT`
  (409) group alongside `ReturnCustodyContendedError` /
  `ReturnRestockAttestationInvalidError`, and is added to `resolveReason`'s
  instanceof list so its `reason` field reaches the wire.
- `libs/core/src/returns/index.ts` — barrel export, one line per exception.
- Frontend: `apps/web/src/features/returns/components/return-custody-panel.tsx`
  — `linesWithCustodyNotices` (~line 106-123) already computes, per line, the
  filtered `blocks` array from `detail.restockBlocks`. `canDispose` (~line 249)
  currently reads only `outstandingToDispose(line) > 0`. The per-line `blocks`
  value needs to be computed once (it already is, just scoped to the notices
  list) and threaded into the `canDispose` calculation for the SAME line.
- `apps/web/src/features/returns/lib/custody-error.ts` +
  `return-custody.copy.ts` — the existing generic 409-reason-to-sentence
  mapping (`RETURN_CUSTODY_ERROR_COPY.byReason`). Adding one entry here is all
  the frontend needs to render a specific sentence for the new backend
  refusal — no new parsing code.

## 3. Design

**Backend** — inside `disposeLine`'s `restock` branch, after acquiring the
per-line lock (not before — the check-then-act must be serialized against a
concurrent submission, exactly the race `ReturnCustodyContendedError`'s own
docblock describes) and before calling `disposeRestock`:

```ts
try {
  const outstanding = await this.repository.findOutstandingRestockEvents(lineId);
  if (outstanding.length > 0) {
    throw new ReturnRestockAlreadyBlockedError(lineId);
  }
  return await this.disposeRestock(lineId, input, at);
} finally {
  await this.lock.release(returnCustodyLockKey(lineId), token);
}
```

New file `libs/core/src/returns/domain/exceptions/return-restock-already-blocked.error.ts`:
- `class ReturnRestockAlreadyBlockedError extends Error`, constructor takes
  `lineId`, message states the line has an outstanding block and must be
  attested first, `public readonly reason = 'restock-already-blocked' as const`.

Wire into `libs/core/src/returns/index.ts` (barrel export) and
`apps/api/src/common/filters/returns-exception.filter.ts` (import, add to
`ReturnRefusal` union, add to `@Catch(...)`, add to the `CONFLICT` group in
`resolveStatus`, add to the `reason`-carrying group in `resolveReason`).

**Frontend** — `return-custody-panel.tsx`: compute each line's outstanding
`blocks` array once (reusing the existing per-line filter already used for
`linesWithCustodyNotices`) and require `blocks.length === 0` alongside
`outstandingToDispose(line) > 0` for `canDispose`. When blocked, the segmented
receive/dispose control's Dispose branch does not render — only the existing
`ReturnRestockBlockedNotice` (already rendered separately, unconditionally
below) shows, which already carries the "Mark stock handled manually" CTA.

`return-custody.copy.ts`: add
`'restock-already-blocked': 'This line already has a stock write waiting on you — mark it handled before disposing more.'`
to `RETURN_CUSTODY_ERROR_COPY.byReason`. No changes needed to
`custody-error.ts` — it already reads `reason` generically from any 409 body.

## 4. Step-by-step

1. `libs/core/src/returns/domain/exceptions/return-restock-already-blocked.error.ts` — new file.
2. `libs/core/src/returns/index.ts` — export it.
3. `libs/core/src/returns/application/services/return-custody.service.ts` — add the guard inside `disposeLine`'s restock branch.
4. `apps/api/src/common/filters/returns-exception.filter.ts` — wire the new error into the filter (import, union, `@Catch`, `resolveStatus`, `resolveReason`).
5. `apps/web/src/features/returns/lib/return-custody.copy.ts` — add the `byReason` entry.
6. `apps/web/src/features/returns/components/return-custody-panel.tsx` — thread per-line `blocks` into `canDispose`.
7. Tests:
   - `return-custody.service.spec.ts` — a `restock` dispose on a line with an outstanding blocked event throws `ReturnRestockAlreadyBlockedError` and writes no new event row; a `scrap` dispose on the same line still succeeds; a line with only *attested* (non-outstanding) history still allows a fresh restock dispose.
   - `returns-exception.filter.spec.ts` — new error maps to 409 with `reason: 'restock-already-blocked'`.
   - `return-custody-panel.test.tsx` — Dispose form does not render when a line has an outstanding block; it reappears (and a real dispose can be submitted) after `markStockHandledManually` resolves.

## 5. Validate

- Architecture: guard lives in the application service that already owns the
  write + the lock (no new port, no new cross-context edge); the domain error
  follows the exact shape of its two closest siblings. Frontend change is a
  single boolean added to an existing derived condition — no new state, no new
  primitive.
- Naming: `return-restock-already-blocked.error.ts` /
  `ReturnRestockAlreadyBlockedError` matches the sibling files' convention
  exactly.
- Testing: three layers (core unit, HTTP filter unit, frontend component) —
  matches the existing coverage shape for every other custody refusal.
- Security/data-integrity: the guard is placed *inside* the lock, so it is not
  a TOCTOU-vulnerable check — this was the one design decision worth writing
  down rather than assuming.

## Risks / open questions

- None expected to require a design decision mid-implementation — the shapes
  to follow (`ReturnCustodyContendedError`, its filter wiring, its frontend
  copy entry) are all already established, single-purpose precedents in the
  same files this change touches.

# Implementation Plan: Automation run retry chains — terminality and count/rows agreement

**Date**: 2026-08-31
**Issue**: #2666 (review follow-up from PR #2629, finding I4)
**Branch**: `2666-automation-retry-chains` off `oms-programme-wave-3a`
**Status**: Ready for Review
**Estimated Effort**: ~1 day

---

## 1. Task Summary

**Objective**: give an automation retry chain a terminal state, and make the AF-X
attention count, the `attentionOnly` filter and the per-row `needsAttention` badge
resolve one predicate that cannot diverge.

**Context** — two defects, one of which is operationally worse than the other:

**(a) A failed retry stays retry-eligible forever.** `resolveRetryEligibility`
tests only `outcome === 'failed'`, so a retry that itself failed is retryable, and
so is *its* retry, with no terminal state anywhere. The same underlying failure is
re-offered indefinitely — and because `AutomationRetryService` deliberately does
**not** re-evaluate conditions (its property 2), every attempt runs the identical
actions against the identical order facts, so attempt 9 is byte-for-byte attempt 1.

**(b) The attention count can disagree with the attention rows.** Superseded-run
resolution lives in two places that must agree — `applyAttentionPredicate`'s
correlated `NOT EXISTS` (serving both `countAttention()` and the `attentionOnly`
filter) and the batched `findSupersededRunIds` (serving the per-row projection).
Today they share `RETRY_SUCCEEDED_CONDITION`, so they agree; the issue's fear is
that a partial fix to (a) touches one and not the other, and a badge reading
"4 automations couldn't finish" over a table that produces a different set teaches
the operator to distrust the surface. That is worse than a stale-but-consistent
answer, which is exactly why #2629 deferred rather than half-fixed.

There is also a **live** symptom of the shared condition being wrong, independent of
divergence: with `RETRY_SUCCEEDED_CONDITION = outcome <> 'failed'`, a chain of three
failed retries produces **three** attention rows for **one** underlying problem. The
count is internally consistent and still misleading.

**Classification**: CORE (domain vocabulary + repository predicate) + Infrastructure
(migration) + Interface (API refusal copy) + Frontend (mirror + copy).

---

## 2. Scope & Non-Goals

### In scope
- A terminal state for a retry chain.
- One superseded-run definition, read by both CTEs, correcting the "three rows for
  one problem" reading.
- Depth/cycle safety on chain resolution.
- Integration proof, against real Postgres, that count, filter and row agree over a
  chain of at least three retries.
- FE mirror of the new refusal reason + its copy.

### Out of scope
- Surfacing "2 of 3 attempts used" to the operator. A genuine gap; a separate
  decision about what the run projection exposes. Recorded under §7.
- Any change to what a retry *does* (whole-rule re-run, no condition re-evaluation,
  `AutomationRetryService` properties 1–5 stand).
- Automatic/backoff retry. `Try again` is operator-initiated and stays that way.
- Dismissal semantics (#2387) — untouched.

### Constraints
- `RETRY_SUCCEEDED_CONDITION` must remain **one** definition read by both readers
  (issue acceptance criterion 4).
- Seven sibling agents are on this programme branch; a migration timestamp must dodge
  `2396-*`, `2406-*`, `2407-*`, `2408-*`, `2409-*`, and the ordering invariant only
  compares against `origin/main`.
- The `automation-dispatch-boot` hard gate must stay green and unweakened.

---

## 3. Architecture Mapping

**Target layers**

| Layer | Files |
|---|---|
| CORE domain types | `libs/core/src/automation/domain/types/automation-run.types.ts` |
| CORE domain entity | `.../domain/entities/automation-run.entity.ts` |
| CORE domain port | `.../domain/ports/automation-run-repository.port.ts` |
| CORE application | `.../application/services/{automation-runs-read,automation-run-recorder,automation-dispatch}.service.ts` + their interfaces |
| CORE infrastructure | `.../infrastructure/persistence/{entities/automation-run.orm-entity.ts,repositories/automation-run.repository.ts}` |
| App (api) | `apps/api/src/automation/application/automation-retry.service.ts`, `apps/api/src/migrations/` |
| Frontend | `apps/web/src/features/automation/{api/automation.types.ts,lib/automation.copy.ts}` |

**No new ports, no new services, no new context.** Everything here is an
extension of vocabulary that already exists, which is the correct size for the
problem: the seams that must not diverge (`resolveRetryEligibility`,
`isAutomationRunAttentionWorthy`, `RETRY_SUCCEEDED_CONDITION`) are already single
definitions with multiple readers, and the fix keeps them that way rather than
adding a fourth place to state the rule.

**Core vs Integration**: entirely CORE. `automation_runs` is OL-owned data; no
adapter, no platform, no capability is involved.

---

## 4. Design

### 4.1 Half (b) — the predicate: **any retry supersedes, not only a successful one**

`RETRY_SUCCEEDED_CONDITION` becomes `SUPERSEDED_BY_RETRY_CONDITION`:

```
-- before
%alias%."outcome" <> 'failed'
-- after
TRUE            (i.e. the mere EXISTENCE of a row with retryOfRunId = <run> supersedes)
```

Concretely the shared constant stops discriminating on the retry's outcome, and the
predicate collapses to "does any run point at me". Renamed, because a constant whose
name says `SUCCEEDED` while it no longer tests success is the next reader's bug.

**Why this is the right rule.** A retry chain is *one* underlying failure with one
live end. The operator's handle is the newest link — the one whose result is not yet
superseded by a further attempt. Making any retry supersede its parent gives:

- **Exactly one attention row per chain** (the head), instead of one per link. A
  three-deep chain reports 1, not 3.
- **Dismissal that means something.** Dismissing the head clears the chain; under the
  old rule the operator had to dismiss every link individually to silence one problem.
- **A successful retry still clears everything** — a `done` retry is also "a retry
  that exists", and the successful head is not itself attention-worthy, so the whole
  chain goes quiet. #2387's behaviour is preserved, not traded away.
- **No recursion.** The predicate stays a single-level `NOT EXISTS`, served by the
  existing partial `IDX_automation_runs_retry_of`. Both readers stay the shapes they
  already are.

**What is lost, stated honestly**: a failed *intermediate* link no longer carries a
badge of its own. That is intended — it is the same problem as the head, its row is
still in the run log with `outcome: 'failed'`, and the head links back to it. What
would be lost by mistake is a link whose head was dismissed: nothing in the chain is
attention-worthy then, which is correct, because the operator dismissed the live end.

### 4.2 Half (a) — terminality: a **denormalized attempt counter**, not a chain walk

New column `automation_runs.retryAttempt` — `integer NOT NULL DEFAULT 0`.

- An ordinary firing writes `0`.
- A retry of run `P` writes `P.retryAttempt + 1`.
- `resolveRetryEligibility` gains `retryAttempt` and a fourth refusal reason,
  `retry-exhausted`, returned when `retryAttempt >= AUTOMATION_MAX_RETRY_ATTEMPTS`.

**A budget alone does not close the chain — forks do (review, BLOCKING).** The budget
bounds a *linear* chain, and nothing in it stops a retry of an ALREADY-SUPERSEDED parent:
R0 fails → R1 (attempt 1) fails → a direct `POST /runs/{R0}/retry` mints R2 with
`retryOfRunId = R0` and `retryAttempt = 1`. Two children point at R0, both are chain heads,
both badge, and the budget resets on every fork — defect (b) restored through the API path.
The frontend hides R0's actions cell once it is superseded (`AutomationRunActions` returns
`null` on `!needsAttention`), which is precisely the state `resolveRetryEligibility`'s own
docblock forbids relying on: *if only the UI knows, a direct call bypasses it.*

So the rule gains a **fifth refusal reason, `'superseded'`**, checked **after `rule-deleted`
and before `retry-exhausted`**. It is deliberately NOT folded into `retry-exhausted`: "you
already retried this, act on the newer row" is different advice from "stop retrying", and
one sentence covering both would send the operator to the wrong place. `RetryEligibilityInput`
therefore gains `supersededByRetry: boolean` alongside `retryAttempt`.

**This costs no new read on either surface.** `project()` already resolves
`findSupersededRunIds` for every row (it is how `needsAttention` is computed), and
`AutomationRetryService.retry` obtains its run through `getRunById` → `project()`, so the
fact is already in hand at both enforcement points. With forks closed, "a chain cannot
exceed `AUTOMATION_MAX_RETRY_ATTEMPTS` links" becomes true without qualification.

`AUTOMATION_MAX_RETRY_ATTEMPTS = 3`, and the number is reasoned rather than picked.
The sync runner's ladder is `maxAttempts = 10` with exponential backoff — machine-paced,
automatic, and retrying a *transient* condition that time may fix. This is the
opposite: an operator clicking a button, with no backoff, re-running actions against
facts that `AutomationRetryService` deliberately does not re-evaluate. A fourth
identical attempt has no new information in it. Three is where the honest message
becomes "this cannot finish as configured — fix the cause at the source, or dismiss".

**Why a stored counter and not a recursive CTE over `retryOfRunId`** (the shape the
issue anticipated):

1. **It bounds the data, not just a query.** The (MAX)th link refuses to spawn a
   successor, so a chain physically cannot exceed MAX links. A read-side depth cap
   bounds only the walk and lets the chain grow forever underneath it.
2. **No traversal means no traversal hazards.** `retryOfRunId` is a self-reference
   **by value with no FK** (the deliberate #2358 treatment), so the projection cannot
   be assumed acyclic; and there is no `statement_timeout` configured, so an uncapped
   walk pins a pooled connection on an operator page load (the ADR-037 breadcrumb-CTE
   precedent the issue cites). A non-recursive predicate cannot hang on a cycle at all.
3. **It keeps terminality inside the one existing rule.** `resolveRetryEligibility` is
   already the single definition read by *both* the projection (rendering) and the
   endpoint (guard). A chain-depth test needs a second database read; a column makes it
   a pure single-row test with no new seam and no way for the two halves to drift.
4. **Denormalizing a fact at write time is this table's own convention** —
   `ruleName`, `trigger` and `blockedByRuleIds` are all frozen on the row for the same
   reason.

**On acceptance criterion 3** ("chain traversal is depth-capped, with the cap's
rationale recorded at the query"): there is no chain traversal after this change, so
the criterion is met by removing the need rather than by capping a walk. The
rationale is recorded at both the predicate and the constant. This is a deliberate
deviation from the issue's prescribed mechanism and is called out for the reviewer.

**Backfill**: existing rows take the `DEFAULT 0`. Understating a chain's history
grants a fresh budget rather than refusing a legitimate retry — the safe direction —
and on this unreleased programme branch there is no meaningful history anyway.

### 4.3 Making the pair unforgeable

`retryOfRunId` and `retryAttempt` are meaningless apart: a caller that sets the link
and forgets the counter silently restarts the budget on every chain, i.e. reopens
this exact issue with no test failing. So at the two **application** seams the two
travel as one value:

```ts
/** libs/core/src/automation/domain/types/automation-run.types.ts */
export interface AutomationRunRetryLink {
  readonly runId: string;   // the failed run being retried
  readonly attempt: number; // parent.retryAttempt + 1
}
```

- `AutomationDispatchInput.retryOf?: AutomationRunRetryLink` (replaces `retryOfRunId?: string`)
- `AutomationRunRecord.retryOf?: AutomationRunRetryLink` (replaces `retryOfRunId?: string`)
- `NewAutomationRun` stays **flat** (`retryOfRunId` / `retryAttempt`) — it mirrors
  columns, and the recorder is the single translation point.

A type that cannot express the broken state is worth the small churn here, because the
broken state is invisible: nothing throws, nothing logs, the chain just never ends.

### 4.5 What an unbadged `failed` row now MEANS, and saying it

Today `failed` + no attention badge means exactly one thing: **a retry succeeded** (or the
row was dismissed, which renders its own muted note). After §4.1 it also means "a later
retry exists, and it may have failed too". Because `AutomationRunActions` short-circuits on
`!run.needsAttention`, such a row also loses its **entire actions cell** — so the operator
sees a `failed` badge, no attention badge, no note, and no controls, with nothing on the row
explaining why.

§4.4's argument that the frontend needs no change because it renders `needsAttention`
verbatim is true and beside the point: the *meaning* of the value changed underneath it, and
a surface that cannot be reconciled with itself is the disease this issue exists to cure.

The row therefore gains one **muted note** — `AUTOMATION_FAILURE_COPY.superseded`,
"A newer attempt replaced this one." — rendered beside the existing `dismissed` and
`isRetryOf` notes, reusing their treatment rather than inventing visual vocabulary. It costs
one projected boolean (`supersededByRetry`), which the client is receiving anyway for the
`'superseded'` refusal reason, and one line of copy.

### 4.4 The three surfaces, and why they cannot diverge

| Surface | Path | Reads |
|---|---|---|
| Attention **count** | `countAttention()` → `applyAttentionPredicate` | `SUPERSEDED_BY_RETRY_CONDITION` |
| Attention **filter** | `findRecent({attentionOnly:true})` → `applyAttentionPredicate` | same constant, same method |
| Per-**row** badge | `project()` → `findSupersededRunIds` + `isAutomationRunAttentionWorthy` | same constant |

A fourth consumer — the order-detail automation timeline
(`apps/web/src/features/orders/lib/automation-timeline.ts`) — renders the *projected*
`needsAttention` and never re-derives it, so it inherits agreement for free. The
frontend holds no copy of the rule (`automation-activity-table.tsx` comments this
explicitly), so there is no FE mirror to keep in step for the attention half; the only
FE mirror is the refusal-reason vocabulary.

---

## 5. Implementation Plan

### Phase 1 — CORE vocabulary (`automation-run.types.ts`)

1. **Add `AutomationRunRetryLink`.**
2. **Rename `AutomationRunAttentionInput.supersededBySuccessfulRetry` →
   `supersededByRetry`**, and rewrite the AF-X docblock's "a derived state is only
   self-clearing if the derivation can SEE what clears it" section to state the new
   rule and why one chain gets one handle.
3. **Add `'retry-exhausted'` to `RetryRefusalReasonValues`**, with a docblock saying
   what it is *not*: not a system fault and not the operator's mistake — the
   automation cannot finish as configured, and the remaining moves are fixing the
   cause at the source or dismissing.
4. **Export `AUTOMATION_MAX_RETRY_ATTEMPTS = 3`** with the §4.2 reasoning recorded at it.
5. **Extend `RetryEligibilityInput` with `retryAttempt: number`** (required, not
   optional-with-default — a caller that forgets it should not silently get an
   unbounded chain) and add the budget arm to `resolveRetryEligibility`.
   **Order matters**: `not-failed` → `subject-unsupported` → `rule-deleted` →
   `retry-exhausted`. Exhaustion is checked **last** so a run that is refused for a
   more specific reason keeps reporting that reason.
   - *Acceptance*: unit spec covers each arm and the precedence.

### Phase 2 — Persistence

6. **ORM entity**: add `retryAttempt` (`int`, `default: 0`), with a docblock stating
   that the declared default must match the migration's — the harness synchronizes
   from the decorator while production runs the migration (the existing `steps`
   docblock states this rule).
7. **Migration** `apps/api/src/migrations/1869000000900-add-automation-run-retry-attempt.ts`:
   `ADD COLUMN IF NOT EXISTS "retryAttempt" integer NOT NULL DEFAULT 0`, with a
   `DROP COLUMN` `down()`.
   **The slot is pinned here, not deferred to a re-check.** `check-migration-timestamps.mjs`
   compares only against `origin/main` (tail `1849000000003`); this branch runs
   `1860000000000`–`1869000000000` in unit steps; and **none of the seven sibling branches
   is pushed to `origin`**, so a re-check has nothing to look at and would itself be a check
   that cannot fail. Every sibling adding a migration will reach for `1870000000000` — the
   next round number — and this programme has already had three slots collide exactly that
   way. `1869000000900` sorts after everything on the branch, passes the ordering gate, and
   sits off the sequence anyone else will pick.
8. **Port** (`automation-run-repository.port.ts`): `NewAutomationRun.retryAttempt: number`;
   document `findSupersededRunIds` as "of these ids, which have a retry at all", and
   why the outcome no longer matters.
9. **Repository**:
   - rename the constant to `SUPERSEDED_BY_RETRY_CONDITION` and record at it that
     supersession is existence, that it is deliberately non-recursive, and that this
     is what makes the chain safe to read without a depth cap;
   - persist and read back `retryAttempt` (`toDomain` coerces a non-finite/negative
     value to `0` — same coerce-on-read-never-throw contract as `outcome`, and `0`
     is the value that keeps a row *usable* rather than permanently refused);
   - `save` writes `run.retryAttempt`.
10. **Entity**: `retryAttempt` constructor field (readonly, defaulted last to keep the
    positional constructor additive).

### Phase 3 — Write path

11. **`AutomationRunRecord` / `AutomationDispatchInput`**: swap `retryOfRunId` for
    `retryOf?: AutomationRunRetryLink`.
12. **`AutomationDispatchService`**: thread `input.retryOf` through to the recorder.
13. **`PersistingAutomationRunRecorder`**: the single translation point —
    `retryOfRunId: run.retryOf?.runId ?? null`, `retryAttempt: run.retryOf?.attempt ?? 0`.
14. **`AutomationRetryService`**: pass `retryAttempt: run.retryAttempt` into
    `resolveRetryEligibility` (the run is already in hand — no extra read), and
    dispatch `retryOf: { runId: run.id, attempt: run.retryAttempt + 1 }`.
15. **`REFUSAL_MESSAGE`** gains `retry-exhausted` (the `Record<RetryRefusalReason, string>`
    type makes omission a compile error, which is the gate).

### Phase 4 — Read path

16. **`AutomationRunsReadService.project()`**: pass `supersededByRetry` and
    `retryAttempt: run.retryAttempt` into the two pure rules. No structural change —
    the point is that this call site did not have to learn anything new.

### Phase 5 — Frontend mirror

17. `RETRY_REFUSAL_REASON_VALUES` += `'retry-exhausted'`.
18. `RETRY_REFUSAL_COPY` += a sentence for **each** new reason. The
    `as const satisfies Record<...>` makes omitting one a compile error;
    `retryRefusalCopy`'s raw-code fallback means an older bundle degrades to showing the
    code rather than showing nothing.
19. **`AUTOMATION_FAILURE_COPY.superseded` + a muted note on the row.** This change alters
    what an unbadged `failed` row *means* — see §4.5 — so the surface that renders it has to
    say the new thing. It reuses the muted-note treatment `dismissed` and `isRetryOf`
    already use, beside them in `automation-activity-table.tsx`; no new visual vocabulary.
20. **Copy constraint**: `check-ui-vocabulary.mjs` RULE B scans every string literal in a
    `*.copy.ts` under the Wave-2 feature folders, which includes `automation.copy.ts`. The
    nine banned model-internal terms are `authority`, `posture`, `FulfillmentWork`,
    `AvailabilityAuthority`, `atpEffect`, `phase`, `Orchestrator`, `Gateway`, `holder` —
    and `phase` / `holder` are ordinary English words easy to reach for when writing about
    a retry chain. Avoid them.

### Phase 6 — Tests

**Unit** (all must be verified red with the change reverted):
- `automation-attention.types.spec.ts`: the `retry-exhausted` arm, its precedence
  behind the three existing reasons, the boundary (`MAX - 1` retryable, `MAX` not),
  and `supersededByRetry` semantics.
- `automation-retry.service.spec.ts`: stamps `attempt = parent + 1`; refuses at budget
  with `retry-exhausted` **before** dispatching (assert the dispatcher was not called).
- `automation-run-recorder.service.spec.ts`: an ordinary firing persists `0`; a retry
  persists the link's attempt.

**Integration** — `apps/api/test/integration/automation/automation-attention.int-spec.ts`.
`seedRun` gains `retryAttempt`. The load-bearing test:

> **a chain of three retries reports ONE attention row, and all three surfaces name it**

Seed `R0 ← R1 ← R2 ← R3`, every one `failed`. Assert, in one test:
1. `countAttention() === 1` — *goes red today (returns 4)*;
2. `listRecent({attentionOnly:true}).runs` is exactly `[R3]` — *red today (returns 4 rows)*;
3. on an **unfiltered** listing, `needsAttention` is `true` for R3 and `false` for
   R0/R1/R2 — *red today (true for all four)*;
4. `count === rows.length`.

Assertion 4 alone would be a **check that cannot fail** — the two shapes agree today
too — so it is not the proof and must not be described as one. The proof that the
three surfaces agree *on the right set* is 1+2+3 together, and each of those three is
independently red before the change.

**`apps/api/test/integration/automation-schema.int-spec.ts`** asserts `automation_runs`'
exact, alphabetically-ordered column set and **will go red** on the new column.
`'retryAttempt'` sorts immediately before `'retryOfRunId'`. Adding it there is part of this
change, not an incidental fix.

Also:
- the existing `'should keep counting when a retry of that firing also failed'` test
  encodes the defect (expects 2) and is **rewritten**, not deleted — same seed, new
  expectation (1), with its comment explaining the chain-head rule;
- a `done` retry still clears the chain (regression guard for #2387);
- an unrelated later firing of the same rule still does **not** clear (the rule the
  spec forbids);
- `POST /runs/:id/retry` on a run seeded at `retryAttempt = MAX` answers 400 with
  `reason: 'retry-exhausted'`, and the same run's projection reports the identical
  refusal — one rule, two enforcement points.

Run with `apps/api` + `--runTestsByPath`, verified via `--listTests`.

---

## 6. Alternatives Considered

**A. Recursive CTE walking `retryOfRunId` with a depth cap** (the issue's own
prescription). Rejected: it caps the *query* while letting the chain grow without
bound, needs a cycle guard on a projection with no FK, adds a recursive walk to the
per-page-load projection path with no `statement_timeout` behind it, and puts
terminality in SQL where the pure `resolveRetryEligibility` rule cannot see it —
splitting one rule across two languages. The stored counter is strictly stronger and
strictly simpler.

**B. Keep "only a successful retry supersedes" and terminate purely on the counter.**
Rejected: it fixes (a) and leaves the live half of (b) — a three-deep chain still
badges three rows for one problem, and the operator must dismiss each.

**C. Latest-run-wins at `(subjectId, ruleId)`.** Already rejected by #2387 and still
wrong: it clears on a later *unrelated* firing of the same rule, which the spec
forbids in as many words.

**D. Make `retryOfRunId` a real FK so the chain is guaranteed acyclic.** Rejected:
#2358 deliberately keeps `ruleId` / `subjectId` / `retryOfRunId` FK-free so history
survives deletion of what it references. Not worth reversing for a hazard the
non-recursive predicate already removes.

---

## 7. Risks, Edge Cases, Deferred

| Item | Handling |
|---|---|
| A dismissed head silences the chain | Correct — the operator dismissed the live end. Asserted. |
| A cycle written by direct SQL | Non-recursive `NOT EXISTS` cannot hang; both members read as superseded, so neither badges. Understates, never overstates. Recorded at the predicate. |
| Pre-existing rows have `retryAttempt = 0` | Grants a fresh budget rather than refusing a legitimate retry — the safe direction. |
| The operator cannot see attempts remaining | **Decided: still not exposed, and here is the argument rather than an omission.** The cost is real — the operator meets the budget only at the moment it stops them. But a counter rendered per row ("attempt 2 of 3") puts a number on the *routine* case, where it is noise on every healthy retry, to pre-warn a case the refusal sentence already explains in full when it arrives; and `retryAttempt` on the response DTO is a field three FE surfaces would have to decide how to render. The refusal sentence names the ceiling, the cause and both remaining moves. If operators report meeting it as a surprise, exposing the counter is additive and costs nothing to add later — the reverse is not true. |
| `Dismiss` copy in the exhausted state | **Examined, kept.** `I handled this myself` is now the ONLY exit from a state OL created by refusing, so the wording was re-read rather than inherited. It still holds: dismissal is the operator asserting they own the outcome, which is exactly what they are doing when the automation cannot finish and they take it off the board. Changing it to something like "Give up" would make OL narrate the operator's intent, which it does not know. The honest work is done by the refusal sentence beside it, which says *why* Try again is gone. |
| Positional entity constructor | `retryAttempt` appended last, so every existing construction site stays valid. |
| Migration timestamp collision with a sibling branch | Re-checked against `origin/main` tail **and** the five named in-flight branch prefixes immediately before commit. |

**ADR**: none. The change adds no cross-context edge, no port, no plugin-contract
surface, and stays inside one bounded context — `engineering-standards.md` §ADRs says
not to write one for a bug fix without architectural impact. The rejected alternatives
are recorded here and at the code, which is this codebase's established convention for
exactly this weight of decision. Flagged for the reviewer to overturn if they disagree.

---

## 8. Acceptance Criteria (issue #2666)

- [ ] A retry that fails does not remain indefinitely retry-eligible —
      `retry-exhausted` at `AUTOMATION_MAX_RETRY_ATTEMPTS`, enforced by the endpoint
      and rendered by the projection through one rule.
- [ ] Count and rows proven to agree in an **integration** test over a chain of ≥3
      retries, red before the change on three independent assertions.
- [ ] Chain traversal depth-capped — satisfied by eliminating traversal; the chain is
      instead length-capped at write time, with the rationale recorded at the predicate
      and at the constant. *Deviation from the issue's prescribed mechanism, called out.*
- [ ] The superseded condition remains a **single** definition read by both CTEs
      (renamed `SUPERSEDED_BY_RETRY_CONDITION`).

## 9. Alignment Checklist

- [x] Hexagonal layering respected; no layer inversion.
- [x] CORE/Integration boundary untouched (no adapter, no capability).
- [x] Reuses the existing single-definition seams rather than adding a fourth.
- [x] Idempotency: unchanged — retries stay operator-initiated and executor-idempotent.
- [x] Error handling: refusal is a typed reason on both the guard and the projection.
- [x] `as const` union extended, not an enum.
- [x] Naming per engineering-standards; pure rules stay in `*.types.ts` under the
      #2231 pure-rule exception.
- [x] Migration follows the synthetic-sequential-timestamp convention.
- [x] Testing strategy names which assertions go red first.

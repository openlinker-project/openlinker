# Pre-implementation analysis: automation retry chains (#2666)

**Plan**: `docs/plans/implementation-plan-automation-retry-chains.md`
**Gate run**: 2026-08-31, against `2666-automation-retry-chains` (off `origin/oms-programme-wave-3a`)
**Verdict**: **NEEDS-REVISION** — no reuse collisions and no unresolvable break, but three
barrel/contract changes go unnamed in the plan, one already-existing test will go red and is
absent from the plan's file list, and one invariant script constrains the new copy.

---

## 1. Reuse audit

Everything the plan proposes to create is **confirmed absent from the tree**. There is no
port, service, token, capability or column being reinvented.

| Plan artifact | Verdict | Evidence |
|---|---|---|
| `retryAttempt` column / field | **NEW** | repo-wide grep for `retryAttempt`: zero hits |
| `'retry-exhausted'` refusal reason | **NEW** | zero hits |
| `AUTOMATION_MAX_RETRY_ATTEMPTS` | **NEW** | zero hits (`MAX_RETRY_ATTEMPTS` unused anywhere) |
| `AutomationRunRetryLink` | **NEW** | zero hits |
| `SUPERSEDED_BY_RETRY_CONDITION` | **PARTIAL — rename** of `RETRY_SUCCEEDED_CONDITION`, `automation-run.repository.ts:49` |
| Attention predicate | **PARTIAL — extend** `applyAttentionPredicate`, `automation-run.repository.ts:186` |
| Retry eligibility rule | **PARTIAL — extend** `resolveRetryEligibility`, `automation-run.types.ts` |
| New port / service / DI token / capability | **none proposed** — correct; nothing here needs one |

**No new `*.tokens.ts` entry, no new `*Port`, no new `*Service`** — so
`check-service-interfaces.mjs` and `check-cross-context-imports.mjs` have nothing to say
about this change. Confirmed by inspection of the proposed file list.

**The plan's one substantive cost is the migration.** It was weighed against a
column-free alternative (make only an *original* firing retryable, i.e. terminate every
chain at length 2) which needs no migration, no dispatch-input change and one line. That
alternative is rejected here for the same reason the plan rejects the CTE: an operator who
has just fixed the underlying cause has a legitimate third attempt, and refusing it leaves
Dismiss as the only move. The column is the honest price; recording that it was considered.

---

## 2. Backward-compatibility findings

### CRITICAL — three published-surface changes the plan does not name as such

All three are **fully migratable inside this commit** — every in-repo consumer is enumerated
below and is already in the plan's scope — but the plan describes them as edits rather than
as contract changes, which is exactly what this gate exists to surface.

| # | Surface | Change | In-repo consumers (complete) |
|---|---|---|---|
| C1 | `AutomationDispatchInput` — **barrel-exported** (`libs/core/src/automation/index.ts`, `export type { IAutomationDispatchService, AutomationDispatchInput }`) | `retryOfRunId?: string` → `retryOf?: AutomationRunRetryLink` | `automation-dispatch.service.ts:187`; `apps/api/.../automation-retry.service.ts:163`; `apps/api/.../__tests__/automation-retry.service.spec.ts:72` |
| C2 | `AutomationRunRecord` — **barrel-exported** (`index.ts:88`) | same rename | `automation-run-recorder.service.ts:115` |
| C3 | `RetryEligibilityInput` — barrel-exported via `export * from './domain/types/automation-run.types'` | gains a **required** `retryAttempt: number` | `automation-runs-read.service.ts` (`project()`); `apps/api/.../automation-retry.service.ts` |

**Assessment**: required-not-optional is the right call for C3 and the plan's reasoning holds
(an optional-with-default field would silently grant an unbounded chain, which is this issue
recurring with no test failing). Same for C1/C2: a paired value object is the only shape that
cannot express "link set, counter forgotten". No revision to the *design* is requested —
only that the plan state these as contract changes with the consumer list above, so the
reviewer of the diff is not discovering them.

**Not affected, verified**: `AutomationRunResponseDto.fromDomain` enumerates fields rather
than spreading (`automation-response.dto.ts:220`), so adding `retryAttempt` to the domain
entity does **not** leak to the API response. The plan's decision to defer exposing it is
therefore free, not merely deferred.

**Entity constructor**: `new AutomationRun(...)` has exactly **two** call sites
(`automation-run.repository.ts:226`, `automation-runs-one-record.spec.ts:25`).
`retryOfRunId` is currently the last positional parameter and carries a default, so
appending `retryAttempt` after it is additive. Low risk, as the plan assumes.

### WARNING — W1: an existing test asserts the exact column set and is missing from the plan

`apps/api/test/integration/automation-schema.int-spec.ts:261-279` asserts
`automation_runs`' complete, alphabetically-ordered column list. Adding `retryAttempt`
**will turn this red**, and the file appears nowhere in the plan's file list or test plan.
`'retryAttempt'` sorts immediately **before** `'retryOfRunId'`.

This is a good gate doing its job, not an obstacle — but a plan that does not name it will
read as an unexpected failure mid-implementation.

### WARNING — W2: migration required, and the slot needs care

Schema change ⇒ migration (`docs/migrations.md`). Facts as of this run:

- `origin/main` migration tail: **`1849000000003`**. The ordering invariant compares only
  against `origin/main`, so any prefix above that passes `check-migration-timestamps.mjs`.
- This branch's tail: **`1869000000000`**, reached in unit steps (`1860…`–`1869…`).
- **None of the seven named sibling branches (#2396, #2406, #2407, #2408, #2409, #2673,
  #2678) is pushed to `origin` yet**, so the invariant cannot see them and neither can this
  gate. A sibling adding a migration will almost certainly take `1870000000000` — the next
  round number — which is precisely the collision the brief warns has already happened three
  times on this programme.
- **Recommendation**: take an in-block offset such as **`1869000000900`** rather than the
  sequential next step. It sorts after everything on the branch, passes the ordering check,
  and does not sit on the slot a sibling picking "the next round number" will take.
- Re-verify immediately before commit; the invariant will not catch a sibling collision.

### WARNING — W3: `check-ui-vocabulary.mjs` scans the file the new copy lands in

RULE B of that script scans every string literal in a `*.copy.ts` under the Wave-2 feature
folders — which includes `apps/web/src/features/automation/lib/automation.copy.ts`, where
the plan adds the `retry-exhausted` sentence. The nine banned model-internal terms are:

> `authority`, `posture`, `FulfillmentWork`, `AvailabilityAuthority`, `atpEffect`,
> `phase`, `Orchestrator`, `Gateway`, `holder`

The plan's draft sentence uses none of them, so this is a constraint to observe rather than a
break — but it is unstated, and `phase` / `holder` are ordinary English words easy to reach
for when writing about a retry chain.

### Checked and clear

| Surface | Result |
|---|---|
| `check-attention-reason-mirror.mjs` | **Not affected** — mirrors `AttentionReason` (fulfillment-authority), not automation refusal reasons. |
| `check-automation-merge-field-mirror.mjs` | Not affected — merge fields (templates). |
| `check-architecture-gates.mjs` | Automation appears only in a prose reference to the #1032 cut; no rule fires. |
| `automation-dispatch-boot.int-spec.ts` (hard gate) | **Untouched** — zero occurrences of `retry` in the file. The plan does not weaken it. |
| FE refusal-reason mirror | No `check-*-mirror.mjs` covers it; the `as const satisfies Record<RetryRefusalReason, string>` on `RETRY_REFUSAL_COPY` plus the API's `Record<RetryRefusalReason, string>` on `REFUSAL_MESSAGE` are the real compile-time gates, exactly as the plan claims. `retryRefusalCopy` has a verified raw-code fallback (`automation-failure.ts:38`), so an older bundle degrades to the code. |
| Cross-context imports | No new sibling-context edge proposed. |

---

## 3. Open questions

1. **Does `retryAttempt` belong on `AutomationRunResponseDto` after all?** The plan defers it
   and the DTO's enumerate-don't-spread shape makes deferral free. But the refusal sentence
   cannot say how many attempts remain, so an operator hitting `retry-exhausted` learns the
   budget existed only at the moment it ran out. A deliberate call either way — flagging that
   the plan resolves it by omission rather than by argument.
2. **`AUTOMATION_MAX_RETRY_ATTEMPTS = 3` is unvalidated by anything but reasoning.** No
   operator data exists on this branch. The reasoning (no backoff, no condition
   re-evaluation, so attempt N is byte-identical to attempt 1) is sound and recorded; noting
   only that the number is a judgement, not a measurement, and should say so at the constant.
3. **Chain-head semantics under partial dismissal** — the plan asserts "a dismissed head
   silences the chain" is correct. Agreed, and it is asserted in the test plan. No question
   about the behaviour; only that it is a *change* from today (where each link could be
   dismissed independently) and deserves a line in the PR description, not just a docblock.

---

## 4. Required before implementation

1. Add `apps/api/test/integration/automation-schema.int-spec.ts` to the plan's file list and
   test plan (W1).
2. Name C1/C2/C3 as barrel-surface changes, with the consumer lists above.
3. Pin the migration slot to an off-sequence prefix and record why (W2).
4. Note the `check-ui-vocabulary.mjs` banned-term constraint on the new copy (W3).

None of these changes the design. The plan's two core decisions — supersession by existence,
and terminality by a denormalized counter rather than a capped chain walk — survive the
audit intact, including the deliberate deviation from the issue's prescribed CTE mechanism,
which is argued rather than assumed.

# Implementation Plan: AF-X — "an automation couldn't finish" (producer half)

**Date**: 2026-08-27
**Issue**: #2387 (`W2-49`), OMS Wave 2, streams S2+S3
**Status**: Ready for Review
**Estimated Effort**: ~1.5 days (L, not the backlog's M — see § 2)

---

## 1. Task Summary

**Objective**: make a failed automation firing an operator-visible, actionable and
*clearable* state — with an action-specific title, the failing operation's own
words, a `Try again` that re-runs the rule under the same money gate, and a
dismissal that records a human handled it.

**Context**: `AutomationRun` already records `outcome: 'failed'` with a per-step
`AutomationStepResult` naming the failing step and the steps skipped after it
(#2385). What is missing is everything that makes it *readable and exitable*: the
titles are generic, the reason is an OpenLinker sentence wrapped around whatever
the operation said, and a failed run has no exit at all.

**Classification**: CORE (contract + derivation) + Interface (two write routes) +
Frontend (two surfaces this body already owns).

---

## 2. Scope & Non-Goals

### The issue's premise is wrong in four places, and this plan builds to the corrected scope

Verified against the tree on branch `2358-automation-rules` before planning. The
coordinator ratified all four findings and the corrected scope; this section is
the record.

**(a) Every stated dependency is unbuilt on this branch.** `AttentionReasonValues`
does not exist anywhere. The `fulfillment-authority` leaf here is #2304's Wave-1a
vocabulary only (`FulfillmentAuthorityBlockReasonValues`, 4 members;
`FulfillmentAuthorityUnresolvedReasonValues`, 5) — declared and never written.
There is no `check-attention-reason-mirror.mjs` and no
`apps/web/src/features/fulfillment-authority/`. #2352, #2356 and #2357 are all
**open**, and they are body C's: **PR #2589**, branch `2351-authority-read-model`,
unmerged. AC #1 is therefore unsatisfiable here — see § 2.3.

**(b) AF-X is an EVENT; the eight siblings are LEVELS, and the issue asks for
both.** The Proposed Solution says AF-X is persisted *"under the same
level-triggered, single-writer, `toOrm`-excluded discipline as its eight
siblings"*, while rule 4 says it must **never** clear because a later firing of
the same rule succeeded, and rule 1 wants one row per failed *firing*.
Level-triggered is **defined** by re-deciding on every transition and storing the
answer *including `null`* — that clearing behaviour is the whole mechanism, and it
is exactly what rule 4 forbids. A single-value column on `order_records` also
holds one value per order, not one per firing. The three requirements are jointly
unsatisfiable on one column.

They do not need to be satisfied there. The issue's own S2-6 criterion has the
answer: *"one record, three renderings — **never three independent writes** —
reading W2-47's `automation_runs` row."* `automation_runs` already **is** the
durable record. **AF-X is DERIVED from those rows and never persisted a second
time.** Persisting it on `order_records` as well would be the second of the three
independent writes the same criterion forbids one line later.

**Why deriving is the safer half — and this is the rule, not a local choice.** A
derived state cannot be stale, cannot be reset by a peer writer, and a successful
retry clears it *by writing a new run* rather than by anything remembering to null
a field. Body C landed the same rule for A1-U / A2-A / A5-A (`origin: 'derived'`,
recomputed per read, no column); this is its second wave-level instance. A future
reader tempted to "optimise" the derivation into a column should read this
paragraph first: the column buys an index scan and costs every one of those three
properties.

**(c) `Try again` has no producer.** `AutomationsController` exposes 12 routes;
none re-dispatches. `AutomationDispatchService` is reached only through trigger
emission.

**(d) Dismissal has no producer.** No column, no route, no permission.

**(e) (smaller, but it fails an AC as written) the reason is neither verbatim nor
attributed.** `RelayStatusToSourceExecutorService` returns
`` detail: `Telling the marketplace failed: ${message}` `` — an OpenLinker sentence
with the underlying text interpolated, and no attribution channel at all. The AC's
test ("no re-wording layer sits between the operation and the rendered string")
fails today.

### In Scope (the producer half)

1. **Derive AF-X** from `automation_runs` — one pure rule, one read, no column.
2. **Six action-specific verb titles** as a copy table keyed
   `satisfies Record<AutomationActionKind, string>`.
3. **Attribution**: an additive `report` member on `AutomationStepResult` carrying
   the operation's own words and who said them.
4. **`Try again`**: a real per-firing re-dispatch that re-applies #2366's
   irreversible gate **by calling the same gate**.
5. **Dismissal**: records that a *human* handled it — the run stays `failed`.
6. Render in the two surfaces body D owns: the order timeline (#2385) and
   `/automations/activity` (#2386).

### Out of Scope — deferred, with the blocker named

The ninth `AttentionReasonValues` member, its mirror-script entry, the
`Needs attention` section row, the `Stopped` order-row badge and the attention
filter chip. **Every one of those is a body-C file, and PR #2589 is open and
unmerged.** Authoring a second copy of a union and a copy table body C is writing
right now is not a merge conflict to be resolved — it is two independently-authored
operator vocabularies that both survive the resolve, which is the failure the
mirror scripts and `check-ui-vocabulary` exist to prevent, and worse than a textual
conflict because a textual conflict is loud.

**AC #1 is therefore knowingly unmet, not forgotten.** The coordinator owns the
follow-up at the wave boundary; it is small once the union exists, because the
derivation it renders will already be built and tested here.

Also out of scope: any `order_records` column (see § 2(b)), retry as a background
job (§ 6, D4), partial-step resume (§ 6, D5).

### Constraints

- Worktree `.claude/worktrees/2358-automation-rules`, branch `2358-automation-rules`.
- Migration slot **1856000000000** is this body's and is unused. No other timestamp
  is minted.
- **Docker is back** (27.4.0). Int-specs are written AND RUN; real results are
  reported, not a disclosed-unverified line. A 900 s timeout while sibling gates
  run is contention — prune and retry rather than reporting red.
- Node 22 for anything touching `apps/web`, including the commit shell.

---

## 3. Architecture Mapping

**Target layers**: CORE domain (`libs/core/src/automation/domain`), CORE
infrastructure (one column + migration), Interface (`apps/api/src/automation`),
Frontend (`apps/web/src/features/automation`, `apps/web/src/features/orders`).

**Reused, not rebuilt**:

| Seam | Reused for |
|---|---|
| `AutomationRun` + `automation_runs` (#2358/#2385) | the durable record AF-X derives from |
| `IDX_automation_runs_failed` (partial, `WHERE outcome = 'failed'`) | the attention read — the index was landed for exactly this |
| `AUTOMATION_DISPATCH_SERVICE_TOKEN` → `AutomationIrreversibleGateService` (#2362) | `Try again`'s money gate |
| `buildOrderAutomationFacts` (`@openlinker/core/orders`) | the retry's facts — third caller after T5 emission and the dry run |
| `IAutomationRunsReadService` (#2363/#2385/#2386) | the run reads |
| `buildAutomationTimelineEvents` (#2385) | the order-timeline rendering |
| `automation.copy.ts` (#2364–#2386) | every string |

**New components**: one pure domain rule, one structured step-report type, one
`apps/api` application service, two controller routes, one nullable column pair +
migration, one FE copy table, two FE renderings.

**CORE vs Interface justification.** The retry service lives in
`apps/api/src/automation/application/`, beside `AutomationDryRunService`, and for
the identical recorded reason: it composes automation rules with **order facts**,
and `OrdersModule` already imports `AutomationModule` for the T5 packed emission,
so a reverse edge inside core would close a NestJS DI cycle (ADR-041 decision 2 —
no `forwardRef` anywhere in `libs/core`, `apps/api` or `apps/worker`). The
`AutomationSubjectFacts` docblock already assigns fact assembly to the caller.

---

## 4. Domain Research (internal)

- **Dispatch stops at the first failure and records every later step `skipped`**
  (`AutomationDispatchService.runRule`) — so the run row already carries what the
  body copy must state. No new backend fact is needed for the "nothing else ran"
  sentence.
- **Only 2 of 6 actions have real executors** (`relay-status-to-source`,
  `send-email`); `issue-sales-document`, `dispatch-shipment`, `place-hold` and
  `release-hold` route to `UnavailableActionExecutorService`. The attribution
  change therefore touches **two** executors, which is what sizes § 6 phase 2 as
  small — worth stating so the L is sized on evidence rather than on the six-verb
  table.
- **Executors own their own idempotency** (`AutomationDispatchService` property 4,
  spec §5.3's admission rule). This is what makes a whole-rule retry safe without
  partial-step resume — see § 6, D5.
- **`@Roles('admin')` is every write route's decoration** on this controller;
  reads are `('admin','operator')`. `@CurrentUser() user: AuthenticatedUser` is the
  actor idiom; `order_records.packedByUserId` (`uuid`, unindexed, no FK) is the
  attribution-column precedent.

---

## 5. Questions & Assumptions

### Decided before planning (coordinator-ratified)
- Split taken: producer half only; the attention-vocabulary half deferred behind PR #2589.
- AF-X derived, never persisted.
- `Try again` + dismissal are **in** — an AF-X state whose only two exits are
  unimplemented is a state with no exit, which is #2385's `blocked`-with-no-producer
  one level worse (that one rendered nothing; this one renders a permanent alarm).

### Assumptions
- **A1.** A single-rule retry passing the #2362 gate is correct. The gate refuses
  when two rules claim the same irreversible action; a retry hands it one rule, so
  it passes. ADR-041 §6 forbids **OpenLinker** choosing between colliding money
  rules — it does not forbid the operator choosing. The retry is an explicit
  operator act naming one rule. Documented at the call site.
- **A2.** `Try again` is offered only for `outcome === 'failed'`. A `blocked` run
  has no failed step and its fix is a configuration change, not a re-run; a
  `nothing-to-do` run did what it should.
- **A3.** No ADR is minted. The derive-not-persist rule is body C's, already
  landed as `origin: 'derived'`; a second ADR from this body would be a rival
  statement of one rule, and ADR numbering is contended across five concurrent
  bodies. The reasoning lives in § 2(b) and at the derivation site.

### Open (flagged, not blocking)
- **Q1.** The FE cannot render "Allegro said" without a connection display name;
  the relay reports `connectionId`. Handled by making `attributedTo` a
  free-text label the *reporter* supplies (§ 6, D3) rather than a lookup.

---

## 6. Design decisions

**D1 — AF-X is a pure rule over one run row, projected by the API.**
`isAutomationRunAttentionWorthy(run)` lives beside `automation-run.types.ts` under
the pure-rule exception (`engineering-standards.md § The pure-rule exception`): it
is pure, it IS the rule for that type, and adding an outcome member must edit both
halves in one commit. Rule: `outcome === 'failed' && dismissedAt === null`. The API
projects the derived boolean onto the run DTO, so **the frontend holds no copy of
the rule** — no mirror script, no drift. Two surfaces, one function, one read.

**A derived state is only self-clearing if the derivation can SEE the thing that
clears it.** The first draft of this plan defined attention as a pure function of
ONE row (`outcome === 'failed' && dismissedAt === null`) and claimed a successful
retry cleared it "by writing a new run rather than by anything remembering to null
a field". That is false: `AutomationDispatchService.record` INSERTs a new row and
never touches the original, so the original keeps `outcome: 'failed'` /
`dismissedAt: null` and stays attention-worthy forever. The clearing fact had to
become **data** — this is the rule, not the local fix.

That fact is `retryOfRunId` (nullable, self-reference **by value, no FK**, the same
precedent #2358 sets for `subjectId` / `ruleId`), written by the retry service.
The predicate becomes:

```
needsAttention = outcome === 'failed'
  AND dismissedAt IS NULL
  AND NOT EXISTS (a run with retryOfRunId = this.id AND outcome <> 'failed')
```

**Latest-run-wins at the `(subjectId, ruleId)` grain was rejected, and that is the
load-bearing half.** It would clear on a later *unrelated* firing of the same rule,
which the issue's rule 4 forbids in as many words. The only thing distinguishing
"a retry of this firing" from "another firing of this rule" is a link, so the link
has to exist.

**Cost, accepted and stated**: D1 is no longer a pure per-row function — the
predicate needs a second read. It is expressed **once, in the repository**, and
shared by the `attentionOnly` filter and `countAttention`. What must not happen is
those two each growing their own `NOT EXISTS`: that is #2377's stage-expression
divergence, which is producing a live `listReturns` 500 in another body right now.
The pure function keeps the rule for the single-row case and takes the resolved
link as an argument — one rule, one place, two callers.

**The frontend parses `needsAttention` as REQUIRED** (`z.boolean()`), not
`.nullish()`. Both halves ship in one deploy, so there is no version skew for
`.nullish()` to protect against, and it costs the one thing that matters: the FE
would have to choose between under-reporting a genuinely failed run (absent ⇒ no
affordance offered) and re-deriving the rule client-side — a second copy of the
rule this decision exists to prevent. `dismissedAt` / `dismissedByUserId` are
genuinely nullable and take `.nullish()` per #939. The mirror at
`automation.schema.ts` moves in the SAME commit: a server field the FE schema drops
type-checks perfectly and renders nothing.

**The cost of `required` here, stated for the next person weighing it**:
`parseAutomationRunLog` parses per row with `runSchema.safeParse(entry)` and
**silently drops** a failing row — there is no dropped-row counter
(`unreadableStepCount` covers steps only). So a backend that ever omits
`needsAttention` makes rows *vanish*, which is worse than the under-reporting
`.nullish()` would cause. The decision stands on same-deploy shipping; the failure
mode does not go unrecorded.

**D2 — Titles are copy, keyed on the action, with a raw-code fallback.**
`AUTOMATION_FAILURE_TITLE` in `automation.copy.ts`,
`as const satisfies Record<AutomationActionKind, (ref: string) => string>` — a
seventh action fails the build rather than rendering a generic sentence. The
fallback for an action string this build does not recognise (the column is `jsonb`;
a rule written by a newer build reaches here) names the raw code rather than
inventing a verb.

**D3 — Attribution is ADDITIVE, and OpenLinker is a legitimate attribution.**
The ratified shape was `detail` becoming `{attribution, rawMessage}`. Replacing
`detail` is not viable against the existing shape and the deviation is documented
at the site: `detail` is consumed by `buildAutomationTimelineEvents` (#2385), by
the run-log panel (#2385) and by the activity table (#2386), and it carries
operator-facing sentences for `done` and `nothing-to-do` steps that have no
external reporter at all. So:

```ts
readonly detail?: string;                                    // unchanged
readonly report?: { attributedTo: string; message: string }; // NEW
```

`report` is set **only when an external operation reported something**, and
`attributedTo` names who said it. Three cases exist and only the first has an
external source: (i) the operation answered → `{attributedTo: 'Allegro', message}`;
(ii) an OpenLinker-side refusal ("no email sender is configured in this process")
→ that IS OpenLinker's own statement, attributed to OpenLinker, not re-worded;
(iii) an unexpected throw → OpenLinker's statement carrying the exception text.
The FE renders `{attributedTo}: "{message}"` when `report` exists and falls back to
`detail`. That satisfies the AC where there is an operation and does not fabricate
attribution where there is not. `steps` is `jsonb` and the member is optional, so
no migration and no reader change.

**D8a — The gate CANNOT refuse a single-rule retry, and must not be described as
if it could.** `Try again` resolves `AUTOMATION_DISPATCH_SERVICE_TOKEN`, which binds
`AutomationIrreversibleGateService` — that is correct and stays correct if a retry
ever carries a set. But `gate-irreversible-automation-actions.ts:95` is
`if (kindRules.length < 2) continue`, so a dispatch carrying ONE rule can never be
blocked. **The gate is therefore not what protects against duplicate money here.**
A vacuous check described as a protection is worse than no check, because the next
author stops looking. What actually protects is executor idempotency — see R6.

**D8 — A refused retry is DISABLED WITH A REASON, never a 400 nobody sees.** An
action rendered enabled that the backend will refuse is the same defect as a
filter the backend cannot serve: the operator learns the truth only by wasting a
click. So the run projection carries a `retryable` discriminant with a closed
reason code, the button reads it, and **the endpoint enforces it independently** —
both halves, because the projection is a *rendering* fact and the endpoint is the
*guard*. If only the endpoint knows, the UI lies; if only the UI knows, a direct
call bypasses it. One pure rule (`resolveRetryEligibility`) produces both, so they
cannot drift.

```ts
type RetryRefusalReason =
  | 'not-failed'      // done / nothing-to-do / blocked — nothing to re-run
  | 'rule-deleted'    // the rule this firing ran no longer exists
  | 'subject-unsupported'; // subjectKind: 'return' — see below
```

**`rule-deleted` must NOT read as a failure.** A rule the operator deliberately
deleted is not a broken retry — it is a retry with no definition left to run.
The copy says exactly that, and **the run row is untouched**: the historical record
of what fired is still true and outlives its rule (#2358's no-FK / frozen-`ruleName`
design exists for this). Dismissal still works, which is the point — an operator
must be able to clear an alarm about a rule that no longer exists.

**`subject-unsupported` names the cause, not the gap.** `buildOrderAutomationFacts`
is order-shaped, so a `subjectKind: 'return'` firing has nothing to re-dispatch
against. The copy is *"this action cannot re-run for a return"* — actionable —
never *"not supported"*, which reads as a hole someone files a bug against.

**D4 — The retry dispatches INLINE, matching T5.** `OrderRecordService` already
dispatches automation synchronously at the pack write site through
`AUTOMATION_TRIGGER_EMISSION_SERVICE_TOKEN`, and `AutomationModule` is in
`apps/api/app.module.ts`, so the dispatch token resolves in the API process. A new
`JobTypeValues` member would additionally touch the ADR-050 lane partition and its
boot assertion — shared files three other bodies are editing this wave. Cost stated
honestly: the HTTP request blocks for the rule's steps, exactly as a pack write does
today. Moving it behind a job later is additive.

**D5 — The retry re-runs the WHOLE rule, not the failed step onward.** Executors
own their own idempotency by contract, so re-running a succeeded step is safe; a
resume-from-index path would be a second execution model that can disagree with the
first. The retry writes a **new** run row — which is also how the attention state
clears, with nothing remembering to null anything.

**D6 — Dismissal records a HUMAN handled it, never that the operation succeeded.**
`dismissedAt` + `dismissedByUserId` on `automation_runs` — following
`AutomationRule.moneyAckAt` / `moneyAckByUserId`, the same `{verb}At` /
`{verb}ByUserId` pattern on the sibling table in this same context, whose no-FK
reasoning is already written into its ORM entity and whose DTO projection is there
to copy. (`order_records.packedByUserId` is the same shape one context away; prefer
the near precedent — it is the one a reviewer compares against.) The row stays `failed`,
the timeline keeps both entries permanently, only the *attention* clears. This is
#2370's `restockedBy: 'operator_out_of_band'` shape and the same sentence applies:
OpenLinker must not claim it did something a person did outside it. The FE labels it
"I handled this myself", never "resolved".

**D7 — Dismissal is a conditional UPDATE, and re-dismissal is a no-op success.**
`WHERE id = $1 AND "dismissedAt" IS NULL` (the `claimWaybillRelay` shape), so two
operators cannot fight over the attribution, and the first dismisser is the one
recorded. A second call returns the row unchanged rather than erroring — dismissing
an already-dismissed run is not a failure state an operator can act on. **The
return contract is deliberately indistinguishable**: the caller cannot tell a fresh
claim from an already-dismissed row, and must not grow a `wasAlreadyDismissed`
boolean to branch UI on — there is no second sentence to say.

---

## 7. Implementation Plan

### Phase 1 — CORE: the derivation and the dismissal column

**1.1 `libs/core/src/automation/domain/types/automation-run.types.ts`**
Add `isAutomationRunAttentionWorthy(run: AutomationRunAttentionInput): boolean` and
the minimal structural input type it reads (`outcome`, `dismissedAt`). Docblock
carries § 2(b)'s derive-not-persist paragraph verbatim.
Add `resolveRetryEligibility(run)` beside it (D8) — the single rule the DTO
projection and the endpoint guard both call.
*Acceptance*: unit spec covers all four outcomes × dismissed/not, and every
`RetryRefusalReason` arm.

**1.2 `automation-run.entity.ts`** — add `dismissedAt: Date | null` and
`dismissedByUserId: string | null` as readonly constructor members, appended after
`createdAt` (the only non-shifting position; two call sites). Anemic per ADR-011 —
the derivation is a free function, not a method, because the API projects it and
the FE must not re-derive.

**Record the 13-parameter note IN THE ENTITY**, not only in the analysis doc: 13
positional parameters is at the edge of readable, and **the next member added here
should convert the constructor to an options object as its own change**. The next
author will be working in this file, not in `docs/plans/analysis/`.

**1.3 `automation-run.orm-entity.ts`** — two nullable columns. `dismissedByUserId`
is `uuid`, unindexed, **no FK** (the `packedByUserId` precedent: display +
attribution only, and a deleted user must not destroy or block run history). Add a
partial index `IDX_automation_runs_attention` on `(firedAt)`
`WHERE "outcome" = 'failed' AND "dismissedAt" IS NULL` — the attention read runs on
every page load, the existing `IDX_automation_runs_failed` no longer matches the
predicate once dismissal exists, and the same #2358 reasoning applies (optimise the
query that always runs).

**1.4 Migration `apps/api/src/migrations/1856000000000-add-automation-run-dismissal.ts`**
Two `ADD COLUMN IF NOT EXISTS`, one `CREATE INDEX IF NOT EXISTS`, matching `down()`.
Class suffix repeats the timestamp. **This is the body's one allotted slot.**

**1.5 `automation-run-repository.port.ts` + repository**
- `dismiss(id: string, userId: string, now: Date): Promise<AutomationRun | null>` —
  the D7 conditional UPDATE, returning the row (dismissed by this call or already
  dismissed) or `null` when no such run exists.
- `AutomationRunFilters` gains `attentionOnly?: boolean` (a NARROWING filter, per
  the #2386 contract that an absent field never narrows) → `outcome = 'failed' AND
  "dismissedAt" IS NULL`.
- `countAttention(): Promise<number>` for the summary.
- `toDomain`/`toOrm` carry the two new columns.
*Acceptance*: repository unit spec; an int-spec for the conditional UPDATE
(**disclosed-unverified — Docker wedged**).

**1.5b `retryOfRunId`** — nullable column on `automation_runs` (same migration),
written by the retry service; the `NOT EXISTS` arm lives in the repository and is
shared by `attentionOnly` and `countAttention`.

**1.6 `automation-step-result.types.ts`** — the D3 `report` member + its docblock.

### Phase 2 — CORE: attribution in the two real executors

**2.1 `relay-status-to-source-executor.service.ts`** — the `catch` arm and the
every-target-refused arm populate `report`. `attributedTo` is the connection label
the relay reports (`target.connectionId` where that is all there is); the
OpenLinker-side "relay is not available in this process" arm attributes to
OpenLinker.
**2.2 `send-email-executor.service.ts`** — same treatment for its three failure arms.
**2.3 `automation-dispatch.service.ts`** — the dispatcher's OWN two failure arms
(`:128` unknown action, `:151` executor threw) populate `report`, attributed to
OpenLinker. **Without this the AC's test goes green while the defect survives**: a
test scoped to executors cannot observe a dispatcher-level failure still rendering
an interpolated wrapper.
**2.4 `unavailable-action-executor.service.ts`** — attributes to OpenLinker; the
`unavailableReason` field is unchanged (it answers a different question: *not built
yet* vs *it failed*).
*Acceptance*: a spec asserting the raw message survives into `report.message`
byte-for-byte, with no OpenLinker prefix inside it.

### Phase 3 — Interface: the two write routes

**3.1 `apps/api/src/automation/application/automation-retry.service.ts`**
(+ `.service.interface.ts`). Reads the run by id (`NotFoundException` if absent), then refuses through the SAME
`resolveRetryEligibility` the projection uses (D8) — never a second hand-written
condition — raising a `BadRequestException` carrying the `RetryRefusalReason` so the
client renders the same sentence the disabled button already showed. Loads the rule, loads the order record, builds facts
via `buildOrderAutomationFacts`, and calls
`AUTOMATION_DISPATCH_SERVICE_TOKEN.dispatch({trigger, facts, matchedRules: [rule], now})`.
**The gate is called, never re-derived** — the token resolves to
`AutomationIrreversibleGateService`, so a second `isActive && irreversible` check at
this call site is exactly how #2366's original bypass existed. A1 is documented here.
It does **not** re-evaluate conditions: the rule matched at fire time, and
re-evaluating would re-apply the retroactivity floor and refuse every retry of an
older firing.

**3.2 `automations.controller.ts`** — two routes, both `@Roles('admin')`, both
declared before `@Get(':id')`'s sibling group per the existing ordering comment:
- `POST runs/:runId/retry`
- `POST runs/:runId/dismiss` (takes `@CurrentUser()`)

**3.3 DTOs** — `AutomationRunResponseDto` gains `needsAttention` (the D1
projection), `retryable` + `retryRefusalReason` (D8), `dismissedAt`,
`dismissedByUserId`. `GET runs` gains an
`attentionOnly` query flag; `GET summary` gains an attention count.

*Acceptance*: controller spec covering both routes' refusals and the projection.

### Phase 4 — Frontend: the two surfaces this body owns

**4.1 `features/automation/lib/automation.copy.ts`** — `AUTOMATION_FAILURE_TITLE`
(D2), the attribution line, the `Try again` / "I handled this myself" labels, the
dismissed-state label, and the "nothing else in that automation ran" body sentence.
All literals live here; `check-ui-vocabulary` scans a `*.copy.ts` in full and a
`.tsx` only for JSX text plus an attribute allowlist, so an object literal of labels
in a component is unscanned. The gate is at 32 files and should keep climbing.

**4.2 `features/automation/api/*`** — the two mutations + the `attentionOnly` filter
threaded through the existing schema/query-key layer. `.nullish()`, never
`.optional()` (#939). Both mutations invalidate the run list **and** the summary.

**4.3 `features/automation/lib/automation-failure.ts`** — a small pure module that
turns a run + its failing step into `{title, reason, skippedSummary}` using the copy
table. One source for both renderings.

**4.3b** — with `retryOfRunId` present, both the timeline and the run-log panel
render the retry as a CHAIN ("this is the retry of the failure above") rather than
as two unrelated firings the operator has to correlate by timestamp.

**4.4 `features/orders/lib/automation-timeline.ts`** — the error-toned event uses
the action-specific title and renders `report` when present, falling back to
`detail`. The dismissed state is shown on the event, and **both entries stay**
(D6).

**4.5 `features/automation/components/*` + `pages/automations/automation-activity-page.tsx`**
— both write affordances are gated with `useWriteAccess('automations:write')` +
`ReadOnlyLock` per `frontend-architecture.md § Access Control And UI Visibility`
(never `AccessGate`, never an inline `role` compare). The failed row gains the two actions and the attribution line; an `attentionOnly`
filter chip on the page this body owns (**not** the cross-app attention chip, which
is body C's). A settled-but-failed query is a state, not a silence: the actions are
disabled with a stated reason, never silently absent — and a refused retry renders
its `retryRefusalReason` on the disabled button (D8), never an enabled control that
400s.

*Acceptance*: tests for the copy table's exhaustiveness, the failure projection, the
timeline rendering, and both mutations' invalidation.

---

## 8. Alternatives Considered

**A1 — Persist AF-X on `order_records` as the ninth reason (the issue as written).**
Rejected: § 2(b). The three stated requirements are jointly unsatisfiable on one
level-triggered column, and doing it anyway would be the second of the three
independent writes S2-6 forbids.

**A2 — Add the ninth `AttentionReasonValues` member here and eat the merge.**
Rejected: § 2.3. Two independently-authored operator vocabularies both survive a
textual resolve.

**A3 — `Try again` as a `sync_jobs` job on the `bulk` lane.** Rejected for this
slice: D4. It would touch `JobTypeValues` and the ADR-050 lane partition — shared
files three other bodies are editing — to gain a property T5's inline dispatch does
not have today. Additive later.

**A4 — Resume from the failed step.** Rejected: D5. A second execution model that
can disagree with the first, against a contract that already makes whole-rule
re-run safe.

**A5 — Replace `detail` with `{attribution, rawMessage}` (the ratified wording).**
Deviated from, documented at the site: D3. Replacing it breaks three shipped
renderings and mis-describes the `done` / `nothing-to-do` steps that have no
external reporter.

---

## 9. Validation & Risks

| Check | Verdict |
|---|---|
| Hexagonal layering | ✅ pure rule in domain; composition in `apps/api` for the recorded DI-cycle reason |
| Cross-context imports | ✅ `apps/api` composes `@openlinker/core/automation` + `@openlinker/core/orders` barrels only; no `*RepositoryPort` added to the allow-list |
| Naming | ✅ `*.types.ts` pure-rule exception cited; `*.service.interface.ts` sibling for the new service |
| `as const satisfies` + raw-code fallback | ✅ D2 |
| Idempotency | ✅ retry relies on the executors' own; dismissal is a conditional UPDATE |
| Migration | ✅ one column pair + one index in the body's allotted slot 1856000000000 |
| No `any`, no `console.log` | ✅ |

**Risks**

- **R1 — an inline retry blocks the HTTP request** for the rule's step duration.
  Accepted (D4), bounded by the same executor timeouts T5 already runs under, and
  stated in the route's Swagger description so the operator-facing client can show
  a pending state.
- **R2 — a retry of one of two colliding money rules passes the gate.** Correct and
  intended (A1), because the operator named the rule. Documented at the call site so
  a later reader does not "fix" it into a refusal.
- **R3 — a run whose rule has since been deleted** cannot be retried (`ruleId`
  carries no FK by #2358 design). Handled by D8's `rule-deleted`: the button is
  disabled with copy saying the rule no longer exists, the endpoint refuses
  independently, the run row is untouched, and dismissal still works — an operator
  must be able to clear an alarm about a rule that is gone.
- **R4 — the attention count and the rows must agree.** Both read the same
  `attentionOnly` predicate; the API projects `needsAttention` from the same pure
  rule. A count whose rows explain nothing is #2100's silent-decline defect one
  surface down.
- **R6 — `Try again` can buy a second shipping label the day A2 lands.** D5 rests on
  "executors own their own idempotency", which holds **today only because A1/A2
  resolve to `UnavailableActionExecutorService`** — an irreversible retry fails at
  step 0 and does nothing. Named trigger: `issue-sales-document` will inherit
  #2047's write-path guard, but **`dispatch-shipment` has no documented
  equivalent**, so when that executor lands, a whole-rule retry re-runs a succeeded
  label purchase. A risk with a named trigger is actionable; "executors are
  idempotent" is not.
- **R5 — int-spec contention, not int-spec absence.** Docker is back, so the
  int-specs are run and real results reported. A 900 s timeout while sibling bodies'
  gates run concurrently is Docker contention: `docker container prune -f` and retry
  rather than reporting red.

---

## 10. Testing Strategy

**Unit** — `isAutomationRunAttentionWorthy` (4 outcomes × 2 dismissal states); the
copy table's exhaustiveness and raw-code fallback; the failure projection; both
executors' `report` (raw message unmodified); the retry service's four refusals and
its gate delegation (asserted by spying the dispatch **token**, which is what proves
the gate is called rather than re-derived); the repository's conditional UPDATE
(mocked) and filter composition; controller routes; the FE mutations, timeline
rendering and activity actions.

**Integration** — one int-spec for the dismissal conditional UPDATE (including the
D7 re-dismissal no-op and a concurrent second dismisser losing the race) and the
`attentionOnly` filter, against real Postgres. **Written and RUN** — Docker is back;
real results are reported.

### Acceptance Criteria (this slice)

- [ ] A failed run derives `needsAttention` from one pure rule with no persisted column
- [ ] The title uses the failing action's own verb; a table-driven test covers all six
- [ ] The reason is the operation's own text, attributed, with a test asserting no
      OpenLinker prefix inside `report.message`
- [ ] `Try again` re-runs that rule against that order and nothing else, through the
      same #2362 gate
- [ ] A refused retry is a disabled control with a stated reason AND an independent
      endpoint guard, both from one rule — never an enabled button that 400s
- [ ] `rule-deleted` reads as "no definition left to run", not as a failure, and the
      run row is untouched; dismissal still works
- [ ] Dismissal records a human handled it; the run stays `failed` and both timeline
      entries remain
- [ ] Neither a timer nor a later unrelated success of the same rule clears it
- [ ] The failure is discoverable from `/automations/activity` and the order timeline
      without opening the rule page
- [ ] AC #1 (`AttentionReasonValues`) is knowingly deferred behind PR #2589

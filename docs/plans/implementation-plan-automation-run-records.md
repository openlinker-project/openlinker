# Implementation Plan: automation run records + order-timeline readings (#2385)

**Date**: 2026-08-27
**Status**: Ready for Review
**Estimated Effort**: ~1 day (size M)

---

## 1. Task Summary

**Objective**: land the `automation_runs` **write path**, and make one firing readable from the
order the operator actually starts from — not only from a rule they do not yet suspect.

**Classification**: CORE + Interface (+ a frontend rendering).

---

## 2. Two corrections to the issue's own framing, both verified against the tree

**C1 — This issue is NOT migration-bearing.** The issue says *"migration-bearing — additive; where
the columns are not already there"*. They are all already there: #2358's
`automation-run.orm-entity.ts` ships `id`, `ruleId`, `ruleName`, `trigger`, `subjectKind`,
`subjectId`, `outcome`, **`steps` (jsonb, default `'[]'`)**, `blockedByRuleIds` (jsonb, nullable),
`firedAt`, `createdAt`, plus four indexes — including `IDX_automation_runs_subject`
(`subjectKind, subjectId, firedAt`), which exists for precisely the per-order read this issue
needs. **No migration. Slot `1856000000000` stays unused.**

**C2 — The timeline is a READING, not a second persisted artefact.** The issue opens with *"Two
persisted artefacts, written together"*, but its own acceptance criterion says *"no surface has its
own write path"* and *"a test that mutates the row's outcome changes all four"*. The AC is right and
the prose is loose: **`OrderActivityTimeline` is a frontend component that derives its events from
data already on `OrderRecord`** — there is no timeline table anywhere in the repo. So there is
exactly **one write** (`automation_runs`) and four renderings. Building a second store would create
the divergence §5.6's closing rule exists to prevent.

---

## 3. Decisions

**D1 — `AutomationRunRecord` is persisted AS IT STANDS. Widened, never forked.**
Binding, and not merely preferred: `IAutomationRunRecorderService`'s own docblock says *"#2385
persists this record as it stands; a second record shape is how one firing renders differently in
the run log and the timeline"*. `AutomationRun.steps` is `readonly unknown[]` on the column and
`AutomationStepResult` in the domain — the frontend already parses that shape per step (#2366). No
new step type, no parallel DTO.

**D2 — `skipped-after-failure` is the issue's word; `skipped` is the shipped vocabulary, and the
shipped one wins.** The issue names three step outcomes (`succeeded` / `failed` /
`skipped-after-failure`). `AutomationStepStatusValues` ships `done | nothing-to-do | failed |
skipped`, and `skipped`'s docblock already defines it as *"an EARLIER step failed, so this one never
ran"* — exactly what the issue means. Introducing the issue's literal string would be a second
vocabulary for one concept, persisted in jsonb, with the frontend (#2366) already exhaustive over
the shipped four. The AC ("records the skipped steps as `skipped-after-failure`, **not as absent**")
is satisfied in substance: the steps are recorded and distinguishable. Recorded as a deliberate
deviation.

**D3 — The recorder class is REPLACED; the contract and the filename do not move.**
`LoggingAutomationRunRecorder` becomes `PersistingAutomationRunRecorder` with `persistsRuns = true`,
which is the single switch that flips `recordingAvailable` on `/automations/:id/runs` and retires
#2366's "not recorded in this build" banner. The logging class is **kept and still exported** so a
host that deliberately does not want run history can bind it — but the default binding changes.

**D4 — Best-effort is ALREADY correct and must not regress.** `AutomationDispatchService.record`
already wraps `recorder.record` in a try/catch whose comment states the reason: *"letting it
propagate would turn a completed firing into a job retry that re-runs the steps"*. This slice adds
a persisting implementation behind that seam and changes nothing about the guarantee. A test pins
it, because the guarantee now has a real I/O failure mode behind it for the first time.

**D5 — Firings only.** The recorder is called from exactly one place —
`AutomationDispatchService.dispatch`, over `input.matchedRules`. A rule that evaluated and did not
match never reaches it, so the firings-only AC holds structurally rather than by a filter that
could be forgotten. Pinned by a test.

**D6 — ONE filtered read serves both the activity list and the order timeline.**
`GET /automations/runs?subjectKind=&subjectId=` — `IDX_automation_runs_subject` serves the filtered
form, `IDX_automation_runs_fired_at` the unfiltered one. Not three endpoints, and not a field on
`GET /orders/:id` (every order-detail load would pay for it, and `OrderRecord` is already a large
projection).

The decisive reason is not tidiness: it makes **"one record, four readings" visibly true rather
than merely asserted** — the activity list and the order timeline become the same read with a
filter, which is exactly the property the AC asks a spec to assert. Two endpoints over the same
rows can disagree about them; one cannot. It also keeps every automation read on the automations
controller: a route under `/orders` served from `apps/api/src/automation/` is a surprise, and
hanging it on `OrderController` would give the orders module an automation dependency for a single
read.

**D8 — `blocked` runs are OUT of scope, and the cost is recorded rather than discovered.**
`AutomationDispatchService.record`'s docblock states that `blocked` *"is never produced here — it
is #2362's verdict about rules that never reached dispatch"*, and the recorder is called only from
`dispatch`, over `input.matchedRules`. So **no `blocked` row is written by anything today.**

Wiring it means changing **#2362's contract** — the at-most-one gate refuses rules before dispatch
and reports nothing back — so this issue, which is about a write path, would be editing the gate it
was never scoped to touch. That is the kind of quiet scope drift that makes a gate's behaviour hard
to reason about later.

The cost, stated plainly so no reviewer has to grep for a producer:

- `'blocked'` remains a declared `AutomationRunOutcome` with **no producer**.
- `AutomationRunOrmEntity.blockedByRuleIds` keeps its comment (*"never null, including on
  `blocked`"*) describing a row nothing writes.
- **#2366's fired-log conflict rendering is a rendering with no writer** — dead rather than false,
  which is why it is tolerable: it displays nothing rather than displaying something untrue. The
  S3-3 collision stays visible only through the dry run, which is where #2366 actually surfaces it.

The AC *"Every firing writes exactly one `automation_runs` row"* is therefore met **for firings**,
with the collision case knowingly deferred. Carried on the wave's follow-up list and filed at the
boundary — tracked, not forgotten.

**D7 — One event per STEP, plus the "Skipped" event, derived in one pure function.**
`buildAutomationTimelineEvents` (`features/orders/lib/`) maps runs → `TimelineEvent[]` with the
spec's field mapping verbatim: `by` = `Automation · {ruleName}` linking to the rule, `title` = the
action's past-tense verb, `description` = the step's own `detail` **verbatim**, `footer` =
`Ran because: {trigger operator name}`, `tone` = `error` on a failed step. A failed step
additionally emits one `Skipped: …` event naming what did not run, because a silently missing step
is indistinguishable from one that was never configured.

**The action verbs and trigger names are imported from the `features/automation` BARREL, never
re-declared in `features/orders`** (the `automation` slug is already in both `.eslintrc.js` groups
from #2364). Two reasons, and the second is easy to lose: a second copy would drift from the
composer, and `check-ui-vocabulary` scans `features/automation` and **not** `features/orders`, so
copy declared on the orders side would sit outside the gate entirely — the exact hole #2365 closed,
reopened from the other end.

---

## 4. Implementation Plan

### Phase 1 — core write path
1. `domain/ports/automation-run-repository.port.ts` — add
   **`save(run: NewAutomationRun): Promise<AutomationRun>`** and
   `findRecentBySubject(subjectKind, subjectId, limit)`; keep `findRecentByRuleId`.

   **The parameter is a NEW-run input, never the `AutomationRun` entity, and the method returns
   the persisted entity.** `AutomationRunOrmEntity.id` is `@PrimaryGeneratedColumn('uuid')` and
   `createdAt` is DB-defaulted, but the domain entity's constructor requires both — so
   `save(run: AutomationRun)` would force the recorder to invent two values the database owns, and
   the `createdAt` would be the application's clock standing in for the row's. `save(run)` alone
   reads as "save the entity" to whoever implements it, so the type is named.
2. `infrastructure/persistence/repositories/automation-run.repository.ts` — implement both;
   `steps` persists the `AutomationStepResult[]` verbatim into the existing jsonb column.
3. `application/services/automation-run-recorder.service.ts` — add
   `PersistingAutomationRunRecorder` (`persistsRuns = true`) beside the logging one.
4. `automation.module.ts` — bind the persisting recorder by default.
5. `IAutomationRunsReadService` — add `listRecentBySubject` + `getById`.

### Phase 2 — read endpoints
6. `GET /automations/runs?subjectKind=&subjectId=` (paged, newest first) and
   `GET /automations/runs/:id`. Both `@Roles('admin','operator')`, matching every other automation
   read. **`/automations/runs` is declared BEFORE `/automations/:id`** in the controller, or the
   dynamic route swallows it.
7. Response DTO: reuse `AutomationRunResponseDto` (#2363) unchanged.

### Phase 3 — the order reading
8. `features/automation` — export the run type + labels the timeline needs (already partly there).
9. `features/orders/api` — `automationRuns` read + `useOrderAutomationRunsQuery`.
10. `features/orders/lib/automation-timeline.ts` — the pure `buildAutomationTimelineEvents`.
11. `order-activity-timeline.tsx` — accept `automationRuns` and merge the derived events into the
    existing chronological list.

### Phase 4 — tests
- every firing writes exactly one row, including one whose first step failed
- a multi-step rule that stops records the later steps as `skipped`, not absent
- a rule that did not match writes nothing (D5)
- a repository throw warn-logs and does NOT propagate (D4)
- a renamed rule's existing rows still render the name they fired under
- **one record, four readings**: changing a run's `outcome` changes what the per-rule log, the
  activity list, the per-order read and the derived timeline all report — asserted over one row
- the timeline emits one event per step, in order, plus the `Skipped:` event on a failure

---

## 5. Risks

- **Docker is wedged host-level**, so no integration run is possible. Everything here is unit-
  testable (the repository is mocked at the port), but a **`migration:show` check cannot be run** —
  mitigated by C1: this slice adds no migration, so there is nothing to be pending. Any case that
  genuinely needs Postgres is written, committed and **named unverified**.
- `steps` is jsonb and `readonly unknown[]` on the column. The repository writes
  `AutomationStepResult[]`; the read path re-narrows. That asymmetry is #2358's design, not this
  slice's, and D1 forbids "fixing" it with a second type. **The `steps` mapping is unit-tested
  against a mocked TypeORM `Repository`** — the round-trip through a real jsonb column is the one
  thing genuinely unverifiable while Docker is wedged, and anything needing it is written,
  committed and **named unverified** in the commit body for the wave-level list.

---

## 6. Acceptance Criteria

- [ ] Every firing writes exactly one `automation_runs` row, including a first-step failure
      (`blocked` is knowingly deferred — D8)
- [ ] Opening an order shows a timeline naming the rule, trigger, timestamp and each step's outcome,
      linking to the rule (S3-8)
- [ ] One event per step, in order; a failed step additionally writes the `Skipped: …` event
- [ ] A rule that did not match writes no timeline event
- [ ] One record, four readings — asserted over a single row, no surface with its own write path
- [ ] Stopped steps recorded as `skipped` (D2), never absent
- [ ] A write failure warn-logs and never rolls back the action
- [ ] A renamed rule's history renders the name it fired under
- [ ] **No migration** (C1) — nothing pending by construction
- [ ] `pnpm lint` / `pnpm type-check` / apps/web + core unit suites green

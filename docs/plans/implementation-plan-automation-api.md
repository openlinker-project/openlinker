# Implementation Plan: Automation API — CRUD, non-committing evaluate, fired-log read (#2363)

**Date**: 2026-08-27
**Status**: Ready for Review
**Estimated Effort**: ~1 day

---

## 1. Task Summary

**Objective**: ship the HTTP surface for automation v1 — rule CRUD with the §5.4 legality
matrix enforced server-side, a `vocabulary` endpoint that is the FE's only source of
triggers/actions/conditions, a **provably non-committing** `evaluate` dry run, and the
per-rule fired log.

**Context**: #2358 landed storage, #2359 the pure evaluator + legality matrix, #2360 trigger
emission, #2361 the six action executors, #2362 the at-most-one irreversible gate. Every
piece exists and nothing is reachable by an operator. This is the interface layer over all
of it, and it is also where an operator learns **what they can actually arm** — five of the
six actions cannot run in this build, and presenting them as ready is the silent-decline
defect class this programme keeps closing.

**Classification**: Interface (primary), with two small additive CORE extensions named below.

---

## 2. Scope & Non-Goals

### In Scope
- `GET/POST/PATCH/DELETE /automations` (+ `GET /automations/:id`).
- `GET /automations/vocabulary` — closed vocabularies, both legality tables, and **per-action
  availability with reasons**.
- `POST /automations/evaluate` — dry run against a named order, for a **saved rule or an
  unsaved draft**, returning per-condition traces, the would-fire verdict, and the #2362
  gate's `blocked[]` (with the colliding action kinds). Commits nothing, dispatches nothing.
- `GET /automations/:id/runs` — the fired log, last 50, honest about the fact that #2385 has
  not landed the write path.
- The §5.7 S3-2 money acknowledgement write, and the rule for when it is cleared.
- A global `AutomationExceptionFilter` mapping the eight domain errors.

### Out of Scope
- `GET /automations/activity` (§5.6c global run log) — not in this issue's AC; #2385/#2366.
- Persisting `automation_runs` — #2385 owns the write path. This slice reads only.
- Any FE work (#2364/#2365/#2366).
- A migration. The `moneyAckByUserId` / `moneyAckAt` columns already exist (#2358), the run
  table already exists, and nothing else needs a column. **Slot `1856000000000` is returned
  to the pool unused.**

### Constraints
- `OrdersModule` imports `AutomationModule` (#2360's T5 write-site emission). Anything that
  needs both automation rules and order facts must therefore live in `apps/api`, not in
  `libs/core/src/automation` — a reverse edge there would close a NestJS DI cycle, and ADR-041
  decision 2 records that there is no `forwardRef` anywhere in the tree.
- `AUTOMATION_DISPATCH_SERVICE_TOKEN` resolves to the #2362 **gate**. Nothing in this slice
  resolves it at all — a dry run must not reach a dispatcher, gated or not.

---

## 3. Architecture Mapping

**Target layer**: Interface (`apps/api/src/automation/**`) + two additive CORE seams.

**Existing components reused**
| Component | Use |
|---|---|
| `IAutomationRulesService` (`AUTOMATION_RULES_SERVICE_TOKEN`) | CRUD + the write-path legality/duplicate guards |
| `IAutomationRulesService.listRulesByTrigger` | candidate-rule read for the dry run — see the `/pre-implement` finding below |
| `evaluateAutomationRules` (pure) | the dry run's verdict + traces |
| `gateIrreversibleAutomationActions` (pure) | the dry run's `blocked[]` — binding items 3 & 4 |
| `AUTOMATION_LEGAL_ACTIONS` / `AUTOMATION_LEGAL_CONDITION_FIELDS` | the vocabulary endpoint's matrix |
| `IOrderRecordService.getOrderRecord` | the dry run's subject |
| `AutomationActionExecutorRegistry` | *not* used — availability is a declared table, see below |

**New CORE components (additive, three files + two one-line contract changes)**
1. `libs/core/src/automation/domain/types/automation-action-availability.types.ts` —
   `AUTOMATION_ACTION_AVAILABILITY`, one declared table over `AutomationActionKind` giving
   `{ availability: 'available' | 'partial' | 'unavailable'; reason: string | null }`.
   `UnavailableActionExecutorService` and `SendEmailExecutorService` **read their operator-facing
   copy from it** rather than holding their own literals, so what the API reports and what the
   executor says at fire time cannot drift (the #2229 "reported === enforced structurally" rule).
   `AUTOMATION_UNAVAILABLE_ACTION_REASONS` stays exported, derived from the table.
2. `libs/core/src/automation/domain/ports/automation-run-repository.port.ts` +
   `.../repositories/automation-run.repository.ts` — **read-only** (`findRecentByRuleId`).
   #2385 extends it with writes; the docblock says so. The port is consumed **only inside
   the context**, by a new `IAutomationRunsReadService` — see the `/pre-implement` finding.
3. `IAutomationRulesService` gains:
   - `validateRule(input): AutomationRulePersistInput` — the narrow+hash step with **no
     repository call**, which is what makes the draft dry run structurally non-committing.
   - `setMoneyAck(id, byUserId | null): Promise<AutomationRule>` — the S3-2 write.
   - `updateRule` gains an optional third argument carrying the ack decision.
4. `IAutomationRunsReadService` (`AUTOMATION_RUNS_READ_SERVICE_TOKEN`) — a new core
   application service owning the read-only run port and answering
   `listRecentByRule(ruleId, limit)` + `isRecordingPersisted()`.
5. `IAutomationRunRecorderService` gains a **required** `readonly persistsRuns: boolean`.
   Required, not optional-with-default: an optional field defaulting to `false` would make
   #2385's real recorder report "the run log is not real" unless it remembered to opt in.
   A compile error pointing at #2385 is the right failure direction.

**Core vs Interface justification**: the dry run composes `automation` (rules) with `orders`
(facts). Neither may import the other in that direction, and the `AutomationSubjectFacts`
docblock already states that assembling the facts is the caller's job. `apps/api` is the only
place both are reachable — the same composition `AnalyticsTrustController`'s layer does.

**Facts projection** — `readSnapshotCountry` is currently a private function in
`order-record.service.ts` and the packed-trigger emission is its only caller. It is promoted
to an exported pure projection in `orders`, `buildOrderAutomationFacts(record, occurredAt)`,
with **two** callers: `emitPackedTrigger` and this dry run. That is not tidying — it is what
makes the preview provably use the same facts the real firing would.

---

## 4. Design

### 4.1 Routes and authorization

`JwtAuthGuard` is a global `APP_GUARD` (`auth.module.ts`), so no `@UseGuards` is written;
`@Roles` is the only per-route decision.

| Route | Role | Why |
|---|---|---|
| `GET /automations` (`?trigger=`) | `admin`, `operator` | reading the rule table |
| `GET /automations/vocabulary` | `admin`, `operator` | the composer must load for anyone who can see it |
| `GET /automations/:id` | `admin`, `operator` | |
| `GET /automations/:id/runs` | `admin`, `operator` | diagnosing a firing is operational work |
| `POST /automations/evaluate` | `admin`, `operator` | **commits nothing**; withholding it would leave the operator who has to diagnose a rule unable to test one |
| `POST /automations` | **`admin`** | |
| `PATCH /automations/:id` | **`admin`** | |
| `DELETE /automations/:id` | **`admin`** | |

**Why writes are admin.** Arming an automation is a *standing* grant of authority to act on the
operator's behalf, unbounded in count — one rule can buy a thousand labels. That is an
administrative act, not an operational one, and it is the same class of decision as
`SalesDocumentRulesController`, which is `@Roles('admin')` for the rules that pick a *fiscal
document*. Note the role is uniform across all four writes rather than gated on whether the
particular rule spends money: a rule's actions are editable, so a non-admin who could create a
`send-email` rule could then PATCH it into a `dispatch-shipment` rule, and a permission that a
later edit can escalate is not a permission.

### 4.2 The dry run — `POST /automations/evaluate`

Body is one of two shapes (exactly one of `ruleId` / `rule` — enforced by a DTO-level check):

```
{ orderId: string, ruleId: string }                     // preview a saved rule
{ orderId: string, rule: AutomationRuleDraftDto }       // preview before saving
```

Flow:
1. `IOrderRecordService.getOrderRecord(orderId)` → 404 if absent.
2. `buildOrderAutomationFacts(record, occurredAt = record.placedAt ?? record.createdAt)`.
3. Resolve the **subject rule**:
   - `ruleId` → `getRule(id)`; 404 if absent. Its own `trigger` is the trigger under test.
   - `rule` → `validateRule(draft)` (throws the same eight domain errors the write path does,
     mapped by the same filter — so a draft preview and a save agree about what is legal),
     then construct a **transient** `AutomationRule` with `id = DRAFT_RULE_ID`
     (`'__draft__'`), `createdAt = now`, `isActive` as submitted.
4. Load **every** rule on that trigger (`findByTrigger`) and evaluate the union of them plus
   the subject. Evaluating the subject alone would make a collision invisible, and a collision
   is exactly what §5.6(a) exists to show before the operator arms a money rule.
5. `evaluateAutomationRules({ trigger, facts, rules, now, enforceRetroactivityFloor: false })`.
   The waiver is **always** applied on this path and never anywhere else; each evaluation
   carries `retroactivityFloorWaived`, which the response surfaces per rule so the preview can
   say *"this matches, but it would not have fired for this order — the order predates the
   rule"* rather than silently differing from reality.
6. `gateIrreversibleAutomationActions(matchedRules)` → `dispatchable` / `blocked`. The response
   reports `wouldFire` per rule as `matches && !blocked`, plus `blockedBy.collidingRuleIds` and
   `blockedBy.actions` (**which** irreversible kinds collided — an operator cannot remediate a
   collision they cannot name).
7. Per matched rule, project each step's availability from `AUTOMATION_ACTION_AVAILABILITY`, so
   a green preview never implies a step that cannot run.

**Non-mutation.** Structural, then tested. The service touches exactly three reads
(`getOrderRecord`, `getRule`, `findByTrigger`), two pure functions, and — on the draft path —
`validateRule`, which has no repository reference in its body. An int-spec asserts row counts
in `automation_rules`, `automation_runs`, `automation_trigger_firings` and `sync_jobs` are
unchanged across an `evaluate` that matches a rule with an irreversible action.

### 4.3 The money acknowledgement — and when editing clears it

`CreateAutomationRuleDto` / `UpdateAutomationRuleDto` carry `moneyAcknowledged?: boolean`.

**Required when arming**: if `isActive === true` and any step is irreversible
(`AutomationRule.hasIrreversibleAction()` semantics, via `isIrreversibleAction`), a create or
update without `moneyAcknowledged: true` is refused **400**, naming the irreversible actions.
Stamped from `@CurrentUser().id` — never from the body, the `ReturnActionsController`
precedent.

**Cleared iff the `definitionHash` changes.** The ack is evidence about *what the rule does*,
and the definition already has a canonical identity: the SHA-256 over
`(trigger, triggerConfig, conditions, actions)` that #2358 computes for the duplicate guard.
So:
- rename, arm/disarm, or move the effective window → hash unchanged → **ack survives**;
- change the trigger, the threshold, a condition, or any action → hash changed → **ack cleared**,
  and re-arming requires a fresh one.

Rejected alternatives, and why. *Clear on every edit*: it would make an operator click through a
money warning to fix a typo in a name, which is how a warning stops being read — the alert-fatigue
failure, and the ack's whole value is that somebody actually considered it. *Never clear*: an ack
given for "email me" would silently carry forward to "buy a DPD label", i.e. consent recorded for
an act that was never consented to. The hash is the only line between those two that is neither
ceremony nor a lie, it needs no new state, and it cannot drift because the same value already
decides rule identity everywhere else.

**Write ordering.** Clearing runs **before** the definition update; stamping runs **after** it
succeeds. A crash in between therefore leaves a rule with its **old** definition and **no** ack,
never a new definition carrying an old ack. Nothing in the dispatcher reads the ack — it is an
authoring-time record, not a firing gate — so the failure direction costs one re-acknowledgement
and never a wrong firing.

### 4.4 The fired log — `GET /automations/:id/runs`

The issue's assumption ("merge `sync_jobs` rows with `automation_runs` rows on
`(ruleId, orderId, firedAt)`") is **not implemented, deliberately**, because it is both
unnecessary and unsound:

- The `automation_runs` row is the authority (`AutomationEmissionResult.firedRuleIds` means
  *handed to dispatch*, not *fired*). #2385's contract writes **one row per firing, including
  firings whose step dispatched a job** — `AutomationRun`'s own docblock says so.
- The `sync_jobs` link is a **field inside** a run row's step (`AutomationStepResult.syncJobId`),
  by explicit design in #2358/#2361. There is no column on `sync_jobs` naming a rule, so
  "automation-originated jobs not covered by a run row" is not a set this system can even
  enumerate — a merge key over it would be a join with nothing on the other side.

So: read `automation_runs` (last 50, `firedAt DESC`) and surface each step's `syncJobId` so the
FE links to the existing job detail. One source, no join table, no merge key.

**And it says the log is not real yet.** The response carries `recordingAvailable`, read from
`IAutomationRunRecorderService.persistsRuns` (`false` on the shipped
`LoggingAutomationRunRecorder`, `true` once #2385 lands). Without it, an empty list means
"nothing fired" and "the write path does not exist yet" identically — which is the exact
confusion this programme keeps closing, and the one an operator would resolve by concluding
their rule is broken.

### 4.5 The vocabulary endpoint

Everything the composer needs, from the declared tables, never restated:
`triggers[]` (value, firing mode, whether it takes a config and which key),
`actions[]` (value, `irreversible`, `availability`, `unavailableReason`),
`conditionFields[]`, `amountOps`, `holdReasons`, `legalActions` (the 8×6 matrix),
`legalConditionFields`, `stepBounds`, plus `runOutcomes` / `stepStatuses` /
`nonFiringReasons` / `conditionOutcomes` so #2364/#2366 render copy off the same unions.

**How the five unavailable actions are reported.** `availability` is three-valued because the
truth is three-valued:
- `unavailable` — A1 `issue-sales-document`, A2 `dispatch-shipment`, A5 `place-hold`,
  A6 `release-hold`. Reason strings are #2361's, verbatim, naming the blocking work.
- `partial` — A4 `send-email`. `MAILER_TOKEN` is bound only in `apps/api`, and automation fires
  from the worker for the T4 deadline sweep. So it works for a write-site-fired trigger and does
  not for the swept one. Reporting it as `available` would be false for exactly the trigger the
  §5.4 matrix pairs it with most usefully; reporting it as `unavailable` would be false for T5.
- `available` — A3 `relay-status-to-source` only.

The write path still **accepts** all six (the legality matrix is what governs saving, and #2361
deliberately registers rather than omits the unavailable executors so a firing is loud). The
create/update response therefore also echoes per-step availability, so a composer can warn that a
saved rule cannot do anything in this deployment — never refuse it silently, and never present it
as ready.

---

## 4.6 `/pre-implement` finding (Critical, applied above)

`scripts/check-cross-context-imports.mjs` walks `apps/api/**` — including
`test/integration/**` — and treats **`*RepositoryPort`** as a deny shape: repository ports
are intra-context, and cross-context callers go through `I*Service`. Every existing
`apps/api` case (`UserRepositoryPort`, `RefreshTokenRepositoryPort`, …) sits in the script's
`ALLOW_LIST` as debt tracked by #722, and adding a new entry is both the wrong direction and
an edit to a shared invariant script this body must not make.

So the API layer imports **no repository port at all**:

- candidate rules come from the already-shipped `IAutomationRulesService.listRulesByTrigger`,
  which already returns every rule on the trigger, active and inactive — exactly what the
  evaluator wants, since `rule-inactive` is the only way the dry run can say *"your rule is
  switched off"*;
- run reads go through the new intra-context `IAutomationRunsReadService`, which keeps the
  deny shape where it belongs and gives #2385 a port to extend without touching the API;
- the int-spec asserts row counts via `harness.getDataSource().query(...)`, never by
  importing a port.

Two further findings, resolved rather than deferred: `DRAFT_RULE_ID` never reaches the
database (the draft rule is transient and the gate keys on `id` only for set membership),
and the response marks the subject explicitly rather than making the FE string-match the
sentinel; and A4's availability is trigger-dependent rather than global, which is what the
three-valued `'partial'` exists to say.

---

## 4.7 `/tech-review` outcomes (applied)

Reviewed twice — once against the plan, once against the diff. Six findings, all applied.

**Plan stage.** (1) `GET /automations` had no backing service method: `trigger` is now
a **required** query param (the `SalesDocumentRulesController.listRules` precedent) plus
`GET /automations/summary` over the already-shipped `countRulesByTrigger()`. (2) The write
verb is **`PUT`**, not `PATCH` — `updateRule` takes a complete input and re-validates and
re-hashes all of it, so `PATCH` would invite a partial body that nulls `conditions` /
`actions` through the narrowers. **Both deviate from the issue text; #2364/#2365/#2366 must
be told.** (3) The optional `moneyAck` argument and the required `persistsRuns` field each
state their failure direction in the interface docblock rather than leaving it to be
inferred.

**Diff stage.** (4) The acknowledgement guard now requires a step to be irreversible **and
legal for the trigger** — it runs before the service validates, so without that arm an
armed `return.received` + `dispatch-shipment` rule was refused with *"arming this needs an
acknowledgement"*, hiding the illegal pair behind a consent prompt. (5) The int-spec gained
the one route on which the ack **clear** is observable over HTTP (replace an armed
irreversible rule with a reversible one, which needs no ack) plus the illegal-pair
precedence case. (6) `orderId`'s Swagger annotation was corrected to `@ApiProperty`, and the
`AutomationUnavailableAction` alias — which widened to `string` when its map became derived —
was deleted rather than left as a public type telling a reader nothing.

One downstream test changed as a consequence: #2361's send-email spec asserted its own copy
literal, and now asserts the **declared** reason instead, which is the property that matters
(one source, three consumers) rather than a string a future wording improvement would break.

---

## 5. Files

```
libs/core/src/automation/
  domain/types/automation-action-availability.types.ts        (new)
  domain/types/__tests__/automation-action-availability.spec.ts (new)
  domain/ports/automation-run-repository.port.ts              (new)
  infrastructure/persistence/repositories/automation-run.repository.ts (new)
  application/interfaces/automation-rules.service.interface.ts (edit: validateRule, setMoneyAck)
  application/interfaces/automation-run-recorder.service.interface.ts (edit: persistsRuns)
  application/services/automation-rules.service.ts             (edit)
  application/services/automation-run-recorder.service.ts      (edit: persistsRuns = false)
  application/services/executors/unavailable-action-executor.service.ts (edit: read the table)
  application/services/executors/send-email-executor.service.ts (edit: read the table)
  automation.module.ts / automation.tokens.ts / index.ts       (edit)

libs/core/src/orders/
  domain/order-automation-facts-projection.ts                 (new, pure)
  application/services/order-record.service.ts                (edit: call the projection)
  index.ts                                                     (edit: export it)

apps/api/src/automation/
  automation-api.module.ts
  application/automation-dry-run.service.ts (+ .service.interface.ts, + .spec.ts)
  http/automations.controller.ts (+ .spec.ts)
  http/dto/*.dto.ts
apps/api/src/common/filters/automation-exception.filter.ts
apps/api/src/main.ts, app.module.ts, test/integration/setup.ts (configureApp mirror)
apps/api/test/integration/automation/automation-api.int-spec.ts
```

---

## 6. Error mapping (`AutomationExceptionFilter`, global)

| Error | Status | Body extras |
|---|---|---|
| `AutomationRuleNotFoundError` | 404 | `ruleId` |
| `AutomationRuleConflictError` | 409 | `trigger`, `conflictingRuleId` |
| `AutomationIllegalPairError` | 400 | `trigger`, `action`, `index` — **the AC's "names the pair"** |
| `AutomationIllegalConditionFieldError` | 400 | `trigger`, `field`, `index` |
| `AutomationInvalidConditionError` | 400 | `index` |
| `AutomationInvalidActionError` | 400 | `index` |
| `AutomationInvalidTriggerConfigError` | 400 | `trigger` |
| `AutomationStepCountError` | 400 | `count`, `min`, `max` |

Global, not a controller-local catch, per the `ReturnsExceptionFilter` docblock: a second caller
of the same service must not answer 500 for a state the first one explains. Structured fields
ride alongside the message so a renderer never parses copy.

---

## 7. Testing

**Unit** — `automation-action-availability.spec.ts` (table is total over `AutomationActionValues`;
every non-`available` entry has a reason; the executors' copy comes from the table);
`automation-dry-run.service.spec.ts` (draft path calls no repository write; waiver reported;
collision produces `blocked` with the colliding actions; unknown order → not-found);
`automations.controller.spec.ts` (role decorators; ack required when arming an irreversible rule;
ack cleared on hash change and preserved on rename).

**Integration** — `automation-api.int-spec.ts`, one file, covering the AC verbatim:
1. create → evaluate → runs (the AC's named chain).
2. an illegal pair is **400 naming the pair**.
3. `evaluate` commits nothing: row counts in `automation_rules`, `automation_runs`,
   `automation_trigger_firings`, `sync_jobs` unchanged across a matching evaluate.
4. `vocabulary` returns all 8 triggers, all 6 actions with availability, and the 48-cell matrix.
5. `runs` on a rule with no runs returns `[]` with `recordingAvailable: false`.
6. arming an irreversible rule without the ack is 400; with it, `moneyAckAt` is stamped;
   renaming preserves it; changing an action clears it.

Harness note: `automation_*` and `order_records` are already in `tablesToTruncate`. `loginAsAdmin`
is called **once** per test file (a second call violates the users unique constraint).

---

## 8. Risks

| Risk | Mitigation |
|---|---|
| A later edit passes `enforceRetroactivityFloor: false` on a committing path | It is set in exactly one file, with the reason inline; the evaluator's own docblock calls it a defect elsewhere. |
| The draft path grows a persist | `validateRule` has no repository reference; the int-spec counts rows. |
| The availability table drifts from the registry | The table is the executors' own source of copy; a spec asserts totality over `AutomationActionValues`. |
| #2385 forgets `persistsRuns: true` | Required field ⇒ compile error. |
| `AUTOMATION_DISPATCH_SERVICE_TOKEN` accidentally resolved | Nothing in `apps/api/src/automation` imports it; the module does not inject it. |

---

## 9. Alignment checklist

- [x] Hexagonal — pure domain functions, ports for persistence, composition in the interface layer
- [x] No CORE↔CORE cycle introduced (`automation` gains no sibling edge; the composition is in `apps/api`)
- [x] Existing patterns reused (`ReturnsExceptionFilter`, `SalesDocumentRulesController`, `AnalyticsTrust` composition)
- [x] Idempotency — reads only; the one write path already carries #2358's two-layer guard
- [x] Error handling comprehensive (eight errors, structured fields)
- [x] Testing strategy complete, AC-mapped
- [x] Naming + file structure per engineering-standards
- [x] No migration; slot 1856000000000 unused and returned

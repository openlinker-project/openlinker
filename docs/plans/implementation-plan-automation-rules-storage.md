# Implementation Plan: `automation_rules` + `automation_runs` storage (#2358)

**Date**: 2026-08-26
**Status**: Ready for Review — pre-implement gate **READY** (amendments A1–A6 applied inline)
**Issue**: #2358 (`W2-21`) — OMS Wave 2, body D head
**Estimated Effort**: ~1 day

> **Diff review (2026-08-26)** — `/tech-review` of the implemented diff returned
> **1 BLOCKING, 3 IMPORTANT, 2 SUGGESTION; all applied, none declined.** The
> blocking one was the class this review exists to catch: four `jsonb` columns
> carried a `DEFAULT` in the migration and none on the ORM entity, and because
> the harness builds schema by `synchronize` that divergence failed two of this
> slice's OWN int-spec tests (both omit `steps` from their INSERT). Fixed by
> making the entities declare the same defaults, with the reason recorded in
> the entity docblock. Also: the architecture-overview section was renumbered
> **20 → 23** (Wave 1a/1c had already landed sections 20–22 on this branch,
> so the plan's numbering was stale); the unchecked `trigger` cast in `toDomain`
> now warns through the shared `Logger` rather than coercing silently, as does
> `countRulesByTrigger`'s skip; and `hasIrreversibleAction` gained the spec it
> lacked.
>
> **Pre-implement gate (2026-08-26)** — audited against the live worktree at
> `ebb543cc3`. **Verdict READY**: every proposed artifact confirmed NEW (no
> `automation` identifier, table, token, entity or migration exists anywhere in
> `libs/`, `apps/`, `scripts/`); no contract-surface break; nothing of body D has
> landed on this branch. Six amendments were folded in below and are marked
> **[A1]**…**[A6]** where they apply. The exhaustive sweep confirmed exactly
> **three** hand-maintained registries need a new entry (package exports,
> `CONTEXT_BARRELS`, the api truncation list) — everything else resolves by
> wildcard.

---

## 1. Task Summary

**Objective**: Land the persistence substrate for OMS automation v1 — a new
`libs/core/src/automation/` bounded context owning the closed trigger / action /
condition vocabularies, the rule aggregate with its save-time duplicate guard, and
the tables the rest of body D writes to.

**Context**: Wave-2 spec §5 defines automation v1 as 8 triggers × 6 actions over a
closed legality matrix. The repo already ships a reviewed rule engine —
`sales_document_rules` (#2161/#2170) — and spec §5.5 adopts it as the house pattern
with **three declared divergences**. Inventing a second shape would double the
surface area of "how a rule is stored and evaluated" in one repo.

**Classification**: CORE — Domain + Infrastructure, **migration-bearing**.

---

## 2. Scope & Non-Goals

### In Scope

1. Migration `1851000000000` creating **three** tables: `automation_rules`,
   `automation_runs`, `automation_trigger_firings` (see Q-a).
2. Closed vocabularies (`as const` + union + narrower): 8 triggers, 6 actions,
   4 condition fields, 2 run-subject kinds, 4 run outcomes.
3. `AutomationCondition` discriminated union + `isAutomationCondition` +
   `canonicalizeAutomationDefinition` + `computeAutomationDefinitionHash`.
4. `AutomationAction` discriminated union + `isAutomationAction` (per-action config
   shapes from spec §5.3b — the **shape**, never the executor behaviour).
5. Domain entities (anemic, ADR-011), rule repository port + repository,
   `AutomationRulesService` + `IAutomationRulesService` with the duplicate guard,
   domain errors, tokens, module, barrel.
6. `automation_runs` + `automation_trigger_firings` ORM entities registered for
   schema creation; **no** repository, **no** write path (see Q-f).
7. Registration: `libs/core/package.json` exports, `CONTEXT_BARRELS`,
   `apps/api/src/app.module.ts`, `apps/api/test/integration/setup.ts` truncation
   list, `docs/architecture-overview.md` § Core Bounded Contexts.
8. Tests: unit specs for narrowers / canonicalize / hash / entity / repository /
   service guard; one schema `int-spec`.

### Out of Scope (owned by named siblings — do not build)

| Issue | Owns |
|---|---|
| #2359 | `evaluate-automation-rules.ts` (pure evaluator) + `automation-legality.types.ts` (the §5.4 48-cell matrix) |
| #2360 | Trigger emission for the eight triggers; the **consumer** of `automation_trigger_firings` |
| #2361 | The six action executors |
| #2362 | The at-most-one gate for irreversible actions (A1/A2) |
| #2363 | CRUD / evaluate / fired-log HTTP API |
| #2385 | The `automation_runs` **write path** and the per-step outcome shape |
| #2364/#2365/#2366 | FE index, composer, dry run |

### Constraints

- Migration timestamp **must** be `1851000000000` (pre-allocated; siblings hold
  1849/1850/1852/1853 concurrently).
- Body A (#2338, `order_holds`) is being built in parallel and is **not on this
  branch**. Nothing here may import its code.
- No `any`; no `console.log`; strict TS; `check-service-interfaces.mjs` requires
  every `application/services/*.service.ts` to `implements` an `I*Service` or a
  `*Port`.

---

## 3. Architecture Mapping

**Target layer**: CORE (`libs/core/src/automation/`), full hexagonal cell —
`domain/{entities,types,ports,errors}`, `application/{interfaces,services}`,
`infrastructure/persistence/{entities,repositories}`, plus
`automation.module.ts` / `automation.tokens.ts` / `index.ts`.

**Existing services reused**: none at runtime. The **pattern** reused is
`libs/core/src/sales-documents/` verbatim (see §4).

**Cross-context edges** — exactly one, and it is deliberate:

```
automation ──(value)──> order-lifecycle     [HoldReasonValues / HoldReason / isHoldReason]
```

`order-lifecycle` is a **zero-sibling-edge leaf** (#2305/#2308) with no outbound
core edges, so a value import from it cannot close a CJS module-load cycle.
Restating the eight hold-reason strings locally is exactly the drift that leaf
exists to prevent. `scripts/check-cross-context-imports.mjs` is **deny**-based
(`*RepositoryPort` / `*OrmEntity` / `*Adapter` / `*Dto` / default / namespace
imports) — a named value import of `HoldReasonValues` matches no deny shape.

**Consequences for the barrel-purity spec**:

- `automation` **is** added to `CONTEXT_BARRELS` (AC requirement).
- `automation` is **not** added to `ZERO_SIBLING_EDGE_LEAVES` — it has a real
  sibling value edge, a module, repositories and ORM entities. Claiming leaf status
  would make the spec fail on the very import that is correct.
- `automation` is **not** added to `libs/core/src/index.ts`. Following `returns`
  (#2327, the freshest full-context precedent), a new context stays off the
  aggregating root barrel and is reached at `@openlinker/core/automation`.

**Core vs Integration**: unambiguously CORE. An automation rule is OpenLinker's
own operator-authored policy; no platform adapter has any view of it.

---

## 4. Internal Research — the mirror target

`libs/core/src/sales-documents/` (#2170), the shipped house pattern:

| Concern | Sales-documents file | Automation counterpart |
|---|---|---|
| Condition union + narrower + canonicalize + hash | `domain/types/sales-document-condition.types.ts` (imports only `node:crypto`) | `domain/types/automation-condition.types.ts` + `automation-definition-hash.types.ts` |
| Anemic domain entity, positional readonly ctor | `domain/entities/sales-document-rule.entity.ts` | `domain/entities/automation-rule.entity.ts` |
| Minimal repository port | `domain/ports/sales-document-rule-repository.port.ts` | `domain/ports/automation-rule-repository.port.ts` |
| Repository: private `toDomain`/`toOrm`, PG `23505` → domain error | `.../repositories/sales-document-rule.repository.ts` | `.../repositories/automation-rule.repository.ts` |
| Service: assert-well-formed → hash → assert-no-conflict → create | `application/services/sales-document-rules.service.ts` | `application/services/automation-rules.service.ts` |
| Symbols-only tokens file, `export *` from barrel | `sales-documents.tokens.ts` | `automation.tokens.ts` |
| `TypeOrmModule.forFeature` + `useExisting` token bindings | `sales-documents.module.ts` | `automation.module.ts` |

Two helpers copied verbatim in intent:

- `canonicalize*` — sort members by discriminant, sort each member's keys, then
  `JSON.stringify`. Deterministic regardless of authoring order.
- `rangesOverlap(aFrom, aTo, bFrom, bTo)` with open-ended `to` treated as
  `new Date(8640000000000000)`.

**Freshest conventions (Wave 1a/1c) that override #2170's older ones**:

- Migration column identifiers are **camelCase, quoted** (`"createdAt"`), not
  snake_case. Types: `text` / `character varying(64)` / `jsonb` /
  `TIMESTAMP WITH TIME ZONE` / `boolean`.
- Vocabulary columns are plain `varchar(64)` with **no PG enum and no CHECK**;
  coerced on read by an `is<X>` narrower.
- Specs live in `__tests__/` subfolders; domain errors are named `*.error.ts`.
- A new table ships a schema int-spec (precedent:
  `apps/api/test/integration/order-changes-schema.int-spec.ts`).
- A core module is registered in `apps/api/src/app.module.ts` with an inline
  `// #NNNN:` comment even before an API surface exists.
- No FK to a table outside the context ⇒ an explicit entry in
  `apps/api/test/integration/setup.ts`'s truncation list.

---

## 5. Questions & Assumptions — settled

Each of the seven open questions is answered with its reasoning, so a later reader
sees the choice as decided rather than accidental.

### Q-a — Does `automation_trigger_firings` ship in this migration? **YES.**

Spec §7 boundary item 2 names it alongside the other two as part of one storage
proposal. Three arguments, one of them decisive:

1. **Decisive — the retention policies are incompatible, so it cannot be folded
   into `automation_runs`.** §5.6 keeps runs for **90 days**; §5.2 requires the
   deadline-sweep guarantee to hold **"at most once per (rule, order), ever"**. A
   table that is pruned quarterly cannot enforce a forever-guarantee: on day 91 the
   sweep re-fires for every pair it already handled. On a T4 rule wired to A2 that
   is a second label, bought with real money, for an order that already shipped.
2. **A run row is not a firing record.** Runs are written for `blocked` and
   `failed` outcomes too (§5.6) — a `blocked` run means *nothing fired*. Reusing
   runs as the dedup key would permanently suppress a pair on which nothing ever
   happened.
3. **Migration-slot economics.** #2360 (the consumer) holds no pre-allocated
   timestamp, and four sibling agents hold the adjacent slots concurrently. Landing
   the table in the slot this issue *does* hold removes a mid-wave collision.

The orchestrating constraint points the same way: *"prefer at-most-once semantics
enforced by a durable conditional write over a best-effort in-memory guard."* The
durable write is `INSERT … ON CONFLICT DO NOTHING` against
`UQ_automation_trigger_firings_rule_subject`; #2360 owns that call.

Accepted cost: two of three tables land without a consumer on this branch. The AC
already accepts that for `automation_runs`; the third is the same trade with a
stronger safety argument.

### Q-b — Do the S3-2 money-acknowledgement columns ship now? **YES.**

Spec §5.7 S3-2: *"the acknowledgement is recorded on the rule (who, when) and shown
on the rule row until the rule's first successful firing."* That is two nullable
rule-scoped columns, `moneyAckByUserId` + `moneyAckAt`, written by #2363. Landing
them now costs two nullable columns; deferring costs a migration slot nobody holds.

**[A4]** `moneyAckByUserId` is **not** an FK to `users`: deleting a user must never
cascade away an operator's automation, and the column is evidence of a past act, not
a live reference. The gate pinned the exact `packedByUserId` (#2287) declaration to
copy — plain nullable `uuid`, **no FK**, **unindexed**
(`order-record.orm-entity.ts:320-327`, migration `1842000000000:41-43`):

```ts
@Column({ type: 'uuid', nullable: true })
moneyAckByUserId!: string | null;
```

with that precedent's reasoning restated in the docblock: *display + attribution
only, never filtered on; a dangling id from a deleted user is the honest outcome for
an audit fact.*

*Not* shipped: a `firstFiredAt` column. "Until the rule's first successful firing"
is derivable from `automation_runs`; a denormalised copy is a second writer to the
same fact.

### Q-c — Where do trigger parameters live? **A separate `triggerConfig jsonb`.**

The §5.2 parameter column mixes two different things, and they belong in two
different places:

- **T1 / T2 / T7's "reason (any / specific)" / "disposition"** are assertions about
  the *subject*, and are already expressible in the condition vocabulary
  (`holdReason eq …`). Do not duplicate them.
- **T3's "N hours/days" and T4's "X hours before"** are assertions about *the
  trigger's own window*. They are not facts about an order — there is no
  `holdAgeHours` field on anything OL persists — so modelling them as conditions
  would make the condition vocabulary lie about what a condition is.

`trigger` stays a real `varchar(64)` column (it is the index/query axis, exactly as
`country` is in #2170, and the §5.5 divergence-1 scope axis). `triggerConfig` is a
`jsonb` narrowed per trigger, `{}` for the six parameterless triggers.

### Q-d — What is the duplicate-guard key? **One combined `definitionHash`, over `(trigger, triggerConfig, conditions, actions)`; unique index `(trigger, definitionHash, effectiveFrom)`.**

The AC says "rejects an identical trigger+conditions+actions rule". #2170 splits
scope-as-column from `conditionsHash` because scope is the *query* axis; the same
split applies here with `trigger` as the column. Everything else that constitutes
sameness — including `triggerConfig`, since two rules differing only in threshold
are genuinely different rules — goes into **one** hash. Two hash columns would
require two indexes and invite a reader to believe they mean different things.

This is a **declared divergence** from #2170's `conditionsHash`: there, the outcome
is a single `(documentKind, connectionId)` pair not part of rule identity; here the
action list *is* part of identity.

The guard is two layers, mirroring #2170 exactly:

- **Service (semantic)** — `findByTriggerAndDefinitionHash`, then reject any
  candidate whose effective range **overlaps** (`rangesOverlap`, open-ended = +inf).
  This is what catches "same rule, different `effectiveFrom`, overlapping window".
- **Repository (exact)** — PG `23505` on the named unique index translated to the
  same `AutomationRuleConflictError`, so a race is a domain error, not a raw 500.

Explicitly *not* transactional/locked — same posture as #2170, and the DB index is
the last line.

**[TR-4] This guard is NOT the money-collision guard, and must say so.** §5.5
divergence 3 places the #2047 at-most-one rule at **runtime** (#2362), and says the
save-time guard only *"warns at authoring time where it can see the overlap; the
runtime guard is the authority."* This guard catches **identical** definitions. Two
rules with the same trigger and the same A2 action but **different conditions**,
both matching one order, is the actual S3-3 scenario and passes it cleanly. Without
that sentence in the service docblock, a reader concludes S3-3 is already handled.

Note also what the guard's shape means, and why it differs from #2170's. #2170 skips
candidates on the SAME `connectionId` and conflicts only ACROSS connections, because
its conflict is *ambiguity between routes*. Automation has no connection axis on a
rule, so any overlapping identical definition is pure *duplication* and conflicting
on all of them is correct. It forbids nothing legitimate: two identical rules with
**non-overlapping** effective windows still save, which is the versioning case.

### Q-e — How does a run identify its subject? **`(subjectKind, subjectId)`.**

T6/T7 fire on returns, T1–T5/T8 on orders, and §5.6's run-log column is literally
`Order / Return`. A nullable `orderId` + nullable `returnId` pair admits rows with
both set or neither, and a third subject kind later means a third column.
`subjectKind` is a closed `varchar(64)` (`'order' | 'return'`) with a narrower;
`subjectId` is `text` (OL internal ids are `ol_*` text, not uuid). No FK in either
direction — the `order_changes` (#2333) precedent — which is why the truncation-list
entry in the int harness is mandatory rather than optional.

### Q-f — Does the 90-day retention sweep ship here? **NO.**

Retention is a scheduler task plus a delete path — behaviour, not storage. #2385
owns the write path; the sweep is named in no body-D issue I can see. This plan
lands only what makes retention possible (`firedAt` + its index) and **flags the
sweep as an unowned follow-up the orchestrator must place** (§8, Risks).

### Q-g — Is currency mismatch a storage concern? **NO — but the amount's representation is.**

§5.5 divergence 2 (*"no conversion, ever — the rule simply does not match"*) is the
evaluator's rule, #2359's. Storage's one obligation is to persist the operator's
amount **faithfully**, and that has a real consequence: JSON numbers are IEEE
doubles, so the inline amount is stored **as a decimal string** inside the jsonb,
and the narrower requires `typeof amount === 'string'` matching `^\d+(\.\d{1,2})?$`.

**[TR-6] The argument is local, and deliberately does NOT cite ADR-040.** The
conclusion is right but the FX precedent is the wrong one to reach for here — spec
§5.5 explicitly warns that *"the ADR-040 FX stamp is analytics-only and must not be
reached for"*, so citing it in an automation storage decision invites the next
reader to think this path sits somewhere near the fiscal one. It does not.

The honest reason is smaller and stronger: **the narrower has to validate the value
anyway**, and a string lets it check a bounded 2-decimal shape that a JSON number
cannot express. It is a **declared divergence** from
`SalesDocumentThresholdFact.amount: number` and it is free — order-total magnitudes
compare exactly at 2dp whichever way #2359 chooses to do the comparison.

### Assumptions

- The trigger / action / condition vocabularies are closed and versioned with the
  code; there is no operator-extensible vocabulary in v1 (issue's own assumption).
- `HoldReason` (already on this branch, `order-lifecycle`) is the **only** source of
  hold-reason values, per spec §5.3b A5: *"The composer cannot add a reason."*
- A rule's action list has **1..3** steps. Zero is a rule that does nothing and is
  rejected; 3 is the §5.5 cap.

### Deliberate non-decision: **no new ADR.**

The guide asks for an ADR when a choice has non-trivial trade-offs and a seriously
considered alternative. The three divergences already have a design of record
(spec §5.5) that the epic names as binding, and the AC requires them restated in
the entity docblock. A fourth restatement (spec + docblock + architecture-overview +
ADR) is drift surface, not documentation. The Q-a/Q-d/Q-g decisions above are
recorded in the docblock and in the architecture-overview entry instead. Flagged
here so `/tech-review` can overrule it rather than discover it.

---

## 6. Proposed Implementation Plan

### Phase 0 — Preconditions

`pnpm install` and `pnpm -r --filter "./libs/**" build` in the worktree (done).
Confirm the migration tail is 1848 and 1851 is free.

### Phase 1 — Domain vocabulary (pure, no framework)

All files under `libs/core/src/automation/domain/types/`, each with a file header
per engineering-standards § File Headers. All exercise the `*.types.ts` **pure-rule
exception** (#2231): pure, no I/O, and each function *is* the rule for the type it
sits with.

1. **`automation-trigger.types.ts`**
   - `AutomationTriggerValues` (8, spec §5.2): `order.hold.placed`,
     `order.hold.released`, `order.on_hold_for`, `order.dispatch_deadline_near`,
     `order.packed`, `return.received`, `return.disposed`,
     `inventory.reservation_shortfall`.
   - `AutomationTrigger`, `isAutomationTrigger`.
   - `AutomationTriggerFiringMode` (`'edge' | 'deadline-sweep'`) +
     `AUTOMATION_TRIGGER_FIRING_MODE` map. The mode is what tells #2360 which
     triggers must consult `automation_trigger_firings`; a `satisfies
     Record<AutomationTrigger, …>` makes a new trigger a compile error until
     classified.
   - **Acceptance**: spec asserts all 8 values, mode map exhaustive, narrower
     rejects unknowns without throwing.

2. **`automation-trigger-config.types.ts`**
   - `AutomationTriggerConfig` — a discriminated-by-trigger union; `{}` for the six
     parameterless triggers, `{ withinHours: number }` for `order.on_hold_for`,
     `{ hoursBefore: number }` for `order.dispatch_deadline_near`.
   - `isAutomationTriggerConfig(trigger, value)` — takes the trigger so the check is
     exact; positive integers only, malformed → `false`, never throws.

3. **`automation-condition.types.ts`** (mirrors
   `sales-document-condition.types.ts`)
   - `AutomationConditionFieldValues = ['sourceConnection','orderCountry','orderTotalGross','holdReason']`.
   - ```ts
     export type AutomationCondition =
       | { readonly field: 'sourceConnection'; readonly op: 'eq'; readonly value: string }
       | { readonly field: 'orderCountry'; readonly op: 'eq'; readonly value: string }
       | { readonly field: 'orderTotalGross'; readonly op: AutomationAmountComparisonOp;
           readonly amount: string; readonly currency: string }
       | { readonly field: 'holdReason'; readonly op: 'eq'; readonly value: HoldReason };
     ```
   - `AutomationAmountComparisonOpValues = ['gte','lt']`.
   - `isAutomationCondition` — malformed ⇒ `false` (**never matches**), never
     throws. `holdReason` delegates to `isHoldReason`. `orderTotalGross` requires a
     2dp decimal **string** (Q-g) and a 3-letter currency.
   - **Acceptance**: a persisted row with `field:'holdReason', value:'nonsense'` is
     narrowed away rather than crashing a read.

4. **`automation-action.types.ts`**
   - `AutomationActionValues` (6, spec §5.3): `issue-sales-document`,
     `dispatch-shipment`, `relay-status-to-source`, `send-email`, `place-hold`,
     `release-hold`.
   - `AutomationAction` — discriminated union on `action`, per-action config from
     spec §5.3b:

     | Action | Config |
     |---|---|
     | `issue-sales-document` | `{}` (§5.3b: deliberately no parameters) |
     | `dispatch-shipment` | `{ carrierId: string; serviceId: string \| null; packagePresetId: string \| null; cashOnDelivery: boolean }` |
     | `relay-status-to-source` | `{}` |
     | `send-email` | `{ recipient: {kind:'buyer'} \| {kind:'address'; address:string}; subject: string; body: string }` |
     | `place-hold` | `{ reason: HoldReason; note: string }` |
     | `release-hold` | `{ holdReason: HoldReason \| null; note: string }` (`null` = "any hold") |

   - `isAutomationAction`, `AUTOMATION_ACTION_IS_IRREVERSIBLE` (A1/A2 `true`,
     rest `false` — spec §5.5 divergence 3), `AUTOMATION_ACTION_MAX_STEPS = 3`.
   - The irreversibility map lives here because it is a property **of the action**;
     #2362 consumes it and must not restate it.
   - **Note the seam**: `place-hold` / `release-hold` configs name a `HoldReason`
     but invoke nothing — the `order_holds` write is body A (#2338) + #2361. This
     file compiles with zero dependency on body A's code.

5. **`automation-definition-hash.types.ts`**
   - `AutomationRuleDefinition = { trigger; triggerConfig; conditions; actions }`.
   - `canonicalizeAutomationDefinition(def): string` — conditions sorted by `field`,
     actions kept **in order** (order is semantic: "run in order, stop on first
     failure"), every object's keys sorted, `JSON.stringify`.
   - `computeAutomationDefinitionHash(def): string` — `sha256` hex, `node:crypto`
     only.
   - **Acceptance**: reordering conditions yields an identical hash; reordering
     actions yields a **different** one.

6. **`automation-run.types.ts`**
   - `AutomationRunSubjectKindValues = ['order','return']` + narrower.
   - `AutomationRunOutcomeValues = ['done','failed','nothing-to-do','blocked']`
     (spec §5.6, closed) + narrower.
   - The per-**step** outcome shape is **#2385's** and is deliberately absent; the
     `steps` column is `jsonb` and this file says so.
   - **[TR-7] State where the `sync_jobs` link lives.** §5.6 requires a run row to
     link to the `sync_jobs` row where a step dispatched a job. It belongs INSIDE the
     per-step `steps` jsonb and therefore needs no column — correct, but exactly the
     kind of thing #2385 will re-derive under time pressure and possibly resolve by
     adding one. One line in this file's docblock closes it.

### Phase 2 — Domain entities, ports, errors

7. **`domain/entities/automation-rule.entity.ts`** — anemic, positional readonly
   ctor (ADR-011): `id, name, trigger, triggerConfig, conditions, actions,
   definitionHash, isActive, effectiveFrom, effectiveTo, moneyAckByUserId,
   moneyAckAt, createdAt, updatedAt`.
   **This is where the AC's "three divergences from #2161" docblock lives**, plus
   the Q-d and Q-g divergences.
8. **`domain/entities/automation-run.entity.ts`** — `id, ruleId, ruleName, trigger,
   subjectKind, subjectId, outcome, steps, blockedByRuleIds, firedAt, createdAt`.

   **`blockedByRuleIds` is the #2362 seam and is why this column exists now.**
   §5.6 defines the outcome vocabulary as *"`Blocked` is the #2047 two-money-rules
   case — nothing ran, and **the row says which rules collided**"*, and S3-3 plus the
   §9 ship gate both require the row to name **both** rules. A single `ruleId` can
   name one. It is populated **only** for `outcome = 'blocked'` and is `NULL`
   otherwise; `ruleId` stays NOT NULL on every row and means *the rule whose
   evaluation raised the collision*, never *the rule that acted* (on a blocked row
   nothing acted). A nullable `ruleId` was rejected: a nullable discriminator invites
   a second reading of what a run row is.

   Landed here rather than with #2362 because **#2362 holds no migration timestamp**
   and four sibling agents hold the adjacent slots concurrently.
9. **`domain/entities/automation-trigger-firing.entity.ts`** — `id, ruleId,
   subjectKind, subjectId, firedAt`. Docblock carries the Q-a
   retention-incompatibility argument.
10. **`domain/ports/automation-rule-repository.port.ts`** — minimal, only what the
    service needs: `findById`, `findByTrigger`, `findByTriggerAndDefinitionHash`,
    `listActive`, `create`, `update`, `delete`, `countRulesByTrigger`.
11. **`domain/errors/`** (`*.error.ts`, the `returns` convention):
    `AutomationRuleConflictError`, `AutomationRuleNotFoundError`,
    `AutomationInvalidConditionError`, `AutomationInvalidActionError`,
    `AutomationInvalidTriggerConfigError`, `AutomationStepCountError`.

### Phase 3 — Infrastructure

12. **`infrastructure/persistence/entities/automation-rule.orm-entity.ts`**
    ```ts
    @Entity('automation_rules')
    @Index('UQ_automation_rules_trigger_hash_from',
           ['trigger', 'definitionHash', 'effectiveFrom'], { unique: true })
    @Index('IDX_automation_rules_trigger_active', ['trigger', 'isActive'])
    ```
    Columns quoted camelCase; `trigger` `varchar(64)`; `triggerConfig` / `conditions`
    / `actions` `jsonb`; `definitionHash` `varchar(64)`; `isActive` `boolean NOT NULL
    DEFAULT false`; `effectiveFrom` `date`, `effectiveTo` `date` nullable;
    `moneyAckByUserId` `uuid` nullable, `moneyAckAt` `timestamptz` nullable;
    `createdAt`/`updatedAt` `timestamptz`.

    **[TR-8] `createdAt` is BEHAVIOURAL, not an audit timestamp.** S3-9 (*"a rule
    created today acts only on facts that occur after it was saved"*) is implemented
    by the deadline sweep comparing against this column, so it is an input to whether
    a rule fires. Mark it as such in the docblock, or a future "we don't need
    createdAt on this table" cleanup silently deletes the retroactivity guarantee and
    a new T3 rule buys labels for a 40-order backlog.

    **[TR-5] `isActive` defaults `false` — fail closed, but say accurately what
    that buys.** A column default only fires when the column is OMITTED from the
    INSERT, and the repository's `toOrm` always carries a boolean, so in practice it
    never applies. It is belt-and-braces for a row arriving by any other path, not
    the safety mechanism. **The service is the real enforcement point**: an
    unspecified `isActive` on `AutomationRuleInput` resolves to `false` there. Do not
    document the DB default as the guarantee — that is the kind of sentence that gets
    believed later.

    **[A2] `trigger` as a column name has ZERO precedent in this repo** — the gate
    grepped every `*.orm-entity.ts` and every migration and found none, quoted or
    unquoted. `TRIGGER` is *non-reserved* in Postgres and legal as a column name,
    and TypeORM emits quoted identifiers regardless, so it works. **Decision: keep
    `trigger`** — it is the spec §7.2 column name and the operator's own word. The
    entity docblock must state the quoting requirement, because #2385/#2386 will
    write raw SQL for the run log and an unquoted `trigger` there fails at runtime
    rather than at compile time. *This is the single item most worth `/tech-review`
    consciously ratifying or overturning; the alternative is `triggerKind`, matching
    the `document_kind` discriminator in the very engine being mirrored, at the cost
    of diverging from the spec's named column.*

13. **`automation-run.orm-entity.ts`** — `@Index('IDX_automation_runs_fired_at',
    ['firedAt'])` (retention sweep + the §5.6 default sort),
    `@Index('IDX_automation_runs_rule_id', ['ruleId'])` (per-rule log),
    `@Index('IDX_automation_runs_subject', ['subjectKind','subjectId'])` (the
    order-timeline read), and — **[TR-2]** —
    `@Index('IDX_automation_runs_failed', ['firedAt'], { where: `"outcome" = 'failed'` })`.

    **Why a PARTIAL `failed` index rather than a composite `("outcome","firedAt")`.**
    Both were considered; the partial one is chosen because the two readers have very
    different cost profiles. The `/automations/activity` `outcome` filter is an
    operator-initiated, paged, already-`firedAt`-sorted browse — the existing
    `firedAt` index serves it acceptably. The **AF-X attention count** is not: §4.3
    makes a failed run attention-worthy, so it is counted and badged on every page
    load, on installs where the healthy answer is zero. #2100's lesson is precisely
    that the attention count runs constantly on healthy installs and must be cheap
    there. A partial index is near-empty on a healthy install, so the count is a
    scan of nothing; a composite index pays for every routine `done` row to make an
    operator's occasional filter marginally faster. Optimise the query that always
    runs, not the one a human triggers.

    **[A3] Carries a frozen `ruleName`, and no FK to `automation_rules`.** §5.6
    renders the rule's name on every run row and S3-6 requires a *deactivated* rule
    to keep its log — but rules are also deletable. An FK forces a bad choice:
    `CASCADE` destroys history, `RESTRICT` blocks the delete, and without a name on
    the row an orphaned run renders as a dangling id. Freezing the name at write
    time is the same attribution-freeze the programme already applies to source
    attribution (#2282) and `packedByUserId`, and it makes the run log honest about
    *history* rather than about the current rule table.

    Same reasoning, no FK, for `automation_trigger_firings` — and no cleanup concern
    there, since a re-created rule gets a fresh uuid, so old firings are inert.
14. **`automation-trigger-firing.orm-entity.ts`** —
    `@Index('UQ_automation_trigger_firings_rule_subject',
    ['ruleId','subjectKind','subjectId'], { unique: true })`. **This index is the
    at-most-once guarantee**; #2360's insert conflicts on it.

    **[TR-3] The key deliberately EXCLUDES `definitionHash`, and that is an
    invariant, not an oversight.** §5.2: *"A rule edited to a shorter threshold may
    fire for orders that already passed the old one; a rule edited to a longer one
    never un-fires. **Editing a rule does not erase its firing record.**"* Keying on
    `ruleId` alone makes the record survive edits, which is exactly what that
    sentence requires. The obvious "improvement" a later reader will propose — add
    the hash so an edited rule re-evaluates — would silently **re-arm every T3/T4
    rule against its entire backlog on the next edit**, buying a label per order.
    State this in the entity docblock with the consequence named.
15. **`.../repositories/automation-rule.repository.ts`** — private
    `toDomain`/`toOrm`; `toDomain` filters `conditions`/`actions` through the
    narrowers (malformed member dropped, never thrown); `create`/`update` translate
    PG `23505` on `UQ_automation_rules_trigger_hash_from` into
    `AutomationRuleConflictError`. `date` columns are `string` in TS with a
    module-level `toDateOnly` helper, as in #2170.

### Phase 4 — Application

16. **`application/interfaces/automation-rules.service.interface.ts`** —
    `IAutomationRulesService`.
17. **`application/services/automation-rules.service.ts`** — `implements
    IAutomationRulesService`. `createRule` order, mirroring #2170:
    `assertTriggerConfigWellFormed` → `assertConditionsWellFormed` →
    `assertActionsWellFormed` (1..3 steps, each narrows) →
    `computeAutomationDefinitionHash` → `assertNoConflict` → `repository.create`.
    `updateRule` re-runs the same chain excluding the row itself.
    Module-level `rangesOverlap` helper (open-ended = `new Date(8640000000000000)`).
18. **`application/types/automation-rule-write.types.ts`** —
    `AutomationRuleInput`.

### Phase 5 — Wiring

19. `automation.tokens.ts` — Symbols only:
    `AUTOMATION_RULE_REPOSITORY_TOKEN`, `AUTOMATION_RULES_SERVICE_TOKEN`.
20. `automation.module.ts` — `TypeOrmModule.forFeature([all three ORM entities])`
    (registering the two write-path-less entities is what makes `autoLoadEntities`
    create their tables in the int harness), repository + `useExisting` bindings,
    service + `useExisting`, `exports` the two tokens.
21. `index.ts` — barrel: types, entities, port, errors, service interface (`export
    type`), module, `export * from './automation.tokens'`.
22. `libs/core/package.json` `exports` — add `"./automation"` (types/require/default
    → `./dist/automation/index.*`). The map is **append-order, not alphabetical** —
    append at the end, next to `catalog-trust`. **No `orm-entities` sub-barrel** —
    nothing outside the context needs the entities (the `sales-documents` posture).
    No change to `files` (`["dist"]`, directory-agnostic), `typesVersions` (absent),
    `libs/core/tsconfig.json` (`include: ["src/**/*"]`), `tsconfig.base.json` (the
    `@openlinker/core/*` wildcard covers it), or any of the seven jest
    `moduleNameMapper`s (all `^@openlinker/core/(.*)$`).
23. `libs/core/src/__tests__/barrel-purity.spec.ts` — add `'automation'` to
    `CONTEXT_BARRELS`, **alphabetically first** (that array *is* alphabetical, unlike
    the exports map). **Not** to `ZERO_SIBLING_EDGE_LEAVES` — verified to match the
    `returns` precedent exactly (`returns` is in `CONTEXT_BARRELS` only, absent from
    both the leaves list and the root barrel), and the root-barrel absence test
    iterates `ZERO_SIBLING_EDGE_LEAVES`, so a context in neither list is untouched
    by it.
24. **[A6]** `apps/api/src/app.module.ts` — import `AutomationModule` from
    `@openlinker/core/automation`, placed immediately after
    `IdentifierMappingModule` / before `CustomersModule`, with a **leading block
    comment** (not a trailing inline one), mirroring `ReturnsModule` verbatim:
    `// #2358: registers the automation ORM entities + rule repository. No API`
    `// surface yet (#2363) — imported so the provider graph is proven at boot.`
    **No worker registration in this slice.** Note for #2360/#2361: the worker
    registers core context modules in `apps/worker/src/sync/sync-worker.module.ts`,
    not in a worker `app.module.ts`.
25. **[A5]** `apps/api/test/integration/setup.ts` — add `automation_runs`,
    `automation_trigger_firings`, `automation_rules` to `tablesToTruncate`
    **mid-list, grouped by domain** (the shape `returns`/`order_changes` used —
    inserted after `refund_records`, not appended), each preceded by a comment
    naming the issue and *why* the table falls outside the `CASCADE` closure (no FK
    to anything outside the context, so the closure walk never reaches them).
    **`apps/worker/test/integration/setup.ts` needs no change** — it keeps its own
    shorter imperative `TRUNCATE` list, and the `returns` tables were deliberately
    not added there despite worker returns int-specs existing. This slice ships no
    worker int-spec.

### Phase 6 — Migration

26. Run `pnpm --filter @openlinker/api migration:generate -- src/migrations/CreateAutomationTables`,
    then **re-prefix filename and class suffix to `1851000000000`** per
    `docs/migrations.md` rule 3. Review the generated SQL by hand and rewrite it to
    the Wave-1c narrative shape: `CREATE TABLE IF NOT EXISTS`, quoted camelCase
    identifiers, `CREATE UNIQUE INDEX IF NOT EXISTS`, a docblock naming the
    synthetic prefix and stating which choices are contract rather than
    housekeeping. `down()` drops indexes then tables in reverse.
27. **No CHECK constraint on `jsonb_array_length(actions) <= 3`**, and no PG enum on
    any vocabulary column. The integration harness builds schema via TypeORM
    `synchronize`, which emits neither — a constraint present only in the migration
    would make the migration schema and the tested schema diverge, so the cap would
    hold in production and silently not in tests. The cap is enforced in the service
    (`AutomationStepCountError`); the schema int-spec asserts only what
    `synchronize` and the migration both produce.
28. `pnpm --filter @openlinker/api migration:show` to confirm ordering.

### Phase 7 — Tests

29. Unit specs (`__tests__/` subfolders) for: every narrower (including the
    malformed-persisted-row path), canonicalize/hash ordering semantics, the three
    entities, the repository's `toDomain` filtering + `23505` translation, and the
    service's guard chain (each error class, the overlap guard, the 1..3 cap).
30. **[A1]** `apps/api/test/integration/automation-schema.int-spec.ts` — modelled on
    `order-changes-schema.int-spec.ts`, whose actual shape the gate corrected: it
    carries **no `pg_indexes` introspection at all**. It uses exactly one
    introspection query — `SELECT column_name FROM information_schema.columns WHERE
    table_name = … ORDER BY column_name`, asserted against a literal column list —
    and proves its unique index **behaviourally**, by catching the violation and
    matching the constraint name (`expect(error?.message).toContain('UQ_…')`).

    Copy that shape: one column-set assertion per table, plus a duplicate insert
    into `automation_trigger_firings` caught and matched against
    `UQ_automation_trigger_firings_rule_subject`. This is the better test for the
    property that matters — it proves the index **rejects**, not merely that it
    exists, and that index *is* the at-most-once guarantee #2360 relies on.

    **Load-bearing caveat, stated in that spec's own header**: the harness builds
    schema by **`synchronize`, not by migration**. Every index name and partial
    predicate on the ORM entity must therefore be byte-identical to the migration's,
    or the spec exercises one schema while production runs the other. Verify both
    sides by hand before committing.

### Phase 8 — Docs

31. `docs/architecture-overview.md` — a new § Core Bounded Contexts entry
    (**20. Automation**) carrying the divergences, Q-a's retention argument, the
    fail-closed `isActive` default, and the named sibling boundaries.
32. Add the `automation → order-lifecycle` edge to the § Cross-context
    dependencies mermaid map.

---

## 7. Alternatives Considered

### A1 — Extend `sales_document_rules` with a `trigger` column instead of a new context
**Rejected.** The two engines share a *shape*, not a *scope*: sales-documents
resolves at-most-one outcome over a country ladder with `thresholdRef` indirection;
automation resolves a multi-step action list over a trigger, with inline amounts and
an asymmetric fire-all/fire-none split. Fusing them makes every future change to
either engine a change to the other, on a table whose write path is a fiscal
document.

### A2 — Fold the at-most-once firing record into `automation_runs`
**Rejected**, see Q-a: 90-day retention cannot enforce a forever-guarantee, and a
`blocked` run (nothing fired) would suppress a pair on which nothing happened.

### A3 — Model actions as `{ action: string; config: jsonb }` with no per-action typing
**Rejected.** The narrower would be vacuous — every malformed action would persist
as "valid" and crash the executor at run time, on the money path. Typing the config
is what makes `isAutomationAction` mean something.

### A4 — Nullable `orderId` + `returnId` on `automation_runs`
**Rejected**, see Q-e: admits rows with both or neither, and does not extend.

### A5 — Store the inline threshold amount as a JSON number
**Rejected**, see Q-g: JSON numbers are IEEE doubles; the newest money precedent
(ADR-040) keeps auditable amounts as strings end-to-end, and the string costs
nothing here.

---

## 8. Validation & Risks

### Architecture compliance
- ✅ Hexagonal cell; domain has no NestJS/TypeORM import.
- ✅ Service implements `IAutomationRulesService` in a separate file
  (`check-service-interfaces.mjs`).
- ✅ Repository port in domain; ORM↔domain mapping private to the repository;
  infra errors converted to domain errors.
- ✅ Cross-context imports: one named value import from a sibling leaf, matching no
  deny shape in `check-cross-context-imports.mjs`.
- ✅ Tokens file is Symbols-only, `export *`-ed from the barrel.

### Risks

| Risk | Mitigation |
|---|---|
| **Migration timestamp collision** with a sibling agent | `1851000000000` is pre-allocated and non-negotiable; `check-migration-timestamps.mjs` runs in `pnpm lint` and would catch a slip. |
| **`trigger` is a reserved word** in some SQL dialects | Always quoted in DDL; the ORM `@Column({ name: 'trigger' })` is explicit, not inferred. |
| **Two tables land with no consumer** | Accepted and argued (Q-a). Their docblocks name the owning issue so a reader does not delete them as dead code. |
| **A jsonb condition referencing a deleted connection** can never match | Not a storage bug — it is spec S3-5 (*"a rule that can never match says so"*), rendered by #2363/#2364. An FK is impossible inside jsonb, and a rule silently vanishing because a connection was removed would be worse. Flagged as a seam. |
| **`isActive` default** disagreeing with the composer | The column default fails closed; #2363 always sets it explicitly. |
| **The 90-day retention sweep is unowned** | Named in §5.6 but in no body-D issue. Flagged for the orchestrator to file; this plan lands `firedAt` + its index so the sweep is a pure add. |

### Cross-body seams (for the orchestrator, after #2338 lands)
- `place-hold` / `release-hold` action configs carry a `HoldReason` but invoke
  nothing. #2361 wires them to `OrderHoldService` (#2339). Nothing here imports body
  A's code.
- `automation_trigger_firings` has no writer until #2360; `automation_runs` none
  until #2385.
- **The 90-day run-retention sweep (§5.6) is unowned** — named in the spec and in no
  body-D issue. The one precedent to mirror is `DemoAccountCleanupService`
  (`apps/api/src/auth/demo-account-cleanup.service.ts`) — the repo's *only* Postgres
  row-deletion retention sweep (unref'd interval + `singleton:` Redis lock +
  `LessThan(olderThan)` repo query). Notably it does **not** live in
  `apps/worker/src/scheduler`. This slice lands `firedAt` + its index so the sweep is
  a pure add.
- **Tripwire for body D's FE half (#2364), not for this slice**:
  `apps/web/src/features/automation` is *already* a declared scan root in
  `scripts/check-ui-vocabulary.mjs` with `pending: true`. The moment that folder
  exists it must contain at least one `.tsx` or `*.copy.ts` or the gate's self-check
  fails the build, and `pending` must be flipped to `false`. Note also that `phase`
  is a **word-mode** ban — a run-log column header using that word would trip.
- #2360/#2361 register core modules in `apps/worker/src/sync/sync-worker.module.ts`
  (the `ReturnsModule` precedent), not in a worker `app.module.ts`.

### Backward compatibility
- ✅ Purely additive: three new tables, one new context, one `app.module` import. No
  existing type, table, or route changes.

---

## 9. Testing Strategy & Acceptance Criteria

**Unit** (`libs/core/src/automation/**/__tests__/*.spec.ts`): narrowers incl.
malformed-persisted-row, canonicalize/hash ordering semantics, entities, repository
mapping + `23505` translation, service guard chain.

**Integration** (`apps/api/test/integration/automation-schema.int-spec.ts`): the
three tables and two unique indexes exist; the firings unique index actually rejects
a duplicate `(ruleId, subjectKind, subjectId)`.

### Acceptance criteria (from the issue)
- [ ] Migration `1851000000000` creates `automation_rules` + `automation_runs`
      (+ `automation_trigger_firings`, Q-a); scope in columns, config in `jsonb`.
- [ ] The three divergences from #2161 are stated in the entity docblock.
- [ ] Save-time duplicate guard rejects an identical trigger+conditions+actions
      rule (service overlap guard + DB unique index).
- [ ] Context registered in `CONTEXT_BARRELS` and package exports;
      architecture-overview updated.
- [ ] Tests added; no boundary violations.

### Gates
`pnpm lint`, `pnpm type-check`, `pnpm test`, `pnpm check:invariants` all green;
the schema int-spec run via `--runTestsByPath`.

---

## 10. Alignment Checklist

- [x] Follows hexagonal architecture
- [x] Respects CORE vs Integration boundaries
- [x] Uses existing patterns (mirrors #2170; no new abstraction invented)
- [x] Idempotency considered (the firings unique index *is* the at-most-once seam)
- [x] Event-driven patterns — N/A at this layer (#2360 owns emission)
- [x] Rate limits & retries — N/A (no outbound I/O)
- [x] Error handling comprehensive (six domain errors; `23505` translated)
- [x] Testing strategy complete
- [x] Naming conventions followed
- [x] File structure matches standards
- [x] Plan is execution-ready

---

## Related Documentation

- `docs/specs/product-spec-oms-wave2-operator-experience.md` §5, §7.2
- `docs/plans/oms-progress-ledger.md`
- `docs/architecture/adrs/041-sales-document-routing-policy.md` (the mirrored engine)
- `docs/architecture/adrs/011-domain-entity-behavior.md`
- `docs/migrations.md` § Timestamp uniqueness invariant

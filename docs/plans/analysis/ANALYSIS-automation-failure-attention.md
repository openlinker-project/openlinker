# Readiness Gate: AF-X — "an automation couldn't finish" (producer half)

**Plan**: `docs/plans/implementation-plan-automation-failure-attention.md`
**Issue**: #2387 (`W2-49`)
**Date**: 2026-08-27
**Branch**: `2358-automation-rules`

## Verdict: **READY**

No Critical findings. Three Warnings, all with a stated migration path, and one
plan refinement (a better in-context precedent than the one cited). Nothing the
plan proposes trips `check:invariants`.

---

## 1. Reuse findings

| Plan artifact | Verdict | Evidence |
|---|---|---|
| AF-X derivation (`isAutomationRunAttentionWorthy`) | **NEW** | No `needsAttention` / `attentionWorthy` / `AttentionReason` identifier exists in the automation context. `automation-run.types.ts:45` already *comments* that `failed` is "Attention-worthy (AF-X)" and `:50` that `nothing-to-do`/`blocked` are not — the plan implements the rule that comment describes, in the file that describes it. |
| Retry / re-dispatch seam | **NEW** | Nothing in `libs/core/src/automation` or `apps/api/src/automation`. `AutomationRunRepositoryPort` (`automation-run-repository.port.ts:74-108`) is save + 4 reads, no update. Every existing "retry" mention is a comment arguing *against* accidental retries (`automation-dispatch.service.ts:177`, `automation-run-recorder.service.ts:79-81`). |
| Dismissal seam | **NEW**, but see § 3.1 | `dismissedAt` / `dismissedBy` / `handledBy` / `restockedBy` / `operator_out_of_band` are absent everywhere in `libs/core` and `apps/api`. |
| `AUTOMATION_DISPATCH_SERVICE_TOKEN` in `apps/api` | **EXISTS → reuse** | Bound at `automation.module.ts:88-92` to `AutomationIrreversibleGateService` (the gate, **not** the raw dispatcher — exactly what D4/§3.1 of the plan requires), exported at `:108`. Reachable in `AutomationApiModule`'s injector via `automation-api.module.ts:21,29`, and independently in `app.module.ts:22,81`. Already proven live by `apps/api/test/integration/automation-dispatch-gate.int-spec.ts:42-45`. **The plan's "call the same gate, never re-derive" is satisfied by resolving this token and nothing else.** |
| `buildOrderAutomationFacts` | **EXISTS → reuse** | `libs/core/src/orders/domain/order-automation-facts-projection.ts`; two callers today (T5 emission, dry run). The retry is the third, as planned. |
| `IDX_automation_runs_failed` | **PARTIAL → extend** | Exists (`automation-run.orm-entity.ts`), but its predicate is `outcome = 'failed'` only. Once dismissal exists it no longer matches the attention read. See § 3.3. |
| Pure-rule exception in `automation-run.types.ts` | **EXISTS → precedent** | That file already exports two runtime functions (`isAutomationRunSubjectKind:34`, `isAutomationRunOutcome:61`) beside its unions. Placing a third pure rule there needs no new justification. |

**Conclusion:** the plan reinvents nothing. Every "existing" hit is one the plan
already intended to reuse.

---

## 2. Plan refinement (not a defect)

**2.1 — Cite the in-context dismissal precedent, not `packedByUserId`.**
The plan cites `order_records.packedByUserId` for "uuid, unindexed, no FK". A
strictly better precedent exists **in the same context and the same table
family**: `AutomationRule.moneyAckByUserId` / `moneyAckAt`
(`automation-rule.entity.ts:96-97`, ORM `:109,112`, no FK **documented at
`automation-rule.orm-entity.ts:31`**, written by
`automation-rule.repository.ts:159`, surfaced by
`automation-response.dto.ts:94-95,120-121`, created in migration
`1851000000000-create-automation-tables.ts:95-96`).

That is the same `{verb}ByUserId` + `{verb}At` naming the plan proposes, the same
no-FK reasoning already written down, and an existing DTO-projection shape to copy.
Switch the citation and follow its column naming. No structural change to the plan.

---

## 3. Backward-compatibility findings

### 3.1 WARNING — `AutomationRun` constructor grows from 11 to 13 positional params

**Surface**: domain entity constructor (`automation-run.entity.ts:50-67`).
**Blast radius is small and known — exactly two real call sites**:
- `automation-run.repository.ts:167` (the production mapper)
- `application/services/__tests__/automation-runs-one-record.spec.ts:24` (test factory)

plus one structural cast that will *not* break:
`__tests__/automation-run-recorder.service.spec.ts:64`
(`{...run, id:'run-1'} as unknown as AutomationRun`).

**Migration path**: append `dismissedAt`, `dismissedByUserId` **after `createdAt`**
— the only non-shifting position — and update the two call sites.

**Stated so a later slice does not repeat it**: 13 positional parameters is at the
edge of readable. This slice appends because two call sites make it cheap and
ADR-011's anemic-readonly entity shape is unchanged; **the next member added to
this entity should convert it to an options object instead**, and that conversion
should be its own change rather than a rider.

### 3.2 WARNING — schema change ⇒ migration required

Two nullable columns + one partial index on `automation_runs`.

**Slot verified**: `1856000000000` is unused locally and absent from `origin/main`.
Local branch tail is `1851000000000`; `origin/main` tail is `1841000000006`. The
`check-migration-timestamps.mjs` ordering rule (strictly greater than every
timestamp on `origin/main`) is satisfied with margin. The class suffix must repeat
the timestamp.

Note the harness synchronizes from the ORM decorators while production runs the
migration, so the two must agree — including the index predicate.

### 3.3 WARNING — the new index overlaps the existing `IDX_automation_runs_failed`

`IDX_automation_runs_failed` (`WHERE "outcome" = 'failed'`) was landed by #2358
explicitly to serve the AF-X attention count. Once `dismissedAt` exists that
predicate is no longer the attention predicate.

**Decision**: add `IDX_automation_runs_attention`
(`WHERE "outcome" = 'failed' AND "dismissedAt" IS NULL`) and **keep** the existing
index — it still serves the `outcome` browse filter, and dropping an index another
slice landed, mid-wave, while three sibling bodies have open PRs, is churn with no
benefit. Record the overlap in the migration docblock so it is a decision rather
than an oversight.

### 3.4 No break — additive interface members

| Change | Verdict |
|---|---|
| `AutomationStepResult.report?` | Additive optional member. `steps` is `jsonb` typed `readonly unknown[]` on the entity, so **no schema change** and no reader change. |
| `AutomationRunFilters.attentionOnly?` | Additive optional. Matches the port's own documented rule (`automation-run-repository.port.ts:51-62`): a narrowing filter, absent means do not narrow. |
| `AutomationRunResponseDto` + 3 fields | Additive. One mapper (`fromDomain`, `automation-response.dto.ts:157-170`), reached from `automations.controller.ts:290` and via `AutomationRunLogResponseDto.fromDomain:189`. |

### 3.5 WARNING — the frontend mirror must move in the same commit

`apps/web/src/features/automation/api/automation.schema.ts:243` is a hand-written
mirror of the run shape. Adding `needsAttention` server-side without updating it
means the FE never sees the field and the attention affordances are dead code that
type-checks — the exact defect class this wave keeps closing.

**Decision to make at implementation time, recorded here**: parse `needsAttention`
as **required** (`z.boolean()`), not `.nullish()`. Both halves ship in one deploy,
so there is no version skew; and the `.nullish()` alternative would force the FE to
choose between under-reporting (absent ⇒ no affordance offered on a genuinely failed
run) and re-deriving the rule client-side, which D1 exists to forbid. `dismissedAt` /
`dismissedByUserId` are genuinely nullable and take `.nullish()` per #939.

### 3.6 No break — `check:invariants`

- **`check-service-interfaces`** scans `libs/core/src/<ctx>/application/services/*.service.ts` only. The new `AutomationRetryService` lives in `apps/api/src/automation/application/` (the `AutomationDryRunService` precedent) and is out of scope. The plan still ships the `.service.interface.ts` sibling, matching that precedent.
- **`check-cross-context-imports`** — baseline re-run clean (`2409 imports / 3143 files, all conform`). The retry service imports the `@openlinker/core/automation` and `@openlinker/core/orders` **top-level barrels** only, taking `I*Service` / `*_TOKEN` / a domain entity / `buildOrderAutomationFacts` — no deny shape, and `AutomationDryRunService` already imports that same set and passes. **No new allow-list entry.**
- **`check-ui-vocabulary`** — `apps/web/src/features/automation` is a scanned root (`check-ui-vocabulary.mjs:163`), and a `*.copy.ts` is scanned in full. Banned §2.1 terms are `authority`, `posture`, `phase`, `holder`, `tenth`; none appears in the planned copy. Keeping the strings in `automation.copy.ts` rather than in a component object literal is what keeps them scanned at all.
- **`check-migration-timestamps`** — § 3.2.

---

## 4. Open questions

**Q1 — a retry whose rule was deleted.** `ruleId` carries no FK by #2358 design, so
the rule may be gone. The plan already refuses with a stated reason (R3) and keeps
dismissal working. **No revision needed**; flagged because the refusal copy must say
*why*, or the operator reads a generic failure.

**Q2 — `subjectKind: 'return'` runs cannot be retried.** `buildOrderAutomationFacts`
is order-shaped, and T6/T7 fire on returns. The plan refuses these explicitly rather
than silently skipping. Confirm the refusal is *rendered* (a disabled action with a
reason), not merely a 400 an operator never sees.

**Q3 — nothing else.** No blocking ambiguity found.

---

## 5. What this gate did not check

Runtime behaviour: Docker is wedged host-level on this machine, so no integration
suite was run and none of the above is verified against a live Postgres. The
migration slot, index predicate and conditional-UPDATE semantics are verified by
reading only.

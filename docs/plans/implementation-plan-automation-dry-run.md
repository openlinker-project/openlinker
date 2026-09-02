# Implementation Plan: Frontend — automation dry run + fired log (#2366)

**Date**: 2026-08-27
**Status**: Ready for Review
**Estimated Effort**: ~1 day (size M)

---

## 1. Task Summary

**Objective**: "Test on a recent order" inside the composer, the per-rule fired log, and the
conflict surfacing that rides with them. Spec §5.6.

This is **an arming gate, not garnish**: an automation that spends money and cannot be tested
before it is armed will not be armed.

**Classification**: Frontend (Interfaces layer). No backend change, **no migration** — slot
`1856000000000` stays unused.

---

## 2. The two invariants that shape every decision here

**A dry run REPORTS; it must never mutate.** `POST /automations/evaluate` commits nothing and
dispatches nothing. So the client must not invalidate a single query key on success — invalidation
would tell TanStack the server state changed, which is precisely the claim this endpoint exists
not to make. It is a mutation only in the HTTP-verb sense.

**A trace the backend supplies is rendered verbatim.** Frontend copy may *label* a trace row
("Matched", "Not matched") but must never paraphrase the `condition` payload or the backend's own
reason strings. And where the response cannot answer for something, the panel says so rather than
rendering a confident empty result.

---

## 3. What already exists and is reused

| Reused | From |
|---|---|
| `describeAutomationWriteError` (extend the `switch`, never parse messages) | #2365 |
| `toConditionInput` / `toActionInput` — pure, exported | #2365 |
| The `vocabulary` prop on the composer (panel mounts with no second fetch) | #2365 |
| `useAutomationRunsQuery`, `automationQueryKeys.runs` | #2364 |
| `describeAvailability`, `describeTrigger`, the copy module | #2364 |
| `useOrdersQuery` + `OrderFilters.createdFrom` for the picker | `features/orders` |

**Three additions**, all frontend:
1. `AutomationsApi.evaluate` (`POST /automations/evaluate`).
2. **`AutomationRun.steps`** — a real gap left by #2364: the type and schema drop `steps`
   entirely, and the per-step `status` / `detail` / `unavailableReason` / `syncJobId` is *where the
   failure reason lives*. Without it AC-3 ("failures with their reason") cannot be met.
3. `useOrdersQuery` + `OrderFilters` onto the `orders` public barrel (the slug is already
   registered in both `.eslintrc.js` groups).

---

## 4. Contract consumed

`POST /automations/evaluate` — body is exactly one of `{orderId, ruleId}` or `{orderId, rule}`.
The **draft** arm is the point: §5.6(a) exists so a money rule can be tested *before* it is armed.

Response:
- `facts` — the five projected facts the evaluator used (never the order snapshot; it carries PII).
- `verdicts[]` — **every** rule scoped to the trigger, plus the subject, so a two-money-rules
  collision is visible:
  - `matches` vs **`wouldFire`** — they differ exactly when the at-most-one gate refused a rule
    that DID match. **Never render readiness from `matches`.**
  - `blockedBy: {collidingRuleIds[], actions[]}` — names the collision *and which actions collided*.
  - `retroactivityFloorWaived` — "matches, but would not have fired for this order". Rendering
    the verdict without it makes the preview lie.
  - `conditionTraces[]` — `{field, condition, outcome}`, outcome from the closed
    `conditionOutcomes` union.
  - `stepAvailability[]` — per step, in this build.

---

## 5. Decisions

**D0 — The gate keys on `irreversible` ALONE, never on `isActive && irreversible`.**
This is the load-bearing decision. `moneyAcknowledged` is required only when ARMING (the backend
skips it for `isActive !== true`), so gating the dry run the same way is bypassable in two clicks:
save an A2 rule **inactive**, then arm it from #2364's rules-list toggle — a `PUT` through
`useSetAutomationActiveMutation` that carries no dry-run gate anywhere on it. The rule spends money
on its next match having never been tested, by a path we shipped last issue.

**The two gates deliberately differ because they are different kinds of thing: one is CONSENT,
needed only when arming; the other is EVIDENCE, needed to create the definition at all.** Gating
the *save* is therefore the structural answer rather than merely the stricter-looking one — a rule
tested before it exists cannot be armed untested by any path, including paths nobody has written
yet.

**D1 — The Save gate is bound to the DRAFT that was tested, not to "a dry run happened".**
The AC says Save stays disabled for an A1/A2 rule "until a dry run has been executed in the
session". Taken literally that is theatre: test a trivial rule, then change the carrier, the
conditions and the actions, and Save unlocks on evidence about a rule that no longer exists. The
gate therefore stores a **fingerprint of the projected body** (`JSON.stringify` of the same
`toConditionInput` / `toActionInput` output the save sends) and unlocks only while the current
draft still matches it. Editing anything material re-locks it, with a line saying why.

**The fingerprint covers exactly `trigger`, `triggerConfig`, `conditions`, `actions` — and
deliberately NOT `isActive` or `moneyAcknowledged`.** Both halves matter. Folding in `isActive`
would re-lock the gate the moment the operator ticks "turn this on", a change the evidence still
covers, sending them round a loop with no visible cause. Omitting `trigger` / `triggerConfig` would
let a rule tested on `order.packed` be switched to `order.on_hold_for` and saved on evidence about
a different event, where the verdicts simply do not transfer.

**D2 — "Spends money" is resolved from the API.** `vocabulary.actions[].irreversible` — the same
field #2365's money-acknowledgement gate reads. No frontend list of A1/A2.

**D3 — `wouldFire`, never `matches`.** The verdict headline is `wouldFire`; `matches` is shown as
a separate line only when the two disagree, because that disagreement *is* the collision and
hiding it would leave the operator with an unexplained "no".

**D4 — The conflict is surfaced on the rule rows. On the order, it is DEFERRED because NOTHING
COULD FEED IT.** The AC asks for both. On the rule rows it is fully supported — `blockedBy` names
the other rules and which actions collided.

On the order, **no data source exists**, and that is the decisive fact rather than any blocked
dependency: automation runs are not recorded in this build (`recordingAvailable === false`, #2385),
so no `blockedByRuleIds` are persisted anywhere, and the API exposes no per-order automation read
at all. A badge would have to invent its input. #2356 being open is secondary — **the badge would
have nothing to render even after #2356 ships**, and stating it the other way round would mislead
the next reader into unblocking it prematurely. Handed to #2385 (the data) and then #2356 (the
surface). This is the one AC this slice cannot meet.

**D5 — The fired log renders `recordingAvailable` first.** While it is false an empty list means
"#2385 has not landed", NOT "nothing fired". The log leads with the backend's own `note` and never
renders an empty-state that would read as "this rule has never fired".

**D5b — The fired log fetches LAZILY, per rule, on expand.** `useAutomationRunsQuery` is per-rule,
so mounting one per row would issue N requests on page load — the N+1 that #1996 exists to prevent,
for a log that is empty in this build anyway. The hook already takes an `enabled` flag; it is
driven by the row's expanded state. **And the log becomes the single source of the
"firings not recorded" fact**: #2364's first-rule-only probe on `automation-rules-list.tsx` was a
deliberate stopgap for exactly this read, and it is retired here. Two ways to learn the same thing
drift.

**D6 — Per-step failure detail comes from `steps`, verbatim.** `detail` and `unavailableReason`
are the backend's sentences. `status` (`done | nothing-to-do | failed | skipped`) is labelled by
FE copy through an exhaustive `switch` with a `never` check. A `skipped` step renders explicitly —
a silently missing step is indistinguishable from one that was never configured, which is exactly
what §5.6 says recording it prevents.

**D7 — The dry run invalidates nothing.** See § 2. Stated in the hook's docblock so a later reader
does not "fix" the missing `onSuccess`.

**D8 — The order picker is the last 30 days, and says so.** `useOrdersQuery` with
`createdFrom = now − 30d`, newest first, paginated to one page. An empty picker states that there
are no orders in the window rather than that the rule cannot be tested.

---

## 6. Implementation Plan

### Phase 1 — contract
1. `api/automation.types.ts` — dry-run view types (`AutomationDryRunResult`, `AutomationVerdict`,
   `AutomationConditionTrace`, `AutomationSubjectFacts`, `AutomationBlockedBy`,
   `AutomationStepResult`) + `AUTOMATION_STEP_STATUS_VALUES`; add `steps` to `AutomationRun`.
2. `api/automation.schema.ts` — `parseAutomationDryRun`; add `steps` to the run parse. `.nullish()`
   throughout.
3. `api/automation.api.ts` — `evaluate(input)`.
4. `hooks/use-evaluate-automation-mutation.ts` — **no `onSuccess` invalidation** (D7).
5. `lib/automation-write-error.ts` — **no new `case`.** `AutomationDryRunService` throws Nest's
   `NotFoundException` for the unknown order (`:91`) and the unknown rule (`:193`, `:199`), so those
   never reach `AutomationExceptionFilter` and the body carries no domain error name. The existing
   `default` arm already passes the message through, which names the id. Document that; an
   `AutomationRuleNotFoundError` case here could never match and would read as coverage.

### Phase 2 — dry run
6. `lib/automation.copy.ts` — the 14 non-firing reasons as
   `as const satisfies Record<AutomationNonFiringReason, string>` (compile-time total, so a 15th
   fails the build) read through a `Record<string, string>` lookup with a **raw-code fallback** —
   the `describeTrigger` precedent. In the copy module, not a component, so it stays inside
   `check-ui-vocabulary` (the hole #2365 closed).
7. `lib/dry-run-verdict.ts` — pure: `describeConditionOutcome` (exhaustive + `never`),
   `describeVerdict` (headline from `wouldFire`, the `matches`-disagreement line, the
   retroactivity waiver), `fingerprintDraft` (D1).
8. `components/automation-dry-run-panel.tsx` — order picker, Run button, facts, per-verdict trace.
   **Its error branch renders the refusal, never an empty verdict list**: a draft dry run
   re-validates exactly as a save does, so an incomplete draft returns the save's own 400s, and
   an empty list would state "this rule matches nothing" when the truth is "we never evaluated it".
   The reports-never-mutates invariant is restated at that branch, where it bites.
9. `components/automation-composer-dialog.tsx` — mount the panel; add the second `disabled` clause.

### Phase 3 — fired log
10. `lib/step-status.ts` — exhaustive step-status labels (4 values + `never`).
11. `components/automation-run-log.tsx` — per-rule, `recordingAvailable`-first, failures with
    reason, `blockedByRuleIds` naming the other rule.
12. `components/automation-rules-list.tsx` — expandable per-rule log (lazy), the conflict line, and
    removal of the #2364 `firingsUnrecorded` probe (D5b).

### Phase 4 — tests
- **the disabled-save gate** (the issue's own AC): locked for an irreversible rule, unlocked by a
  dry run, **re-locked when the draft changes** (D1)
- the dry run dispatches nothing — assert `evaluate` called and **no** query invalidated
- a per-condition trace renders every outcome value
- `wouldFire === false` with `matches === true` renders the collision naming the other rule
- `retroactivityFloorWaived` renders
- the fired log shows a `failed` step with its reason, and a `skipped` step
- `recordingAvailable: false` renders the note, never an empty state

---

## 7. Risks

- **`steps` is `readonly unknown[]` server-side** (#2385 may widen it). The parse is therefore
  per-step non-fatal: an unreadable step drops and is counted, never crashes the log.
- **The fingerprint is a `JSON.stringify` of projected output**, so key order matters. Both sides
  come from the same `toActionInput` / `toConditionInput`, so ordering is structurally identical —
  but this is stated because a future hand-built body would silently break the gate open.
- `EXPECTED_LAZY_ROUTE_COUNT` stays **59** — panel in a dialog, log on an existing page.

---

## 8. Acceptance Criteria

- [ ] `Save` is disabled for an A1/A2 rule until a dry run has been executed **for that draft**,
      gated on `irreversible` alone so the arm-from-list path cannot bypass it (D0)
- [ ] The dry run renders a per-condition matched/not-matched trace and dispatches nothing
- [ ] Fired log shows failures with their reason, not just successes
- [ ] A conflict names the other rule on both rule rows (**on the order: deferred, D4**)
- [ ] Component tests including the disabled-save gate
- [ ] `pnpm lint` / `type-check` / full web suite green

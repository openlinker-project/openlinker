# Implementation Plan: Frontend — automation composer dialog (#2365)

**Date**: 2026-08-27
**Status**: Ready for Review
**Estimated Effort**: ~1 day (size L)

---

## 1. Task Summary

**Objective**: the `when / only if / then` builder an operator uses to author an automation rule —
mounted on the `/automations/:trigger` page #2364 shipped, reachable through the
`?compose=suggested | new` entry contract that page already routes.

**Classification**: Frontend (Interfaces layer).

**Non-goals**: the dry run and the fired log (#2366 — `POST /automations/evaluate` is not called
here), the combined run log (W2-48), any backend change, any migration.

---

## 2. What already exists and is reused verbatim

#2364 left a complete substrate. This slice adds **one** API method and otherwise composes:

| Reused | From |
|---|---|
| `AutomationsApi`, `automationQueryKeys`, all five hooks | `features/automation/api`, `/hooks` |
| `describeAvailability` / `readRuleAvailability` | `features/automation/lib/action-availability.ts` |
| `describeTrigger`, the whole copy module | `features/automation/lib` |
| `automations:write` + `useWriteAccess` + `ReadOnlyLock` | #2364 |
| `useAutomationVocabularyQuery` — triggers, actions, **legality**, `stepBounds` | #2364 |

**One addition**: `AutomationsApi.create` (`POST /automations`). The barrel, query keys and
invalidation rule are already in place.

---

## 3. The contract this composer writes against

Read off `libs/core/src/automation/domain/types/` — the composer must produce exactly these shapes
or the server-side narrowers reject the row.

**Conditions** (`AutomationCondition`, discriminated on `field`):
- `sourceConnection` / `orderCountry` — `{field, op: 'eq', value: string}`
- `orderTotalGross` — `{field, op: 'gte' | 'lt', amount: string, currency: string}`
  - **`amount` is a decimal STRING**, `/^\d+(\.\d{1,2})?$/`, never a JSON number — the type's own
    docblock says a string is what lets the narrower check a bounded 2-decimal shape.
  - `currency` is `/^[A-Z]{3}$/`.
  - **Inline amount + currency, not a `thresholdRef`** — spec §5.5 divergence 2, the declared
    departure from the sales-document composer.
- `holdReason` — `{field, op: 'eq', value: HoldReason}`

**Actions** (`AutomationAction`, discriminated on `action`):
- `issue-sales-document` / `relay-status-to-source` — **no parameters**, deliberately.
- `dispatch-shipment` — `{carrierId, serviceId: string|null, packagePresetId: string|null, cashOnDelivery: boolean}`
- `send-email` — `{recipient: {kind:'buyer'} | {kind:'address', address}, subject, body}` (`body` non-empty)
- `place-hold` — `{reason: HoldReason, note: string}`
- `release-hold` — `{holdReason: HoldReason|null, note: string}` (**`note` required** — mirrors the manual release)

---

## 4. Decisions

**D1 — RHF + Zod, mirroring the reference's INTERACTION model, not its state library.**
The issue's Assumptions say *"RHF + Zod, per the repo's form convention"*, and
`frontend-architecture.md` pins form state to React Hook Form. The named reference
(`sales-document-rule-composer-dialog.tsx`) uses plain `useState` — a pre-existing deviation, the
same shape as `settings-page.tsx`'s inline role compare that #2364 declined to copy. What the issue
actually asks to mirror is *behaviour* (*"a bespoke interaction model here would make the two rule
builders behave differently for no reason"*): AND-only closed-vocabulary conditions,
`+ Add condition`, the footer sentence pattern, the same validation posture. Those are preserved
exactly; the state lives in RHF + `useFieldArray` (precedent: `woocommerce-publish-wizard.tsx`) with
a Zod discriminated-union resolver, which is also the only thing that types a dynamic
heterogeneous action list honestly.

**D2 — The legality matrix is never held frontend-side.** Action options come from
`vocabulary.triggers[].legalActions` and condition fields from `.legalConditionFields`, both keyed
by the selected trigger. The FE holds no matrix and no copy of §5.4. Changing the trigger re-filters
both lists and **drops any now-illegal step or condition**, surfacing what was dropped rather than
silently submitting a body the server will refuse.

**D3 — Legal is not runnable, and the composer says both.** A legal action may still be
`unavailable` in this build (four of six are). Each offered action carries its
`describeAvailability` badge and, where present, the backend's `reason` **verbatim**. The action is
still offerable — the write path accepts all six by design — but never presented as ready. This is
#2364's rule continued one screen earlier, and it is the whole reason the vocabulary endpoint
reports availability at all.

**D4 — The cap comes from `vocabulary.stepBounds.max`, not a literal `3`.** (The vocabulary query
already carries `staleTime: 60 * 60 * 1000` from #2364, so reading the cap costs no extra fetch —
worth stating so it is not "optimised" back into a constant.) A hardcoded cap is a
second declaration that can disagree with the server's `AUTOMATION_ACTION_MAX_STEPS`. Min likewise:
a zero-step rule is refused server-side, so `+ Add action` is capped and the save is gated on ≥ min.

**D5 — Rule-level facts render ONCE, never per row.** The stop-on-first-failure sentence and the
non-retroactivity sentence are properties of the rule, not of any step, so each is one line in the
actions block / footer. Repeating either per action row would state N times something true once —
the #2231 rule, and the same correction #2364 took on its "firings not recorded" notice.

**D6 — The duplicate refusal is read STRUCTURALLY.** `AutomationExceptionFilter` answers 409 with
`{error: 'AutomationRuleConflictError', message, …}`. The composer branches on `ApiError.status` +
the `error` field, never on message text — the `decline-error.ts` precedent, whose docblock states
the rule: *"any structured rendering reads the field, because the field and the sentence would
otherwise drift the first time the backend reworded the sentence."* Same for
`AutomationIllegalPairError` (400 + `trigger`/`action`/`index`) and `AutomationStepCountError`
(400 + `count`/`min`/`max`), each of which the filter deliberately made distinguishable.

**D7 — Arming a money rule requires the acknowledgement, in the composer.** `POST /automations`
400s when `isActive` and any legal step is irreversible unless `moneyAcknowledged: true`. The
composer therefore renders the acknowledgement checkbox **only** when that combination holds, and
gates Save on it — otherwise the operator meets the refusal after filling the whole form.

**D8 — A2's parameter block renders only sources that exist.** Spec §5.3b asks for carrier /
service / package-preset selects. Carrier resolves from connections carrying the
**`ShippingProviderManager`** capability (`libs/integrations/inpost/src/inpost-plugin.ts:35`) — a
*manifest* capability, legitimately outside `CoreCapabilityValues` since capability is open at the
registry boundary; `adapter.types.spec.ts:79` asserts the plausible-looking `'ShippingProvider'` is
NOT a core capability, so naming it wrong renders an empty select that reads as "you have no
carriers configured". Filtering follows the `selectInvoicingCandidates` precedent. **`carrierId`'s
referent is an assumption, not a fact** — A2's executor never runs in this build, so nothing can
confirm whether it means a connection id or a carrier code; spec §5.3b's "the connection's
configured carriers" points at the connection id, and the code records that it is unverified. **Service and package presets have no source at all** —
`packagePreset` appears nowhere in `apps/web`, and the backend's own availability reason names
"package presets do not exist yet" as part of why A2 cannot run. Both submit `null`, which the
narrower explicitly permits, and the block says so rather than rendering an empty picker that reads
as "you have none configured". Fabricating either would be the false-claim class this wave keeps
closing.

**D9 — Indexed server errors land on the row that caused them.** `frontend-architecture.md`
§ Form State requires server errors be mapped back to fields "where practical", and the backend
made it practical on purpose: `AutomationExceptionFilter` splits eight refusals into distinct types
"precisely so a caller can tell them apart", and three carry an **`index`** —
`AutomationInvalidConditionError`, `AutomationInvalidActionError`, `AutomationIllegalPairError`
(which also carries `trigger` / `action`). On such a 400 the composer calls RHF `setError` on
`conditions.{index}` / `actions.{index}` so the failing row is marked, with the batch-level message
still rendered ONCE above — a rule-level refusal is not a property of any row. Dropping the index
and rendering only a banner discards the one thing the backend built to be renderable.

**D10 — Form primitives are the documented ones.** `FormField` wires label + control + description
+ `aria-invalid` / `aria-describedby` (§ Forms), which is also what makes D9's per-row error
reachable to a screen reader rather than merely coloured. The write refusal renders through
`Alert` / `FormErrorSummary`. The named reference composer hand-rolls
`<label className="eyebrow">` + `Select`; that predates the primitives and is not the standard.

**D11 — The composer stays interactive at 375 px, and the departure is recorded.**
`frontend-ui-style-guide.md` § Responsive puts *complex editors* on a read-only + "open on desktop"
affordance below 1024 px. This composer is not one: it is mostly closed-vocabulary selects (trigger,
action, condition field, hold reason) plus three short text fields — far closer to the **#1754
picker modal**, which is a *documented departure* precisely because it is a selection surface rather
than a data editor. It therefore stacks to a single column with ≥ 44 px targets and stays fully
interactive, and **`frontend-ui-style-guide.md` gains that departure note in the same commit**.
Claiming 375 px support while the guide says complex editors go read-only, with nothing written
down, is the one outcome ruled out.

**D12 — No priority field.** Stated by the issue; recorded here so it is not "added for symmetry"
with the sales-document composer later.

---

## 5. Implementation Plan

### Phase 1 — contract + validation
1. `api/automation.types.ts` — add `AutomationConditionInput` / `AutomationActionInput` view types
   and `AUTOMATION_CONDITION_FIELD_VALUES`, `AUTOMATION_AMOUNT_OP_VALUES`, the nine merge fields.
2. `api/automation.api.ts` — `create(input): Promise<AutomationRule>` (`POST /automations`).
3. `hooks/use-create-automation-mutation.ts` — invalidates **both** `list(trigger)` and `summary()`.
4. `lib/automation-composer.schema.ts` — the Zod resolver: a discriminated union per condition and
   per action, `note` required on `release-hold`, `body` required on `send-email`. The amount check
   is deliberately **shape-only and looser than the backend's** `DECIMAL_AMOUNT`: § Form State says
   "server-side validation remains the source of truth", and a looser client can only produce a late
   400 that D9 now renders on the right row, whereas a stricter one silently refuses input the
   server would have accepted. The source file is named in a comment.
5. `lib/automation-write-error.ts` — `describeAutomationWriteError(error)`, structural, per D6.

### Phase 2 — composer
6. `components/automation-condition-row.tsx` — one condition, field-driven controls.
7. `components/automation-action-row.tsx` — one step: action select (legality-filtered) +
   availability badge + the §5.3b parameter block for that action.
8. `components/automation-merge-fields.tsx` — the closed nine, insertable, with the
   "anything else is sent exactly as you type it" line.
9. `components/automation-composer-dialog.tsx` — the shell: name, trigger (+ `configKey` numeric
   input where the vocabulary declares one), conditions `useFieldArray`, actions `useFieldArray`,
   effective from/to, the money acknowledgement, the two rule-level sentences, footer.
10. `index.ts` — export the dialog and the two pure helpers.

### Phase 3 — mount
11. `pages/automations/automation-trigger-page.tsx` — read `?compose=`, open the dialog,
    pre-fill T5 → A2 → A3 for `suggested`, clear the param on close. Gate on `write.canWrite`.
12. `automation.copy.ts` — the composer's copy, including the two verbatim sentences.

### Phase 4 — tests
- legality filtering against a **fixture matrix** (the issue's first AC), including the
  drop-on-trigger-change path
- the cap at `stepBounds.max` and the stop-on-first-failure line
- the duplicate 409 → actionable message, read structurally
- the non-retroactivity sentence renders
- the money acknowledgement gate
- condition list add/remove; amount validation rejects `1.234` and `-1`

---

## 6. Risks

- **The amount check is deliberately not a strict mirror** (see Phase 1 step 4). `apps/web` cannot
  import core (#591), so any restatement can drift; the chosen direction makes drift produce a
  late, correctly-attributed 400 rather than a silent client-side refusal. No `check:invariants`
  script is proposed for it.
- **`?compose=suggested` pre-fills A2, which cannot run.** That is intended (#2364's card says so)
  and D3's availability badge is what keeps it honest.
- **`EXPECTED_LAZY_ROUTE_COUNT` stays 59** — the composer is a dialog on an existing route.

---

## 7. Acceptance Criteria

- [ ] Only legal actions offered for the selected trigger, sourced from the API (fixture matrix)
- [ ] Action list caps at `stepBounds.max` and states stop-on-first-failure once
- [ ] Duplicate rule rejected with an actionable message, read structurally
- [ ] The non-retroactivity sentence renders verbatim
- [ ] No priority field
- [ ] Component tests for the condition list and the legality filtering; usable at 375 px
- [ ] An indexed 400 marks the offending condition/action row (D9)
- [ ] The 375 px departure is recorded in `frontend-ui-style-guide.md` (D11)
- [ ] `pnpm lint` / `type-check` / full web suite green

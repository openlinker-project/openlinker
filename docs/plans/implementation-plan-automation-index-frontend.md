# Implementation Plan: Frontend — automations index and trigger list (#2364)

**Date**: 2026-08-27
**Status**: Ready for Review
**Estimated Effort**: ~1 day

---

## 1. Task Summary

**Objective**: ship `apps/web/src/features/automation` (singular) plus the `/automations` route,
the operator's first surface onto the #2363 automation API — a trigger index, a per-trigger rule
list with a one-click deactivate, and an honest rendering of what the six v1 actions can
actually do in this build.

**Context**: #2358 → #2363 built the whole backend (storage, evaluator, legality matrix, trigger
emission, executors, the at-most-one gate, CRUD + vocabulary + dry run + fired log). None of it is
reachable from the product: the nav still carries `Automations` under a disabled `Planned` group.

**Classification**: Frontend (Interfaces layer).

---

## 2. Scope & Non-Goals

### In scope
- `features/automation/**` with its public `index.ts` barrel.
- `/automations` (index) and `/automations/:trigger` (per-trigger rule list), both lazy.
- Nav promotion: `Automations` moves from the `Planned` group into `Operations`.
- `.eslintrc.js` — the `automation` slug in **both** `no-restricted-imports` pattern groups.
- `scripts/check-ui-vocabulary.mjs` — flip the `features/automation` scan root to `pending: false`.
- `EXPECTED_LAZY_ROUTE_COUNT` bump; `api-client.ts` namespace registration.
- Component tests; 375 px usable.

### Out of scope (owned elsewhere, and must not be pre-empted)
- **The composer dialog — #2365.** This slice routes *into* it via a search param and renders
  nothing of it.
- **The dry run and the per-rule fired-log rendering — #2366.** `POST /automations/evaluate` is
  not called here at all.
- **`/automations/activity` — W2-48.** See § 5, decision D3.
- Any write other than the arm/disarm toggle and delete.

### Constraints
- **No migration.** None is needed — every read and write already exists.
- `apps/web` cannot import `@openlinker/*` (#591), so every backend union is re-declared locally
  and every response is parsed rather than cast.
- Copy lives in `*.copy.ts` as plain literals (the vocabulary gate scans literals textually; routing
  copy through `t(key, fallback)` moves it out of the gate's reach).

---

## 3. Architecture Mapping

**Target layer**: `apps/web` — `app` (route + nav) → `pages` → `features` → `shared`.

**Reference implementations followed**:
| Concern | Reference |
|---|---|
| Trigger index table shape + class reuse | `features/sales-documents/components/sales-document-country-index.tsx` |
| Feature folder layout, `.nullish()` schema, copy module, barrel | `features/returns/**` (#2335/#2336) |
| Route module + crumb + lazy | `app/routes/returns.route.tsx` |
| Mobile card rendering, row navigation | `shared/ui/data-table.tsx` (`cardView`, `rowHref`) |

**No new shared primitive.** `DataTable` already carries `cardView` (a card list below the
breakpoint) and `rowHref`, which together answer the 375 px and tap-target requirements without
inventing a row height absent from `docs/frontend-ui-style-guide.md § Density & Row Heights`.

---

## 4. Backend contract consumed (#2363, verbatim)

| Route | Used for | Notes |
|---|---|---|
| `GET /automations/vocabulary` | triggers, actions + **availability**, legality, closed unions | the ONLY source of these values |
| `GET /automations/summary` | the index — counts for all 8 triggers, zeros included | `GET /automations` 400s without `?trigger=` |
| `GET /automations?trigger=` | the per-trigger rule list | |
| `PUT /automations/:id` | arm / disarm | **PUT, not PATCH** — a full replace; a partial body nulls `conditions`/`actions` |
| `DELETE /automations/:id` | delete a rule | 204 |

Writes are `admin`; reads are `admin` + `operator`.

---

## 5. Decisions & Assumptions

**D1 — The six actions are rendered from `actionAvailability` / vocabulary, never inferred.**
Only `relay-status-to-source` is `available`; `send-email` is `partial`; four are `unavailable`,
each carrying the backend's own reason string. Two surfaces:
- **Index**: a `What automations can do in this build` panel listing all six with a tone-mapped
  badge and the backend's reason. Never hidden (an operator who cannot see an action cannot
  understand why nothing fires) and never presented as ready.
- **Rule row**: every rule response carries `actionAvailability` per step. A rule with any
  `unavailable` step renders an `error`-toned chip naming those actions; `partial` renders a
  `warning` chip. **This is how an operator learns a rule they just saved cannot act yet.**

Availability copy is derived by a pure `describeActionAvailability` in `lib/`, so the panel and the
row chip cannot drift.

**D2 — `Last fired` is reported as unknown, not fabricated.** `GET /automations/summary` returns
`{trigger, ruleCount}` and nothing else; there is no last-fired field and no global run-log route.
`recordingAvailable` is per-rule and only obtainable from `GET /automations/:id/runs`. The index
therefore renders the column as an explicit "not recorded in this build" `EmptyValue`, sourced from
the per-trigger page's own `recordingAvailable` probe rather than asserted. Fabricating a timestamp,
or rendering `—` as if it meant "never", would be exactly the silent-false-claim defect this
programme keeps closing. Recorded as a deviation from the issue's AC wording.

**D3 — `/automations/activity` is registered with a minimal honest page.** The AC requires a
`Run log` header action opening that path, and the `returns.route.tsx` docblock states the rule
plainly: *a row that navigates to an unregistered path clicks through to a blank page*. But the
contract exposes **no global run-log route** — only `GET /automations/:id/runs`. So the route is
registered rendering a small page that says the log is per-rule today and links back to the index;
W2-48 replaces its body. Flagged for the orchestrator.

**D4 — S3-5 ("a rule that can never match") is rendered only from what the backend states.** The
observable that makes a never-matched claim safe is the dry run's `conditionOutcomes`
(`currency-mismatch`), which is #2366's. Asserting it client-side would require the browser to
guess at order currencies. This slice renders the availability warnings (real, backend-declared)
and, where a rule's fired log reports `recordingAvailable: false`, states that OpenLinker cannot
yet tell whether it has ever matched. Declined with reason; handed to #2366.

**D5 — `Set this up` navigates, and creates nothing.** The zero-rules card routes to
`/automations/order.packed?compose=suggested`, a search param #2365's composer reads to pre-fill
T5 → A2 → A3, inactive. This slice issues no mutation on page load at all, so "creates nothing" is
structural.

**D6 — Read-only role sees the list and no write control.** `useWriteAccess('connections:write')`
is the wrong permission; the automations writes are `@Roles('admin')`. The page gates its write
affordances on the session role the way `settings-page.tsx` does.

---

## 6. Implementation Plan

### Phase 1 — feature slice
1. `api/automation.types.ts` — locally declared closed unions (`AUTOMATION_TRIGGER_VALUES`,
   `AUTOMATION_ACTION_VALUES`, `AUTOMATION_ACTION_AVAILABILITY_VALUES`) + view-model types.
2. `api/automation.schema.ts` — Zod over each response. **`.nullish()`, never `.optional()`**
   (#939). Per-row non-fatal drops with a reported count, the `returns.schema.ts` shape.
3. `api/automation.api.ts` — `getVocabulary` / `getSummary` / `listByTrigger` / `get` / `listRuns`
   / `replace` / `remove`. Every response parsed, never cast.
4. `api/automation.query-keys.ts`.
5. `hooks/` — `use-automation-vocabulary-query`, `use-automation-summary-query`,
   `use-automation-rules-query`, `use-automation-runs-query`,
   `use-set-automation-active-mutation` (a **PUT** rebuilding the full definition from the loaded
   rule, per the handover), `use-delete-automation-mutation`.
6. `lib/automation.copy.ts` — every operator string, plain literals, no banned §2.1 term
   (note `phase` is a word-mode ban — no run-log column may use it).
7. `lib/action-availability.ts` — `describeActionAvailability`, exhaustive `switch` with a `never`
   check over the three-value union.
8. `components/` — `automation-trigger-index.tsx`, `automation-suggestion-card.tsx`,
   `automation-rule-row-availability.tsx`, `automation-action-availability-panel.tsx`,
   `automation-rules-list.tsx`.
9. `index.ts` — the public barrel.

### Phase 2 — pages + routes
10. `pages/automations/automations-page.tsx` (index), `automation-trigger-page.tsx`
    (per-trigger rules), `automation-activity-page.tsx` (D3).
11. `app/routes/automations.route.tsx` — three lazy children, each with its own crumb.
12. `app/routes/root.route.tsx` — register; `route-lazy.test.ts` `56 → 59`.

### Phase 3 — host wiring + gates
13. `app/api/api-client.ts` — `automations` namespace.
14. `app/nav-registry.ts` — move `Automations` into `Operations`; drop the now-empty
    `Planned` group's item (and the group if it empties); update `app-shell.test.tsx`.
15. `.eslintrc.js` — `**/automation/{api,hooks,components,lib,types}/**` into **both** groups.
16. `scripts/check-ui-vocabulary.mjs` — `pending: true → false` for the automation root.
17. `docs/frontend-architecture.md` — the new slug in the cross-feature list.

### Phase 4 — tests
- `automation-trigger-index.test.tsx` — 8 rows with counts; the zero-rules card appears at
  all-zero and disappears once any count is non-zero.
- `action-availability.test.ts` — the three-value mapping, exhaustively.
- `automation-rules-list.test.tsx` — an `unavailable` step renders its chip and its reason; a
  read-only role sees no write control; deactivate issues a PUT carrying the full definition.
- `automation.schema.test.ts` — `null` survives every nullable field; a malformed row drops and
  is counted.

---

## 7. Alternatives Considered

- **Index-only, no `/automations/:trigger`.** Rejected: the ACs require per-rule rows with a
  one-click deactivate, and `GET /automations` refuses to list without a trigger, so the rules
  have nowhere else to live.
- **Fetch every trigger's rules on the index to compute `Last fired`.** Rejected: 8 list calls
  plus N run-log calls per page load, to render a field that is `null` in this build anyway.
- **Skip `/automations/activity` and drop the header action.** Rejected: it is an explicit AC.
  Registering an honest placeholder is cheaper than a blank page and cheaper than silence.

---

## 8. Validation & Risks

- ✅ `app → pages → features → shared`; `shared` untouched.
- ✅ Server state via TanStack Query; URL state via route params + search params; no global store.
- ✅ No `any`; every union exhaustive with a `never` check.
- **Risk — vocabulary-gate self-check.** Creating the folder while the root is `pending: true`
  passes vacuously; leaving it `true` after the folder exists is a *pending note*, not a failure,
  but shipping at least one `.tsx`/`*.copy.ts` under a `pending: false` root is what makes the
  scan real (Z3 fails an existing-but-empty root). Both halves land in the same commit.
- **Risk — `phase` is a banned word-mode term.** No run-log or lifecycle column header may use it.
- **Risk — the arm/disarm PUT.** It must resend `name`/`trigger`/`triggerConfig`/`conditions`/
  `actions`/`effectiveFrom`/`effectiveTo` from the loaded rule, or the narrowers null them. Arming
  a rule with an irreversible action additionally needs `moneyAcknowledged: true` → the UI asks
  before arming such a rule and surfaces the 400 verbatim otherwise.

---

## 9. Acceptance Criteria

- [ ] `features/automation` (singular) serves `/automations`; the slug matches in both
      `.eslintrc.js` groups and the vocabulary scan root
- [ ] `features/automation/index.ts` is the public barrel; a deep cross-feature import fails lint
- [ ] Every schema uses `.nullish()` (#939)
- [ ] Eight trigger rows with counts
- [ ] The §5.1 suggestion card renders verbatim at zero rules, disappears once any rule exists,
      and creates nothing
- [ ] The six actions' availability is rendered honestly on both the index panel and the rule row
- [ ] `Run log` header action opens `/automations/activity`
- [ ] Deactivate is one click, reversible, and deletes no history
- [ ] A read-only role sees the list and no write control
- [ ] Component tests; usable at 375 px
- [ ] `pnpm lint` / `type-check` / `test` green

---

## 10. Alignment Checklist

- [x] Follows the FE layering rules
- [x] Reuses existing patterns (no new shared primitive, no new row height)
- [x] Uses only contracts #2363 actually ships
- [x] No migration
- [x] Testing strategy complete
- [x] Naming conventions followed
- [x] Execution-ready

# Implementation Plan: automation run log + timeline rendering (#2386)

**Date**: 2026-08-27
**Status**: Ready for Review — **two scope questions for the orchestrator**
**Estimated Effort**: ~1 day (size M)

---

## 1. Task Summary

`/automations/activity` — the cross-rule run log, counterpart to `/sync/jobs`, answering *"what
has been happening?"* when the operator has no specific order in hand. #2385 persists the history;
without a surface it is a table nobody reads.

The route **already exists**: #2364 registered it with a placeholder whose header says *"Replace
this body when W2-48 lands. Do not delete the route."* This is that replacement, so
`EXPECTED_LAZY_ROUTE_COUNT` stays **59**.

---

## 2. Two scope questions — reported before implementing

### SQ1 — The 90-day retention footer would state a policy NOTHING ENFORCES

The issue asks for a footer reading *"Runs older than 90 days are removed."*, with the stated
purpose that *"an empty older window is a known fact rather than suspected data loss"*.

**There is no retention job.** `grep` over `apps/worker/src`, the scheduler task list and the
automation context finds no prune, no cron, no `DELETE` against `automation_runs`. The 90-day
figure appears only as *prose* in `automation-trigger-firing.entity.ts`, which cites it to explain
why firings are a **separate** table (*"§5.6 keeps runs for 90 days; this guarantee is forever"*).

So rendering that sentence would make the UI assert something false about the operator's own data
— the exact defect class this wave keeps closing, and the third time this body has caught one.
It is also **worse than silence**: the sentence exists to explain an empty older window, so an
operator who sees one would conclude "retention removed them" when the real cause is something
else entirely.

**DECIDED: do not implement the prune, and do not ship the AC's sentence.**

The footer reads *"Every automation run recorded so far is listed here."* — true today, and it
serves the stated purpose better, because an absence then genuinely means nothing fired. It carries
a **code comment tying it to the retention follow-up**, because it must not be a promise about
deletion **in either direction**: it becomes false the day a prune lands.

The `automation.runs.prune` sweep is on the wave follow-up list. Deleting operator data deserves
its own decision, not a footnote in a filter issue.

### SQ2 — Five URL filters need backend support this "Frontend"-typed issue does not include

The issue requires `ruleId`, `trigger`, `outcome`, `from`/`to`, `orderId`.
`GET /automations/runs` (#2385) accepts only `subjectKind`, `subjectId`, `limit`, `offset`.

- `orderId` → covered (`subjectKind=order&subjectId=`).
- `ruleId` → the repository has `findRecentByRuleId`, but the feed endpoint does not expose it.
- `trigger`, `outcome`, `from`/`to` → **no backend read exists at all.**

Filtering client-side over one page would be a filter that silently lies: it would hide rows from
the page it fetched while the operator believes it searched the log. So the endpoint must widen.

**Recommendation — widen it here** (a filter object on the port + repository + controller query
params). It is additive, needs no migration, and the alternative is shipping filters that do not
filter. Noting it because the issue is typed *Frontend* and this is a core + api change.

---

## 3. Decisions

**D1 — The filter layer mirrors `returns-filters.ts` exactly, and unrecognised values are handled
ASYMMETRICALLY.** `AUTOMATION_ACTIVITY_FILTER_PARAMS` + `readActivityFilters` +
`hasActiveActivityFilters` + `clearActivityFilters` + `setActivityFilterParam` /
`setActivityOffsetParam`.

The AC says an unrecognised value is *ignored, never thrown*. #2385's `listRunFeed` **throws** for
an unrecognised `subjectKind`, and that was deliberate and defended. Both are right, for different
reasons, and the difference is what a wrong answer would look like:

- **A NARROWING filter that cannot be honoured is IGNORED** (`trigger`, `outcome`, `from`/`to`).
  The result is *wider* than asked — visible to the operator, and recoverable by fixing the URL.
- **A SUBJECT SCOPE that cannot be honoured THROWS** (`subjectId` without a valid `subjectKind`).
  The result would be data from *other* subjects, which the operator **cannot detect by looking**.

The frontend coerces before sending, so it never emits an invalid narrowing value; the backend rule
is defence-in-depth rather than the primary path.

**There is no `is*` guard for a date**, so `from`/`to` need one of their own: `readIsoDateParam`
returns `null` for anything unparseable, beside the enum coercions. Without it `from=banana` has no
handler at all — `new Date('banana')` either throws at the query layer or matches nothing, and both
violate the AC.

**D2 — The outcome vocabulary is the closed four, and two of them are NOT failures.**
`Done` / `Failed` / `Nothing to do` / `Blocked`. `AUTOMATION_RUN_OUTCOME_COPY` already exists as
`as const satisfies Record<AutomationRunOutcome, string>` (#2385) and is reused, not re-authored.
**`Nothing to do` and `Blocked` must never render as failures or feed any attention count** —
`Nothing to do` is a rule that fired and found the work already done, and `Blocked` is the
two-money-rules case where *nothing ran*. Toned `neutral` and `warning`, never `error`.

**D3 — `Blocked` rows still cannot appear, and the page says so TO THE OPERATOR.**
#2385 D8 deferred the `blocked` writer (the #2362 gate refuses before dispatch and reports
nothing back), so no `blocked` row exists to render. The vocabulary is implemented in full — the
column, the filter option and the copy — because the value is declared and a filter that silently
omits one of four documented outcomes is its own lie. It simply matches nothing today.

A code comment would serve a reviewer; an **operator** filtering by `Blocked` sees an empty list
that reads as *"no collisions have occurred"* when the truth is *"collisions are not recorded in
this build"*. That is exactly the distinction `recordingAvailable` exists to make elsewhere in this
feature, so it is applied to the filter: when `Blocked` is the active outcome filter and the result
is empty, the empty state says so.

**D4 — Three link targets, and the `sync_jobs` link appears exactly when the step dispatched one.**
`step.syncJobId` is the discriminator; absent means no link, never a dead one. Target is
**`/jobs-logs/:id`** — the detail route — not `/jobs-logs?jobId=`, which that page ignores
(#2366's fix; the same mistake must not be re-made here).

**D5 — The order timeline gains the run OUTCOME, anchored to `stepIndex === 0`.** #2385 renders
per-step title / description / tone plus the rule, trigger and timestamp, but never names the run's
overall outcome, which the AC asks for. It attaches to one event per run, not every step — a
run-level fact repeated per step would state N times something true once.

The anchor is **`stepIndex === 0`**, a property of the data, NOT "the first event emitted". Every
event of one run shares `run.firedAt`, so their relative order after the timeline's chronological
sort is insertion order — fragile against any future re-sort.

**D7 — Pagination is next/prev, never numbered.** The feed pages by `limit`/`offset` and
`AutomationRunLogPage` carries `hasMore` but deliberately **no `total`** — #2363's read service
refuses to pay for a second scan of the partition to firm up a "maybe". So no "page 3 of 9" and no
result count is possible; nobody should design one against a total that does not exist. Page size
is `AUTOMATION_RUN_LOG_PAGE_SIZE` (50), which also caps `limit` server-side.

**D6 — Two empty states, distinguished.** "No automations yet" (no rules exist) and "no firings
yet" (rules exist, none has fired) are different operator situations with different next actions.
The first links to `/automations`; the second says the rules are armed and waiting. Distinguishing
them needs the rule *summary*, which `useAutomationSummaryQuery` (#2364) already provides.

---

## 4. Implementation Plan

### Phase 1 — backend filter widening (SQ2)
1. `AutomationRunRepositoryPort` — `findRecent` takes an `AutomationRunFilters` object
   (`ruleId?`, `trigger?`, `outcome?`, `from?`, `to?`, `subjectKind?`, `subjectId?`) + page.
2. Repository — a query builder over the existing indexes; `firedAt` range via `Between`.
3. `IAutomationRunsReadService.listRecent` takes the same filters.
4. Controller — the query params, each coerced through its `is*` guard, **unrecognised ignored**.

### Phase 2 — feature slice
5. `api/automation.types.ts` — `AutomationRunFilters` view type.
6. `api/automation.api.ts` — `listRunFeed(filters, pagination)`.
7. `hooks/use-automation-run-feed-query.ts`.
8. `lib/automation-activity-filters.ts` — the D1 filter layer.
9. `lib/automation.copy.ts` — the page copy, including the honest footer sentence (SQ1).

### Phase 3 — the page
10. `components/automation-activity-table.tsx` — six columns, `DataTable` + `cardView`.
11. `pages/automations/automation-activity-page.tsx` — replaces the #2364 placeholder body.
12. `/automations` header `Run log` action already links here (#2364); a rule row gains
    `See all runs for this rule →` opening it pre-filtered.

### Phase 4 — the order timeline
13. `lib/automation-timeline.ts` — add the run outcome to the first event of each run (D5).

### Phase 5 — tests
- an unrecognised filter value is ignored, not thrown (each of the five)
- `Nothing to do` and `Blocked` render neither as failures nor in any attention count
- the `sync_jobs` link is present exactly when `syncJobId` is set, and points at `/jobs-logs/:id`
- a failed firing shows its reason inline and names the steps that did not run
- the two empty states are distinguished
- `When` is the default descending sort
- the footer states only what is true (SQ1)

---

## 5. Risks

- **Docker wedged**: no integration run. The filter coercion and the query-builder shape are
  unit-testable; a real `Between` over `firedAt` against Postgres is not. Anything needing it is
  written, committed and **named unverified**.
- **`EXPECTED_LAZY_ROUTE_COUNT` stays 59** — the route already exists.

---

## 6. Acceptance Criteria

- [ ] `/automations/activity` is a child route of `/automations`, no nav entry of its own
- [ ] `.nullish()` on every new schema (#939)
- [ ] All six columns; `When` default descending
- [ ] All five filters work; an unrecognised value is ignored
- [ ] Three link targets per row; `sync_jobs` link exactly when the step dispatched a job
- [ ] Closed four-outcome vocabulary; `Nothing to do` / `Blocked` never render as failures
- [ ] The footer states only what is true today, with a comment tying it to the retention
      follow-up (SQ1) — and never claims runs are deleted
- [ ] `from=banana` is ignored, not thrown (`readIsoDateParam`)
- [ ] Filtering by `Blocked` on an empty result says collisions are not recorded in this build
- [ ] A failed firing shows its reason and names the skipped steps
- [ ] The order timeline names rule, trigger, timestamp and outcome, linking to the rule
- [ ] Empty state distinguishes "no automations" from "no firings"
- [ ] Responsive; TanStack Query owns server state; `shared` imports no feature

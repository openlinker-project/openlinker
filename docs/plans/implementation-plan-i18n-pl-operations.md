# Implementation Plan: Polish translation, batch B - operations (#3887)

## 1. Task understanding

**Goal.** A Polish value for every key of batch B's namespaces (extraction issues #3874-#3876), so the
operations screens read in Polish. Data only: `locales/pl/<namespace>.json` + `pl/index.check.ts`; no
component change. Same rules as #3886 (glossary, four plural forms, budgets, no em dash).

| Namespace | Strings | Plurals | Extracted in | Lives on branch |
|---|---|---|---|---|
| `returns` | 474 | 4 | #3874 | `3874-i18n-returns` -> `3875-...` |
| `bench` | 415 | 7 | #3875 | `3875-i18n-bench-fulfilment-oms` |
| `fulfillment` | 240 | 3 | #3875 | same |
| `fulfillment-authority` | 170 | 0 | #3875 | same |
| `oms-core` | 219 | 1 | #3875 | same |
| `shipments` | 144 | 5 | #3876 | main chain (`3876` ... `3886`) |
| `inventory` | 529 | 16 | #3876 | main chain |
| `automation` | 336 | 4 | #3876 | main chain |

About 2,500 strings.

## 2. The stack splits here

#3874 and #3875 sit on a side branch off #3873 (`3873 -> 3874 -> 3875`, PRs #3947 / #3948); the main chain
(`3873 -> 3876 -> ... -> 3886`) does not contain `returns`, `bench`, `fulfillment`, `fulfillment-authority`
or `oms-core`. A Polish file needs its English file on the same branch, so batch B cannot be one branch on
top of #3886 without merging the side branch into the main chain.

**Decision: one branch, one PR** (`3887-i18n-pl-operations`, base `3886-i18n-pl-daily-screens`). The side
branch `3875-i18n-bench-fulfilment-oms` (which contains #3874) is merged into it first; the four conflicts
(`.eslintrc.js` and `check-i18n-lint-rule.mjs` scopes, `limits.json`, `locales/en/index.ts`) are unions of
both sides. `tsc -b` and `check:invariants` pass after the merge. The PR diff against #3886 therefore also
shows the #3874 / #3875 extraction, which stays reviewed in #3947 / #3948.

## 3. Steps (2 agents, no tsc / tests)

1. Agent A: `returns`, `bench`, `oms-core`.
2. Agent B: `fulfillment`, `fulfillment-authority`, `shipments`, `inventory`, `automation`.
3. Me: index files, sort, coverage script, `check-locales`, `check:invariants`, `tsc -b` for apps/web, commit locally,
   push, one draft PR.

## 4. Still needed after this

A Polish speaker's on-screen review in `pl` and the overflow screenshot pass (acceptance criteria).

# Implementation Plan: i18n extraction 8/18 - bench, fulfilment and OMS (#3875)

## 1. Task understanding

**Goal.** Move every operator-visible English string in `features/bench`, `features/fulfillment`,
`features/fulfillment-authority`, `features/oms`, `pages/bench`, `pages/fulfillment` and `pages/oms`
into core namespaces of `apps/web/src/locales/en.json`, delete the copy modules, and switch the
no-literal-text lint on for these folders. English only; Polish lands with batch B.

**Layer.** Frontend (`apps/web`). Stacked on #3874 (branch `3874-i18n-returns`), because the attention
mirror compares `fulfillment-authority` titles with the returns titles #3874 moved into `en.json`.

**Non-goals.** Polish text; server `error.message` (error-code track); `plugins/oms` (#3885).

## 2. Findings (branch 3874 @ 0e97fab64)

- Inventory: 731 rows in 33 files, 614 of them already in copy modules. The area is much larger:
  about 170 non-test files, ~25,000 lines.
- **13 copy modules** (the issue names 9): bench-parcel, bench-work, bench-identity,
  bench-connectivity; who-decides, attention-reason; assign-packing-work, fulfillment-task,
  fulfillment-work-detail, fulfillment-worklist, routing-decision; sourcing-rule, routing-dry-run.
- **Used outside the area**: `attentionTitle` (orders `order-edited-badge.tsx`, products list page),
  `ATTENTION_REASON_COPY` (products list page), `WHO_DECIDES_PAGE_COPY` (`pages/settings/who-decides-page.tsx`).
  These keep their names and shapes and read copy when read.
- **Scripts reading these copy modules** - must be rewritten to read `en.json`:
  - `check-attention-reason-mirror.mjs` M4/M5/M6: reads `ATTENTION_REASON_COPY` / `ATTENTION_BADGE_COPY`
    entries IN ORDER. A sorted JSON cannot keep order, so for the copy map the rule becomes "exactly one
    entry per value" (order stays enforced between core and the FE value arrays), the approach #3870
    took in `check-fulfillment-reason-mirror.mjs`.
  - `check-spec-owned-copy.mjs`: reads the attention titles from `attention-reason.copy.ts`.
  - `check-sourcing-rule-vocabulary-mirror.mjs` compares value arrays only - untouched.
  - `check-ui-vocabulary.mjs` names `fulfillment-task-copy.ts` in a comment only.
- **Namespace clash**: `oms` is a plugin id; the registry refuses a second `oms` namespace. Core
  `features/oms` copy goes to **`oms-core`** (the issue's suggestion).
- `(grams / 1000).toFixed(1)` in bench parcel copy -> `useFormat().number`.
- British "fulfilment" in copy, "fulfillment" stays in identifiers and keys.
- 79 em dashes, 6 plurals, 10 zod messages.

## 3. Design

| Namespace | Holds |
|---|---|
| `bench` | pack bench: parcel, work, identity, connectivity, topbar, documents |
| `fulfillment` | assign packing work, task card / dialog / actions, worklist, work detail, routing decision |
| `fulfillment-authority` | who decides (page, rows, presets, confirm), attention reasons and badges |
| `oms-core` | sourcing rules (table, dialog, delete / locked dialogs, tile, page), routing dry run |

- Former copy constants map 1:1 onto sub-keys (property names kept); function fields become template
  or plural keys.
- Helpers outside React read `getMessages(ns)` when called; zod schemas become factories.
- Lint scope += the seven folders; `EXPECTED_SCOPE` updated.

## 4. Steps (sequential, light on the machine)

At most 2 agents at a time, no per-agent type-check (CI runs it):

1. **Agent A**: `features/bench` + `pages/bench` -> `bench`.
2. **Agent B**: `features/oms` + `pages/oms` -> `oms-core`.
3. Then **Agent C**: `features/fulfillment` + `pages/fulfillment` -> `fulfillment`.
4. **Me**: `features/fulfillment-authority` -> `fulfillment-authority`, including the two mirror scripts
   (attention order rule, spec-owned titles) and the three outside consumers.
5. **Integration (me)**: limits, lint scope, one ESLint pass, `check:invariants`, `i18n:sort`, key check
   script; no local tsc.

## 5. Risks

- The attention mirror loses its ORDER check for copy maps (kept for value arrays); stated in the script.
- `oms-core` name: a namespace not equal to its feature folder - noted in the namespace's sub-keys and
  plan; alternative is putting the copy into the `oms` plugin namespace (#3885).

# Implementation Plan: i18n extraction 7/18 - returns (#3874)

## 1. Task understanding

**Goal.** Move every operator-visible English string in `features/returns` and `pages/returns` into
the `returns` namespace of `apps/web/src/locales/en.json`, read it with `useMessages('returns')` /
`getMessages('returns')`, delete the 14 copy modules, and switch the no-literal-text lint on for both
folders. English only; Polish lands with the batch B translation issue.

**Layer.** Frontend (`apps/web`). Stacked on #3873 (branch `3873-i18n-products-customers`).

**Non-goals.**
- Polish text.
- `backend-msg` rows (server `error.message`) - error-code track.
- `fulfillment-authority`'s own attention copy (#3875 area); only the mirror script that compares it
  with the returns titles changes here.

## 2. Findings (branch 3873 @ 180dd1097)

- 51 files in the inventory; the area has 52 non-test source files plus 3 pages.
- **14 copy modules** (`lib/*.copy.ts`, `restock-target-copy.ts`) hold about half the rows. Most are
  re-exported from the `features/returns` barrel as `*_COPY` constants plus helpers
  (`describeLineQuantity`, `describeUnreadableLines`, `describeRange`, `describeUnreadableRows`).
- **Consumers outside the area**: only `pages/orders/order-detail-page.tsx` (components and hooks, no
  copy). `correction-line-grid.tsx` and `attention-reason.copy.ts` mention copy names in comments only.
- **42 test files** import copy constants to assert text. They switch to reading the namespace
  (`getMessages('returns')...`); assertions stay on the same English.
- **Mirror** `scripts/check-attention-reason-mirror.mjs` compares two returns titles byte for byte
  (`RETURN_ORPHAN_BANNER_COPY.title` in `return-detail.copy.ts`, `RETURN_RESTOCK_BLOCKED_COPY.title` in
  `restock-blocked.copy.ts`) with fulfillment-authority's attention copy. Both files are deleted, so
  the script must read `en.json` instead (same approach #3870 took for its mirrors).
- `check-return-stage-mirror.mjs` reads `return-stage.types.ts` (values, not copy) - untouched.
- `return-restock-blocked-notice.tsx` builds sentences from fragments -> whole-sentence keys.
- 69 em dashes, 14 plurals, 22 zod messages (`record-return-dialog.schema.ts` -> factory).
- "authority" is banned by `check-ui-vocabulary`.

## 3. Design

- **Namespace `returns`**, one sub-key per former copy module / component:
  `detail`, `custody`, `list`, `proposal`, `recordReturnDialog`, `restockBlocked`, `restockTarget`,
  `timeline`, `orphanWorklist`, `matchReturnDialog`, `money`, `orderReturnsPanel`, `activity`,
  `authorizeReturnDialog`, plus component sub-keys where a component has inline copy.
- **Fixed keys for the mirror**: `returns.detail.orphanBanner.title` and `returns.restockBlocked.title`.
- **Barrel**: the `*_COPY` constants are deleted with their modules (no consumer outside the area
  uses them); the `describe*` helpers stay exported with the same signatures and read copy at call
  time.
- **Helpers outside React** (`*-error.ts`, `return-row.ts`, `return-segments.ts`,
  `return-timeline-events.ts`) read `getMessages('returns')` when called.
- **Zod**: `createRecordReturnFormSchema(copy)` built with `useMemo`.
- **Plurals / formats**: `usePlural` / `formatPlural`, `useFormat` for money, dates, numbers, lists.
- **Lint**: `no-literal-string` scope += `features/returns/**/*.tsx`, `pages/returns/**/*.tsx`;
  `EXPECTED_SCOPE` updated.

## 4. Steps

Parallel agents on disjoint files, one brief, locked merge into `en.json`:

1. **Detail + proposal**: `return-detail.copy.ts`, `return-proposal.copy.ts`, `pages/returns/return-detail-page.tsx`,
   `correction-proposal-panel.tsx`, `return-decline-action.tsx`, `decline-error.ts`, `return-orphan-banner.tsx`,
   `return-lines-table.tsx`, `return-line-state-chips.tsx`, `authorize-*`, `authorize-error.ts`.
2. **Custody + restock**: `return-custody.copy.ts`, `restock-blocked.copy.ts`, `restock-target-copy.ts`,
   `return-custody-panel.tsx`, `return-receive-form.tsx`, `return-dispose-form.tsx`,
   `return-not-returned-action.tsx`, `return-restock-blocked-notice.tsx`, `custody-error.ts`,
   `return-stage-cell.tsx`.
3. **List + worklist**: `returns-list.copy.ts`, `orphan-returns-worklist.copy.ts`,
   `pages/returns/returns-list-page.tsx`, `return-segments.ts`, `return-segment-strip.tsx`, list cells
   (`return-identity-cell`, `return-order-cell`, `return-opened-cell`, `return-source-status`),
   `return-row.ts`, `orphan-returns-worklist.tsx`, `returns-filters.ts`.
4. **Dialogs, money, timeline**: `record-return-dialog.*`, `record-error.ts`, `match-return-dialog.*`,
   `match-error.ts`, `return-money.copy.ts`, `return-money-panel.tsx`, `refund-error.ts`,
   `order-returns-panel.*`, `return-timeline.copy.ts`, `return-activity.copy.ts`,
   `return-activity-timeline.tsx`, `return-timeline-events.ts`, `api/*.schema.ts` (operator text only).
5. **Integration (me)**: barrel exports, tests that import deleted constants, mirror script reads
   `en.json`, `limits.json`, lint scope, quality gate (tsc, ESLint, `check:invariants`, `i18n:sort`).

Cross-group imports (a component reading another group's copy module) switch to `useMessages('returns')`
on the fixed sub-keys above, so no group waits on another's file.

## 5. Risks

- 42 test files touch copy constants: the integration step rewrites their imports; English is unchanged,
  so assertions keep their meaning.
- The mirror must keep failing on drift after the move - verified by its own self-check fixtures.

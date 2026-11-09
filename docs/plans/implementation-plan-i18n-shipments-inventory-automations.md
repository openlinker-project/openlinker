# Implementation Plan: i18n extraction 9/18 - shipments, inventory and automations (#3876)

## 1. Task understanding

**Goal.** Move every operator-visible English string in `features/automation`, `features/inventory`,
`features/shipments`, `pages/automations`, `pages/inventory` and `pages/shipments` into the
`automation`, `inventory` and `shipments` namespaces of `apps/web/src/locales/en.json`, read it with
`useMessages` / `getMessages`, fold in the copy modules, and switch the no-literal-text lint on for the
six folders. English only; Polish lands with the batch B translation issue.

**Layer.** Frontend (`apps/web`). Stacked on #3873 (branch `3873-i18n-products-customers`); runs in
parallel with #3874 (returns), which touches none of these folders.

**Non-goals.**
- Polish text.
- `backend-msg` rows (server `error.message`) - error-code track.
- Carrier brand names (InPost, DPD, Paczkomat) - they stay as they are, as data or params.

## 2. Findings (branch 3873 @ 180dd1097)

- Inventory: 976 rows in 41 files. The area is larger: automation 39, inventory 43 and shipments 30
  non-test files, plus 8 page files (about 16,500 lines); 55 test files.
- **Copy modules**: `automation/lib/automation.copy.ts` (287 rows, the largest single source),
  `inventory/lib/inventory-locations-tile.copy.ts`, `inventory/lib/stock-movement-copy.ts` (not in the
  inventory, same treatment), `shipments/lib/cancel-shipment-copy.ts`.
- **Consumers outside the area** (orders, already migrated in #3870): `AUTOMATION_ACTION_LABELS`,
  `AUTOMATION_TRIGGER_COPY` (`orders/lib/automation-timeline.ts`), `AUTOMATION_FAILURE_COPY`,
  `AUTOMATION_RUN_OUTCOME_COPY` (`orders/components/order-activity-timeline.tsx`) and
  `cancelShipmentCopy` (`orders/components/shipment-action-buttons.tsx`). These keep their exported
  names and shapes and read copy when read (getters / functions), so orders needs no change.
- **Mirror scripts** `check-automation-merge-field-mirror.mjs` and `check-retry-refusal-reason-mirror.mjs`
  compare value ARRAYS in `automation.types.ts`, not copy - untouched; must keep passing.
- `toLocaleString('en-US')` in `duplicate-positions-page.tsx` -> `useFormat`.
- Shipment status values are rendered raw -> label map with raw fallback.
- 17 plurals, 23 zod messages (`location-dialog.schema.ts`, `automation-composer.schema.ts` -> factories).
- `duplicate-positions-csv.ts`: CSV column headers are a file format, decide per header (operator-facing
  export -> copy).

## 3. Design

| Namespace | Holds |
|---|---|
| `automation` | rules list, composer (trigger, conditions, actions, merge fields), dry run, run log, activity table and page, availability notices, write / failure errors |
| `inventory` | locations page, location dialog + schema, delete dialog, locations tile, duplicate positions page + remediation modal + CSV, stock movements, stock correction |
| `shipments` | shipments page, row detail, triage strip, status / severity / processor badges, label download errors, cancel shipment, retryability, waybill relay badge |

- One sub-key per former copy constant (property names kept 1:1) or per component.
- Exported copy constants used by orders stay exported, now getters / functions reading copy.
- Helpers outside React read `getMessages(ns)` when called; zod schemas become factories.
- Plurals via `usePlural`; numbers, money, dates via `useFormat`.
- Lint scope += the six folders; `EXPECTED_SCOPE` updated.

## 4. Steps

Parallel agents, one brief, locked merge into `en.json`:

1. **Automation copy + composer**: `automation.copy.ts`, composer dialog, trigger / condition / action
   rows, merge fields, composer schema, write error, failure, availability notices.
2. **Automation views**: rules list, dry run panel, run log, activity table, pages/automations.
3. **Inventory**: everything in `features/inventory` and `pages/inventory`.
4. **Shipments**: everything in `features/shipments` and `pages/shipments`.
5. **Integration (me)**: barrels, tests importing deleted constants, `limits.json`, lint scope, quality
   gate (tsc, ESLint, `check:invariants`, `i18n:sort`).

## 5. Risks

- `automation.copy.ts` feeds both automation groups and orders: group 1 converts it first and merges its
  keys before group 2 reads them.
- 55 test files: the copy-importing ones switch to reading the namespace; English unchanged.

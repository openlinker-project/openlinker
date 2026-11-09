# Implementation Plan: i18n extraction 3/18 - orders (#3870)

Written after the fact, from what PR #3926 ships (review follow-up). It records the decisions so the next
extraction PRs and the Polish batch (#3886) can rely on them.

## 1. Task understanding

**Goal.** Move every operator-visible English string in `features/orders` and `pages/orders` into the
`orders` namespace, `apps/web/src/locales/en/orders.json` (one file per namespace, ADR-081 as amended by
#3920), delete the copy modules, and switch the no-literal-text lint on for both folders. English only.

**Non-goals.** Polish (#3886); server error codes (#3864, #3865); the orders backend.

## 2. Scope

- Far larger than the issue's inventory: about 170 files - list page and filters, health and routing, bulk
  actions, sales documents and refunds, shipping and labels, dispatch risk and failed orders, the detail page
  (notes, buyer note, timeline, holds), order edits and discounts, cancellation, tags, export and column
  presets.
- The 14 `*.copy.ts` / `-copy.ts` modules were folded into the namespace and deleted.

## 3. Decisions

- **Reading copy.** Components use `useMessages('orders')`; helpers outside React read `getMessages` when
  called, never at module level. Label constants became functions or tone maps plus lookups
  (`holdReasonLabel`, `paymentMethodLabel`, `describeRefundReason`), so a language switch reaches them; the
  removed constants (`STOCK_AT_RISK_BODY`, `REFUND_REASON_LABELS`, `REFUND_CONFIRMATION_COPY`,
  `HOLD_REASON_COPY`) had no consumers left outside orders.
- **New hooks.** `useStockAtRiskText` and `useOrderTagsCopy` give the shared copy to the row badge, the
  detail callout and the tag surfaces from one place.
- **Forms.** Zod schemas are factories taking the namespace slice (`create*Schema(copy)`), built with
  `useMemo`. Validation-copy and view types live in `*.types.ts` files, not in the schema or `lib` files.
- **Formatting.** Counts use `usePlural`; money, dates, numbers and lists go through `useFormat`; hand-rolled
  `.replace()` interpolation became `interpolate`; a link or bold word inside a sentence uses `renderRich`.
- **Server text.** A server `message` is never shown bare: it is wrapped in `orders.common.serverSaid`
  ("The server said: {message}") through `lib/server-error-text.ts`; the translated fallback stays for an
  empty message.
- **Raw enum values** (sync status, hold and cancel reasons, column roles) are shown through label maps with
  a raw-value fallback; returns, fulfilment and settings read them through orders' own exports.
- **Mirror scripts** (destination routing, handled-in-OpenLinker, fulfilment reasons) read their copy keys
  from `locales/en/orders.json`.
- **Export column labels** stay in `api/orders.types.ts`: they mirror the CSV headers core writes
  (`check-order-export-columns-mirror`).
- **Copy rules.** Plain hyphens, British spelling, operator wording (no permission ids or env vars), provider
  names passed as parameters, no "authority".
- **Budgets.** Table headers, filter and health chips, badges and the main action buttons carry character
  budgets in `locales/limits.json` (`orders:*`), so `check-locales` guards the Polish lengths.

## 4. Tests

- Tests that pin English keep passing; where the rules changed the English (em dash to hyphen, `2000` now
  formatted as `2,000`), the assertions follow the new copy.
- New: the bulk-actions view model, the server-message helper, a schema factory whose messages come from the
  copy argument, and the stock-at-risk text hook.

## 5. Lint

`features/orders/**/*.tsx` and `pages/orders/**/*.tsx` join the no-literal-text scope in `.eslintrc.js` and
`EXPECTED_SCOPE` in `scripts/check-i18n-lint-rule.mjs`.

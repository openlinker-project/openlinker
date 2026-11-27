# Implementation Plan: i18n extraction 13/18 - analytics and insights (#3880)

## 1. Task understanding

**Goal.** Move every operator-visible English string in `features/analytics`, `pages/analytics` and
`pages/insights` into the `analytics` namespace (`apps/web/src/locales/en/analytics.json`, ADR-081 as
amended in #3920), delete the copy modules, and switch the no-literal-text lint on for the three folders.
English only - nothing under `locales/pl/`.

**Layer.** Frontend. Base: `3879-i18n-sales-documents` @ 7d3349f72 (top of the stack).

**Non-goals.** Polish text; server `error.message`; the analytics backend.

## 2. Findings

- Area: `features/analytics` 91 non-test files (~9,400 lines, 49 components), `pages/analytics`,
  `pages/insights` (~1,100 lines).
- **Copy modules (3)**: `lib/data-coverage.copy.ts`, `lib/margin-copy.ts`, `lib/needs-attention.copy.ts`
  (+ its `.copy.test.ts`). No file outside analytics imports their constants.
- **Outside consumers** of `features/analytics` (orders `use-order-line-costs`, products list and cost
  prices pages) import hooks and helpers only - no copy.
- **Scripts**: `check-tax-rate-state-mirror.mjs` reads value arrays in `api/analytics-tax-coverage.types.ts`
  - untouched.
- **Issue notes**: developer wording in `analytics-kpi-strip.tsx` ("repo", "metrics spec", "FX stamp
  sweep") -> operator wording; "Net sales" (10x), "GMV" (7x), "Not listed" (9x) repeated across tables ->
  one key each under `analytics.common`.

## 3. Design

- Namespace `analytics`; sub-key per component / former copy module; shared table terms in
  `analytics.common` (netSales, gmv, notListed), created first so both agents read them.
- Helpers outside React read copy when called; plurals via `usePlural`; numbers, money, percentages and
  dates via `useFormat`; zod (settings dialog) via a schema factory.
- Lint scope += `features/analytics/**/*.tsx`, `pages/analytics/**/*.tsx`, `pages/insights/**/*.tsx`.

## 4. Steps (light: 2 agents, no tsc, ESLint once each)

1. Me: `analytics.common` keys; lint scope.
2. Agent A: KPI strip, settings dialog, data coverage panel + dialog + alerts, needs-attention, trust
   header, degradation banner, convert / exclusion notes, currency picker, net-gross toggle, KPI card,
   recalculating value, date-range toolbar; `data-coverage.copy.ts`, `needs-attention.copy.ts`,
   `display-currency.lib.ts`, `date-range.lib.ts`, `ingestion-trust.lib.ts`.
3. Agent B: channel / product sales tables, variant-channel matrix, channel publish action, margin
   (`margin-copy.ts`), the remaining components and lib view-models, `pages/analytics`, `pages/insights`.
4. Me: limits, key check, one ESLint over the area, `check:invariants`, local commit.

## 5. Risks

- Tests pin English in large table tests (product / channel sales); English stays identical except em
  dashes and the developer wording the issue asks to rewrite.

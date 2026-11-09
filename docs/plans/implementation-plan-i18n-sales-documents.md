# Implementation Plan: i18n extraction 12/18 - sales documents, invoicing and fiscalization (#3879)

## 1. Task understanding

**Goal.** Move every operator-visible English string in `features/sales-documents`, `features/invoicing`,
`features/fiscalization`, `pages/sales-documents` and `pages/invoicing` into the `sales-documents`,
`invoicing` and `fiscalization` namespaces of `apps/web/src/locales/en.json`, delete the copy modules,
replace the legacy `t(key, fallback)` calls, and switch the no-literal-text lint on. English only.

**Layer.** Frontend. Base: `3877-3878-i18n-connections` @ 04bff92d6 (latest local commit of the stack).

**Non-goals.** Polish text; server `error.message`; `plugins/ksef`, `plugins/infakt`, `plugins/eparagony`
(#3883 / #3884).

## 2. Findings

- Area: ~130 non-test files, ~14,700 lines.
- **Copy modules (4)**: `sales-document-reason-copy.ts`, `sales-document-market-outcome-copy.ts`
  (sales-documents), `sales-document-block-copy.ts`, `marketplace-upload-copy.ts` (invoicing).
- **Legacy `t(key, fallback)`**: 168 calls (invoicing 73, pages/invoicing 85, fiscalization 10) through
  `useTranslation()`. The keys (`invoice.field.number` ...) exist in no locale file, so the fallback is what
  renders. Each call becomes a `useMessages` read; the old key becomes the key path inside the namespace
  (`t('invoice.field.number', 'Number')` -> `invoicing.invoice.field.number = "Number"`), so the wording
  and the structure survive.
- **Scripts**:
  - `check-sales-document-reason-mirror.mjs` reads `SALES_DOCUMENT_GATE_REASON_COPY` /
    `SALES_DOCUMENT_UNRESOLVED_REASON_COPY` keys from `sales-document-reason-copy.ts` -> rewrite to read the
    keys from `en.json` (set compare, like #3875 / #3877).
  - `check-sales-document-market-summary-mirror.mjs` compares the TEXT of
    `summarizeSalesDocumentMarkets` with its copy in `apps/e2e/src/support/`. When the function starts
    reading copy, the e2e mirror changes identically (it reads the same English from `en.json`), and the
    normalisation rule gains that one difference if needed.
  - Value-array mirrors (fiscal reconcile / progress, condition field, shipping tax split) - untouched.
- "Invoice" / "Receipt" hardcoded in two places conflicts with `invoice.documentType.*` -> one key.
- `sales-document-block-copy.ts` builds sentences from vocabulary words -> whole-sentence keys.

## 3. Design

| Namespace | Holds |
|---|---|
| `sales-documents` | rules list / composer / engine panel, country routing and defaults, markets, templates, panel, list page, fiscal receipt detail page, the reason and outcome copy |
| `invoicing` | invoices list and detail pages, timeline, corrections, document type, status badges, numbering, issue errors, block copy, marketplace upload |
| `fiscalization` | receipt status badge, artefact list, receipt display |

Former copy constants map 1:1 onto sub-keys; exported helpers keep names and signatures and read copy when
called; schemas become factories (or read messages at validation time); plurals / formats via
`usePlural` / `useFormat`. Lint scope += the five folders.

## 4. Steps (light: at most 2 agents, no tsc, ESLint once each)

1. Agent A: `features/sales-documents` + `pages/sales-documents`.
2. Agent B: `features/invoicing` + `features/fiscalization` + `pages/invoicing` (incl. all `t()` calls).
3. Me: the two scripts (reason mirror, market-summary e2e mirror), limits, key check, `check:invariants`,
   commit locally.

## 5. Risks

- The market-summary mirror compares function text with an e2e copy: both sides change together.
- 168 `t()` calls: wording must stay identical (the fallback text), only the source changes.

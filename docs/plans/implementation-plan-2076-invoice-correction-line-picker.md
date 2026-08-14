# Implementation Plan — #2076 Invoice correction line picker

**Issue:** #2076
**Branch:** `2076-invoice-line-reference`
**Layer:** Frontend only (no backend change, no migration)

---

## 1. The task

An operator issuing an invoice correction **types the original line number freehand** into a bare
`<input type="number" placeholder="1">`. No correction flow displays the invoice's lines. They are
numbering rows they cannot see.

This has already produced a bad fiscal document. `infakt-invoicing.adapter.ts:701` records it:

> reproduced live 2026-07-29: an `originalLineNumber: 99` typo produced `3/KOR/07/2026` with
> `gross_price: 0`

That document went to KSeF, where the legal issue date is authority-assigned and not retractable.

**Goal:** the operator **picks a line** instead of typing a number, so `originalLineNumber` is
derived from the position of the row they clicked.

### Non-goals

- **A stable line reference on `InvoiceLine`** (the issue's original proposal). It disambiguates for
  the *machine*; the defect is *human*. It also adds a permanent dual path, because snapshots
  persisted before the field exists never carry it. Deferred with a stated trigger — see § 7.
- Any backend change. See § 2.
- Changing the `CorrectionLine` wire contract. Adapters index `originalLineNumber`; it stays.

---

## 2. The decisive research finding: no backend work is needed

The first draft of this plan proposed `GET /invoices/:invoiceId/correctable-lines`. **That endpoint
would have duplicated one that already exists.**

`GET /invoices/:invoiceId/content` returns `IssuedDocumentContentDto`, which carries `LineDto[]`.
And its indices are **provably** the ones `originalLineNumber` addresses:

| Path | Content built from | Snapshot persisted from | Same array? |
|---|---|---|---|
| Issuance (`invoice.service.ts:415`, `:419`) | `buildContent(cmd, …)` ← `cmd.lines` | `lines: cmd.lines` | **yes** |
| Correction (`:752`, `:735`) | `buildContent({ lines: correctedLines, … })` | `lines: correctedLines` | **yes** |

`buildContent` is `cmd.lines.map(...)` (`:864`) — order-preserving, 1:1, no filtering. So
`documentContent.lines[i]` ↔ `issuedLineSnapshot.lines[i]` on both paths, **by construction within
the same method call**.

That is the correctness requirement this feature turns on: *the operator must pick from the same
list the adapter indexes.* It is already satisfied by an endpoint that ships.

**Consequence:** the whole change is frontend. No new endpoint, no new DTO, no projection decision,
no controller-layer question about reusing private derivation helpers.

---

## 3. Design

```
GET /invoices/:invoiceId/content   (exists)
        │
        ▼
invoicing.api.ts  getContent()            ← new transport method
        │
        ▼
use-invoice-content-query.ts              ← new TanStack query hook
        │
        ▼
CorrectionLinePicker (features/invoicing) ← new shared component
        │
   ┌────┴────┬─────────┐
   ▼         ▼         ▼
 infakt    ksef     subiekt                ← three flows, same picker
```

**One picker, in the feature, exported from the barrel.** The three correction flows live in
`plugins/{infakt,ksef,subiekt}/components/` and already import
`features/invoicing` (`infakt-invoice-correction-flow.tsx:28`), which
`frontend-architecture.md § Dependency Rules` explicitly permits. Three copies of a picker is the
obvious failure mode and would triplicate the next fix.

### Fallback: records with no content

`/content` **409s** when `documentContent` is null (`invoicing.controller.ts:1373`) — a pending
invoice, an adapter that captured no content, or a row predating the column. The picker degrades to
the current freehand input **with a visible warning**, rather than blocking the correction. Stranding
a real document is worse than the status quo for those rows.

### Unit price

`LineDto` exposes `unitNet`, but `CorrectionLine.newUnitPriceGross` is **gross**. Showing net beside
an input labelled gross invites the exact class of error being fixed. The picker displays
`quantity`, `name`, and the per-line **`gross`** (both present on `LineDto`), and prefills
`newUnitPriceGross` from `gross / quantity` when the operator picks a row.

---

## 4. Steps

| # | File | Change | Acceptance |
|---|---|---|---|
| 1 | `features/invoicing/api/invoicing.types.ts` | `IssuedDocumentContent` + `IssuedDocumentLine` transport types, mirroring the DTO. `camelCase` preserved. | Types compile against the real response shape |
| 2 | `features/invoicing/api/invoicing.api.ts` | `getContent(invoiceId): Promise<IssuedDocumentContent>` | Calls `GET /invoices/:invoiceId/content` |
| 3 | `features/invoicing/api/invoicing.query-keys.ts` | `content: (invoiceId) => ['invoicing','content',invoiceId]` | Follows the existing key shape |
| 4 | `features/invoicing/hooks/use-invoice-content-query.ts` | Query hook; **must not retry a 409** (it is a terminal "no content", not a transient failure) | Returns lines, or a flag that content is unavailable |
| 5 | `features/invoicing/components/correction-line-picker.tsx` | Shared picker: renders lines with 1-based position, name, qty, gross; `onSelect(lineNumber, unitGross)`. Freehand fallback + warning when unavailable. | Emits the 1-based index of the chosen row |
| 6 | `features/invoicing/index.ts` | Export the picker + hook | Barrel-only surface |
| 7 | `.eslintrc.js` | Add `invoicing` slug to **both** `no-restricted-imports` groups | Deep imports into the feature fail lint |
| 8 | `plugins/{infakt,ksef,subiekt}/components/*-correction-flow.tsx` | Replace the number input with the picker | `originalLineNumber` derived from row position |
| 9 | Tests | Picker unit test + one flow test asserting the submitted `originalLineNumber` equals the chosen row's 1-based index | That assertion **is** the fix |

---

## 5. Validation

- **Architecture:** frontend-only; dependency direction `plugins → features → shared` respected; no
  raw `fetch` (goes through `useApiClient`); server state in TanStack Query per
  `frontend-architecture.md § State Management`.
- **Naming:** `kebab-case.tsx` component file with a `PascalCase` export; `use-*.ts` hook; types in
  `*.types.ts` — all per `frontend-architecture.md § Components And Pages`.
- **Security:** no new data exposure. `/content` already ships and is already role-open by the
  documented invoicing convention (reads open, writes `@Roles('admin')`,
  `invoicing.controller.ts:26-28`). This change adds no endpoint and widens no surface.
- **Accessibility:** the picker is a list of selectable rows with visible focus and a text label per
  row — colour is not a signal here. Tap targets ≥ 44 px on narrow viewports.

---

## 6. Risks

| Risk | Mitigation |
|---|---|
| `/content` 409s for older records → picker unusable | Freehand fallback + warning (§ 3). Explicitly in scope, not an afterthought. |
| A future change makes `buildContent` filter or reorder lines | The index equivalence in § 2 becomes false and corrections silently mis-target. **Pin it with a test in the same PR** asserting `documentContent.lines` and `issuedLineSnapshot.lines` are index-aligned after issuance. |
| Three flows drift | One shared component; the ESLint slug (step 7) keeps consumers on the barrel. |

The second risk is the one that matters. The whole fix rests on an invariant that is currently
guaranteed only by two call sites happening to pass the same array — nothing enforces it.

---

## 7. Deferred

**A stable line reference on `InvoiceLine`.** Not needed once selection is by picking: two
byte-identical rows produce the same correction either way, and rows differing in price are visibly
different to the person choosing. It becomes necessary when a **programmatic** correction caller
exists — the returns→correction mapper was the candidate, and it was cut with #1032 Wave 4.

Record on #2076 rather than closing the thought.

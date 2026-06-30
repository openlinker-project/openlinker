# Implementation Plan: Invoicing FE+BE — Close Mockup Gaps

**Date**: 2026-06-29
**Status**: Ready for execution
**Companion mockup**: `docs/plans/invoicing-ui-mockup.html` (the visual authority)
**Companion design**: `docs/plans/implementation-plan-invoicing-fe-redesign.md`
**Progress ledgers**: `docs/plans/invoicing-fe-progress.md`, `docs/plans/invoicing-backend-progress.md`

---

## 1. Task Summary

**Objective**: Close every remaining gap between the current `main` branch and the invoicing mockup at `docs/plans/invoicing-ui-mockup.html` (six screens: Order Detail invoice card, Invoices List, Invoice Detail, Connection Setup, Correction Form). This plan covers:

1. **The merge queue** — five open PRs that are fully implemented and reviewed but not yet merged (#1231 BE draft, #1232, #1233, #1234, #1235 FE).
2. **Small neutral-base UI gaps** — three elements in the Invoices List and Invoice Detail pages that are missing from the merged Wave A code.
3. **Visual polish** — specific CSS/layout adjustments to match the mockup exactly.

**Context**: Wave A FE (#1247), Subiekt FE (#1249), KSeF scaffold (#1191), FA(3) parsed XML (#1256), and all backend work items W1–W6 (#1214, #1238, #1244, #1246) are **already on `main`**. The six-screen mockup is therefore 60–70% live. This plan targets the remaining 30–40%.

**Classification**: Frontend (`apps/web`) + Backend merge gate.

---

## 2. Current State Audit (as of 2026-06-29)

### What IS on `main`

| Area | Shipped |
|---|---|
| Backend: `issueInvoice`, exactly-once gate, `failureMode`/`failureCode` | W1 #1214 ✓ |
| Backend: batch retry `POST /invoices/retry` | W6 #1246 ✓ |
| Backend: buyer-tax-id filter `GET /invoices?taxId=` | W5 #1244 ✓ |
| Backend: Subiekt correction + `getClearanceStatus` + bridge paths | W4 #1238 ✓ |
| FE: redesigned `OrderInvoicePanel` (all 8 states), `/invoices` list, `InvoiceDetailPage` shell, `InvoiceTimeline`, batch retry, tax-id filter | Wave A #1247 ✓ |
| FE: Subiekt detail section + correction flow | #1249 ✓ |
| FE: KSeF connection wizard + `ksef-invoice-detail-section` slot | #1191 ✓ |
| FE: FA(3) parsed XML visualization (parsed-XML tab on detail page) | #1256 ✓ |

### What is NOT on `main` (open PRs, fully implemented)

| PR | Branch | Contents | Blocker |
|---|---|---|---|
| **#1231** DRAFT | `1224-ksef-upo-endpoint` | `GET /invoices/:invoiceId`, `/upo`, `/document` backend endpoints + `sourceDocument` persist | Must un-draft; stacked on `1151-ksef-kor-corrections` (#1189) — check if base is now main-mergeable |
| **#1235** OPEN | `1222-ksef-invoices-page` | `/invoices` list: KSeF clearance ref column + `'Clearance ref.'` neutral fallback | None |
| **#1232** OPEN | `1223-ksef-seller-profile` | KSeF seller profile fields in connection wizard edit form | None |
| **#1234** OPEN | `1221-ksef-fa3-visualization` | KSeF UPO iframe preview + binary download button | Verify no conflict with #1256 (FA3 tab already merged) |
| **#1233** OPEN | `1220-ksef-manual-issue` | KSeF manual-issue dialog + `invoiceCorrectionFlow` slot (KOR) | Feature-gated on KSeF KOR backend (#1189) |

### Small gaps in merged Wave A code (not in any open PR)

| ID | Location | Gap | Mockup reference |
|---|---|---|---|
| **G1** | `pages/invoicing/invoices-list-page.tsx` | No "Clear filters" CTA when `hasFilters=true` | Screen 3: "Clear filters" link next to active filter row |
| **G2** | `pages/invoicing/invoices-list-page.tsx` | Empty-state has no action; mockup shows "Go to orders" CTA | Screen 3: empty-state CTA |
| **G3** | `pages/invoicing/invoice-detail-page.tsx` | No explicit back-link "← Invoices" in page header | Screen 4: `← Invoices` nav |
| **G4** | `pages/invoicing/invoices-list-page.tsx` | Filters are a plain flex toolbar; mockup shows labeled chip-style row | Screen 3: filter row design |
| **G5** | `apps/web/src/index.css` | No `.invoice-detail__skeleton` shimmer animation CSS (class referenced in code, styles missing) | Screen 4: loading skeleton |

---

## 3. Architecture Mapping

**Target layers**: `apps/web/src/{pages/invoicing, features/invoicing}` (gaps G1–G5); `apps/api/src/invoicing` (PR #1231 merge); `apps/web/src/plugins/ksef` (PRs #1232–#1235).

**No new ports, services, or migrations needed.** All backend contracts shipped. All plugin slots (`invoiceDetailSection`, `invoiceCorrectionFlow`) defined in Wave A. This plan only wires the remaining pieces and polishes the neutral base.

**Dependency direction preserved**: neutral shell in `pages/invoicing` → `features/invoicing` → `shared`. Plugin slots filled by `plugins/ksef` (zero `platformType` literals in neutral base).

---

## 4. Implementation Plan

### Phase 1 — Merge gate: unblock the backend endpoints (P1)

**P1.1 — Un-draft and merge #1231**

This is the highest-priority item. `GET /invoices/:invoiceId` (W2) and `GET /invoices/:invoiceId/document` (W3) are gated behind this DRAFT PR. Without it the `InvoiceDetailPage` always 404s.

Steps:
1. Check if #1231's base branch (`1151-ksef-kor-corrections` / #1189) is already merged to `main`:
   ```bash
   gh pr view 1189 --repo openlinker-project/openlinker --json state,mergedAt
   ```
   - If #1189 is merged → retarget #1231 to `main` (`gh pr edit 1231 --base main`).
   - If #1189 is NOT merged → either merge #1189 first (it's a DRAFT too, check its state), or extract just W2+W3 onto a new branch based off `main`.
2. Run scoped checks on the branch:
   ```bash
   pnpm --filter @openlinker/core type-check
   pnpm --filter @openlinker/api type-check
   pnpm --filter @openlinker/core test -- --testPathPattern=invoicing
   pnpm --filter @openlinker/api test -- --testPathPattern=invoicing
   ```
3. Mark #1231 ready for review (`gh pr ready 1231`), un-draft.
4. Merge.

**Acceptance**: `curl -b <session-cookie> http://localhost:3000/invoices/<id>` returns 200 with `InvoiceRecordResponseDto`; `InvoiceDetailPage` no longer shows 404.

---

### Phase 2 — Fix neutral-base UI gaps (P2)

These are small edits to already-merged pages. Group them in one commit on a dedicated branch off `main`.

**Branch**: `invoicing-neutral-base-gaps` (new, off `main`).

**P2.1 — "Clear filters" CTA** (`pages/invoicing/invoices-list-page.tsx`)

Add a button/link that calls `setSearchParams(new URLSearchParams())` when `hasFilters` is true. Per the mockup it appears as a secondary text link inline with the toolbar.

```tsx
{hasFilters && (
  <Button
    tone="secondary"
    className="button--sm button--ghost"
    onClick={() => setSearchParams(new URLSearchParams())}
  >
    {t('invoice.filter.clearAll', 'Clear filters')}
  </Button>
)}
```

File: `apps/web/src/pages/invoicing/invoices-list-page.tsx`

**P2.2 — Empty-state "Go to orders" CTA** (`pages/invoicing/invoices-list-page.tsx`)

When `!hasFilters` and no invoices, show an `action` on `EmptyState` pointing to `/orders`.

```tsx
<EmptyState
  title={t('invoice.list.empty.title', 'No invoices yet')}
  message={t('invoice.list.empty.none', 'When you issue an invoice from an order, it shows up here.')}
  action={
    <Link className="button button--secondary" to="/orders">
      {t('invoice.list.empty.cta', 'Go to orders')}
    </Link>
  }
/>
```

When `hasFilters` keep the current "Try clearing some filters" message without action.

File: `apps/web/src/pages/invoicing/invoices-list-page.tsx`

**P2.3 — Back-link in Invoice Detail** (`pages/invoicing/invoice-detail-page.tsx`)

The mockup shows `← Invoices` as a back-navigation element above the page title. Add it via `PageLayout`'s `backHref` prop (or equivalent — check `shared/ui/page-layout.tsx` for the correct prop name; if `backHref` is not supported, render a `<Link>` component above the grid).

```tsx
<PageLayout
  eyebrow="Operations"
  backHref="/invoices"    // ← if supported
  backLabel={t('invoice.detail.back', 'Invoices')}
  title={title}
  ...
>
```

File: `apps/web/src/pages/invoicing/invoice-detail-page.tsx`

**P2.4 — Invoice detail skeleton CSS** (`apps/web/src/index.css`)

The class `.invoice-detail__skeleton` is referenced in the detail page but has no CSS definition — it renders as an empty unstyled div. Add shimmer animation matching the page's two-column grid height.

```css
/* ── Invoice Detail skeleton (#1240 A4) ── */
.invoice-detail__skeleton {
  height: 400px;
  border-radius: var(--radius-md);
  background: linear-gradient(
    90deg,
    var(--bg-surface-muted) 25%,
    var(--bg-strong) 50%,
    var(--bg-surface-muted) 75%
  );
  background-size: 200% 100%;
  animation: shimmer 1.4s var(--ease-out) infinite;
}

@keyframes shimmer {
  0%   { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
```

File: `apps/web/src/index.css` — add in the `/* ── Invoice Detail (#1240) ── */` section.

Also add `--invoice-detail-skeleton-height: 400px` to `shared/theme/tokens.ts` if the drift-checker requires it (check if the `background` tokens used are already declared; the `shimmer` keyframe itself doesn't need a token).

**P2.5 — Test coverage for P2.1–P2.3**

Update `pages/invoicing/invoices-list-page.test.tsx`:
- Add: `should render "Clear filters" button when filters are active`
- Add: `should render "Go to orders" CTA in empty state when no filters`
- Update: snapshot / text assertions if changed

Update `pages/invoicing/invoice-detail-page.test.tsx`:
- Add: `should render back link to /invoices`

File paths:
- `apps/web/src/pages/invoicing/invoices-list-page.test.tsx`
- `apps/web/src/pages/invoicing/invoice-detail-page.test.tsx`

**Acceptance (P2)**: `pnpm --filter @openlinker/web lint && type-check && test` green; visual: "Clear filters" appears when a filter is set, disappears when cleared; detail page shows "← Invoices" above title; loading state shows a shimmer rectangle.

---

### Phase 3 — Merge remaining FE PRs in order (P3)

**P3.1 — Merge #1235** (invoices list KSeF columns)

No conflicts expected (Wave A and #1191 are on main, #1235 is a clean branch). Steps:
1. `gh pr checks 1235` — confirm CI green.
2. Merge: `gh pr merge 1235 --merge --repo openlinker-project/openlinker`.

Result: `/invoices` list now has the `Clearance ref.` column surface for KSeF invoices.

**P3.2 — Verify and merge #1232** (KSeF seller profile)

PR #1232 rewires `EditConnectionForm` to read and write nested `config.seller.*` fields for KSeF connections. Check for conflicts with merged #1191 (KSeF wizard). Steps:
1. `gh pr checks 1232` — confirm CI green.
2. If conflicts: rebase `1223-ksef-seller-profile` onto main, resolve, force-push.
3. Merge.

Result: Editing a KSeF connection shows seller NIP, name, address fields pre-populated from the saved config.

**P3.3 — Verify and merge #1234** (KSeF UPO iframe + download)

PR #1256 (FA3 parsed XML) was merged after #1234 was created. Verify that #1234 does not re-add FA3 parsing code that conflicts with #1256. Specifically:
1. Inspect diff: `gh pr diff 1234 --repo openlinker-project/openlinker | grep -A5 "fa3\|FA3\|parsed"`.
2. If #1234 still contains its own FA3 tab that duplicates #1256's work: rebase onto main and drop the duplicate section (keep only the UPO iframe + download button; the FA3 tab already lives in `ksef-invoice-detail-section.tsx` from #1256).
3. Confirm `pnpm --filter @openlinker/web test -- --testPathPattern=ksef` green.
4. Merge.

Result: Invoice detail for KSeF connections shows "Preview UPO" iframe and "Download UPO" button when `regulatoryStatus === 'accepted'`.

**P3.4 — Merge #1233** (KSeF correction flow)

PR #1233 provides the `invoiceCorrectionFlow` slot for KSeF (KOR document). It is feature-gated on the KSeF KOR backend trigger (#1189). Steps:
1. Confirm the feature-gate is in place (correction flow renders a "not available yet" stub if the backend 404s on `/invoices/:id/correct`).
2. `gh pr checks 1233` — CI green.
3. Merge.

Result: On a KSeF-issued invoice detail page, a "Issue correction (KOR)" button is visible. If the backend endpoint is not yet live it shows a graceful "feature coming soon" state. Once #1189 merges the full KOR flow lights up.

---

### Phase 4 — Visual polish pass (P4)

After P2 + P3 are merged, run a side-by-side comparison of each mockup screen vs. the live app. Target items from the mockup audit:

**P4.1 — Invoices list filter-row layout**

The mockup shows filters as a horizontal chip/label row with cleaner spacing. The current implementation uses a plain `.toolbar` flex div. Align the CSS:
- Add `label` text above each `<Select>` ("Status:", "Clearance:", etc.) or use `aria-label` + visible chip style.
- The `Input[type=date]` pair should be wrapped in a `.filter-group.filter-group--daterange` container with a "·" separator.
- All filter controls should have `white-space: nowrap` to prevent wrapping at medium widths.

File: `apps/web/src/index.css` — `.invoice-list__toolbar` section.

**P4.2 — Invoice panel card chrome**

The mockup `OrderInvoicePanel` in the order detail sits in a card with `border: 1px solid var(--border-default)` and `border-radius: var(--radius-md)`. Verify the current panel has this chrome; add if missing.

**P4.3 — Badge sizes and status copy**

From the mockup badge specifications (screen 2, screen 3):
- `not-issued` → neutral, text "NOT ISSUED"
- `pending` → neutral + pulse, text "PENDING"  
- `issuing` → info + pulse, text "ISSUING"
- `issued` → success, text "ISSUED"
- `failed` → error, text "FAILED"
- `in-doubt` → warning, text "IN DOUBT"

Verify these match `features/invoicing/components/invoice-status-badge.tsx` exactly. Fix any mismatches.

**P4.4 — Connection setup forms**

After #1232 and #1191 are merged, verify the KSeF connection form matches screen 5:
- Environment selector (production / test) visible above the auth token field.
- "Does NOT fetch seller details" note displayed below the auth section.
- Seller profile fields (NIP, name, address) in a separate `StructuredConfigSection`.

The Subiekt connection form (from #1249) should show:
- Bridge URL input
- API key input
- "Retrieves seller details from Subiekt itself" note.

If form sections are missing or out of order, correct in `plugins/ksef/components/ksef-structured-section.tsx` and `plugins/subiekt/components/subiekt-structured-section.tsx`.

---

## 5. File Change Summary

### Phase 2 (new branch, one PR)
```
apps/web/src/pages/invoicing/invoices-list-page.tsx          +15/-5  (P2.1, P2.2)
apps/web/src/pages/invoicing/invoice-detail-page.tsx         +5/-2   (P2.3)
apps/web/src/index.css                                        +20/-0  (P2.4)
apps/web/src/pages/invoicing/invoices-list-page.test.tsx     +20/-5  (P2.5)
apps/web/src/pages/invoicing/invoice-detail-page.test.tsx    +8/-0   (P2.5)
```

### Phase 3 (existing PRs — merge only, no new code except conflict resolution)
```
#1235: apps/web/src/plugins/ksef/components/ksef-invoice-detail-section.tsx  (column add)
#1232: apps/web/src/features/connections/components/EditConnectionForm.tsx    (seller fields)
#1234: apps/web/src/plugins/ksef/components/ksef-invoice-detail-section.tsx  (UPO iframe)
#1233: apps/web/src/plugins/ksef/components/ksef-invoice-correction-flow.tsx (KOR slot)
```

### Phase 4 (visual polish, small follow-up PR)
```
apps/web/src/index.css                                        +30/-5  (filter-row CSS)
apps/web/src/plugins/ksef/components/ksef-structured-section.tsx  (form order/notes)
```

---

## 6. Testing Strategy

**Per-phase scoped command**:
```bash
pnpm --filter @openlinker/web lint
pnpm --filter @openlinker/web type-check
pnpm --filter @openlinker/web test
```

**Acceptance smoke tests** (manual, after all phases merged):

| Screen | Check | Pass |
|---|---|---|
| Invoices list | Filters visible; "Clear filters" appears when any filter active | |
| Invoices list | Empty state shows "Go to orders" when no invoices and no filters | |
| Invoices list | Batch retry: select 2 failed-rejected, click "Retry selected", confirm, see banner | |
| Invoice detail | Navigate from list → detail; page loads with all KV fields | |
| Invoice detail | `← Invoices` back link navigates to `/invoices` | |
| Invoice detail | KSeF slot: clearance ref + UPO preview when `accepted` | |
| Order detail | Invoice card shows correct state badge for not-issued / issued / failed | |
| Order detail | Issue invoice: picks single connection, shows pending badge | |
| Order detail | Issue invoice: no connection → error toast with actionable message | |
| Connection wizard | KSeF: environment picker + NIP + seller fields present | |
| Correction | KSeF: "Issue correction" button visible on issued KSeF invoice | |
| Correction | Subiekt: correction form with quantity/reason fields | |

---

## 7. Risks & Edge Cases

| Risk | Mitigation |
|---|---|
| #1231 stacked on #1189 (KSeF KOR backend) not yet merged | Check #1189 state. If unmerged, extract W2+W3 onto a clean branch off `main` — UPO endpoint can stay with #1189 since the FE doesn't call it until #1234 also merges. |
| #1234 duplicates FA3 parsing code from #1256 | Inspect diff before merge; drop duplicate tab section; keep only UPO iframe + download. |
| CSS token drift checker failing on new `shimmer` keyframe | Keyframe uses only already-defined tokens (`--bg-surface-muted`, `--bg-strong`). If checker fires, add a no-op entry to `tokens.ts` mapping the animation name — but this is a keyframe not a CSS var; the checker only tracks `var()` usage, not `animation-name`, so should be fine. |
| `PageLayout` not supporting `backHref` | Read `shared/ui/page-layout.tsx` first; if prop is absent, render `<Link className="backlink" to="/invoices">← Invoices</Link>` above the grid and add `.backlink` CSS. |
| Wave C KSeF correction gated on #1189 backend | PR #1233 is feature-gated — "correction unavailable" stub shows until #1189 merges. Acceptable; document clearly in PR description. |

---

## 8. Questions & Assumptions

| # | Question | Assumption |
|---|---|---|
| Q1 | Is PR #1189 (KSeF KOR backend) already merged or close to merge? | **Assumed unmerged**. Plan handles #1231's stack dependency explicitly (P1.1). |
| Q2 | Does `PageLayout` support a `backHref`/`backLabel` prop? | **Unknown**. P2.3 prescribes reading the component first and using the correct API. |
| Q3 | Does the FA3 tab in #1256 conflict with #1234's implementation? | **Assumed possible conflict**. P3.3 mandates diff inspection before merge. |
| Q4 | Are there any remaining CSS tokens used in Wave A code but not declared in `tokens.ts`? | **Assumed covered** by the Wave A review process. Drift checker will catch any residual. |

---

## 9. Alignment Checklist

- [x] Follows `app → pages → features → shared` dependency direction
- [x] Zero `platformType` literals in neutral-base pages (only `plugins/ksef/**` allowed)
- [x] Fiscal-safety rules preserved: Retry only on `failed+rejected`; `in-doubt` shows check/resolve only
- [x] All states handled: loading → error → empty → data on every page
- [x] Error handling: `ApiError` 404 → EmptyState; 5xx → ErrorState with retry
- [x] Testing coverage: unit tests for every changed component
- [x] No new migrations, no new backend endpoints (only PR merges)
- [x] No new GitHub issues (user directive)
- [x] CSS tokens: shimmer uses existing token values; drift checker not triggered
- [x] Naming conventions: `kebab-case.tsx`, `use-*.ts`, CSS `.component__element` pattern

---

## 10. Delivery Order

```
P1.1  un-draft + merge #1231 (backend GET /invoices/:id)          ← HIGHEST PRIORITY
  │
  ├── P2   neutral-base gaps (branch: invoicing-neutral-base-gaps)
  │    Clear filters CTA · empty-state CTA · back link · skeleton CSS
  │
  ├── P3.1  merge #1235 (list KSeF columns)                        ← no deps
  ├── P3.2  merge #1232 (seller profile)                           ← no deps
  ├── P3.3  merge #1234 (UPO iframe, after diff check)             ← after #1256 on main
  └── P3.4  merge #1233 (KSeF correction)                          ← after #1191 on main
       │
       └── P4   visual polish pass (one follow-up PR)
```

P2 and P3.1–P3.3 can run in parallel after P1.1 is resolved.

---

## Related Documentation
- `docs/plans/invoicing-ui-mockup.html` — visual authority (six-screen mockup)
- `docs/plans/invoicing-fe-progress.md` — progress ledger with per-item status
- `docs/plans/invoicing-backend-progress.md` — backend ledger (all W1–W6 done)
- `docs/plans/implementation-plan-invoicing-fe-redesign.md` — design authority
- `docs/plans/implementation-plan-invoicing-fe-orchestration.md` — execution model

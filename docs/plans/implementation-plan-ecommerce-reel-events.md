# Implementation Plan: Instrument Full E-Commerce Reel Viewer Events (Batch 1)

**Date**: 2026-07-23
**Status**: Draft
**Estimated Effort**: 5-7 hours

---

## 1. Task Summary

**Objective**: Wire `captureDemoEvent(...)` (from the #1786 demo-events framework) at ~15 viewer-clickable call sites spanning the products list → offer-creation wizards → orders list → shipment/label form → invoicing panel flow, so marketing can build a funnel from `products_viewed` through three ★ intent-to-convert clicks (`offer_create_attempted`, `label_generate_attempted`, `invoice_issue_attempted`).

**Context**: In demo viewer mode the write actions are rendered-but-disabled (`ReadOnlyLock`), so a successful mutation never fires for a viewer. The highest-value signal is therefore **exploration + intent-to-convert clicks on the locked action**, not the mutation itself. This is the first of three event-instrumentation batches (#1788/#1789/#1790) that all depend on the demo-events catalog + `captureDemoEvent` helper (#1786, merged into this worktree) and consume the framework as-is — no changes to the capture mechanism itself, only new catalog entries + call-site wiring.

**Classification**: Frontend / Interface layer (pure UI instrumentation, no backend, no new API surface).

---

## 2. Scope & Non-Goals

### In Scope
- 14 new `DemoEventCatalog` entries in `apps/web/src/features/demo/lib/demo-events.ts` (the existing single seed entry, `demo_viewer_locked_action_clicked`, is left untouched — these are additive, more specific replacements for that generic placeholder at the concrete call sites this batch covers).
- `captureDemoEvent(...)` wired at every confirmed call site below.
- **One shared-component change**: add an optional `onLockedClick?: () => void` prop to `ReadOnlyLock` (`apps/web/src/shared/ui/read-only-lock.tsx`) — this is the only way to attach a click handler to a `ReadOnlyLock`-gated control (the wrapped button is natively `disabled` and swallows clicks; today `ReadOnlyLockProps` has no click hook at all). This single additive, backward-compatible prop unblocks the 5 `ReadOnlyLock`-gated "attempted" sites in this batch (Allegro create, Woo create ×2, bulk-confirm create, invoice issue) instead of five separate per-site workarounds.
- Explicit **corrections to the issue's stated line numbers** (several have drifted since the issue was written; verified line numbers are used throughout this plan — see § 4).
- Three **explicit scope decisions** flagged where the issue's description doesn't cleanly map to current code (§ 5 Questions & Assumptions) — each has a recommended default so the plan stays execution-ready without blocking on a reply.

### Out of Scope
- Adding `ReadOnlyLock` gating to the shipment/label-generation flow (`order-shipment-panel.tsx`, `generate-label-form.tsx`) — confirmed to have **zero** write-access gating anywhere in that chain today. The issue itself flags this as a UX question for the team, not something to fix in this batch. The `demo_label_generate_attempted` event still fires (from the plain submit handler, not from a lock span, since no lock exists) — see § 6 Phase 3.
- Desktop product-row expansion (the `DataTable`'s built-in `expandable` accordion) — only the **mobile card view**'s disclosure button is a plain call site in `products-list-page.tsx`; the desktop expand toggle lives inside the shared `DataTable` component itself. Instrumenting the desktop path would require a new callback prop on `DataTable`'s `expandable` API, which is a shared-component surface change beyond this batch's "wire existing onClick" framing — deferred (see § 5).
- `demo_order_timeline_expanded` as literally described — **no expand/collapse interaction exists** in `order-activity-timeline.tsx` today (confirmed by full file read: no `useState`, no toggle, flat `<ol>` render). Recommended default: drop this event from the batch rather than inventing new UI (see § 5).
- Batches #1789 (connections/mapping/KSeF) and #1790 (AI/open-source/cross-cutting) — separate tasks.
- Any change to `captureDemoEvent`, `DemoEventCatalog`'s type machinery, or the `/settings` Product-events panel (#1786/#1787) — this batch only adds catalog *entries* and call sites, consuming the existing framework unmodified apart from the one `ReadOnlyLock` prop addition.

### Constraints
- Every new catalog entry's `props` must stay low-cardinality (bounded strings/enums/numbers/booleans) — never raw order IDs, free text, or unbounded carrier/platform names. Where the issue's table implies an unbounded value (e.g. "carrier"), this plan buckets it to a known enum instead (see per-event prop shapes in § 6).
- Must not fire on a non-demo build — already guaranteed by `captureDemoEvent`'s existing gating (no code path in this batch bypasses it).
- `ReadOnlyLock`'s new `onLockedClick` prop must be a no-op by default (optional, undefined) so every existing consumer that doesn't pass it is unaffected.

---

## 3. Architecture Mapping

**Target Layer**: Frontend Interface layer — page/feature components in `apps/web/src/pages/` and `apps/web/src/features/`, plus one shared UI primitive (`apps/web/src/shared/ui/read-only-lock.tsx`).

**Capabilities Involved**: None (no backend ports touched).

**Existing Services Reused**:
- `captureDemoEvent`, `DemoEventCatalog` — from the `demo` feature's public barrel (`apps/web/src/features/demo`), per the cross-feature consumption pattern already established by #1787 (`docs/frontend-architecture.md § Feature Public Surface`).
- `ReadOnlyLock` (`apps/web/src/shared/ui/read-only-lock.tsx`) — extended, not replaced.

**New Components Required**: None beyond the one new prop on `ReadOnlyLock`. No new files.

**Core vs Integration Justification**: N/A — pure frontend instrumentation, no `libs/core`/`libs/integrations` involvement.

---

## 4. External / Domain Research

### Internal Patterns — verified current code state (supersedes the issue's line numbers where they've drifted)

**`ReadOnlyLock`** (`apps/web/src/shared/ui/read-only-lock.tsx`, full file, 41 lines):
```tsx
interface ReadOnlyLockProps {
  active: boolean;
  message: string;
  children: ReactNode;
}
export function ReadOnlyLock({ active, message, children }: ReadOnlyLockProps): ReactElement {
  if (!active) return <>{children}</>;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="read-only-lock" tabIndex={0}>{children}</span>
      </TooltipTrigger>
      <TooltipContent>{message}</TooltipContent>
    </Tooltip>
  );
}
```
When `active` is `false` it's a pure passthrough (no wrapper). When `active` is `true`, the `<span className="read-only-lock">` is the sibling wrapper the issue refers to — this is exactly where a click handler needs to attach, since the disabled button inside swallows pointer events. **No `onClick`/`onLockedClick` prop exists today.**

**`demo-events.ts`** (full current contents, from #1786):
```ts
export const DemoEventCatalog = {
  demo_viewer_locked_action_clicked: {
    description: '...',
    group: 'conversion-intent',
    props: { actionName: '', surface: '' } as { actionName: string; surface: string },
  },
} as const;
```
Only one seed entry exists. Every new entry must follow this exact shape (placeholder runtime values + type cast — see #1786's own doc comment on why `props` values must be non-empty placeholders, not bare `{}`).

**Per-site findings** (file : line, verified against current code — issue's stated line is noted where it has drifted):

| # | Site | Verified location | Note |
|---|---|---|---|
| 1 | Products viewed | `pages/products/products-list-page.tsx` — no existing mount effect; `useEffect` not currently imported | New effect needed, ref-guarded so it fires once per query success, not on every refetch |
| 2 | Product row expanded | `products-list-page.tsx:1159` (issue's line — confirmed exact) | **Mobile card view only** — `toggleCardExpanded(product.id)` in the card disclosure button. Desktop uses `DataTable`'s own `expandable` prop (lines 1108-1119), a separate component-internal toggle not reachable from this file — out of scope (§ 2) |
| 3 | Offer create launched | `handleCreateOffers` (line 469, bulk) / `handleCreateOffersForProduct` (line 479, per-row) — both confirmed | Two distinct entry points, not duplicates: bulk-bar CTA vs per-row CTA. Both branch into either a direct `goToWizard` (1 connection) or `MarketplacePickerModal` (2+ connections) — capture at the button click itself (source known immediately), not at the deferred wizard-entry point |
| 4 | Marketplace picked | `marketplace-picker-modal.tsx` — two candidates: line 72 (radio select) vs line 95-102 (Continue confirm, issue's cited ~99 lands here) | Recommend firing on **Continue** (line 99), matching the issue's actual cited line — this is the moment the pick is committed, not merely highlighted |
| 5 | Wizard step advanced (Allegro) | `AllegroCreateOfferWizard.tsx` — `goNext()` at lines 672-710 (issue said 662, off by ~10) | Fire after validation passes, alongside the `setStepIndex` call at line 709 |
| 6 | Wizard review reached (Allegro) | Review is `stepIndex === 4` (line 1265); `ALLEGRO_STEP_LABELS` ends `'Review'` | Fire via a `useEffect` keyed on `stepIndex` transitioning to `4`, not a literal handler at the issue's cited line 696 (which is unrelated Step-3 validation code) |
| 7 | ★ Create attempted (Allegro) | Lines 1346-1355 (issue said 1327, off by ~20), `ReadOnlyLock`-gated | Requires the new `onLockedClick` prop (§ 2). `mode` is always `'create'` (Allegro wizard has no edit mode) |
| 8 | Wizard step advanced (bulk) | `bulk-wizard.tsx` — two separate callbacks, `handleConfigProceed` (188-191, `config→resolve`) and `handleResolveComplete` (193-196, `resolve→review`) — issue's single "line 196" conflates these | Use `handleResolveComplete` as the "review reached" equivalent (§ 6); platform via `next.connectionId` at `handleConfigProceed` time (the `batchConnection`/`batchPlatform` memo hasn't re-rendered yet at that point) |
| 9 | Wizard review reached (Woo) | `WoocommercePublishWizard.tsx:859-863` (issue's 861 — confirmed) | `setReviewing(true)`, single-mode only |
| 10 | ★ Create attempted (Woo) ×2 | Lines 662-666 and 868-883 (issue's 662/868 — both confirmed), both `ReadOnlyLock`-gated | Two scenarios: single-mode-via-Review-confirm (662) vs direct-submit (868, used by bulk always and optionally by single). `mode` variable already in scope at both sites |
| 11 | ★ Create attempted (bulk confirm) | `bulk-confirm-modal.tsx:147-155` (issue said 107, off by ~40 — 107 lands in an unrelated tooltip block), `ReadOnlyLock`-gated | Same `onLockedClick` mechanism |
| 12 | Orders viewed | `orders-list-page.tsx` — existing `useEffect` (918-940) is an unrelated `R`-keydown refresh shortcut, not reusable | New effect needed, same ref-guard pattern as item 1 |
| 13 | Orders filtered ×2 | Lines 964/976 (health-segment click filter, issue's 964 partially matches — the second site is 976, not 1048) and line 1048 (breaching-SLA `Chip` toggle) | Two structurally different mechanisms: multi-value segment click vs boolean toggle. A third filter surface (toolbar `Select`s, lines 986-1044) exists but isn't in the issue's list — optional future extension, not in this batch |
| 14 | Order opened | `orders-list-page.tsx:563-567` (confirmed), via `EntityLabel` | `EntityLabel`'s outer `<span>` also wraps an unrelated "Copy id" button with its own `onClick` — attaching a naive `onClick` to `EntityLabel` would double-fire on Copy clicks too (event bubbling, no `stopPropagation` today). See § 5 for the recommended fix |
| 15 | Order timeline expanded | `order-activity-timeline.tsx` — **no such interaction exists** (confirmed, full file read) | Recommended: **drop this event from the batch** (§ 5) |
| 16 | Label form opened ×2 | `order-shipment-panel.tsx:132` (empty-state CTA) and `:145` (`ShipmentActionButtons`'s `onGenerateLabelClick`) — both confirmed exact | Neither site nor anything downstream has `ReadOnlyLock`/write-access gating — plain `onClick` wiring, no lock trick needed |
| 17 | ★ Label generate attempted | `generate-label-form.tsx:741-743` (confirmed exact) — **not** `ReadOnlyLock`-gated (grepped whole file, zero hits) | Fire from the form's submit handler directly (before/alongside the mutation call), not from a lock span — there is no lock in this chain (matches the issue's own caveat) |
| 18 | Invoice doctype changed | `order-invoice-panel.tsx:534-539` (confirmed exact) | `setDocumentType` `onChange` |
| 19 | ★ Invoice issue attempted | `order-invoice-panel.tsx:540-544` (confirmed exact), `ReadOnlyLock`-gated | Same `onLockedClick` mechanism; `handleIssue` (lines 284-291) already has `documentType` in scope |

**Note on scope creep guardrail**: `order-invoice-panel.tsx` has a second, unrelated `ReadOnlyLock`-gated "Retry" button (lines 464-472, failed-invoice recovery) not mentioned in the issue's 15 sites — **not instrumented in this batch**, left for a future batch if wanted.

---

## 5. Questions & Assumptions

### Open Questions (each with a default so the plan stays execution-ready)

1. **`demo_order_timeline_expanded` has no real interaction to attach to.** Default: **drop it from this batch's catalog** rather than inventing new expand/collapse UI (out of scope for an instrumentation-only task). If the team wants this signal, it should be a follow-up UI task, not silently invented here.
2. **`demo_product_row_expanded` only covers the mobile card path**, not the desktop `DataTable.expandable` accordion. Default: **ship mobile-only for this batch**, note the desktop gap explicitly in the catalog entry's description so a future task can close it via a `DataTable` callback prop.
3. **`demo_offer_marketplace_picked` — fire on radio-select (line 72) or Continue-confirm (line 99)?** Default: **Continue-confirm (line 99)**, matching the issue's actual cited line and representing a committed choice rather than a still-changeable highlight.
4. **`demo_order_opened`'s `EntityLabel` wrapping problem** (an outer-span `onClick` would also catch the unrelated "Copy id" button click). Default: **add a dedicated `onNavigate?: () => void` prop to `EntityLabel`** (`apps/web/src/shared/ui/entity-label.tsx`), wired directly to the inner `<Link>`'s `onClick` — mirrors the `ReadOnlyLock.onLockedClick` precedent of adding one small, backward-compatible prop to a shared primitive rather than accepting event-bubbling imprecision. Both the desktop cell (line 563) and the mobile card-title duplicate (line 1162) get the new prop.
5. **`demo_label_generate_attempted` has no `ReadOnlyLock` to piggyback on** (confirmed: zero write-gating anywhere in the shipment/label chain). Default: wire the event directly at form-submit time, unconditionally on click (matching the issue's own explicit note that "the event is still a valid intent signal" even without gating) — **not** a blocker, but flagged again here per the issue's own ask to "flag to the team whether that path should be gated for UX consistency" (a separate, out-of-scope UX decision).

### Assumptions
- The existing single catalog seed (`demo_viewer_locked_action_clicked`) stays untouched — it's a generic placeholder from #1786's framework task, and this batch's 14 named, specific events are a superset serving the same "conversion-intent" purpose at concrete sites, not a replacement.
- "step" props (Allegro/bulk wizard step-advanced events) are captured as low-cardinality string buckets (step *name*, e.g. `'category'`/`'attributes'`/`'review'`), never the raw numeric index alone without a stable mapping, so the value stays meaningful across future wizard-step reordering.
- `result_count_bucket` (products-viewed event) and any other "count" prop is bucketed (e.g. `'0'`, `'1-10'`, `'11-50'`, `'50+'`) rather than the raw integer, consistent with the catalog's low-cardinality constraint.

### Documentation Gaps
- None beyond what's already flagged inline above — `docs/analytics-events.md` (from #1786) is the canonical place these 14 new rows land (§ 6 Phase 4).

---

## 6. Proposed Implementation Plan

### Phase 1: Shared-component prerequisites

**Goal**: Unblock the 5 `ReadOnlyLock`-gated intent-click sites and the `EntityLabel` navigation-click site with two small, additive, backward-compatible prop additions.

**Steps**:

1. **Add `onLockedClick` to `ReadOnlyLock`**
   - **File**: `apps/web/src/shared/ui/read-only-lock.tsx`
   - **Action**: add `onLockedClick?: () => void` to `ReadOnlyLockProps`; wire it as `<span className="read-only-lock" tabIndex={0} onClick={onLockedClick}>`. No change to the `!active` passthrough branch.
   - **Acceptance**: existing consumers (that don't pass the new prop) render identically; a consumer passing `onLockedClick` sees it fire exactly when the lock is active and the wrapped (disabled) control is clicked.
   - **Dependencies**: none.

2. **Add `onNavigate` to `EntityLabel`**
   - **File**: `apps/web/src/shared/ui/entity-label.tsx`
   - **Action**: add `onNavigate?: () => void` to its props; wire it to the inner `<Link to={to}>`'s `onClick`, leaving the outer span's existing props/Copy-button untouched.
   - **Acceptance**: clicking the name/link fires `onNavigate`; clicking the Copy-id button does not.
   - **Dependencies**: none.

### Phase 2: Catalog entries

3. **Add 14 new entries to `DemoEventCatalog`**
   - **File**: `apps/web/src/features/demo/lib/demo-events.ts`
   - **Action**: append entries (group: `'ecommerce-reel'` for exploration events, `'conversion-intent'` for the three ★ events — reusing the existing group name for intent clicks since it already exists and means the same thing):
     ```ts
     demo_products_viewed: { description: '...', group: 'ecommerce-reel', props: { resultCountBucket: '' } as { resultCountBucket: string } },
     demo_product_row_expanded: { description: '...', group: 'ecommerce-reel', props: {} as Record<string, never> },
     demo_offer_create_launched: { description: '...', group: 'ecommerce-reel', props: { source: '' } as { source: 'row' | 'bulk_bar' } },
     demo_offer_marketplace_picked: { description: '...', group: 'ecommerce-reel', props: { platform: '' } as { platform: string } },
     demo_offer_wizard_step_advanced: { description: '...', group: 'ecommerce-reel', props: { platform: '', step: '' } as { platform: string; step: string } },
     demo_offer_wizard_review_reached: { description: '...', group: 'ecommerce-reel', props: { platform: '' } as { platform: string } },
     demo_offer_create_attempted: { description: '...', group: 'conversion-intent', props: { platform: '', mode: '' } as { platform: string; mode: string } },
     demo_orders_viewed: { description: '...', group: 'ecommerce-reel', props: {} as Record<string, never> },
     demo_orders_filtered: { description: '...', group: 'ecommerce-reel', props: { filter: '', value: '' } as { filter: string; value: string } },
     demo_order_opened: { description: '...', group: 'ecommerce-reel', props: {} as Record<string, never> },
     demo_label_form_opened: { description: '...', group: 'ecommerce-reel', props: { entry: '' } as { entry: 'empty_state' | 'active_shipment_row' } },
     demo_label_generate_attempted: { description: '...', group: 'conversion-intent', props: { carrier: '' } as { carrier: string } },
     demo_invoice_doctype_changed: { description: '...', group: 'ecommerce-reel', props: { documentType: '' } as { documentType: string } },
     demo_invoice_issue_attempted: { description: '...', group: 'conversion-intent', props: {} as Record<string, never> },
     ```
     (`demo_order_timeline_expanded` deliberately omitted — § 5 Question 1.)
   - **Acceptance**: `demo-events.test.ts`'s existing "every entry has non-empty runtime prop keys" assertion (from #1787's fix) either passes for entries with real props, or is adjusted to tolerate the `Record<string, never>` no-props entries (empty object is legitimately correct there, not a regression) — see Phase 4 test step.
   - **Dependencies**: none (pure data, independent of Phase 1).

### Phase 3: Call-site wiring

4. **Products list** (`pages/products/products-list-page.tsx`)
   - Add `useEffect` import; fire `demo_products_viewed` once per successful query load (ref-guarded on `query.data`), bucketing `query.data.total`.
   - Fire `demo_product_row_expanded` in the mobile card disclosure `onClick` (line 1159), alongside `toggleCardExpanded`.
   - Fire `demo_offer_create_launched` with `source: 'row'` / `source: 'bulk_bar'` at the top of `handleCreateOffersForProduct` (line 479) / `handleCreateOffers` (line 469) respectively.
   - **Acceptance**: all three events fire exactly once per real user interaction; no double-fire on re-render.

5. **Marketplace picker** (`pages/products/marketplace-picker-modal.tsx`)
   - Fire `demo_offer_marketplace_picked` with `platform: picked` inside the Continue button's `onClick` (line 99), before calling `onContinue(picked)`.

6. **Allegro wizard** (`features/listings/components/AllegroCreateOfferWizard.tsx`)
   - Fire `demo_offer_wizard_step_advanced` with `platform: 'allegro', step: <current step name>` inside `goNext()` after validation passes, alongside the `setStepIndex` call (line 709).
   - Fire `demo_offer_wizard_review_reached` with `platform: 'allegro'` via a `useEffect` keyed on `stepIndex === 4`.
   - Fire ★ `demo_offer_create_attempted` with `platform: 'allegro', mode: 'create'` via the new `ReadOnlyLock`'s `onLockedClick` prop (lines 1346-1355).

7. **Bulk wizard** (`features/listings/components/bulk/bulk-wizard.tsx`)
   - Fire `demo_offer_wizard_step_advanced` (`platform` from `next.connectionId` lookup, `step: 'config'`) inside `handleConfigProceed` (188-191).
   - Fire `demo_offer_wizard_review_reached` (`platform` from `batchPlatform`) inside `handleResolveComplete` (193-196).

8. **Bulk confirm modal** (`features/listings/components/bulk/bulk-confirm-modal.tsx`)
   - Fire ★ `demo_offer_create_attempted` (`platform` from the connection in scope, `mode: 'bulk'`) via `ReadOnlyLock.onLockedClick` (lines 147-155).

9. **WooCommerce wizard** (`features/listings/components/WoocommercePublishWizard.tsx`)
   - Fire `demo_offer_wizard_review_reached` (`platform: 'woocommerce'`) inside the Review-button handler (line 861).
   - Fire ★ `demo_offer_create_attempted` (`platform: 'woocommerce', mode`) via `ReadOnlyLock.onLockedClick` at **both** sites (662, 868).

10. **Orders list** (`pages/orders/orders-list-page.tsx`)
    - Add ref-guarded `useEffect` firing `demo_orders_viewed` once per successful query load.
    - Fire `demo_orders_filtered` (`filter: 'health', value: segment.key ?? 'all'`) at lines 964/976; fire `demo_orders_filtered` (`filter: 'sla_breaching', value: String(!breaching)`) at line 1048's `toggleBreaching`.
    - Fire `demo_order_opened` via `EntityLabel`'s new `onNavigate` prop at both the desktop (line 563) and mobile-card (line 1162) render sites.

11. **Order shipment panel** (`features/orders/components/order-shipment-panel.tsx`)
    - Fire `demo_label_form_opened` (`entry: 'empty_state'`) at line 132's `onClick`.
    - Fire `demo_label_form_opened` (`entry: 'active_shipment_row'`) at line 145's `onGenerateLabelClick`.

12. **Generate label form** (`features/orders/components/generate-label-form.tsx`)
    - Fire ★ `demo_label_generate_attempted` (`carrier` from `routedCarrierPlatform`, bucketed to a known enum or `'unknown'`) directly in the submit handler — no lock to piggyback on (§ 5 Question 5).

13. **Order invoice panel** (`features/invoicing/components/order-invoice-panel.tsx`)
    - Fire `demo_invoice_doctype_changed` (`documentType`) in the `DocumentTypeSelect`'s `onChange` (line 534-539), alongside `setDocumentType`.
    - Fire ★ `demo_invoice_issue_attempted` via `ReadOnlyLock.onLockedClick` (lines 540-544).

### Phase 4: Docs & tests

14. **Update `docs/analytics-events.md`** (from #1786) with 14 new rows (event, description, props, what it measures) and mark the batch as landed.
15. **Tests**:
    - `demo-events.test.ts` (extend) — verify the "non-empty prop keys" assertion tolerates the intentional `Record<string, never>` no-props entries (either exempt them explicitly, or assert `Object.keys(entry.props).length >= 0` with a separate check that every *non-empty-typed* entry has non-empty runtime keys).
    - `read-only-lock.test.tsx` (new or extended) — `onLockedClick` fires only when `active` is true and the span is clicked; absent when `active` is false.
    - `entity-label.test.tsx` (extend) — `onNavigate` fires on link click, not on Copy-button click.
    - Component-level tests for 2-3 representative call sites (e.g. `products-list-page.test.tsx`, `order-invoice-panel.test.tsx`) mocking `captureDemoEvent` (via the `demo` feature barrel) and asserting it's called with the right event name + props shape on the relevant interaction — not exhaustive for all 15 sites, but enough to prove the wiring pattern works end-to-end per file.

---

## 7. Alternatives Considered

### Alternative 1: Duplicate a per-call-site `<span onClick>` wrapper around each `ReadOnlyLock` instead of adding `onLockedClick`
- **Why Rejected**: `ReadOnlyLock`'s `active`-false branch renders zero wrapper (pure passthrough) — a call-site-local wrapping span would need to conditionally exist too, duplicating `ReadOnlyLock`'s own `active` branching logic five times across five files instead of once in the shared primitive.

### Alternative 2: Fire `demo_order_opened` from the outer `EntityLabel` span without a dedicated prop, accepting the Copy-button double-fire
- **Why Rejected**: a spurious "order opened" event on every "copy ID" click would corrupt the funnel's numerator (inflated opens with no corresponding navigation), directly undermining the batch's stated purpose (accurate funnel construction).

### Alternative 3: Invent new expand/collapse UI for `order-activity-timeline.tsx` to satisfy `demo_order_timeline_expanded` literally
- **Why Rejected**: this task is scoped as instrumentation-only (no backend, and implicitly no new UI surfaces) — adding an accordion interaction purely to have something to instrument inverts the task's purpose. Dropping the event and flagging the gap (§ 5) is more honest than fabricating an interaction.

---

## 8. Validation & Risks

### Architecture Compliance
- ✅ No hexagonal-layer violation — pure `apps/web` feature/page instrumentation plus two additive shared-primitive props.
- ✅ Cross-feature import (`pages`/`features` → `demo` barrel) already established by #1787's precedent.

### Naming Conventions
- ✅ Event names follow the existing `demo_<noun>_<verb>` pattern from the seed entry.
- ✅ New props (`onLockedClick`, `onNavigate`) are optional, camelCase, consistent with existing prop naming across `shared/ui/`.

### Existing Patterns
- ✅ `ReadOnlyLock` extension mirrors how other shared primitives in this codebase have grown one prop at a time (additive, backward-compatible) rather than being rewritten.

### Risks
- **Line-number drift recurs**: several of the issue's cited lines had already drifted by the time of this research (§ 4 table) — the plan uses verified current locations throughout; the *implementer* should re-verify once more immediately before editing, since other in-flight PRs may shift these files further before this batch lands.
- **Double-fire on re-render for "viewed" events**: mitigated by the explicit ref-guard requirement in Phase 3 steps 4 and 10 — without it, `useEffect` firing on every filter-driven refetch would flood the funnel with false "viewed" events.
- **`ReadOnlyLock.onLockedClick` used at 5 sites simultaneously**: low risk — each call site's closure captures its own props (`platform`, `mode`, etc.), no shared mutable state.

### Edge Cases
- A viewer who is *not* in demo mode (self-hosted install): `captureDemoEvent` is already a no-op per its existing gating — no new edge case introduced by this batch.
- Multiple `ReadOnlyLock` instances re-rendering rapidly (e.g. typing in a form that keeps `active` toggling): `onLockedClick` only fires on an actual click event, not on `active` transitions, so no spurious fires.
- `routedCarrierPlatform` being `null`/unknown at label-generate-attempted time (per its own doc comment, pre-adapter-preflight): capture `carrier: 'unknown'` rather than omitting the prop (props are required by `captureDemoEvent`'s type signature).

### Backward Compatibility
- ✅ Fully additive — `onLockedClick` and `onNavigate` are optional props; no existing consumer needs updating.

---

## 9. Testing Strategy & Acceptance Criteria

### Unit Tests
- `read-only-lock.test.tsx`, `entity-label.test.tsx` (new/extended) — prop wiring correctness, per Phase 4 step 15.
- `demo-events.test.ts` (extended) — catalog shape invariant tolerates intentional no-props entries.
- 2-3 representative call-site tests mocking `captureDemoEvent` — proves the wiring pattern, not exhaustive coverage of all 15 sites (each site is a 1-2 line addition alongside an already-tested existing handler; full behavioral re-testing of every handler is out of proportion to the risk).

### Integration Tests
- None required — pure client-side instrumentation, no new backend surface.

### Mocking Strategy
- `captureDemoEvent` mocked via `vi.mock('../../../demo', ...)` (or the appropriate relative path per test file) in call-site tests, asserting call args.

### Acceptance Criteria
- [ ] Each event fires from its verified (not necessarily issue-cited) handler, with the listed props, viewer-clickable only.
- [ ] The three ★ intent-click events fire via the `ReadOnlyLock`'s new `onLockedClick` for the four sites that have a lock (Allegro create, Woo create ×2, bulk-confirm create, invoice issue); `demo_label_generate_attempted` fires directly (no lock exists in that chain — documented deviation, not a gap).
- [ ] No event fires on a self-hosted (non-demo) build (inherited from `captureDemoEvent`'s existing gate — no new verification needed beyond confirming no call site bypasses it).
- [ ] Catalog entries exist for all 14 events in this batch (`demo_order_timeline_expanded` intentionally excluded, per § 5).
- [ ] `pnpm lint`, `pnpm type-check`, `pnpm test` pass with zero errors.

**Reference**: `docs/testing-guide.md`.

---

## 10. Alignment Checklist

- [x] Follows hexagonal architecture (N/A — pure frontend instrumentation)
- [x] Respects CORE vs Integration boundaries (N/A — no backend touched)
- [x] Uses existing patterns (no unnecessary abstractions) — reuses `captureDemoEvent`/`DemoEventCatalog` as-is; the two new shared-prop additions follow existing additive-prop precedent
- [ ] Idempotency considered — N/A (client-side analytics, not a job/mutation)
- [ ] Event-driven patterns used where applicable — N/A (this *is* the event-emission mechanism, not a consumer)
- [ ] Rate limits & retries addressed — N/A (no external API call introduced beyond PostHog's own existing fire-and-forget capture)
- [x] Error handling comprehensive — `captureDemoEvent` cannot throw by design (#1786); no new error paths introduced
- [x] Testing strategy complete
- [x] Naming conventions followed
- [x] File structure matches standards
- [x] Plan is execution-ready — depends on #1786 (merged into this worktree) and, for full ★-event coverage semantics, benefits from but does not strictly require #1787 (settings gating) to already be present
- [x] Plan is saved as markdown file

---

## Related Documentation

- [Architecture Overview](../architecture-overview.md)
- [Engineering Standards](../engineering-standards.md)
- [Frontend Architecture](../frontend-architecture.md)
- [Frontend UI Style Guide](../frontend-ui-style-guide.md)
- [Testing Guide](../testing-guide.md)
- [Demo Events Framework Plan (#1786)](./implementation-plan-demo-events-framework.md)
- [Product-Events Settings Panel Plan (#1787)](./implementation-plan-demo-events-settings-panel.md)
- Issue: [#1788](https://github.com/openlinker-project/openlinker/issues/1788) (this task) — part of epic [#1785](https://github.com/openlinker-project/openlinker/issues/1785); depends on [#1786](https://github.com/openlinker-project/openlinker/issues/1786) (PR [#1817](https://github.com/openlinker-project/openlinker/pull/1817)) and stacks alongside [#1787](https://github.com/openlinker-project/openlinker/issues/1787) (PR [#1822](https://github.com/openlinker-project/openlinker/pull/1822))

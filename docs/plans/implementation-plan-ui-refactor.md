# Implementation Plan — UI refactor (FE-001 → FE-002)

Epic: [#236](https://github.com/SilkSoftwareHouse/openlinker/issues/236) · Phases: [#237](https://github.com/SilkSoftwareHouse/openlinker/issues/237) → [#242](https://github.com/SilkSoftwareHouse/openlinker/issues/242)

---

## 1. Goal

Transform the OpenLinker frontend from a generic admin template into a commerce-operations cockpit matching the style guide's "Shopify admin clarity + Linear polish" intent. Close all 4 P0 and 15 P1 findings from the audit. Land as 6 independently-mergeable PRs so operators feel incremental improvement and regression risk is contained.

**Layer**: Frontend only — `apps/web/`. No backend changes except reading existing APIs.

**Non-goals**: Mobile/tablet layouts. Performance work (Lighthouse Best-Practices already 100). i18n. Allegro OAuth callback UX. Full a11y remediation beyond the remaining 4% (already at 96).

---

## 2. Current State

- **Audit**: 4 P0 + 15 P1 findings grouped into 8 themes. Full document: [`docs/ui-audit/audit.md`](../ui-audit/audit.md).
- **Baseline**: 34 screenshots + 5 Lighthouse reports at [`docs/ui-audit/baseline/`](../ui-audit/baseline/). Lighthouse a11y 96, best-practices 100, SEO 82 across every page.
- **Decision record**: [`docs/ui-audit/library-analysis.md`](../ui-audit/library-analysis.md) — Variant A (restrained cockpit) with targeted B transplants. Stack adopts Radix Primitives + TanStack Table.
- **Concepts**: [`docs/ui-audit/concepts/`](../ui-audit/concepts/) — 5 page mockups (dashboard, orders list, order detail, connection detail, category mappings) in the chosen direction. Open `concepts/index.html` for the gallery.
- **Style guide**: `docs/frontend-ui-style-guide.md` updated with FE-002 direction, IBM Plex typography, expanded token palette, primitive inventory, external-library policy, density table, and reference concepts.

---

## 3. Solution — Six phases, each = one PR

Each phase is independently mergeable and non-breaking. Old and new patterns coexist during migration. The sequence is dependency-driven: tokens before primitives, primitives before pages.

```
Phase 1 · Tokens & typography     ──┐
Phase 2 · Shell (nav + topbar)    ──┼─→ unblocks Phase 3
                                    │
Phase 3 · Shared primitives       ──┼─→ unblocks Phases 4, 5, 6
(DataTable, EntityLabel,           │
 RawPayloadPanel, MetricCard,      │
 KeyValueList, Dialog, Select,     │
 DropdownMenu, Tooltip, Tabs,      │
 Toast, Popover)                   │
                                   ▼
Phase 4 · Detail pages ──┐  Phase 5 · Forms & wizards ──┐  Phase 6 · Dashboard ──┐
                         └────────────────┬──────────────┘                       │
                                          ▼                                      │
                               FE-002 complete ◄───────────────────────────────┘
```

Phases 4, 5, and 6 are independent of each other — can land in any order once Phase 3 is in.

---

## 4. Phase-by-phase

### Phase 1 — Tokens & typography (issue [#237](https://github.com/SilkSoftwareHouse/openlinker/issues/237))

**Scope**: No visual changes. Align `apps/web/src/index.css` with the FE-002 token palette in the style guide. Add IBM Plex loading. Audit and remove hardcoded hex values from component CSS.

**Critical files**:
- `apps/web/src/index.css` — token block, `@import` for IBM Plex, `.mono-text` utility
- `apps/web/src/**/*.css` / inline style props — grep for hex literals outside tokens

**Steps**:
1. Add `--status-*-strong`, `--bg-surface-muted`, `--bg-surface-hover`, `--text-inverse`, `--accent-primary-border`, `--border-focus` tokens to `index.css` matching `docs/frontend-ui-style-guide.md §Theme Tokens`.
2. Add `@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap');` at the top of `index.css`. Set `--font-sans` / `--font-mono` tokens to use IBM Plex with system-sans fallback.
3. Update `body` base to consume `--font-sans` and the 13.5/20 body scale.
4. Add `.mono-text`, `.tabular`, `.eyebrow` utility classes to `index.css`.
5. Grep `apps/web/src` for raw hex (`#[0-9a-fA-F]{3,6}`) in non-token files; log violations; migrate to tokens or document exceptions.
6. Regression check: open all 34 baseline pages in the dev server, confirm identical rendering (typography shift is expected, structure unchanged).

**Acceptance**:
- [ ] Token list in `index.css` matches style guide §Theme Tokens
- [ ] IBM Plex loaded and rendered on every page
- [ ] Grep for raw hex in component CSS → 0 or documented
- [ ] Baseline screenshots compared against updated pages; structural diff only
- [ ] `pnpm lint && pnpm type-check && pnpm test` pass

**Estimated size**: S (1–2 days)

---

### Phase 2 — Shell (issue [#238](https://github.com/SilkSoftwareHouse/openlinker/issues/238))

**Scope**: Restructure left nav, top bar, page header. These appear on every page — improvements compound immediately.

**Critical files**:
- `apps/web/src/app/layouts/authenticated-app-layout.tsx` — shell composition
- `apps/web/src/app/routes/root.route.tsx` — remove stub routes
- Nav component files (find via grep for `OPERATIONS`, `PLATFORM`)
- `apps/web/src/app/routes/automations.route.tsx`, `shipping.route.tsx`, `invoices.route.tsx` — delete

**Steps**:
1. Rewrite the nav component to the three-group IA defined in style guide §Left Navigation:
   - Operations: Dashboard / Orders / Products / Inventory / Customers / Listings
   - Diagnostics: Jobs & Logs / Webhooks / Cursors
   - Platform: Integrations / Adapters / Settings
   - Planned (disabled, `--text-disabled` opacity, tooltip "Coming in a future release"): Automations / Shipping / Invoices
2. Remove all "Live"/"Planned" pills from live nav items. Fix the "Planned" mislabel on `Jobs & Logs`.
3. Remove `Add connection` from the nav entirely (CTA already on `/connections`).
4. Rename "Integrations" → "Connections" (or vice-versa) to stop the label drift. Pick one and update nav, page titles, URLs, and API terminology consistently.
5. Collapse top utility bar to: breadcrumbs + global search + alerts bell + user chip. Remove "WORKSPACE"/"Development"/"admin authenticated" eyebrow and the duplicated org/env context in the sidebar.
6. New `PageHeader` primitive: title + description + actions. Enforce ≤ 120 px from viewport top to first content.
7. Delete `automations.route.tsx`, `shipping.route.tsx`, `invoices.route.tsx` and their page files. Nav entries remain as disabled placeholders.
8. Capture after-shots for Dashboard, Orders list, Connections list, Settings at 1440×900. Diff against baseline in the PR.

**Acceptance**:
- [ ] Nav renders 12 live items in 3 groups + 3 disabled Planned entries
- [ ] No `Live` pills on live nav items; disabled entries carry a tooltip
- [ ] `Add connection` removed from nav; CTA remains on `/connections`
- [ ] Top-of-every-page content begins ≤ 120 px from viewport top
- [ ] Sidebar no longer duplicates org/env context from top bar
- [ ] Routes `/automations`, `/shipping`, `/invoices` removed; nav entries remain disabled
- [ ] `pnpm lint && pnpm type-check && pnpm test` pass

**Estimated size**: M (2–3 days)

---

### Phase 3 — Shared primitives (issue [#239](https://github.com/SilkSoftwareHouse/openlinker/issues/239))

**Scope**: Biggest phase. Introduce the primitive layer; migrate every page onto it. Each primitive ships with unit tests and a real-page usage.

**Dependencies added** (per `package.json` audit in decision record):

```json
{
  "@tanstack/react-table": "^8.x",
  "@tanstack/react-virtual": "^3.x",
  "@radix-ui/react-dialog": "^1.x",
  "@radix-ui/react-dropdown-menu": "^2.x",
  "@radix-ui/react-select": "^2.x",
  "@radix-ui/react-tabs": "^1.x",
  "@radix-ui/react-tooltip": "^1.x",
  "@radix-ui/react-popover": "^1.x",
  "@radix-ui/react-toast": "^1.x"
}
```

**Critical files**:
- `apps/web/src/shared/ui/` — new primitive modules
- `apps/web/src/pages/**/*.tsx` — migrate usages
- `.claude/rules/frontend.md` (already amended to permit headless libraries)

**Sequence** (one logical chunk per primitive or small cluster):

1. **`EntityLabel`** — takes `{ kind: 'connection' | 'customer' | 'product' | 'order', id: string }`, resolves name via query hook, renders `name` + `mono(id)` + copy button. No backend changes; all resolver hooks already exist.
2. **`StatusBadge`** — extend existing primitive with all 6 tones + `dot` slot. No Radix dependency.
3. **`MetricCard`** — label + value + hint + optional sparkline. Severity-tinted via `tone` prop.
4. **`KeyValueList`** — dl grid, mono values, hover-reveal copy buttons. Used on every detail page.
5. **`RawPayloadPanel`** — header (title + size + copy) + collapsible body. Basic JSON syntax highlight in CSS (not a JS highlighter — the style guide is minimalist). Replaces every bare `<pre>`.
6. **`DataTable`** — wraps `@tanstack/react-table`. Props: `columns`, `data`, `onRowClick`, `emptyState`, `sortable`, `pagination`. Dense rows (36 px default). No "View" column — the row itself is the link.
7. **`Dialog` / `ConfirmDialog`** — wrap `@radix-ui/react-dialog`. Replace any existing hand-rolled modals.
8. **`DropdownMenu`** — wrap `@radix-ui/react-dropdown-menu`.
9. **`Select`** (enhanced) — wrap `@radix-ui/react-select` only where native `<select>` can't render rich options (e.g., the target picker in category mappings).
10. **`Tooltip`, `Popover`, `Toast`, `Tabs`** — wrap the remaining Radix primitives.

**Migration chunks** (separate commits within the same PR, or separate PRs if reviewer prefers):

- **Chunk A** — `DataTable` migration across 9 list pages (Orders, Products, Inventory, Customers, Listings, Cursors, Jobs & Logs, Connections, Adapters). Removes every custom table + every "View" action column. Drops row height to 36 px. Adds sort + URL-synced sort on CREATED/UPDATED.
- **Chunk B** — `EntityLabel` rollout: every row/column that currently renders a raw UUID. Grep for `ol_order_`, `ol_customer_`, `ol_product_` in JSX.
- **Chunk C** — `RawPayloadPanel` replacement: Order detail / Connection detail / Listing detail / Job detail.
- **Chunk D** — `@tanstack/react-virtual` on Jobs & Logs (4,677 rows).

**Acceptance**:
- [ ] Every primitive has a `*.test.tsx` covering happy path + a11y attributes
- [ ] `DataTable` used on every list page (9 pages)
- [ ] `EntityLabel` used on every detail-page heading + every table row currently showing a UUID
- [ ] `RawPayloadPanel` replaces every raw-JSON `<pre>` (grep check in PR)
- [ ] No "View" action column in any list table; rows click-navigable
- [ ] Row height ≤ 36 px default across every list
- [ ] Sort indicators + URL-synced sort on CREATED/UPDATED minimum
- [ ] Virtualization on `/jobs-logs`; scrolling 4,677 rows is smooth at 60 fps
- [ ] MetricCard severity tinting on Dashboard (Failed Jobs card is tinted red-soft when count > 0)
- [ ] Empty states ≤ 1/4 page height; "EMPTY STATE" eyebrow removed
- [ ] `pnpm lint && pnpm type-check && pnpm test` pass

**Estimated size**: L (1–2 weeks, depending on how many chunks become separate PRs)

---

### Phase 4 — Detail pages (issue [#240](https://github.com/SilkSoftwareHouse/openlinker/issues/240))

**Scope**: Order / Connection / Product / Customer / Inventory / Listing / Job (succeeded + failed). Restructure per the pattern: header → status banner → summary → related sections → activity timeline → raw data (collapsed).

**Critical files**:
- `apps/web/src/pages/orders/order-detail-page.tsx`
- `apps/web/src/pages/integrations/*` (connection detail + edit)
- `apps/web/src/pages/products/product-detail-page.tsx`
- `apps/web/src/pages/customers/customer-detail-page.tsx`
- `apps/web/src/pages/inventory/inventory-detail-page.tsx`
- `apps/web/src/pages/listings/listing-detail-page.tsx`
- `apps/web/src/pages/jobs/job-detail-page.tsx`

**Reference**: `docs/ui-audit/concepts/order-detail.html` + `docs/ui-audit/concepts/connection-detail.html`.

**Steps** (per page, same shape):
1. Replace bespoke layout with `PageHeader` + status banner (when failure state exists) + `KeyValueList` summary + related-entity section + activity timeline + `RawPayloadPanel` (collapsed).
2. Heading uses `EntityLabel` — entity name first, internal UUID as mono metadata.
3. Operator actions row: retry / abort / view source / edit / disable, as appropriate per entity.
4. For Connection detail specifically: replace the card mosaic with tabs (Overview / Health / Mappings / Activity / Configuration / Danger zone).
5. Order detail: elevate the destination failure into a top-of-page error banner with the full error text (no ellipsis) + Retry action. This closes P0 [#4.2](../ui-audit/audit.md#42--order-destination-status--failed-but-page-says-order-sync-status).
6. Customer detail: add list of customer's orders.
7. Inventory detail: add "recent adjustments" timeline (placeholder if adjustments aren't tracked yet — backend issue, not blocking).
8. Failed job detail: retry / abort / force-dead action row; attempts history.

**Acceptance**: per issue #240; every detail page heading uses `EntityLabel`; status summary visible without scroll; related entity lists reachable.

**Estimated size**: L (1–2 weeks)

---

### Phase 5 — Forms & wizards (issue [#241](https://github.com/SilkSoftwareHouse/openlinker/issues/241))

**Scope**: Convert single-screen setup forms into step-based wizards. Ship `SetupStepper`. Tighten form widths. Audit validation surfaces.

**Critical files**:
- `apps/web/src/shared/ui/setup-stepper.tsx` — new
- `apps/web/src/pages/integrations/new-connection-prestashop-page.tsx`
- `apps/web/src/pages/integrations/new-connection-allegro-page.tsx`
- `apps/web/src/pages/integrations/edit-connection-page.tsx`
- `apps/web/src/pages/integrations/advanced-new-connection-page.tsx`
- `apps/web/src/pages/integrations/connection-mappings-page.tsx`
- `apps/web/src/pages/integrations/connection-category-mappings-page.tsx`

**Steps**:
1. Ship `SetupStepper` primitive with per-step validation, next/back/save, unsaved-changes guard.
2. PrestaShop wizard: split into **Credentials → Test connection → Capabilities → Review & connect**.
3. Allegro wizard: split into **Credentials → Environment → Product catalog → OAuth redirect → Review & connect**. Make Product catalog required when any `ProductMaster` connection exists.
4. Connection edit: replace raw `Config JSON` textarea with structured inputs + a power-user "JSON view" toggle.
5. Advanced mode: add warning-tone header + "prefer the guided flow" recommendation.
6. Mapping editors: rebuild per `concepts/category-mappings.html` — two-pane layout, tree expanded by default, inline target picker with auto-match suggestions, sticky command bar. Delete the empty-state cards.
7. Audit all forms for `FormErrorSummary` presence. Apply `max-width: 560px` to single-column forms.

**Acceptance**: per issue #241.

**Estimated size**: M–L (1–2 weeks)

---

### Phase 6 — Dashboard & triage surfaces (issue [#242](https://github.com/SilkSoftwareHouse/openlinker/issues/242))

**Scope**: Redesign Dashboard around triage (not product overview). This phase consumes every primitive from earlier phases, so it lands last.

**Critical files**:
- `apps/web/src/pages/dashboard/dashboard-page.tsx`
- `apps/web/src/pages/orders/failed-orders-page.tsx`
- `apps/web/src/features/sync-jobs/*` — for the grouped-failures query

**Reference**: `docs/ui-audit/concepts/dashboard-a.html`.

**Steps**:
1. Compress 4 metric cards into a single tinted `MetricCard` strip (Failed Jobs goes red-soft when count > 0).
2. Build the "What's broken right now" surface — 4 incident groups with retry/view actions. Requires a new backend aggregation endpoint grouping failed jobs by job type + connection (coordinate with backend team if not already available).
3. Connection health card reflects job-failure signal, not just DB `status=active`. Roll up: if connection has N failing jobs in last 24h, render `warning` badge.
4. Harmonize Failed Jobs count between Dashboard and `/orders/failed`. Either narrow both to the same scope, or make the scopes explicit in copy. Closes P0 [#4.1](../ui-audit/audit.md#41--counter-contradiction-between-dashboard-and-failed-orders-page).
5. Dashboard metric cards link to filtered list views (e.g., clicking Failed Jobs lands on `/jobs-logs?status=dead`).

**Acceptance**: per issue #242.

**Estimated size**: M (3–5 days)

---

## 5. Cross-cutting concerns

### Regression prevention

- **Before/after screenshots** per phase, committed under `docs/ui-audit/progress/phase-{N}/`. Diff tool: `ImageMagick compare` or eyeballing in the PR.
- **Test suite**: every existing `*.test.tsx` must pass. Add new tests for every new primitive. No coverage drop.
- **Lighthouse a11y**: must stay ≥ 96 on every audited page. Re-run after each phase via chrome-devtools MCP.
- **Visual smoke test** (manual): open all 34 baseline pages after each phase, confirm no layout collapse.

### Testing policy

- Unit: `@testing-library/react` + `vitest` for primitives and pages.
- Integration: existing critical-path integration tests in `apps/api/test/integration/` stay green (they don't touch FE).
- No new e2e tests are required for this refactor — the changes are visual/structural.

### Rollback strategy

Each phase is one PR. Reverting a phase reverts just that phase; downstream phases either still function (since old and new patterns coexist during migration) or are reverted in reverse order.

If Phase 3 primitives cause issues, the consuming pages in Phases 4–6 can import the old pattern until the primitive is fixed. No big-bang risk.

### Accessibility

- Lighthouse a11y check after each phase.
- Keyboard-only navigation pass before opening Phase 2 and Phase 3 PRs.
- Focus indicators mandatory on every interactive element (`2px solid var(--accent-primary)`).
- Status color is never the only signal — every badge has a dot + text (already enforced in style guide).

---

## 6. Quality gate (every PR)

```bash
pnpm lint
pnpm type-check
pnpm test
pnpm build
```

Additionally, for pages impacted by the PR:
- Open in dev server, walk the happy path manually.
- Run Lighthouse a11y; ensure ≥ 96.
- Capture an after-shot for the PR description.

---

## 7. Sequencing & rough timeline

| Phase | Dependency | Est. size | Calendar week |
|---|---|---|---|
| 1 — Tokens | none | S | 1 |
| 2 — Shell | Phase 1 (soft dep — can start with minor rebase) | M | 1–2 |
| 3 — Primitives | Phase 1, 2 | L | 2–4 |
| 4 — Detail pages | Phase 3 | L | 4–5 |
| 5 — Forms | Phase 3 | M–L | 4–5 (parallel with 4) |
| 6 — Dashboard | Phase 3, (ideally 4) | M | 5–6 |

**Total:** ~6 weeks of focused front-end work for one engineer, or 3–4 weeks for two engineers parallelizing Phases 4/5/6.

Phases 4 and 5 can run in parallel once Phase 3 is merged — different files, no conflicts. Phase 6 is best run last because it showcases every primitive.

---

## 8. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Radix Primitives introduce subtle focus/keyboard bugs | Low | Medium | Unit test each wrapper with `@testing-library/user-event`; Lighthouse a11y after every phase |
| Visual drift between concepts (`docs/ui-audit/concepts/`) and live build (React + tokens vs. static HTML) | Medium | Low | Concepts are the measuring stick; reviewer compares live page to concept in every phase PR |
| TanStack Table migration regresses table behavior | Medium | Medium | Migrate one page at a time in chunks; Chunk A alone might need 2–3 smaller PRs |
| Phase 3 takes longer than estimated (primitives expand under migration pressure) | High | Medium | Carve Phase 3 into per-primitive sub-PRs if it grows; each primitive is independently mergeable |
| Backend aggregation endpoint for "What's broken right now" (Phase 6) not ready | Medium | Low | Phase 6 can use a client-side aggregation as a fallback; backend endpoint can come later |
| IBM Plex from Google Fonts fails / CSP tightens | Low | Low | Self-host the font files under `apps/web/public/fonts/` as a fallback; document in Phase 1 PR |
| Scope creep — operators find problems not in the audit | Medium | Medium | File new sub-issues under epic #236 instead of widening existing phase PRs |

---

## 9. Success criteria

- All 4 P0 and 15 P1 findings from [`docs/ui-audit/audit.md`](../ui-audit/audit.md) closed
- Lighthouse a11y ≥ 96 maintained on every audited page
- No P0 / P1 finding re-opens in a post-refactor audit
- `docs/frontend-ui-style-guide.md` serves as the measuring stick; every phase PR references the relevant section
- Style-guide-compliance sweep: a freshly-onboarded engineer reading only `docs/frontend-ui-style-guide.md` can produce a new page that visually fits without further guidance

---

## 10. Out of scope

Same as epic #236:

- Mobile/tablet layouts (style guide targets operator workstations)
- Performance work (already strong)
- i18n (English-only in FE-001)
- Allegro OAuth callback UX (requires live OAuth state)
- Full a11y remediation beyond the remaining 4%

---

## Related documents

- Epic: [#236](https://github.com/SilkSoftwareHouse/openlinker/issues/236)
- Audit: [`docs/ui-audit/audit.md`](../ui-audit/audit.md)
- Baseline: [`docs/ui-audit/baseline/README.md`](../ui-audit/baseline/README.md)
- Library decision: [`docs/ui-audit/library-analysis.md`](../ui-audit/library-analysis.md)
- Concepts: [`docs/ui-audit/concepts/index.html`](../ui-audit/concepts/index.html)
- Style guide: [`docs/frontend-ui-style-guide.md`](../frontend-ui-style-guide.md)
- Frontend architecture: [`docs/frontend-architecture.md`](../frontend-architecture.md)

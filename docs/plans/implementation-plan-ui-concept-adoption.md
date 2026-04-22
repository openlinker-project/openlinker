# Implementation Plan: UI Refactor — Adopt Variant A Concept Across `apps/web` (one big PR)

**Date**: 2026-04-22
**Status**: Ready for Review
**Estimated Effort**: 7–9 working days (one engineer, single PR)

> **Supersedes the six-PR split** in `docs/plans/implementation-plan-ui-refactor.md` (Epic #236, issues #237–#242). This plan consolidates that work into a single PR per the owner's decision. Epic #236 remains the umbrella; the phase issues can be closed on merge of this PR or left open as historical links. The *scope* of this plan is broader (dark mode, real nav counts, placeholder ⌘K, near-black primary) because the concept gallery landed after the six-PR plan was written.

---

## 1. Task Summary

**Objective**: Rewrite the visual layer of the OpenLinker operator web app (`apps/web`) to match the Variant A direction in `docs/ui-audit/concepts/` (shadcn-faithful cockpit, Linear polish, IBM Plex type, wider status palette, denser tables, sparkline-ready KPIs, dark-mode toggle). Delivered as one big PR.

**Context**: The current UI is functional but visually undifferentiated — system fonts, single-tone blue primary button, generic cards, no severity tinting on KPIs, no dark mode, no sparklines, no count-aware nav, a sidebar/topbar that ignore cockpit idioms. A comprehensive UI audit (`docs/ui-audit/`) produced a shadcn-faithful concept gallery with a 1236-line `foundation.css` token sheet and five reference HTML pages. This plan ports that direction into the live app and locks the six decisions the owner made upstream:

1. Primary button → near-black (`var(--text-primary)`), not blue. Blue (`#2f6fed`) demotes to `--accent-primary` for links, focus rings, and the active-nav inset indicator only.
2. Sidebar nav counts → real data via a new `useNavCounts()` hook that fans out existing feature queries (no new backend endpoint).
3. Command palette (⌘K) → placeholder-only in this PR. Full implementation tracked in **#333**.
4. Dark mode → included. Toggle in the user-chip dropdown; persisted to localStorage; `prefers-color-scheme` default.
5. IBM Plex → self-hosted woff2 subsets under `apps/web/public/fonts/`. No Google Fonts CDN.
6. Delivery → one big PR.

**Classification**: **Frontend** (visual layer only). No backend or CORE changes. No new HTTP endpoints. No domain-logic or capability-port changes.

---

## 2. Scope & Non-Goals

### In Scope

- Design tokens: port the token palette from `docs/ui-audit/concepts/foundation.css` into `apps/web/src/index.css` `:root`, plus `html[data-theme=dark]` override.
- Typography: self-host IBM Plex Sans (400/500/600/700) + IBM Plex Mono (400/500/600) under `apps/web/public/fonts/`. Declare `@font-face` in `index.css` with `font-display: swap`. Subset to `latin` + `latin-ext`.
- Shared UI primitives: rewrite CSS for `Button`, `Input`, `Select`, `Textarea`, `StatusBadge`, `Alert`, `DataTable`, `Tabs`, `Dialog`, `DropdownMenu`, `Popover`, `Tooltip`, `ToastProvider`, `MetricCard`, `SetupStepper`, `EmptyState`/`ErrorState`/`LoadingState`, `FormField`, `FormErrorSummary`, `FieldError`.
- New primitives: `KpiCard` (severity-tinted, sparkline slot), `Chip` (filter pill), `Sparkline` (SVG-only, no library), `ThemeToggle` (light/dark/system).
- AppShell: redesign sidebar (nav groups with count badges, active inset-left indicator, workspace footer) and topbar (breadcrumb + placeholder search with `⌘K` hint + alerts icon + primary-CTA slot + user chip with theme toggle).
- Nav counts hook: `useNavCounts()` under `app/hooks/` fanning out existing feature queries.
- Theme infrastructure: `ThemeProvider` under `app/theme/`, `useTheme()` hook, localStorage persistence, `prefers-color-scheme` default, FOUC-prevention inline script in `index.html`.
- Page migration: update all 32 page files to consume the new primitives/tokens. Structural rewrites for Dashboard, Connection detail, and Mapping editor per the concept pages; other pages get token-driven visual uplift plus native `<input>`/`<select>` → shared-primitive swaps.
- Resolve remaining open items that are side-effects of this work: **#318**, **#324**, **#325** close on merge. (**#317**, **#319**, **#320** already addressed by the 2026-04-22 polish bundle on `main`; confirm during final validation.)

### Out of Scope (and Why)

- **Backend changes** — `useNavCounts()` reuses existing list endpoints via `{ limit: 1 }`; no new `/nav-counts` endpoint introduced.
- **Command palette behavior** — `⌘K` search slot is a visual placeholder. Full implementation tracked in **#333**.
- **Mobile redesign beyond current affordances** — existing responsive patterns (hamburger, `DesktopOnlyBanner`, `hideBelow` columns, `cardView`) stay. Tablet polish is a nice-to-have; mobile parity is not a blocker.
- **Wizard step logic** — PrestaShop and Allegro setup wizards get visual shell updates only; step graphs, validation, and mutation wiring do not change.
- **`Product.currency`** — unrelated data-model gap, tracked in **#326**.
- **Mono-text tooltip coverage across every DataTable** — tracked in **#320** (polish bundle partially addressed).
- **Raw connection UUIDs in Jobs/Webhooks** — tracked in **#321**.
- **Failed Orders triage gaps** — tracked in **#327**.
- **Allegro "Before you start" callout** — tracked in **#316**.

### Constraints

- Must ship as **one big PR**. Branch must be rebased against `main` at least every other working day.
- Must preserve existing keyboard shortcuts, ARIA semantics, and focus management in Radix-wrapped primitives.
- Must not break `pnpm lint` / `pnpm type-check` / `pnpm --filter @openlinker/web test` at merge.
- Must not introduce any new UI library beyond those already listed in `docs/frontend-architecture.md` → "UI Library Policy". This plan does not require amending that document.

---

## 3. Frontend Architecture Mapping

**Target layers in `apps/web/src`**:

| Layer | Folder | What changes |
|---|---|---|
| `app/` | `app/theme/`, `app/hooks/use-nav-counts.ts`, `app/main.tsx`, `apps/web/index.html` | Theme provider, nav counts hook, font preload, FOUC guard |
| `pages/` | All 32 `*.tsx` under `pages/` | Visual updates via primitives; structural rewrites on Dashboard, Connection detail, Mapping editor |
| `features/` | `features/*/components/*.tsx` (wizards, panels) | Visual shell updates only; internal logic untouched |
| `shared/ui/` | All 33 existing `*.tsx` primitives + 4 new | CSS rewrites + 3 new display primitives + theme toggle |
| `shared/` (root) | `apps/web/src/index.css` | Token set, `@font-face`, dark-mode override, CSS body rewrites |
| `public/` | `apps/web/public/fonts/*.woff2`, `apps/web/public/fonts/LICENSE.txt` | 7 self-hosted woff2 subsets + Plex SIL OFL license |

**Dependency direction stays intact** (enforced by existing ESLint rules in `apps/web/.eslintrc.js`):
- `app` → `pages` → `features` → `shared`
- `shared` imports no `features` / `pages`
- No new boundary crossings.

**No new Radix / headless library adopted.** The plan honors the UI Library Policy without amendment.

---

## 4. Research — Concepts, Current Code, and Delta

### Concept source material (read)

- `docs/ui-audit/concepts/foundation.css` — 1236 lines: tokens, reset, typography utilities, shell layout, buttons, cards, badges, tables, KPI, misc primitives.
- `docs/ui-audit/concepts/index.html` — gallery, names the direction "Variant A — Restrained cockpit · with targeted B transplants".
- `docs/ui-audit/concepts/dashboard-a.html` — KPI strip with severity tinting, "What's broken right now" incidents table, connection + system health split, recent activity stream.
- `docs/ui-audit/concepts/orders.html` — canonical list pattern (entity-resolved rows, filter chip bar, no "View" column).
- `docs/ui-audit/concepts/order-detail.html` — prominent failure banner, summary + sync destinations grid, line items, raw payload, activity timeline.
- `docs/ui-audit/concepts/connection-detail.html` — tabbed drilldown with KPI strip + activity table + capabilities + right-rail ops.
- `docs/ui-audit/concepts/category-mappings.html` — two-pane editor, inline target picker, sticky command bar.

### Current state (verified by `grep` / `find`)

- `apps/web/src/index.css` — 3651 lines. Current token names partially overlap with the concept (`--bg-surface`, `--text-primary`, `--border-subtle`, `--status-*`). Values differ; new tokens needed for `--space-1..8`, `--radius-xs..xl`, `--shadow-xs/sm/md/focus`, `--duration-*`, `--ease-*`, `--status-review`, `--status-conflict`.
- `apps/web/src/shared/ui/` — 33 primitives, 22 with colocated `*.test.tsx`.
- `apps/web/src/pages/` — 32 page files. 20 pages use `button--primary|secondary|ghost|danger` class strings directly (some through `<Button>`, some via `<Link className="button button--primary">`).
- Tests: 22 primitive tests + ~25 page tests.

### Delta summary (what actually changes)

**Tokens**:
- Primary demoted from blue filled → near-black filled. Blue `#2f6fed` stays as `--accent-primary` for links, focus rings, and the active-nav inset indicator.
- New radii scale, spacing scale, shadow triplet + focus shadow, motion tokens.
- New status tones: `review` (purple), `conflict` (orange), `disabled` (slate).
- Dark-mode values under `html[data-theme=dark]`.

**Typography**:
- IBM Plex Sans replaces system sans. IBM Plex Mono replaces system mono.
- Body 13.5px / line-height 20px.
- Numeric columns use `font-variant-numeric: tabular-nums` (already present via `.tabular` / `.num`).

**Primitives**:
- `Button` — near-black primary, softer secondary, ghost/danger unchanged semantically. Heights 32/28/24px.
- `StatusBadge` — soft bg + strong border + 20px height, add `review` tone.
- `Alert` — tighter card, tone-tinted left accent + soft bg + border.
- `DataTable` — uppercase header with letter-spacing, denser rows (10px padding), hover tint.
- `Tabs` — underline treatment, matches concept's connection-detail tabs.
- `Select` — **fix #325**: bump `.control--select padding-right` to `3rem` and reposition chevron gradient.
- `EmptyState` / `ErrorState` — add `justify-items: start` to `.state-card__actions` (closes any remaining #319 remnants after the polish bundle).
- `MetricCard` — add `tone?: 'neutral' | 'error' | 'warning' | 'success'` prop wiring the new `.kpi--*` severity-tinted backgrounds.
- `FormField` / `Input` / `Textarea` — inherit new control styling; border-radius moves from 10px to `var(--radius-md)` (6px).

**New primitives (4)**:
- `KpiCard` — severity-tinted card with optional `sparkline` slot. Replaces `MetricCard` usage on the Dashboard. `MetricCard` stays for any other spot not migrated (JSDoc `@deprecated`).
- `Chip` — filter-bar pill (22px height, muted bg, border).
- `Sparkline` — SVG-only, no charting library. ~60 LOC.
- `ThemeToggle` — three-option radio group (Light / Dark / System), lives in user-chip dropdown.

**AppShell rebuild**:
- Sidebar: uppercase group labels (`letter-spacing: 0.11em`), nav items 6px padding, active item gets `box-shadow: inset 2px 0 0 var(--accent-primary)`, count slot (`.nav-item-count`) on the right. Workspace footer at bottom with brand-gradient avatar, workspace name, env chip, sign-out.
- Topbar: 52px height. Grid: `breadcrumbs | search-slot | spacer | icon-alerts | primary-cta | user-chip`. Primary CTA slot is context-aware via a new `usePageAction()` context set from each page.
- Breadcrumbs: `resolveCrumbs()` semantics unchanged; only visual treatment updated.

**Closes on merge**:
- **#318** — Mapping editor rewrite uses real `<Tabs>` primitive.
- **#324** — Filter bars on migrated pages use `<Input>` / `<Select>` primitives.
- **#325** — Select chevron clip fixed via CSS.

---

## 5. Questions & Assumptions

### Open Questions

1. **Plex legal bundling** — OFL 1.1 allows self-hosting; license file must ship alongside. Assumption: include `apps/web/public/fonts/LICENSE.txt`. Confirm at review.
2. **Sparkline data** — current API does not return time-series for KPIs. Assumption: sparkline slot ships empty in v1; a follow-up issue wires data once a `/metrics/timeseries` endpoint exists.
3. **Env chip placement** — concept shows env inline with brand name. Assumption: move to that position; reuse existing `EnvironmentBadge`.
4. **Alerts icon** — current app has text "Alerts 0". Concept has icon with red dot. Assumption: swap to icon-only; keep reaching into the existing toast surface. No notification-center refactor in this PR.
5. **`useNavCounts` cadence** — assumption: reuse TanStack Query defaults (stale-while-revalidate, query-wide stale time per feature hook). Counts refresh when the user visits related pages.
6. **"Failed jobs" nav count semantics** — use `deadGroupsQuery.data.length` for groups and sum of counts for jobs (matches Dashboard).

### Assumptions

- Existing test infra (`vitest`, `@testing-library/react`) untouched; test updates are content-only.
- No new feature flags or env vars. Theme persists client-side in localStorage.
- Manual QA only; no visual regression tool on the approved list. Reviewer sweeps desktop + tablet + mobile on key routes.
- Bundle size budget: IBM Plex subsets ≤ 700 KB gzipped across all 7 weights.

### Documentation Gaps

- `docs/frontend-ui-style-guide.md` will diverge from reality after this PR. Plan includes an update step at the end of Phase 4.

---

## 6. Proposed Implementation Plan

Five phases. Commits inside the single PR branch should match these phases so reviewers can walk the diff chronologically.

### Phase 0 — Foundations (Tokens + Fonts + Dark-Mode Infra)

**Goal**: Swap the visual substrate. Every existing page picks up the new look automatically via CSS cascade, before any TSX is touched.

**Steps**:

0.1. **Download IBM Plex subsets**
- Source: SIL OFL 1.1 downloads from IBM Plex project.
- Weights: Sans 400/500/600/700; Mono 400/500/600.
- Subset: `latin` + `latin-ext` (Polish coverage).
- Output: `apps/web/public/fonts/plex-sans-{400,500,600,700}.woff2`, `apps/web/public/fonts/plex-mono-{400,500,600}.woff2`.
- Add: `apps/web/public/fonts/LICENSE.txt` (OFL 1.1 text).
- **Acceptance**: 7 woff2 files present; `du -sh apps/web/public/fonts/` ≤ 800 KB.

0.2. **Declare `@font-face` at the top of `index.css`**
- `font-display: swap`; `unicode-range` for latin + latin-ext.
- Preload the 400 weight of each family via `<link rel="preload" as="font" crossorigin>` in `apps/web/index.html`.
- **Acceptance**: no network request to Google Fonts in the browser; `font-family: 'IBM Plex Sans'` resolves.

0.3. **Rewrite `:root` in `index.css` with the concept token set**
- Port tokens from `docs/ui-audit/concepts/foundation.css:15-114`.
- **Keep existing token names** that already work (e.g., `--bg-surface`, `--text-primary`, `--border-subtle`, `--status-success-soft`). Only values change.
- **Add new tokens** where the concept introduces them: `--space-1..8`, `--radius-xs..xl`, `--shadow-xs/sm/md/focus`, `--duration-fast/normal`, `--ease-out/standard`, `--status-review/review-soft`, `--status-conflict/conflict-soft`.
- **Acceptance**: dev build compiles; routes show IBM Plex + slightly different colors; no class renames yet.

0.4. **Add dark-mode override**
- Append `html[data-theme=dark] { … }` block overriding color tokens for dark mode.
- Recompute `-soft` / `-border` variants for readability on dark surfaces.
- **Acceptance**: `document.documentElement.setAttribute('data-theme', 'dark')` in devtools flips the whole app cleanly.

0.5. **Theme provider + hook + FOUC guard**
- `apps/web/src/app/theme/theme-provider.tsx` — reads `localStorage.theme` or `prefers-color-scheme`; writes `data-theme` to `<html>`; listens for `matchMedia` changes when in `system`.
- `apps/web/src/app/theme/use-theme.ts` — returns `{ theme, effectiveTheme, setTheme }`.
- `apps/web/src/app/theme/theme-provider.test.tsx` — tests for default, persistence, system change.
- Mount `<ThemeProvider>` in `main.tsx` above `<QueryClientProvider>`.
- Add inline `<script>` in `apps/web/index.html` `<head>` that reads localStorage and sets `data-theme` **before** React hydrates (prevents flash of wrong theme).
- **Acceptance**: theme persists across reloads; no FOUC; `matchMedia` change flips theme when in `system`.

**Commit boundary**: after Phase 0 the app looks visually "different" already without any TSX churn.

---

### Phase 1 — Shared UI Primitives

**Goal**: Rewrite CSS for every `shared/ui/` primitive to match the concept. TSX APIs stay stable. Add 4 new primitives.

**Steps**:

1.1. **Button** (`shared/ui/button.tsx` + `.button*` CSS)
- Keep API. Rewrite CSS: primary → near-black; secondary → surface + border; ghost; danger → `--status-error`.
- Add colocated `button.test.tsx` (currently missing).
- **Acceptance**: all four tones match concept; focus ring uses `--shadow-focus`.

1.2. **Input / Textarea / Select** (`shared/ui/{input,textarea,select}.tsx` + `.control*` CSS)
- Height 32px, radius `--radius-md` (6px), new border colors.
- **Fix #325**: `.control--select { padding-right: 3rem }`; chevron gradient at `calc(100% - 14px)` / `calc(100% - 8px)`.
- **Acceptance**: "All platforms" filter on `/connections` shows full text at 390 / 768 / desktop.

1.3. **StatusBadge** (`shared/ui/status-badge.tsx` + `.status-badge*` CSS)
- Add `review` tone. 20px height, soft bg + strong border.
- **Acceptance**: all existing usages unchanged; new tone works.

1.4. **Alert** (`shared/ui/alert.tsx` + `.alert*` CSS)
- Tone-tinted left accent + soft bg + border.
- **Acceptance**: no API changes.

1.5. **DataTable** (`shared/ui/data-table.tsx` + `.data-table*` CSS)
- Header uppercase + 0.08em letter-spacing, 10.5px font.
- Rows 10px padding, hover `--bg-surface-muted`.
- `hideBelow`, `cardView`, virtualization untouched.
- **Acceptance**: `data-table.test.tsx` passes.

1.6. **Tabs** (`shared/ui/tabs.tsx` + `.tabs*` CSS)
- Underline treatment for selected tab.
- **Acceptance**: `tabs.test.tsx` passes.

1.7. **Feedback states** (`shared/ui/feedback-state.tsx` + `.state-card*` CSS)
- Re-verify `justify-items: start` on `.state-card__actions` (already landed in the polish bundle). Add the muted error-soft background on `ErrorState`.

1.8. **MetricCard** (`shared/ui/metric-card.tsx` + `.metric-card*` CSS)
- Add `tone?: 'neutral' | 'error' | 'warning' | 'success'` prop.
- CSS: reuse concept's `.kpi--error` / `.kpi--warning` rules under existing `.metric-card*` class names.

1.9. **SetupStepper** (`shared/ui/setup-stepper.tsx`)
- Lighter circles, subdued connector lines, active uses `--accent-primary`.
- Mobile collapsed state unchanged.

1.10. **Dialog / DropdownMenu / Popover / Tooltip / Toast**
- CSS-only updates; no behavior change; all Radix-wrapped.

1.11. **New: `Chip`** (`shared/ui/chip.tsx` + test)
- Native `<button>` extension. Props: `tone`, `active`, `onClick`.
- 22px pill, muted bg, border, 11.5px font.

1.12. **New: `Sparkline`** (`shared/ui/sparkline.tsx` + test)
- SVG-only. Props: `values`, `width?`, `height?`, `tone?`.
- `polyline` with tone-colored stroke + optional filled area.

1.13. **New: `KpiCard`** (`shared/ui/kpi-card.tsx` + test)
- Props: `label`, `value`, `tone`, `description?`, `sparkline?`, `as?`, `href?`.
- Composes concept's `.kpi` CSS + optional `Sparkline`.

1.14. **New: `ThemeToggle`** (`shared/ui/theme-toggle.tsx` + test)
- Three-button radio using concept's `.btn-group` CSS.
- Reads/writes via `useTheme()`.

**Commit boundary**: after Phase 1 every primitive looks finished.

---

### Phase 2 — AppShell Rebuild

**Goal**: Replace sidebar + topbar with concept layout. Wire real nav counts and theme toggle.

**Steps**:

2.1. **`useNavCounts` hook** (`app/hooks/use-nav-counts.ts` + test)
- Fans out: `useConnectionsQuery()`, `useOrdersQuery({}, { limit: 1 })`, `useInventoryQuery({}, { limit: 1 })`, `useCustomersQuery({}, { limit: 1 })`, `useListingsQuery({}, { limit: 1 })`, `useSyncJobsQuery({ status: 'dead' }, { limit: 1 })`, `useWebhookDeliveriesQuery({ status: 'failed' }, { limit: 1 })`.
- Returns: `{ connections, orders, inventory, customers, listings, jobsFailed, webhooksFailed }` with `number | null` per key (null while loading/error).

2.2. **Rewrite `AppShell` sidebar** (`shared/ui/app-shell.tsx`)
- `.sidebar-brand` with OL mark + brand name + inline env chip.
- `.sidebar-nav` groups: `OPERATIONS | DIAGNOSTICS | PLATFORM | PLANNED`.
- Each `<NavLink>` has `.nav-item` / `.nav-item--active` + `.nav-item-count` slot.
- `.sidebar-footer` with workspace mark + name + sign-out.
- Counts populated from `useNavCounts()`.

2.3. **Rewrite `AppShell` topbar**
- Grid: breadcrumbs | search-slot | spacer | alerts-icon | primary-cta | user-chip.
- Search slot: `<button class="topbar-search">` with search icon + `<kbd>⌘K</kbd>`. `onClick`: no-op. `title="Global search (coming soon)"`. Full impl in **#333**.
- Primary-CTA slot: new `<TopbarAction>` component fed by a `usePageAction` context (pages call `usePageAction({ label, to | onClick })` on mount).
- User chip: existing `DropdownMenu` wrapping user name/email + `<ThemeToggle>` + Sign out.

2.4. **Update `app-shell.test.tsx`**
- Mock `useNavCounts`. Assert count badges render when hook returns data. Assert sidebar/topbar structure.

**Commit boundary**: after Phase 2 the shell is done.

---

### Phase 3 — Page Migration

**Goal**: Update every page. Five concept pages get structural rewrites; other 27 pages get lighter visual uplift + filter-primitive swaps.

One commit per page (or per small group) to keep diffs reviewable inside the one big PR.

**Priority order**:

3.1. **Dashboard** (`pages/dashboard/dashboard-page.tsx`) — swap `MetricCard`s for `KpiCard`s with `tone`; "What's broken right now" matches concept; connection + system health split; recent activity stream; topbar primary action = "Refresh".

3.2. **Connections list** — `<Select>` filters; topbar primary action = "New connection".

3.3. **Connection detail** — KPI strip + tabs + right-rail actions layout per concept.

3.4. **Orders list** — `Chip` primitive for selected filter pills; `<Select>` for status.

3.5. **Order detail** — prominent failure banner; summary + sync-destinations grid; line items; raw payload (existing `RawPayloadPanel`); activity timeline.

3.6. **Mapping editor** (`pages/connections/connection-mappings-page.tsx`) — **closes #318**: real `<Tabs>` primitive replaces the button-as-tabs hack. Two-pane layout landed where feasible; if not, minimum = real tabs + existing `MappingPanel`.

3.7. **Failed Orders** — token uplift; no structural change. (`rowHref` / IDs remain with #327.)

3.8. **Remaining 27 pages** (mechanical pass):
- **Closes #324**: swap remaining native `<input>`/`<select>` to `<Input>`/`<Select>`.
- Spot-check tests per page.
- Pages: `inventory-list`, `inventory-detail`, `customers-list`, `customer-detail`, `listings-list`, `listing-detail`, `products-list`, `product-detail`, `sync-jobs`, `sync-job-detail`, `webhook-deliveries`, `webhook-delivery-detail`, `cursors`, `adapters`, `settings`, `login`, `allegro-connect-callback`, `new-connection`, `prestashop-setup`, `allegro-setup`, `advanced-new-connection`, `connection-category-mappings`, `edit-connection`.

---

### Phase 4 — Polish + Cleanup + Validation

**Goal**: Ship.

4.1. **Prune unused CSS** in `index.css`. Target: ~3650 → ~2500 lines.

4.2. **Deprecate legacy primitives** — add `@deprecated — use KpiCard instead` to `MetricCard` JSDoc (not deleted — still referenced in non-Dashboard spots).

4.3. **Update `docs/frontend-ui-style-guide.md`** — new primary, new typography, dark mode, reference `docs/ui-audit/concepts/` as the design source.

4.4. **Validate closes-on-merge issues** — walk #318, #324, #325 acceptance criteria manually. Confirm #317/#319/#320 polish bundle remains intact (already landed on `main` 2026-04-22).

4.5. **Bundle & runtime checks** — `pnpm build`; confirm font payload ≤ 700 KB gzipped; JS bundle delta ≤ +50 KB gzipped. Sweep 8 routes × 3 viewports × 2 themes = 48 visual spot-checks.

4.6. **Open the PR** — title `refactor(web): adopt Variant A UI concept across apps/web`. Body includes before/after screenshots and `Closes #318`, `Closes #324`, `Closes #325`.

---

## 7. Alternatives Considered

### Alternative 1 — Six-PR split (existing plan in `implementation-plan-ui-refactor.md`)
**Why rejected now**: owner explicitly chose one big PR; lands atomically; simpler review calendar.
**Trade-off**: bigger single review, higher rebase cost.

### Alternative 2 — Coexistence flag (`html[data-ui=v2]`)
**Why rejected**: adds scaffolding with no merge-time benefit when the PR lands atomically; risks leaving dead code if rollout stalls.

### Alternative 3 — Big-bang CSS rename (`btn`, `card`, `badge`)
**Why rejected**: doubles the diff by forcing every page file to update both CSS references and markup. Phase 1 already covers the visual delta by rewriting CSS bodies under existing class names.

### Alternative 4 — Ship `cmdk` palette in this PR
**Why rejected**: requires UI Library Policy amendment + new dep + ~1 day of its own UX work. Cleanly tracked in **#333**.

---

## 8. Validation & Risks

### Architecture Compliance

- ✅ Dependency direction preserved (`app → pages → features → shared`).
- ✅ No new library adopted.
- ✅ New primitives stay in `shared/ui/` and follow established rules (forwardRef, `className` merge, tokens-only styling, colocated test).
- ✅ Naming: `PascalCase.tsx` for components, `use-*.ts` for hooks, `*.test.tsx` for tests.

### Risks

- **Branch drift** — one big PR. **Mitigation**: rebase every other day; integrate any primitive/CSS change on `main` immediately.
- **Visual regression** — no snapshot tool. **Mitigation**: Phase 4 manual sweep across 48 permutations; reviewer repeats.
- **Test churn** — page tests asserting on old class names. **Mitigation**: grep page tests for class-string selectors up-front; fix per page in Phase 3.
- **IBM Plex subsetting mistakes** — dropping latin-ext would break Polish characters. **Mitigation**: smoke-check Polish glyphs on a page with Polish copy if available; verify subset ranges include U+0100–U+024F.
- **Dark-mode edge cases** — Radix portals must inherit theme. **Mitigation**: `data-theme` on `<html>` means portals inherit automatically; verify in Phase 1.10.
- **`useNavCounts` cost** — 7 list queries on app mount. **Mitigation**: all use `{ limit: 1 }`; TanStack Query dedupes with list-page visits via same query keys.

### Edge Cases

- Zero-row counts → show `0` (not "—") once query settles; show empty slot while loading.
- FOUC — handled by inline script in `index.html` (Step 0.5).
- localStorage disabled — `useTheme` falls back to `prefers-color-scheme`, swallows write errors.
- System theme change while open — `matchMedia` listener active when `theme === 'system'`.
- `hideBelow` column widths — manual check per page at tablet in Phase 3.

### Backward Compatibility

- ✅ No API changes.
- ⚠️ Additive `tone` on `MetricCard` only; no breaking prop changes.
- ⚠️ Class names on pages: unchanged except when a page file is explicitly touched in Phase 3.

---

## 9. Testing Strategy & Acceptance Criteria

### Unit / Component Tests

- 22 existing `shared/ui/*.test.tsx` — green after each phase.
- New: `kpi-card.test.tsx`, `chip.test.tsx`, `sparkline.test.tsx`, `theme-toggle.test.tsx`, `theme-provider.test.tsx`, `use-nav-counts.test.ts`, `use-theme.test.ts`, `button.test.tsx` (missing), `alert.test.tsx` (if missing).
- Page tests: 25 page tests green. Replace class-string assertions with role-based queries where found.
- Run: `pnpm --filter @openlinker/web test`.

### Integration Tests

No backend changes → no `*.int-spec.ts` updates.

### Manual QA

Pre-PR sweep at 1440×900, 768×1024, 390×844 across `/`, `/orders`, `/orders/:id`, `/connections`, `/connections/:id`, `/connections/:id/mappings`, `/jobs-logs`, `/settings`. In both light and dark themes.

### Acceptance Criteria (closes on merge)

- [ ] `index.css` `:root` uses concept tokens; IBM Plex renders from self-hosted woff2.
- [ ] `html[data-theme=dark]` flips app cleanly.
- [ ] `ThemeToggle` in user-chip dropdown persists to localStorage; respects `prefers-color-scheme` by default; no FOUC.
- [ ] Sidebar shows uppercase group labels, active inset indicator, count badges from `useNavCounts()`.
- [ ] Topbar shows breadcrumbs, `⌘K` search placeholder, alerts icon, primary-CTA slot, user chip.
- [ ] All 32 pages render with new tokens.
- [ ] Dashboard uses `KpiCard` with severity tint; layout matches concept.
- [ ] Mapping editor uses real `<Tabs>` (closes #318).
- [ ] `.control--select` no longer clips selected option at narrow widths (closes #325).
- [ ] All migrated filter bars use `<Input>` / `<Select>` (closes #324).
- [ ] `pnpm lint` / `pnpm type-check` / `pnpm --filter @openlinker/web test` pass.
- [ ] Font payload ≤ 700 KB gzipped; JS bundle delta ≤ +50 KB gzipped.
- [ ] `docs/frontend-ui-style-guide.md` updated.
- [ ] PR body includes before/after screenshots for Dashboard, Connection detail, Mapping editor, Orders list.

---

## 10. Alignment Checklist

- [x] Follows dependency direction (`app → pages → features → shared`)
- [x] No new styled UI library
- [x] No new headless library (UI Library Policy untouched)
- [x] `shared/ui/` wraps every Radix usage; no direct imports from pages
- [x] Vanilla CSS + tokens; no Tailwind / CSS-in-JS
- [x] New primitives follow `ui-components.md` rules (forwardRef, `className` merge, tone prop, colocated test)
- [x] Testing strategy covers every new file and every modified primitive
- [x] Naming conventions honored
- [x] Questions / assumptions surfaced
- [x] Risks and edge cases enumerated
- [x] Rollback: revert the single PR commit; no data migrations
- [x] Plan execution-ready and self-contained

---

## Related Documentation

- [Frontend Architecture](../frontend-architecture.md)
- [Engineering Standards](../engineering-standards.md)
- [Testing Guide](../testing-guide.md)
- [Code Review Guide](../code-review-guide.md)
- [UI Audit Concepts gallery](../ui-audit/concepts/index.html)
- [Six-PR split (superseded)](./implementation-plan-ui-refactor.md)

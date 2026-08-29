# Frontend UI Style Guide

## Purpose

This document defines the visual and interaction style for the OpenLinker frontend.

The frontend should feel like a commerce operations cockpit:

- status-first
- dense but readable
- modern but restrained
- fast to scan
- strong on diagnostics and exception handling

It should not feel like a generic admin template, a settings-heavy CRUD backoffice, or a marketing site disguised as an application.

## Product Feel

OpenLinker should feel closer to:

- Shopify admin clarity
- Linear-level polish
- internal operations console efficiency

OpenLinker should feel less like:

- a glassmorphism dashboard
- a legacy ERP
- a form dump
- a menu jungle

## Direction (FE-002)

Adopted during the UI refactor epic ([#236](https://github.com/openlinker-project/openlinker/issues/236)).

**Aesthetic baseline:** **shadcn/ui** look-and-feel (compact inputs, subdued palette, restrained shadows, clean proportions, small radii) — **implemented in vanilla CSS**, not Tailwind.

**Density posture:** *restrained cockpit* (Linear × Shopify admin). Typography-led hierarchy, generous-but-purposeful spacing, color reserved for operational meaning. Targeted *denser* patterns transplanted from a data-oriented variant: sparklines on KPI cards, filter chip bars above tables, monospace for every timestamp / ID / duration, and a queue-pressure composition widget for triage surfaces.

**Type pairing:** **IBM Plex Sans** for UI, **IBM Plex Mono** for identifiers, timestamps, durations, payload fields, and numeric columns. Self-hosted under `apps/web/public/fonts/` with SIL OFL `LICENSE.txt` alongside; `@font-face` declarations in `src/index.css` scope the subset to `latin` + `latin-ext`. Falls back to system sans.

**Foundation libraries** (headless only — see `## External Libraries`):
- `@tanstack/react-table` — `DataTable` state engine
- `@tanstack/react-virtual` — long lists (e.g., the 4,677-row Jobs & Logs page)
- `@radix-ui/react-*` — `Dialog`, `Select`, `DropdownMenu`, `Tooltip`, `Popover`, `Toast`, `Tabs`

**Non-goals for this direction:** NOC/Datadog-grade density. Chart-heavy dashboards. Mobile-first layouts. These are explicitly rejected by the audit; OL operators are not 24/7 monitoring staff.

## Core Principles

### Status First

System health, failures, stale data, pending actions, and manual review states must be visible without opening deep detail screens.

### High Information Density

Operators work with queues, lists, statuses, and history. The UI should support fast scanning without wasting vertical space.

### Progressive Disclosure

Show the essential view first. Hide advanced details in tabs, drawers, panels, expandable sections, or raw-data views.

### Consistent Patterns

Every module should reuse the same patterns for:

- list and detail
- filters and saved views
- activity timelines
- setup wizards
- mapping editors
- health drilldowns

### Debuggable By Design

Raw payloads, sync history, error details, retry context, and entity timelines must be accessible.

## Shell Layout

The shell should be structured as:

```text
Left navigation
Top utility bar
Main workspace
Optional right utility rail
```

### Left Navigation

The left navigation is persistent and grouped into **three sections by frequency of use**, with a disabled **Planned** footer for IA-anticipated modules that are not yet shipped. This structure was finalized during the FE-002 refactor.

**Operations** (daily surfaces):
- Dashboard
- Orders
- Products
- Inventory
- Customers
- Listings

**Diagnostics** (debugging surfaces):
- Jobs & Logs
- Webhooks
- Cursors

**Platform** (configuration):
- Integrations
- Adapters
- Settings

**Planned** — retired as of #2364. `Automations` was its last remaining item (Shipments and
Invoices had already gone live), and promoting it emptied the group, so the group was removed
rather than left rendering a heading with nothing under it. The `PlannedNavGroup` type and the
shell's `kind: 'planned'` branch survive — a plugin may still contribute one — so neither is dead
code. A future IA-anticipated module re-adds the group here.

Rules:
- No "Live" pills on any live nav item.
- No CTAs in the nav (`Add connection` belongs on `/connections`, not in the sidebar).
- Active item: 2px inset accent-primary shadow on the left edge + `--bg-surface-muted` background + semibold weight.
- Route label, page title, and URL should use the same noun — either "Connections" or "Integrations" throughout, not both.
- Nav width: `240px`. Group labels are `10px / 600 / 0.11em tracking / uppercase` in `--text-muted`.

### Top Utility Bar

The top bar should prioritize utility over decoration and may contain:

- organization or workspace context
- environment context
- global search
- issues or notifications
- quick actions
- profile or permissions

### Main Workspace

Every major screen follows this structure:

```text
Page header
├── breadcrumb (if nested)
├── title (22 px / 600)
├── description (13 px / --text-secondary)
└── actions slot

Workspace
├── status banner (only when degraded / incident / warning)
├── filters or search (chip-based FilterBar)
├── primary content
└── optional detail panel or secondary context
```

**Vertical budget:** on a 900 px viewport the topbar consumes 52 px, the page header ~70 px, so primary content must appear within ≤ 120 px of the viewport top. No empty "workspace strip" or duplicated org/env banner. This is enforced; the FE-001 baseline consumed ~22 % of viewport here and broke the cockpit feel.

## Visual Direction

### Surfaces

Prefer:

- solid surfaces
- subtle elevation
- thin borders
- limited shadow

Avoid:

- translucent glass panels
- heavy gradients
- over-rounded cards
- decorative glow effects

### FE-001 Visual Correction

The FE-001 baseline should move away from a dark SaaS concept-shot aesthetic and toward a light, enterprise e-commerce operations console.

Corrective direction:

- use a warm-neutral light base with restrained accent usage
- reduce panel padding and decorative empty space
- replace roadmap or product-planning content with operator-facing queues, health lists, and activity views
- prefer tables, compact lists, and timelines over large descriptive cards
- keep the shell informational, not editorial

### Visual System v2 (#775)

The current visual system supersedes the monochrome stance from #371. The flat monochrome accent surfaced as the "doesn't feel like a designed product" complaint — #775 reintroduces a brand accent and rebuilds the palette on a perceptual model.

- **Signal-orange accent** — `--accent-primary` is `oklch(68% 0.18 50)` in light, `oklch(72% 0.18 50)` in dark. Used sparingly: primary buttons, active-tab underline, KPI top-rule, pulsing live dot, focus rings, stepper done state, chip-active fill. Status hues remain reserved for status meaning.
- **OKLCH-driven palette** — both themes share a single perceptual model. Warm neutrals in light (hue 80), cool neutrals in dark (hue 270).
- **Live reference** — navigate to `/dev/ui` in the running app (admin tree, hidden from nav). Three tabs: Brandbook (every token), Primitives (kitchen sink), Patterns (composed cockpit examples). Use it as the canonical visual reference.

## Theme Tokens

Tokens are OKLCH-driven (#775), so both light and dark themes share one perceptual model. Drift is enforced — every CSS var in `:root` must appear in `apps/web/src/shared/theme/tokens.ts` and is checked by `scripts/check-design-tokens.mjs` under `pnpm lint`.

Light theme tokens (canonical source: `apps/web/src/index.css :root`):

```css
:root,
[data-theme='light'] {
  /* Surfaces — warm-neutral OKLCH ramp (hue 80) */
  --bg-canvas: oklch(99% 0.003 80);
  --bg-shell: oklch(97.5% 0.004 80);
  --bg-surface: #ffffff;
  --bg-surface-elevated: oklch(99% 0.003 80);
  --bg-surface-muted: oklch(96% 0.005 80);
  --bg-surface-hover: oklch(93% 0.006 80);
  --bg-muted: oklch(96% 0.005 80);
  --bg-strong: oklch(93% 0.006 80);

  /* Borders */
  --border-subtle: oklch(93.5% 0.006 80);
  --border-default: oklch(88% 0.008 80);
  --border-strong: oklch(78% 0.010 80);
  --border-focus: oklch(68% 0.18 50);

  /* Text */
  --text-primary: oklch(20% 0.012 80);
  --text-secondary: oklch(38% 0.010 80);
  --text-muted: oklch(52% 0.008 80);
  --text-disabled: oklch(70% 0.005 80);
  --text-inverse: oklch(96% 0.005 80);
  --text-on-primary: oklch(18% 0.012 50);  /* paired with accent for contrast */
  --text-link: oklch(50% 0.14 250);

  /* Signal-orange accent (#775) — sparingly: primary CTAs, active-tab
     underline, KPI top-rule, pulsing live dot, focus rings. */
  --accent-primary: oklch(68% 0.18 50);
  --accent-primary-hover: oklch(62% 0.19 50);
  --accent-primary-active: oklch(56% 0.20 50);
  --accent-primary-soft: oklch(96% 0.04 60);
  --accent-primary-soft-strong: oklch(40% 0.16 50);
  --accent-primary-border: oklch(85% 0.10 55);
  --accent-focus: oklch(68% 0.18 50);
  --accent-ring: oklch(68% 0.18 50 / 0.30);

  /* Status — each tone ships base / soft / border / fg / strong.
     Hues spaced for distinction (success 150, warning 85, error 25,
     info 245, review 290, conflict 45). */
  --status-success: oklch(54% 0.14 150);
  --status-success-soft: oklch(96% 0.04 150);
  --status-success-border: oklch(85% 0.08 150);
  --status-success-fg: oklch(36% 0.12 150);
  --status-success-strong: oklch(36% 0.12 150);

  --status-warning: oklch(72% 0.16 85);
  --status-warning-soft: oklch(96% 0.05 85);
  --status-warning-border: oklch(85% 0.10 85);
  --status-warning-fg: oklch(42% 0.12 80);
  --status-warning-strong: oklch(42% 0.12 80);

  --status-error: oklch(58% 0.20 25);
  --status-error-soft: oklch(96% 0.04 25);
  --status-error-border: oklch(85% 0.10 25);
  --status-error-fg: oklch(42% 0.16 25);
  --status-error-strong: oklch(42% 0.16 25);

  --status-info: oklch(56% 0.14 245);
  --status-info-soft: oklch(96% 0.03 245);
  --status-info-border: oklch(85% 0.08 245);
  --status-info-fg: oklch(40% 0.12 245);
  --status-info-strong: oklch(40% 0.12 245);

  --status-review: oklch(58% 0.16 290);
  --status-review-soft: oklch(96% 0.04 290);
  --status-review-border: oklch(85% 0.08 290);
  --status-review-fg: oklch(42% 0.14 290);
  --status-review-strong: oklch(42% 0.14 290);

  --status-conflict: oklch(64% 0.16 45);
  --status-conflict-soft: oklch(96% 0.05 45);
  --status-conflict-border: oklch(85% 0.10 45);
  --status-conflict-strong: oklch(40% 0.14 45);

  --status-disabled: oklch(55% 0.008 80);
  --status-disabled-soft: oklch(95% 0.005 80);
  --status-disabled-border: oklch(85% 0.008 80);
  --status-disabled-fg: oklch(38% 0.010 80);
  --status-disabled-strong: oklch(38% 0.010 80);

  /* Tracking, motion, spacing, radii, shadows live in the same :root
     block. See apps/web/src/index.css for the full catalogue. */
}
```

## Color Usage Rules

- canvas and shell stay neutral
- **the primary CTA is signal orange** (`var(--accent-primary)`) paired with `var(--text-on-primary)` (near-black so contrast survives at small sizes). The accent is the brand mark — use sparingly: primary buttons, active-tab underline, KPI top-rule, pulsing live dot, focus rings, stepper done indicator, chip-active fill. (#775 reverses the monochrome stance of #371.)
- **status hues are reserved for status meaning** — five tones (success / warning / error / info / review) plus `conflict` and `disabled`, each with `*` / `*-soft` / `*-border` / `*-fg`. Don't borrow them for decorative tinting.
- semantic colors appear mainly in badges, icons, row markers, and compact highlights
- large panels should not use semantic fills unless the whole panel is an alert or incident state
- neutral borders should dominate the interface
- **color is never the only signal** — pair tone with text, icon, or dot. `StatusBadge` enforces this by combining tone + leading dot + mono-caps label.

## Dark Mode

Dark mode ships as a user toggle. The `ThemeProvider` reads the user's
saved choice from `localStorage` (`openlinker.theme`), falling back to
`prefers-color-scheme`. The resolved theme is written onto
`<html data-theme="...">` so every token swap cascades automatically.
An inline FOUC guard in `apps/web/index.html` sets the attribute
**before React hydrates** to avoid a flash of light theme on first paint.

Dark-mode palette overrides live in `apps/web/src/index.css` under the
`html[data-theme='dark']` block — only colour tokens are remapped. The
spacing, radii, shadows, and typography scales are shared across themes.

The theme toggle itself lives in the top-bar user-chip dropdown as a
three-option radiogroup (Light / Dark / System). It is a shared primitive
at `apps/web/src/shared/ui/theme-toggle.tsx`.

### Color

The dark canvas is a **cool graphite ramp** (hue 270 with very low chroma) — neutral with a faint cool whisper, deliberately not navy. Surfaces step from `oklch(14% …)` (canvas) up to `oklch(28% …)` (strong/hover). Text inverts the same way as light: high-contrast primary, secondary, muted.

The signal-orange accent **stays orange in dark mode** (slightly brighter at `oklch(72% 0.18 50)` for legibility on dark surfaces) so the brand mark is consistent across themes. Status hues lift in brightness so soft backgrounds don't wash out on dark surfaces (#775).

```css
html[data-theme='dark'] {
  /* Surfaces — cool graphite ramp */
  --bg-canvas: oklch(14% 0.005 270);
  --bg-shell: oklch(16% 0.006 270);
  --bg-surface: oklch(19% 0.007 270);
  --bg-surface-elevated: oklch(22% 0.008 270);
  --bg-surface-muted: oklch(24% 0.009 270);
  --bg-surface-hover: oklch(28% 0.010 270);
  --bg-muted: oklch(24% 0.009 270);
  --bg-strong: oklch(28% 0.010 270);

  /* Borders */
  --border-subtle: oklch(24% 0.010 270);
  --border-default: oklch(30% 0.012 270);
  --border-strong: oklch(42% 0.014 270);
  --border-focus: oklch(72% 0.18 50);

  /* Text */
  --text-primary: oklch(96% 0.006 270);
  --text-secondary: oklch(78% 0.010 270);
  --text-muted: oklch(60% 0.012 270);
  --text-disabled: oklch(42% 0.012 270);
  --text-inverse: oklch(20% 0.012 80);
  --text-on-primary: oklch(16% 0.012 50);
  --text-link: oklch(76% 0.14 245);

  /* Accent — brighter for legibility on dark surfaces (#775) */
  --accent-primary: oklch(72% 0.18 50);
  --accent-primary-hover: oklch(78% 0.18 50);
  --accent-primary-active: oklch(84% 0.16 50);
  --accent-primary-soft: oklch(28% 0.08 50);
  --accent-primary-soft-strong: oklch(86% 0.14 60);
  --accent-primary-border: oklch(40% 0.14 55);
  --accent-focus: oklch(72% 0.18 50);
  --accent-ring: oklch(72% 0.18 50 / 0.40);

  /* Status — chroma kept; hues spaced as in light. See index.css for
     the full set (success / warning / error / info / review / conflict /
     disabled). */
}
```

The palette is intentionally restrained:

- neutral background, surface, elevated surface
- strong primary text, muted secondary text, clear border color
- semantic status tones (success, warning, error, info, inactive, conflict / manual review) — chroma reserved for state, never decoration

Color must never be the only signal. Every status must also have text and, where useful, an icon.

### Typography

Typography should prioritize scanning and system clarity.

**Adopted pairing (FE-002):**
- UI sans-serif: **IBM Plex Sans**, weights 400 / 500 / 600 / 700
- Monospace: **IBM Plex Mono**, weights 400 / 500 / 600

IBM Plex was chosen over Inter / Geist / system defaults because it carries operator/technical heritage without feeling generic, and it renders cleanly at the 12–14 px sizes we use heavily.

**Self-hosted woff2 files** live under `apps/web/public/fonts/` with the SIL OFL `LICENSE.txt` alongside. `@font-face` declarations in `src/index.css` scope the subset to `latin` + `latin-ext` (ranges sourced from `@fontsource`'s `unicode.json`) and set `font-display: swap`. The hot-path weights (sans 400, sans 600, mono 400) are `<link rel="preload">`'d from `apps/web/index.html` to eliminate FOUT on first paint. No external font CDN is consulted at runtime.

Recommendations:

- restrained page-title sizes
- clear section headings
- compact body text
- consistent metadata style

Type scale:

- page title: `22 / 28`, 600, `-0.02em` tracking
- section title: `14 / 20`, 600
- body: `13.5 / 20`
- metadata or labels: `12 / 16`
- uppercase eyebrows: `10.5 / 16`, 600, `0.09em` tracking
- table headers: `10.5 / 16`, 600, `0.09em` tracking, uppercase, `--text-muted`
- mono body: `12 / 18`, `-0.01em` tracking

Use monospace for:

- identifiers (`ol_order_…`, connection UUIDs)
- timestamps and durations (`11:47:22`, `312ms`, `2h 14m`)
- payload field labels and JSON
- numeric columns in tables (with `font-variant-numeric: tabular-nums`)
- system references and cursors

### Spacing And Shape

Use the strict 4 px spacing scale via `var(--space-{n})` tokens (1=4 / 2=8 / 3=12 / 4=16 / 5=24 / 6=32 / 7=48 / 8=64). Avoid raw rem values where a token exists — keeps the grid honest at refactor time.

Use restrained radii and avoid overly soft shapes. Canonical scale (#775):

- form controls + buttons: `var(--radius-md)` — 8 px
- cards (KPI/metric, feedback-state, table container): `var(--radius-lg)` — 10 px
- dialogs, toasts, dev-ui section surface: `var(--radius-xl)` — 14 px
- pills, chips, channel-pill: `var(--radius-pill)` — 9999 px
- status badges (mono+caps treatment): `var(--radius-sm)` — 6 px

Recommended defaults:

- page gutters: `var(--space-5)` to `var(--space-6)` (24 / 32 px)
- panel padding: `var(--space-4)` to `var(--space-5)` (16 / 24 px)
- avoid more than three visual depth levels on the same screen

### Canonical type scale (#775)

The scale below is what primitives now use. Keep page-level typography aligned with these rem values.

| Purpose | Rem | Pixels | Weight | Tracking |
|---|---|---|---|---|
| Display (KPI value, hero numbers) | `2rem` | 32 | 600 | `var(--tracking-tight)` |
| Page title | `1.75rem` | 28 | 600 | `var(--tracking-tight)` |
| Section title | `1.0625rem` | 17 | 600 | `var(--tracking-tight)` |
| Body | `0.875rem` | 14 | 400 | normal |
| Body (small / default control) | `0.8125rem` | 13 | 400 | normal |
| Metadata / labels | `0.75rem` | 12 | 500 | normal |
| Eyebrow / uppercase / mono-caps | `0.6875rem` | 11 | 500 | `var(--tracking-caps)` |

**Always pair numerics with `font-variant-numeric: tabular-nums`** (or the `.tabular` utility) — the cockpit table view depends on it for scan-ability.

## CSS Implementation Standard

The visual direction above must be enforced in CSS and component markup, not only in mockups.

Required implementation rules:

- define theme values as tokens first and consume those tokens in component rules
- avoid raw hex colors in component selectors; literals belong in the token layer
- prefer explicit component classes over broad descendant selectors such as `.panel p` or `.page-header h2`
- keep default HTML affordances useful: links should look like links unless a component intentionally restyles them
- style modifiers after their base rules and keep state classes explicit, for example `status-pill--error` or `context-chip--info`
- responsive overrides must match the layout model being changed; use grid overrides for grid layouts and flex overrides for flex layouts
- add or extend shared primitives before introducing page-specific one-off styling
- narrow-viewport table-to-cards (#1784): where a dense mapping/config table must stay usable on small screens, opt the table into `.data-table--stackable` and add a `data-label` to each `<td>`. At `<= 640px` a scoped block collapses each row into a card (source cell as the heading; remaining cells stack under their `data-label`). Prefer this over a "desktop-only" banner — the mapping page dropped `DesktopOnlyBanner` for it. The rule is scoped to the modifier so the app-wide `DataTable` is untouched.

Recommended CSS structure for `apps/web/src/index.css`:

- tokens
- base element defaults
- layout primitives
- shared component primitives
- state modifiers
- responsive overrides

Markup conventions:

- use dedicated classes for component text roles such as page title, page description, section title, panel copy, and state messages
- avoid styling bare tags inside containers when the intent is component-specific
- use semantic status text together with color; status color must never be the only signal
- keep interactive classes consistent across links and buttons so hover and focus behavior stays predictable

## Core Component Patterns

The design system should prioritize these primitives:

- `PageHeader`
- `StatusBadge`
- `MetricCard`
- `DataTable`
- `FilterBar`
- `BulkActionBar`
- `EmptyState`
- `ErrorState`
- `LoadingState`
- `DetailDrawer`
- `Timeline`
- `KeyValueList`
- `EntityTabs`
- `SetupStepper`
- `LogViewer`
- `RawPayloadPanel`

These primitives matter more than decorative hero sections or unusual card layouts.

## MVP Primitives Standard

FE-002 expanded the primitive layer in `apps/web/src/shared/ui`. Every primitive below is owned by us and styled via `index.css`. Where a Radix primitive is wrapped, its role is behavior + a11y only.

### Controls (unstyled wrappers over native HTML)

- `Button` — tones: `primary` (signal orange + `--text-on-primary`), `secondary` (surface + border), `ghost`, `danger`. Sizes via `className="button--{xs|sm|md|lg}"` (24 / 28 / 32 / 38 px). Icon-only via `button--icon`. Trailing keyboard shortcut affordance via `<span className="button__shortcut">⌘K</span>`.
- `Input` / `Textarea` / native `Select` — 32 px height, `var(--radius-md)`. Invalid state via `aria-invalid` or the `invalid` prop (mirrors danger-tone focus ring).
- Native `<input type="checkbox|radio">` — styled via `accent-color: var(--accent-primary)`. The form-controls rule excludes non-text input types so checkboxes keep their native 14 px size.
- `FormField` — label + control + description + error wiring (`aria-invalid`, `aria-describedby`)
- `FieldError`, `FormErrorSummary`
- `Alert` — tonal variants matching status tokens, left-rule accent

### Tables

- `DataTable` — wraps `@tanstack/react-table` for sort/filter/column state. Dense rows (36 px default), row-click navigation, integrated empty state, status badge cells. `align` is **`'left' | 'right'` only** — the `.data-table__cell--center` rule was deleted in #2023 once it proved consumerless (its two former call sites, the dashboard *Attempts* and failed-orders *Items* counts, are numeric and moved to `'right'`), and `'center'` was dropped from the type with it: a member that type-checks, stamps a class nothing matches, and then renders *left* declares the opposite of what it does. Re-adding it means re-adding the CSS in the same change. `rowLinkDisplay` (`'inline'` default | `'block'`) controls how the first cell's navigation `<a>` participates in layout — pass `'block'` when that cell renders a tall composite, or the `:focus-visible` ring sizes itself from the anchor's own inline metrics and paints across the row's middle (see § Density & Row Heights, listings carve-out). Pairs with `@tanstack/react-virtual` when row count ≥ 500. `hideBelow` (per-column, breakpoint-gated hiding) and `expandable` (a per-row accordion detail panel, opened via a leading toggle, `#1620`) are two independent, composable strategies for keeping a wide table usable at narrower widths — `hideBelow` drops non-essential columns outright below a breakpoint, `expandable` keeps every column queryable but moves non-essential fields into a click-to-open detail row instead of hiding them. A table can use either, both, or neither; the orders list (`#1620`) uses `expandable` with no `hideBelow` columns, relying on the table's own horizontal scroll at tablet width for anything that doesn't fit. `expandable` is not currently supported together with `virtualize` on the same table — see the `DataTableExpandable` JSDoc in `data-table.tsx`.

### Status & data surfaces

- `StatusBadge` — tones: `success` / `warning` / `error` / `info` / `review` / `neutral`. Dot + text; never color alone.
- `MetricCard` — label + value + hint + optional sparkline. Severity-tinted via `--kpi--error` / `--kpi--warning` modifiers when the metric carries operational alarm.
- `KeyValueList` — definition list with `120px auto` grid, monospace values where appropriate, inline copy-to-clipboard buttons on hover.
- `EntityLabel` — **name-first resolver** that takes an internal UUID + entity type and renders human name + monospace ID + copy button. Consumes `useConnectionsQuery` / `useCustomersQuery` / etc. Used on every list row and detail heading where an internal UUID would otherwise leak. `nameTitle` overrides the `title` on the rendered name — pass it whenever the caller SHORTENS what it hands to `name`, or the tooltip shows the shortened form and the full value becomes unreachable to a sighted user (#2089). `copyLabel` / `copiedLabel` mirror `CopyableId`'s and must name what Copy actually writes, which is always the `id`. The copy button also carries `title={id}` so a sighted operator can see the target on a row whose visible identity is something else — deliberately the raw id rather than a mirror of the accessible name, which would make `title` the accessible *description* of a control that already has that string as its name (#2091). `showCopy` (default `true`) suppresses the built-in copy button for a composite that pairs the label with its own copy affordance, so one id never grows two copy controls (#2027). The id-shortening rule is exported as `shortenId(id)` from `shared/ui` so such a composite reuses the exact algorithm instead of growing a second one.
- `CopyableId` — monospace id + copy button. `copyLabel` / `copiedLabel` override the copy button's accessible name, which otherwise defaults to `Copy {id}` and is read out as a spelled-out UUID; a caller that can resolve the id to something human should pass it (`"Copy connection ID for Erli Demo"`, #1996).
- `ConnectionCell` (`features/connections`) — the standard table cell for a connection reference: an optional leading `adornment` + resolved name + shortened, copyable id + an attention-only status note, driven by **one batched `useConnectionsQuery` for the whole page**. The adornment is pluggable and per-page: a `channel-pill` where the platform is the point (Products), a `ConnectionDot` where a carrier is (Shipments), nothing where a dedicated Channel column already carries it (Listings). Never resolve a connection per row (#1996/#2027). Its `connection` prop distinguishes `undefined` (still loading) from `null` (resolved, not found) — coalesce with `?? null` at the call site or a per-row fetch is silently reinstated.
- `OrderIdentityCell` (`features/orders`) — the standard table cell for an order reference on any list that shows one: 24 px `ProductThumbnail` + the marketplace order number (shortened past 18 chars, falling back to `shortenId` of the internal id) + first item name and a `+N` line-item chip. Copy writes the **internal** id and says so; the full order number is the line's `title`. Fed from the `orderSummary` projection (#1995) on Shipments and Invoices; `/orders` adopted it in #2091.
- `ProductThumbnail` — 24 px (`sm`) / 32 px (`md`) square with a 6 px radius over `--bg-surface-muted`. Renders the product image (`loading="lazy"`, `decoding="async"`) when `src` is provided, otherwise a monospace first-letter placeholder derived from `name`; falls back to the placeholder on image load error. `alt=""` by default so it stays decorative next to an adjacent name label (`aria-hidden` set on the wrapper); callers pass an explicit `alt` when the thumbnail is the sole label. **Always render a `ProductThumbnail` when a product appears in a list/row** — the placeholder keeps row heights stable while images load and doubles as a visual affordance that the row is a product.
- `RichTextEditor` — WYSIWYG description editor over Tiptap. Its toolbar, document schema and byte counter are all **derived from the destination's declared `DescriptionFormat`** (ADR-046), fetched per connection: a bold button exists because the destination declared `<b>`, and a byte counter appears only where the destination declared a cap. Before the declaration arrives it renders a loading surface (`aria-busy`, with no toolbar at all) — never a default toolbar. A control whose tag the destination *rewrites* (Allegro rewrites italic to bold) carries a lossy note so the operator is not surprised by what publishes. Also exposes a source (HTML) mode; leaving it commits on the toggle. Wires `aria-invalid` / `aria-describedby` like every other control primitive.
- `RichTextView` — read-only render of stored description HTML, sanitized with DOMPurify. The **only** sanctioned `dangerouslySetInnerHTML` in the app (enforced by a `no-restricted-syntax` selector with this file as the sole per-line override). It drops `style` / `class` / `data-*` / `aria-*`, which is deliberately narrower than what storage keeps — arbitrary CSS in an admin page is a UI-redressing vector even where it cannot execute.
- `RawPayloadPanel` — JSON viewer: header with title + byte count + copy button + collapse; syntax-highlighted body (mono font, 12 px, 18 px line-height). Replaces every bare `<pre>` block.
- `Timeline` — vertical timeline with dot + time column + body. Used on order detail, job detail, connection activity.

### Navigation & overlays (wraps Radix headless primitives)

- `Dialog` / `ConfirmDialog` — wraps `@radix-ui/react-dialog`
- `Select` (enhanced) — wraps `@radix-ui/react-select` when native select's options can't carry rich content
- `DropdownMenu` — wraps `@radix-ui/react-dropdown-menu`
- `Tooltip` — wraps `@radix-ui/react-tooltip`
- `Popover` — wraps `@radix-ui/react-popover`
- `Tabs` — wraps `@radix-ui/react-tabs`
- `Toast` — wraps `@radix-ui/react-toast`

### Composition patterns

- `PageHeader` — page title + description + actions slot; page content begins ≤ 100 px from viewport top.
- `PageShell` — sidebar (240 px) + topbar (52 px) + main. Enforced structure for every authenticated page.
- `FilterBar` — chip-based filter surface above tables; chips are `{ label: value }` with a remove button each. Paired with `Add filter` affordance at the end.
- `SetupStepper` — horizontal stepper for integration wizards (Allegro, PrestaShop). Per-step validation; next/back/save.
- `BackLink` (+ `PageLayout.backTo`) — retreat-one-level navigation for detail and sub-pages. Rendered via `PageLayout.backTo={{ to, label }}` above the eyebrow, outside `actions` (which is reserved for forward CTAs — Cancel is a form concern, not navigation). Labels match sidebar-nav entry names (e.g. `"Jobs & Logs"`, not `"Jobs"`). The glyph is `aria-hidden` so accessible names read as the bare label. When all three slots are populated the vertical stack is `backTo → eyebrow → title` in that order — anticipate this composition when designing a page; if a tighter header is wanted, omit `eyebrow`. Also composable standalone for non-PageLayout hosts (e.g. the wizard-card back slot, via `className="wizard-card__back"`). Tokens only: `--text-muted`, `--text-primary`, `--accent-focus`.

### Implementation rules

- Prefer native HTML semantics first; wrap them with thin React components.
- Every shared UI component uses `forwardRef` (required for React Hook Form).
- Keep primitives token-driven — no raw hex in component CSS.
- Use `tone` for variant props (not `variant` or `color`).
- Avoid over-generalized APIs; build only the surface the current product needs.
- Use the same primitive in a real page immediately after introducing it — no unused abstractions.

### Buttons

Buttons should support:

- primary actions
- secondary actions
- destructive confirmation actions
- disabled and busy states

Use links only for real navigation. If an element submits, confirms, or mutates state, it should be a button.

### Inputs, Selects, And Textareas

Control primitives should:

- preserve native browser semantics
- share the same spacing, border, and focus treatment
- expose invalid state visually and through `aria-invalid`
- work cleanly with React Hook Form registration

### Status Badge

Status badges use a normalized semantic vocabulary + a mono-caps treatment so they read as a typed label rather than a generic pill (#775).

Tones (the `tone` prop): `success`, `warning`, `error`, `info`, `review`, `neutral`. Optional flags:

- `withDot` — adds a leading tone-coloured dot (color is never the only signal).
- `pulse` — animates the dot for live/syncing states. Implies `withDot`.
- `solid` — high-emphasis inverted variant (Draft, Outbox, internal flags).
- `compact` — slightly tighter padding for inline use inside table rows.

Always include status text — colour and dot are reinforcement, not substitutes.

## External Libraries

**Styled UI libraries are not adopted.** shadcn/ui, MUI, Mantine, Chakra, Ant Design bring visual opinions that conflict with the operator-cockpit direction and the vanilla-CSS / design-token contract. shadcn specifically requires Tailwind, which is explicitly banned.

**Headless libraries are permitted** when wrapped by a project primitive in `shared/ui/` and styled with our own CSS. They contribute behavior and accessibility only — zero visual opinion, zero bundled styles beyond minimal utility classes we can override.

Adopted (FE-002):

| Library | Role | Wrapped by |
|---|---|---|
| `@tanstack/react-table` | table state engine: sort, filter, column visibility | `DataTable` |
| `@tanstack/react-virtual` | row virtualization for large lists | `DataTable` (conditional) |
| `@radix-ui/react-dialog` | modal focus trap, scroll lock, esc | `Dialog`, `ConfirmDialog` |
| `@radix-ui/react-select` | keyboard-navigable combobox | `Select` (enhanced) |
| `@radix-ui/react-dropdown-menu` | menus + submenus | `DropdownMenu` |
| `@radix-ui/react-tooltip` | positioning + hover delays | `Tooltip` |
| `@radix-ui/react-popover` | portal + positioning | `Popover` |
| `@radix-ui/react-toast` | queue + focus management | `Toast` |
| `@radix-ui/react-tabs` | roving tabindex | `Tabs` |
| `cmdk` | headless command menu: keyboard nav, filtering, composable groups | `CommandPalette` |

Adopted (#2193, [ADR-046](./architecture/adrs/046-adapter-declared-description-format.md)):

| Library | Role | Wrapped by |
|---|---|---|
| `@tiptap/*` | headless rich-text editing: ProseMirror schema + commands, zero visuals, no shipped CSS | `RichTextEditor` (`shared/ui/rich-text-editor.tsx`) |
| `dompurify` | HTML sanitization before render | `RichTextView` (`shared/ui/rich-text-view.tsx`) |

Two rules apply to the rich-text pair specifically, because both are easy to get wrong from a design brief:

- **The editor's toolbar is not a design decision.** Which marks, blocks and lists a `RichTextEditor` offers is derived at runtime from the destination's declared `DescriptionFormat` (ADR-046) — a control exists because a destination declared the tag, never because a designer picked it. Until the declaration arrives the editor renders a loading surface with no toolbar rather than a default one. Do not add a control to the mockup and expect it to appear.
- **Tiptap ships no stylesheet, and `prosemirror-view`'s optional one is deliberately not imported.** Its functional declarations are transcribed into `index.css` and its one cosmetic `outline` uses `var(--accent-primary)`, so the surface stays token-driven like every other primitive.

**Adding a library requires:** (1) a written rationale in the PR description explaining why the behavior can't be built from native HTML, (2) a wrapping primitive under `shared/ui/` with its own CSS, (3) an update to this section.

## Density & Row Heights

Operators scan, they don't read. Density is budgeted across the product so every row earns its height.

Defaults (FE-002):

| Surface | Row height | Notes |
|---|---|---|
| `DataTable` rows | `36 px` | Dense-but-readable. Hover highlights whole row. |
| Listings identity row | auto, ~60 px | Documented `DataTable` exception (#2023) — 32 px thumbnail + name/badges line + meta line + optional validator message. See the carve-out below. |
| Shared identity row (`OrderIdentityCell` / `ConnectionCell`) | auto, ~60 px | Documented `DataTable` exception (#2086) — 24 px thumbnail + identity line + meta line. See the carve-out below. |
| Orders Status cell | auto, ~144 px | Documented `DataTable` exception (#2310, extended #2342 / #2350 / #2356) — health badge + lifecycle-phase badge + optional stock-at-risk badge + optional hold badge + optional OMS attention badge(s) + optional failure reason, up to six stacked lines. See the carve-out below, including the Wave-2 composition note. |
| Nav items | `28 px` | 6 px vertical padding, icon + label + optional count. |
| Toolbar / filter chip | `28 px` | Same height as nav items for alignment. |
| Button `sm` | `28 px` | Default for toolbar buttons, table actions. |
| Button `md` | `32 px` | Default for page-header actions and forms. |
| Input / Select | `32 px` | Never taller. |
| KPI card | auto, ~96 px | Label + value + hint. Sparkline floats top-right. |
| Analytics KPI card (`.status-strip--analytics .kpi-card`, #1990) | auto, ~152 px | Documented carve-out — the six-card sales strip stacks a headline+metric+delta block on top of one-or-more qualifier rows pinned to the card floor by a hairline, provably taller than the ~96 px default. See the carve-out note below. |
| Status banner | auto, ~64 px | Icon + title + message + actions. |
| Analytics trust-header row (`.trust-header__row`) | auto, ~52 px | `var(--space-3) var(--space-4)` padding. Per-connection freshness list, denser than a status banner because it repeats per row. Collapses to one column, auto height on mobile. |
| Who-decides question row (`.who-decides-row`, #2354) | auto, ~76 px | Documented **non-`DataTable`** carve-out — question + answer + why-line + optional extras + badge. See the carve-out below. |

Never introduce a row height that isn't on this list without updating the guide first. Variability across surfaces is the primary way a cockpit feels amateur.

**Documented carve-out — the listings identity row (#2023).** `/listings` is a *cockpit* row, not a label row: a `ProductThumbnail size="md"` (32 px) sits beside a two-line stack (name + lifecycle badges, then a `SKU · EAN · offer-ID` meta line), plus an optional validator-message line when the marketplace rejected the offer. That is provably taller than the `36 px` default, and the first column carries a `min-width: 28rem` floor so the stack never wraps into a third line. It stays on the `DataTable` primitive (unlike the picker rows below, which aren't `DataTable` at all) and it keeps the density posture — nothing decorative is added, every line is a fact an operator scans for — it just takes its height from content instead of the table default. **This carve-out is for the listings identity cell specifically; a new table wanting a tall row needs its own entry here, not a silent reuse.**

Two mechanical consequences worth knowing before copying the pattern:

- The row link must be `rowLinkDisplay="block"` (see the `DataTable` catalog entry). An inline anchor sizes its focus ring from its own line-box metrics, so around a tall composite the ring paints a band across the row's middle instead of enclosing it.
- Only the unbounded field gets a hard character cap. Capping *every* meta field ellipses a routine 20-char SKU on a wide desktop; `flex: 0 1 auto` + `min-width: 0` already truncates each field under real pressure.

**Documented carve-out — the analytics KPI card (#1990).** The six-card sales KPI strip (Revenue, Orders, Order value, Units, Returns & refunds, Cancellations) carries a richer anatomy than the default KPI card: a headline+metric+delta stack plus one or more qualifier rows, each qualifier separated by a hairline (`.kpi-card__qualifier`, `border-top` + `padding-top: var(--space-3)`) and pinned to the card floor via `margin-top: auto`. That composition doesn't fit in ~96 px, so `.status-strip--analytics .kpi-card` sets `min-height: 9.5rem` (152 px) — every line is a fact (a definition, a value, a comparison basis), nothing decorative padded in to hit a number. The strip also runs a 3-column desktop grid (`.status-strip.status-strip--analytics` at ≥1024px) rather than the general dashboard `.status-strip`'s 4-column, because 6 cards divide evenly into 2 rows of 3 rather than an uneven 4-then-2 — see the parity matrix entry below (2×3 desktop, not the generic KPI strip's 1×4). This carve-out is for the analytics KPI card specifically; a new strip wanting either the taller card or the 3-column grid needs its own entry here.

**Documented carve-out — the shared identity row (#2086).** The five lists that answer *which order is this* and *which connection did it come from* render those facts through two shared cells — `OrderIdentityCell` (24 px `ProductThumbnail` + order number/id line + item-name/`+N` line) and `ConnectionCell` (adornment + name line + shortened-id/status line). Either one makes the row two-line, so a table adopting them takes its height from content, same as the listings row above and for the same reason: every line is a fact an operator scans for.

This entry exists because the listings carve-out explicitly refuses to cover a second table. It is deliberately **one entry for all five lists** (Shipments #2089, Invoices #2090, Orders #2091, Products #2092, Customers #2093) rather than one per page — the whole point of #2086 is that these rows are the same row.

**Documented carve-out — the orders Status cell (#2310, extended #2356).** The #2086 entry above covers the *identity* column; this one covers a different column on the same table, which is why it is a separate entry rather than a widening of that one. `.orders-cell-stack` in the orders Status cell is a vertical stack, and the ADR-059 lifecycle phase is appended **inside** it, so a row that carries both a phase and a sync-failure reason renders health badge / phase badge / reason — three lines where two was previously the worst case, and the column can now set the row height on its own rather than only the identity cell doing so.

**#2356 makes four the worst case**: the OMS inert-state badge (§ 4 of the Wave-2 spec — *what OpenLinker stopped deciding*) is appended into the same stack between the phase badge and the failure reason, so a row carrying a phase, an inert state and a sync failure renders health / phase / attention / reason. That is the ceiling by construction, not by convention, and the mechanism is worth naming because `.orders-cell-stack` is `flex-direction: column`: the attention entries are keyed by producer and an order can carry more than one, so `OmsAttentionBadges` renders them inside its own `.data-table__badge-row` (a wrapping flex ROW). Returning bare sibling spans into that column would make each producer its own line and the ceiling five, not four. No alignment change is needed and none was made: `.orders-table td` already top-aligns every cell (see the bullet below), so the taller column lands on line 1 at any row height. Anything that would add a **fifth** line needs its own entry here. Kept as a stack rather than nesting the phase inline beside the health badge (a `ds-row`): the two are orthogonal partitions, and putting them on one line reads as one compound status, which is precisely the reading ADR-059 exists to prevent. The three lines are each a fact an operator triages on, so the row takes its height from content in the usual way. Note this interacts with the vertical-alignment rule below — `.orders-table td` already top-aligns every cell, so no further change is needed for the taller column.

**Extended by #2350 — a fourth line.** The reservation-shortfall badge (§ Order-row signal placement, the sixth badge vocabulary) is appended to the same `.orders-cell-stack`, so the worst case is now health / phase / stock-at-risk / reason: four stacked lines, ~96 px. Recorded here rather than left to be discovered because this section's standing instruction is to update the guide before the row height moves. It needs **no CSS change** — the stack and the `.orders-table td` top-alignment already handle it, and the badge is `compact`. The worst case stays rare by construction: a shortfall badge only appears on an order the master has actually gone short on, and the phase renders neutral on an ordinary row, so a four-line Status cell means four genuine facts rather than decoration.

**Wave-2 composition note (#2342 / #2350 / #2356) — the ceiling is six, not four.** The two paragraphs
above were written on separate branches and each measured its own worst case honestly *in isolation*; body A's
hold badge (#2342) never updated this table at all. `.orders-cell-stack` is `flex-direction: column`, so every
direct child is its own line, and the merged cell has six of them: health / phase / stock-at-risk / hold /
attention / reason. Neither paragraph's "four is the ceiling by construction" survives the composition, and
#2356's own standing instruction — *anything that would add a fifth line needs its own entry here* — is what
this note discharges. The mechanism #2356 describes still holds and is what stops it being worse: multiple
attention producers wrap inside `OmsAttentionBadges`' own `.data-table__badge-row`, so they contribute one line
rather than one per producer.

Two caveats, stated rather than buried. The **~144 px is extrapolated, not measured**: this table's own two
data points for the cell (three lines ~72 px, four lines ~96 px) give a 24 px cadence, and six lines at that
cadence is 144 px — confirm it against a real six-line row before relying on the figure. And #2350 and #2356
each described *itself* as "the sixth badge vocabulary", which cannot both be true; in the merged row the
attention badge is the seventh, and the ordinal has been dropped from its call-site comment rather than left
asserting a count that is now wrong. The worst case stays rare by construction — it needs an order that is
simultaneously short on stock, on hold, carrying an inert state and failing to sync — but it is reachable, so
it is documented.

Mechanics that differ from the listings carve-out, and why:

- **The body caps are px, not a `min-width` floor**: `.order-cell__body` at 250 px (matching `.orders-items-line`, which governs its own second line) and `.connection-cell__body` at 220 px. A column flex container with `align-items: flex-start` sizes each child to its own content, so without a cap the children's existing ellipsis can never fire and one long value widens the column instead.
- **A frozen-pane narrowing is per-table, never inherited.** Shipments caps its frozen Order body at 11 rem below 1280 px (`.shipments-table .data-table__sticky-col .order-cell__body`): at exactly 1024 px the persistent sidebar appears *and* its Connection column un-hides, leaving 720 px, and its frozen cluster is Status — carrying a 32ch error string — plus Order. That figure describes **that** pane and no other. It was originally keyed on `.data-table__sticky-col` alone and silently caught Orders, whose frozen pane is a 36 px expander plus a checkbox (#2091); Products also freezes two columns. Scope any such cap to the table that measured it, positively — a `:not()` exclusion list reproduces the same trap, because the next frozen page inherits a figure measured elsewhere unless it remembers to opt out.
- **A shared cell's own cap is a budget for a specific adornment; re-measure it if you pass a different one.** `.connection-cell__body`'s 220 px was measured for an adornment that is absent or a 14 px `ConnectionDot`. Products passes a `.channel-pill` — mono text, ~100 px for `WooCommerce` — leaving the connection *name* ~113 px, about 17 characters, which is enough for two same-platform connections to ellipsise to the same string and stop discriminating on the axis the line exists for. Widen per page (`.products-table .connection-cell__body`), positively, the same way a frozen-pane narrowing is scoped — and size it so the names *diverge* inside the budget, not so one of them exactly fits.
- **A tablet fold adds a line to a host cell, so re-run the height question at that width.** #2094 relocates the Connection fact into an adjacent cell below 1024 px on Products, Shipments and Invoices rather than letting the `hideBelow: 1024` column drop it — the pattern `.orders-order-channel` established. The cost is not uniform and is not free: Shipments absorbs it (the identity cell was already the tallest thing on the row), Products nearly does, and **Invoices grows from ~65 px to ~83 px** because at tablet its Regulatory, Clearance-ref and Connection columns are all hidden and nothing else on that row is multi-line. That also flips Invoices into the align-the-whole-row branch — `td:first-child` was correct only while the identity cell set the height.

  Two mechanics the fold makes non-optional: the host must supply a **definite width** (`max-width` + `> * { max-width: 100% }`), or the fold's ellipsis can never fire and one long connection name widens the column at exactly the width where the table is already scrolling; and the fold's visibility query must be the **exact complement** of `.data-table__cell--hide-below-1024`'s, which is guarded by a stylesheet-reading test rather than by prose, because a one-pixel drift shows the fact twice or loses it in the gap and no unit test would notice.

  Use `display: none`, not `visibility: hidden` — for a *layout* reason. Both drop out of the accessibility tree; only `display: none` also stops the hidden copy reserving a phantom line at the other breakpoint.

- **Before capping a cell inside a frozen pane, check its siblings.** Capping the identity body alone achieves nothing where an uncapped sibling in the same stack sets the column width — on Orders the channel fold (~200 px) and a `nowrap` Retry button did exactly that, so line 1 ellipsised beside empty column space. And capping the stack instead is not automatically safe: a sibling whose text child declares no `overflow`/`text-overflow`/`min-width: 0` will *overflow* the sticky cell rather than truncate, bleeding over the next column.
- **`rowLinkDisplay="block"` applies only when the table actually linkifies its first cell.** `DataTable` sets `linkifyFirstCell = Boolean(href) && !expandable`, so a table using `expandable` with no `rowHref` — Shipments — never wraps the cell in an anchor and must NOT pass it. The listings consequence is not universal; check which interaction model the table uses first.
- **Every leading control needs `vertical-align: top` — and so does the identity cell, if anything else on the row is taller.** `.data-table td` is `middle`, so at ~60 px a 24 px expander or a 13 px checkbox centres opposite the gap between the two identity lines rather than the identity it belongs to. Alignment only, never a `padding-top` nudge: the cell already inherits the table's vertical padding, so top-aligning lands the control on line 1 at every row height, while a padding tuned for one height misaligns the other tables.

  What differs per table is *scope*, and the epic ended up with three shapes because the row height is not always set by the identity cell:
  - **Products** — `.products-table td` (all cells, #2092). Same shape and same reason as Orders, reached independently from the heuristic rather than copied: its `ConnectionCell` is ~40 px while Stock (value + badge + `reserved N`) is ~56 px and the merged money column ~51 px — either dominates on its own, and both are unconditional. Its leading expander is already covered by Shipments' global rule; the select checkbox in the *second* cell is not, and gains line-1 alignment from the table-wide rule. Note the cells are top-anchored *composites*, not all literally `.products-cell-stack` (the Product cell is `.product-row`, Source is `.connection-cell`), so re-walk the columns if you add one.
  - **Shipments** — `.data-table__row--expandable .data-table__expand-cell` (global). The identity cell is the tallest thing on a *normal* row, so `middle` and `top` coincide for it — but on a **failed** row `ShipmentStatusCell` stacks badge + error message + error time (~3 lines) and sets the height instead, so the identity centres against it. Applying the heuristic below to that row says "align the whole table"; it is a known, unfixed exception rather than a counter-example to the rule.
  - **Invoices** — `.invoices-table td:first-child` (no `expandable`, so the first cell is the checkbox).
  - **Orders** — `.orders-table td` (all cells). Its money column stacks four items, ~70-85 px against the identity's ~37 px, so top-aligning the *controls* alone would still leave the identity centred and the row reading at three different heights. Every cell on that page is a stack, so `top` is right for all of them.
  - **Customers** — `.customers-table td` (all cells, #2093). The interesting case, because it has **no leading control at all**: no expander, no checkbox. Adopting `ConnectionCell` made its Source column (~2 lines) the tallest thing on the row, so the heuristic's "another column sets the height → align the whole row" branch is what applies; the "align the leading control" branch has nothing to point at. Its `Customer` cell is one line on a named row and a two-line stack on a nameless one, so it is also the table where centring is visibly wrong in only *some* rows.

  Pick by asking what sets the row height. If it is the identity cell, align the leading control. **If the table has no leading control and every cell is single-line, do nothing** — reaching "nothing to do" by elimination is correct, not an oversight. If it is another column, align the whole row — *including* when there is no leading control, which is Customers (#2093): the missing control removes the narrower fix, it does not remove the misalignment. Before #2093 Customers really was the "do nothing" case, single-line throughout; adopting a two-line shared cell moved it into the row-wide branch, and that transition is the thing to watch for when a table gains one of these cells.

  One mechanical trap when you write the rule: `DataTable` hardcodes the `<table>` class and puts the caller's `className` on the **container** div, so a page-scoped rule is a *descendant* match (`.orders-table td`) and ties on specificity with `.data-table td { vertical-align: middle }`. It wins by source order alone. Author it **after** that rule in `index.css`, or it silently loses.
- **Hosting one of these cells in a card `title` slot** (the mobile branch) puts it inside `<strong>`, so the meta line must not inherit the emphasis — `.orders-cell-sub, .orders-more-count` pin `font-weight: 400` (the `+N` chip inherits the emphasis too).

Known gap: `DataTableSkeleton` still renders `36 px` rows, so a table with these cells grows on load. It predates this epic (listings ships the same mismatch) and is not owned by any of the five sub-issues. Tracked as #2152.

**Documented carve-out — the who-decides question row (#2354).** `/settings/who-decides` renders its seven rows as a CSS-grid definition list (`.who-decides-row`), not a `DataTable`, and that is the carve-out: the only column cheap enough to hide at a breakpoint is the **why-line**, which spec § 3.3 calls "the whole point of the table" — an answer with no reason is a configuration dump. A `hideBelow` on it would delete the feature on mobile, so the row reflows to a single column at ≤ 768 px instead and never drops a fact. The other reasons `DataTable` is the wrong primitive here are secondary but real: seven fixed rows with no sort, no pagination and no row link, carrying per-row content a table cell does not model well (a link out for A7, a locked note for A6, a list of named connections on an ambiguous row).

Height is content-derived like the identity-cell carve-outs above — question line, answer line, why-line, an optional extras line, and a badge — and the density posture is unchanged: every line is a fact an operator scans for. **This entry is for the who-decides row specifically**; another page wanting a non-`DataTable` list needs its own entry rather than a silent reuse.

**Selection-list rows are governed separately.** Multi-select picker rows inside a modal (e.g. the offer-creation product picker, `.offer-product-picker__prow-main` / `.offer-product-picker__vrow`, #1754/#1779) are *not* `DataTable` rows and are intentionally taller than 36 px: the whole-product checkbox carries a ≥ 44 px tap target (touch parity with the full-width variant-row hit area) and each row pairs a thumbnail with two text lines. They inherit the density posture but pick their own height from content + the tap-target floor rather than the table default; don't force them onto the `36 px` row.

Registered selection-row surfaces:

| Class | Height | Why |
|---|---|---|
| `.offer-product-picker__prow-main` / `__vrow` (#1754/#1779) | auto, ≥ 44 px | thumbnail + two text lines; checkbox tap target |
| `.category-search-results__item` (#2075) | `min-height: 44px` | category name + its root→leaf breadcrumb + a Select action, in the category pickers' search results |

The category-search row takes the same `≥ 44 px` tap-target floor and, below 767 px, **stacks** (`flex-direction: column`) rather than truncating: the breadcrumb is the only thing that makes a hit from an unvisited branch intelligible, so squeezing it to keep one line would defeat the row's purpose. It shares `var(--radius-sm)` with `.bulk-editor__catpick-item`, the drill-down row it swaps places with in the same modal slot.

## Responsive

Desktop (≥ 1024 px) is the design anchor. **Mobile (≤ 767 px) and tablet (768–1023 px) are first-class** — operators should be able to triage failures from a phone off-hours and from an iPad on the shop floor.

Breakpoints (defined in `index.css`):

```css
/* Mobile-first. Layer desktop styles inside min-width queries. */
@media (min-width: 768px) { /* tablet */ }
@media (min-width: 1024px) { /* desktop */ }
```

Parity matrix — what changes across sizes:

| Surface | Mobile (≤ 767) | Tablet (768–1023) | Desktop (≥ 1024) |
|---|---|---|---|
| Nav | drawer · hamburger trigger in topbar | drawer *or* persistent rail | persistent 240 px sidebar |
| Topbar | logo + hamburger + search icon + user | full minus workspace crumb | full |
| Tables | **card view** (one card per row, key columns stacked) | full table, scrolled horizontally within its container as needed | full table |
| Detail pages | single-column stack | 1-col or 60/40 split | 65/35 grid |
| KPI strip | 1 × 4 vertical | 2 × 2 grid | 1 × 4 horizontal |
| Analytics KPI strip (6 cards, #1990) | 1 × 6 vertical | 2 columns × 3 rows | 3 columns × 2 rows — see the analytics KPI card carve-out above |
| `MetricCard` | full width | 2-col grid | 4-col grid |
| Forms (single-column) | `max-width: 100%` | `max-width: 560 px` | `max-width: 560 px` |
| Raw payload panel | collapsed by default | as desktop | as desktop |
| Complex editors | **read-only + "open on desktop to edit" hint** | full interactive | full interactive |
| Wizards | one step per screen, stepper collapsed | full | full |

**Documented departure — the automation composer (#2365)** stays **fully interactive at 375 px**
rather than taking the *Complex editors* row's read-only + "open on desktop to edit" affordance. The
composer is overwhelmingly closed-vocabulary selects (trigger, action, condition field, hold reason)
plus three short text fields — a *configuration* surface, far closer to the picker modal below than
to category mappings or raw-JSON editing, which are the cases that row was written for. It stacks to
a single column below 768 px with ≥ 44 px targets. Like the picker, it never shows an "open on
desktop" hint, because there is nothing it refuses to do at that width.

**Documented departure — the offer-creation product picker modal (#1754/#1779)** folds into a two-step wizard (step 1 = product list, step 2 = selection review + connection + Continue) at **both** mobile *and* tablet width (≤ 1023 px), rather than staying "full interactive" at tablet as the *Complex editors* / *Wizards* rows above would suggest. This is deliberate: the modal's side-by-side list + review rail needs two comfortable columns, which only desktop (≥ 1024 px) affords; on an iPad the two-step flow is more usable than two cramped columns. Unlike the "complex editors" rule, the picker stays **fully interactive** at every width (it is a selection surface, not a data editor), so it never shows an "open on desktop" hint.

Rules:

- **No horizontal scrolling** at any breakpoint except inside `RawPayloadPanel` and a table's own column-overflow area (`.data-table__container`, `overflow-x: auto` — both the virtualized scroller and the plain container). Dense tables (e.g. an 8-column invoices list) grow to their natural content width and scroll horizontally within that container rather than crushing columns; simple 2–4 column tables stay at `100%` width with no scrollbar since their natural width never exceeds the container. `RawPayloadPanel` also scrolls vertically when content exceeds its `max-height` cap (#390).
- **Tap targets ≥ 44 px** on mobile for every interactive element (`.btn--sm` grows to 36 px min on touch; icon buttons to 40 px).
- Text must remain readable at `13 px` body — no shrinking below that on mobile.
- Status banners stack their action buttons below the body on mobile instead of pushing off-screen.
- Every phase PR captures after-shots at **three widths**: 360 × 812, 768 × 1024, 1440 × 900.

Interactive editing on mobile is out of scope for this refactor. Category mappings, connection wizards, and raw JSON editing all show a "Open on a desktop screen to edit" affordance below 1024 px — the view is still readable, just not editable.

## Tables

Tables are primary UX elements in OpenLinker.

Tables should support:

- dense but readable rows
- clear status visibility
- sorting
- filtering
- row-level actions
- bulk actions
- fast navigation to detail views

Prefer tables and structured lists over dashboard-style card grids for operational data.

For dashboard and queue views, introduce tables early instead of relying on summary cards alone.

MVP `DataTable` expectations:

- typed column definitions
- accessible table semantics
- dense but readable rows
- status badge support inside cells
- row-level action cells where needed
- empty-state support

Defer advanced grid behavior until real workflows justify it.

## Forms

Forms should be:

- concise
- sectional
- step-based for setup flows
- explicit about validation and next steps

Avoid very large single-screen setup forms. Integration onboarding should prefer step-by-step flows.

MVP form pattern rules:

- keep validation schemas colocated with the feature
- use `react-hook-form` with `zod` as the default pattern
- use `FormField` to connect label, control, description, and error state
- render field-level errors consistently
- render form-level validation or API errors through a shared summary or alert pattern
- use confirm dialogs for destructive resets or irreversible actions
- use toast feedback for transient mutation success or non-blocking feedback

## Status Language

Important entities should expose both current status and recency.

Recommended status vocabulary:

- healthy
- pending
- running
- stale
- failed
- retrying
- disabled
- needs review
- conflicted

Status should be consistent across orders, products, inventory, integrations, jobs, and automations.

### Order-row signal placement (#2081)

The orders list carries several signals per row. They are organised into **three semantic groups**
(consolidated in #1713), each with one primary badge and subordinate detail beneath it:

| Group | Primary | Subordinate |
|---|---|---|
| **Status** | order health | **lifecycle phase** (#2310, ADR-059); **OMS inert state** (#2356); failure reason; **exceptions** (e.g. an open return) |
| **Shipment** | fulfillment state | packed, ship-by SLA + countdown, delivery owner, carrier |
| **Money** | total | payment, invoice clearance, created |

Four rules govern anything added to a row:

1. **Shipment reads as time.** Its stack is ordered by when things happen — *packed → shipped → due
   → carrier* — so the column scans as a sequence rather than a list of unrelated facts. A new
   shipment-related signal is inserted at its chronological position, not appended.
2. **A workflow position is a tick; an exception is a badge.** Packed is binary and renders as a
   tick, because the row already carries four distinct badge vocabularies and a fifth pill makes
   them compete. Exceptions (returns) are badges, and they belong in the **Status** group where
   failure reasons already live.

   **The ADR-059 lifecycle phase is the standing exception, and it is a badge (#2310).** The rule
   above is about *crowding*: a signal that adds no new axis should not spend a pill. The phase does
   add one — it is a deliberate **second orthogonal partition** beside health, not a refinement of
   it (a held order is usually also `synced`), and it is a **vocabulary of nine values, not a
   workflow tick**, so a tick cannot express it and a subordinate line would bury the one word that
   says where the order actually is. Approved as such at the #2310 gate. The count in the sentence
   above is therefore now five badge vocabularies on the row, and the exception is closed to
   further growth: a sixth needs its own decision, not this paragraph.

   **The sixth vocabulary is the reservation shortfall, and it is a badge in the Status group
   (#2350).** This is the "own decision" the sentence above demands, taken at the #2628 gate rather
   than assumed by the paragraph. Three things settle it. It is an **exception**, not a workflow
   position, so the tick form cannot carry it. It is an exception about *this order's own line* —
   "we promised more of this sku than the master now has, and this order is the one at risk" —
   which is exactly what the Status group means, so it goes there beside the failure reasons. And
   it sits **beside order health, never inside it**: `OrderHealthValues` is a partition whose values
   must sum to the KPI cards, so adding a shortfall value would either double-count or hide a sync
   failure behind a stock one — the same reason #2100 declined a sixth `OrderHealth` bucket and
   shipped a non-partitioning field instead.

   Two placements were rejected. The **Money group** is about amounts, and a shortfall is about
   units the buyer may not receive; putting it there would make a currency column mean two things.
   A **new column** would cost every row permanent width for a state the overwhelming majority of
   rows never have — the same objection that keeps returns in the Status group.

   Tonally it is `warning`, never `error`: the order is at risk, not broken, and reserving red for
   real failures is what keeps a red row meaning outstanding work. The count is now **six**, and
   the exception remains closed: a seventh needs its own decision, not this paragraph.

   The mitigation that keeps the pills from competing is **tonal**, and it is load-bearing rather
   than incidental: the dominant `ready` phase renders **neutral**, as do `cancelled` and every
   other non-exceptional value, so on an ordinary row exactly one badge carries colour and the
   phase reads as a label beside it. A phase that ever renders a warning/error tone alongside a
   non-`healthy` health badge is the shape this rule was written to prevent.

   **The OMS inert-state badge is the sixth vocabulary, and it is taken here as its own decision
   (#2356).** The paragraph above closed the exception to further growth and required a decision
   rather than an inheritance; this is that decision. It qualifies on the same ground the phase did
   — it adds an **axis**, it is not a refinement of one. Health answers *did something fail*, the
   phase *what stage is this at*, fulfillment *where is the parcel*; an inert state answers
   **what OpenLinker stopped deciding**, which is orthogonal to all three (an order OpenLinker
   refused to route is routinely `synced` and `ready`). It is also a *vocabulary*, not a tick: four
   values (`Stopped` / `At risk` / `Blocked` / `Not matched`, spec § 4.2), each pointing at a
   different remedy, so a binary affordance cannot carry it.

   **It does NOT inherit the phase's tonal mitigation, and that difference is the point.** An
   attention badge is **never neutral** — it exists to say something is wrong — so a row carrying
   one deliberately shows two coloured pills. That is not the crowding the rule guards against; it
   is the signal. The cost is bounded by how rare the state is: the badge renders only where a
   producer wrote one, and a healthy install shows none at all. **The count is now six, and the
   exception is closed again**: a seventh needs its own decision, not this paragraph.
3. **The list displays; the detail page acts.** Every row affordance is a link (`Generate label`,
   `Issue invoice`), never an in-place mutation. Introducing in-place editing to this table is a new
   interaction pattern and needs its own decision — it is not a styling choice.
4. **Never extend the health vocabulary.** `OrderHealthValues` is a partition whose five values must
   stay exhaustive and mutually exclusive so the KPI cards sum to the total. New signals sit *beside*
   health, never inside it. And no signal may be frontend-only: `deriveOrderHealth` is a deliberate
   twin of SQL in `OrderRecordRepository`, so anything the backend cannot also compute can never
   become a server-side sort or filter. **The lifecycle phase does not bend this rule** — it sits
   strictly beside health rather than inside it (`OrderHealthValues` is untouched and its buckets
   still sum to the total), it is backend-derived with its own SQL twin in the same repository, and
   the two are held identical by `scripts/check-order-lifecycle-phase-mirror.mjs`. It is a
   server-side filter (`?phase=`) precisely because it satisfies rule 4, not in spite of it.

On narrow viewports the row becomes a card with a labelled fact list (`<dt>`/`<dd>`); a signal that
is a tick on desktop becomes a labelled fact there, and the Shipment block keeps its chronological
order.

**Keep a status pill inside ~17 characters.** BaseLinker's status model carries three name lengths and
reserves a 17-character "short name" explicitly for "space-limited areas like order tables". That is a
borrowed budget, not a derived one, but it is calibrated against a table rendering the same kind of
label at higher volume than ours.

**Why packed earns a place in the row here, when the market leader omits it.** BaseLinker's order list
has no packed column and no packed icon — packing state is visible only as whatever status an
automatic action moved the order into. That works because its statuses are **operator-defined folders
in a left sidebar with per-status counts**, so an operator simply creates a `Packed` folder and the
folder *is* the signal. OL deliberately did not build operator-defined stages (#1032), so it has no
substitute: without a row signal, packed state would be invisible while scanning. The omission
upstream is not evidence the signal is unwanted — it is evidence their information architecture
already carries it somewhere else.

**Not adopted, and why:** a draggable status board.

- **OL cannot honour the drop.** It could only apply for `ol_managed_carrier` orders — under the
  default `omp_fulfilled` routing the destination ships and OL merely observes, so the drop would
  either no-op or assert a status OL has no authority to write.
- **It is also the wrong gesture for the work.** The market leader has no board either, and its
  transitions are **bulk-select-and-act** (row checkboxes plus a toolbar action), **automated**
  (action chains), or **scanner-driven** — even status *reordering* uses arrow buttons, not drag.
  Drag-one-card-at-a-time is orthogonal to how order operators work at volume.

Counts-by-state belong in the summary cards above the list instead.

## Page Patterns

Standardize these patterns:

### List To Detail

Used for:

- orders
- products
- jobs
- automation rules

### Health To Drilldown

Used for:

- integrations
- sync status
- system health

### Setup Wizard

Used for:

- new integrations
- advanced onboarding

### Timeline And Audit

Used for:

- order history
- job execution
- sync events
- integration activity

### Mapping Editor

Used for:

- category mappings
- field mappings
- shipping mappings

### Two-Axis Bulk Editor (#1741 / #1830)

The bulk publish edit modal (`BulkEditModal`) is organized along two independent
axes rather than one flow per destination:

- **Variant shape** - a multi-variant product renders the two-pane layout (left
  rail of scopes: Shared base + one per variant, right pane = the active scope's
  form, inherit/override provenance badges); a simple/single-variant product
  collapses to a flat form with no rail.
- **Destination kind** - a marketplace destination (`OfferCreator`) shows the
  offer field set (category tree + parameter schema, EAN self-link); a shop
  destination (`ProductPublisher`, #1830) shows the shop field set (category in
  the top crumb bar, structured attributes, content, visibility, price/stock).

Both axes reuse the same shell chrome (rail, accordion heads, provenance badges,
discard-guard dialog) - only the field set inside a scope changes with the
destination kind. A destination's sub-capabilities (`ShopCategoryBrowser`,
`ShopAttributeReader`, `CategoryBrowser`, …) gate which sections render; never
branch on `platformType`.

## Accessibility

The operations cockpit must remain accessible even when dense.

Required:

- keyboard navigable shell and filters
- visible focus states
- sufficient contrast
- badges that do not rely only on color
- field-level error association
- accessible tables and status labels

## Do Not

- do not center the app on decorative dashboards
- do not use glassmorphism as the primary shell style
- do not create unique page layouts for every module
- do not hide failures and retry behavior
- do not make settings the center of the product
- do not optimize for empty whitespace over operational readability

## FE-002 refactor epic

Tracked by epic [#236](https://github.com/openlinker-project/openlinker/issues/236) with six phase sub-issues (tokens → shell → primitives → detail pages → forms → dashboard). Every phase PR should attach before/after screenshots and reason about the change against this style guide.

---

This style guide complements `docs/frontend-architecture.md`, which remains the source of truth for technical architecture and state boundaries.

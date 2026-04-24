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

Adopted during the UI refactor epic ([#236](https://github.com/SilkSoftwareHouse/openlinker/issues/236), audit at `docs/ui-audit/audit.md`).

**Aesthetic baseline:** **shadcn/ui** look-and-feel (compact inputs, subdued palette, restrained shadows, clean proportions, small radii) — **implemented in vanilla CSS**, not Tailwind. Reference concepts live in `docs/ui-audit/concepts/`.

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

**Planned** (disabled, `--text-disabled` opacity, non-clickable, tooltip "Coming in a future release"):
- Automations
- Shipping
- Invoices

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

- use a white and graphite-neutral base with restrained accent usage
- keep chroma reserved for semantic status states — primary CTAs, active/selected/focused affordances use `var(--accent-primary)`, which is itself a monochrome alias of `--text-primary` (see #371 and the "Color Usage Rules" section below)
- reduce panel padding and decorative empty space
- replace roadmap or product-planning content with operator-facing queues, health lists, and activity views
- prefer tables, compact lists, and timelines over large descriptive cards
- keep the shell informational, not editorial

## Theme Tokens

Recommended FE light theme tokens:

```css
:root[data-theme="light"] {
  --bg-canvas: #f5f7fa;
  --bg-shell: #ffffff;
  --bg-surface: #ffffff;
  --bg-surface-elevated: #f8fafc;
  --bg-surface-muted: #f1f4f8;    /* active nav row, table hover, chip background */
  --bg-surface-hover: #eef2f7;    /* hover over muted */

  --border-subtle: #e5eaf0;
  --border-default: #d7dee8;
  --border-strong: #c2ccd8;
  --border-focus: var(--accent-focus);

  --text-primary: #16202b;
  --text-secondary: #4f5f73;
  --text-muted: #728197;
  --text-disabled: #9aa6b5;
  --text-inverse: #ffffff;

  /* Accent — monochrome by design (#371). `--accent-primary` is an alias
     of `--text-primary`, expressed via `var()` so the alias holds across
     theme flips. Do not reintroduce a chromatic brand hue here. */
  --accent-primary: var(--text-primary);
  --accent-primary-hover: #000000;
  --accent-primary-soft: rgba(22, 32, 43, 0.06);
  --accent-primary-border: rgba(22, 32, 43, 0.18);
  --accent-focus: var(--text-primary);

  /* Each status tone ships a 4-variable triple: base (icon/dot) / strong (text on soft surface) / soft (surface tint) / border */
  --status-success: #1f9d63;
  --status-success-strong: #167049;
  --status-success-soft: #eaf8f1;
  --status-success-border: #b9e5cd;

  --status-warning: #b7791f;
  --status-warning-strong: #885a17;
  --status-warning-soft: #fff6e5;
  --status-warning-border: #f1d39a;

  --status-error: #c24141;
  --status-error-strong: #962f2f;
  --status-error-soft: #fdecec;
  --status-error-border: #efb7b7;

  /* Info is a neutral slate, not a second blue — it must not compete
     with the primary surface for attention. (#371) */
  --status-info: #5a6b85;
  --status-info-strong: #3e4a60;
  --status-info-soft: #eef1f5;
  --status-info-border: #c9d0db;

  --status-review: #7c5cc4;
  --status-review-soft: #f2edfb;
  --status-review-border: #d4c5f2;

  --status-conflict: #cf6d2f;
  --status-conflict-soft: #fdf0e8;
  --status-conflict-border: #efc7ad;

  --status-disabled: #7b8695;
  --status-disabled-soft: #f1f4f7;
  --status-disabled-border: #d5dde6;
}
```

## Color Usage Rules

- canvas and shell stay neutral
- **the primary CTA is near-black** (`var(--text-primary)`) — it auto-inverts
  to near-white in dark mode, so primary buttons read as "page foreground,
  filled" in either theme.
- **`--accent-primary` is itself monochrome** — aliased to `--text-primary`,
  so links, focus rings, and the active-nav inset indicator all read as page
  foreground. There is no demoted brand hue; chroma is reserved for the
  `--status-*` tokens only. Do not reintroduce a blue (or any chromatic)
  accent without revisiting #371.
- semantic colors appear mainly in badges, icons, row markers, and compact highlights
- large panels should not use semantic fills unless the whole panel is an alert or incident state
- neutral borders should dominate the interface

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

The dark canvas is a **graphite ramp** — neutral with the slightest cool
whisper, deliberately not navy. The accent inverts the light-mode rule:
`--accent-primary` is aliased to `--text-primary` (near-white), so primary
buttons, links, focus rings, and the active-nav inset indicator all read as
page foreground in dark mode too. Status info is a neutral slate, never a
second light-blue — see #371 for the rationale.

```css
html[data-theme='dark'] {
  --bg-canvas: #0e1014;
  --bg-shell: #131519;
  --bg-surface: #16181d;
  --bg-surface-elevated: #1b1e24;
  --bg-surface-muted: #1f2229;
  --bg-surface-hover: #272b33;

  --border-subtle: rgba(255, 255, 255, 0.08);
  --border-default: rgba(255, 255, 255, 0.14);
  --border-strong: rgba(255, 255, 255, 0.24);
  --border-focus: var(--accent-focus);

  --text-primary: #e9eef5;
  --text-secondary: #b5c1d1;
  --text-muted: #8998ac;
  --text-disabled: #596776;
  --text-inverse: #0e1014;

  --accent-primary: var(--text-primary);
  --accent-primary-hover: #ffffff;
  --accent-primary-soft: rgba(233, 238, 245, 0.08);
  --accent-primary-border: rgba(233, 238, 245, 0.24);
  --accent-focus: var(--text-primary);

  --status-info: #8a95a8;
  --status-info-strong: #c5cbd6;
  --status-info-soft: rgba(138, 149, 168, 0.14);
  --status-info-border: rgba(138, 149, 168, 0.32);

  /* Status success / warning / error / review / conflict / disabled
     keep their semantic chroma — see apps/web/src/index.css. */
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

Use a strict spacing scale such as:

- 4
- 8
- 12
- 16
- 24
- 32

Use restrained radii and avoid overly soft shapes.

Recommended defaults:

- page gutters: `20px` to `24px`
- panel padding: `16px`
- panel radius: `8px`
- input radius: `6px`
- avoid more than three visual depth levels on the same screen

### Type scale audit (Phase 1 — 2026-04-20)

Phase 1 did not normalize per-component `font-size` values in `apps/web/src/index.css` — changing 40+ rules without per-component visual QA risks drift. Each primitive migration in Phase 3 (#239) normalizes its own typography to the canonical scale below. This table lists **off-scale values currently in component CSS** so Phase 3 PRs can track their resolution.

Canonical scale (rem):

| Purpose | Canonical | Pixels |
|---|---|---|
| Page title | `1.375rem` | 22 |
| Section title | `1rem` | 16 |
| Body | `0.875rem` | 14 |
| Body (small) | `0.8125rem` | 13 |
| Metadata / labels | `0.75rem` | 12 |
| Eyebrow / uppercase | `0.6875rem` | 11 |

Off-scale values currently in `index.css` (~31 occurrences — to be normalized during Phase 3, each resolved by the primitive that owns the affected selector):

| Current | Nearest canonical | Affected selectors | Resolved by |
|---|---|---|---|
| `0.76rem` | `0.75rem` | `.topbar__label`, `.data-table thead th`, `.eyebrow` | Phase 2 (shell, #238) + Phase 3 (DataTable, #239) |
| `0.8rem` | `0.75rem` | `.metric-card__label` | Phase 3 (MetricCard, #239) |
| `0.82rem` | `0.8125rem` | `.timeline-list__time` | Phase 3 (Timeline, #239) |
| `0.92rem` | `0.875rem` | `.data-table` | Phase 3 (DataTable, #239) |
| `0.9375rem` | `0.875rem` | `.capability-fieldset__legend` | Phase 5 (wizards, #241) |
| `1.125rem` | `1rem` | `.guest-page__title` | Phase 2 (shell, #238) — login/guest is part of shell scope |
| `1.25rem` | `1rem` or `1.375rem` | `.guest-brand__title` | Phase 2 (shell, #238) |
| `1.4rem` | `1.375rem` | `.metric-card__value` | Phase 3 (MetricCard, #239) |

All other `font-size` usages already sit on the canonical scale. Full grep output archived with PR #244.

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

- `Button` — tones: `primary` (dark), `secondary` (outlined), `ghost`, `danger`; sizes: `sm` (28px), `md` (32px), `xs` (24px)
- `Input` / `Textarea` / native `Select`
- `FormField` — label + control + description + error wiring (`aria-invalid`, `aria-describedby`)
- `FieldError`, `FormErrorSummary`
- `Alert` — tonal variants matching status tokens

### Tables

- `DataTable` — wraps `@tanstack/react-table` for sort/filter/column state. Dense rows (36 px default), row-click navigation, integrated empty state, status badge cells. Pairs with `@tanstack/react-virtual` when row count ≥ 500.

### Status & data surfaces

- `StatusBadge` — tones: `success` / `warning` / `error` / `info` / `review` / `neutral`. Dot + text; never color alone.
- `MetricCard` — label + value + hint + optional sparkline. Severity-tinted via `--kpi--error` / `--kpi--warning` modifiers when the metric carries operational alarm.
- `KeyValueList` — definition list with `120px auto` grid, monospace values where appropriate, inline copy-to-clipboard buttons on hover.
- `EntityLabel` — **name-first resolver** that takes an internal UUID + entity type and renders human name + monospace ID + copy button. Consumes `useConnectionsQuery` / `useCustomersQuery` / etc. Used on every list row and detail heading where an internal UUID would otherwise leak.
- `ProductThumbnail` — 24 px (`sm`) / 32 px (`md`) square with a 6 px radius over `--bg-surface-muted`. Renders the product image (`loading="lazy"`, `decoding="async"`) when `src` is provided, otherwise a monospace first-letter placeholder derived from `name`; falls back to the placeholder on image load error. `alt=""` by default so it stays decorative next to an adjacent name label (`aria-hidden` set on the wrapper); callers pass an explicit `alt` when the thumbnail is the sole label. **Always render a `ProductThumbnail` when a product appears in a list/row** — the placeholder keeps row heights stable while images load and doubles as a visual affordance that the row is a product.
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

Status badges should use a normalized semantic vocabulary and visual variants rather than per-feature ad hoc styling.

Recommended MVP variants:

- success
- warning
- error
- info
- review
- neutral

Badges must still include status text, not just color or dot indicators.

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

Decision record: `docs/ui-audit/library-analysis.md`.

**Adding a library requires:** (1) a written rationale in the PR description explaining why the behavior can't be built from native HTML, (2) a wrapping primitive under `shared/ui/` with its own CSS, (3) an update to this section.

## Density & Row Heights

Operators scan, they don't read. Density is budgeted across the product so every row earns its height.

Defaults (FE-002):

| Surface | Row height | Notes |
|---|---|---|
| `DataTable` rows | `36 px` | Dense-but-readable. Hover highlights whole row. |
| Nav items | `28 px` | 6 px vertical padding, icon + label + optional count. |
| Toolbar / filter chip | `28 px` | Same height as nav items for alignment. |
| Button `sm` | `28 px` | Default for toolbar buttons, table actions. |
| Button `md` | `32 px` | Default for page-header actions and forms. |
| Input / Select | `32 px` | Never taller. |
| KPI card | auto, ~96 px | Label + value + hint. Sparkline floats top-right. |
| Status banner | auto, ~64 px | Icon + title + message + actions. |

Never introduce a row height that isn't on this list without updating the guide first. Variability across surfaces is the primary way a cockpit feels amateur.

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
| Tables | **card view** (one card per row, key columns stacked) | table with column hiding | full table |
| Detail pages | single-column stack | 1-col or 60/40 split | 65/35 grid |
| KPI strip | 1 × 4 vertical | 2 × 2 grid | 1 × 4 horizontal |
| `MetricCard` | full width | 2-col grid | 4-col grid |
| Forms (single-column) | `max-width: 100%` | `max-width: 560 px` | `max-width: 560 px` |
| Raw payload panel | collapsed by default | as desktop | as desktop |
| Complex editors | **read-only + "open on desktop to edit" hint** | full interactive | full interactive |
| Wizards | one step per screen, stepper collapsed | full | full |

Rules:

- **No horizontal scrolling** at any breakpoint except inside `RawPayloadPanel` and virtualized tables' column-overflow area.
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

### Reference concepts

Concrete renderings of each pattern live in `docs/ui-audit/concepts/`. The gallery at `concepts/index.html` links them with annotated audit-finding coverage.

- Dashboard (triage + KPI strip) — `concepts/dashboard-a.html`
- List to detail — `concepts/orders.html` + `concepts/order-detail.html`
- Health drilldown — `concepts/connection-detail.html`
- Mapping editor — `concepts/category-mappings.html`

These are the measuring stick for implementation. When in doubt about density, composition, or element placement, match the concept.

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

## Baselines

### FE-001 baseline (audited 2026-04-19)

Captured as 34 screenshots + 5 Lighthouse reports under `docs/ui-audit/baseline/`. Lighthouse scores were already strong (Accessibility 96, Best Practices 100); the refactor targets UX, density, and information hierarchy, not a11y remediation.

Full ranked findings at `docs/ui-audit/audit.md` (4 P0 + 15 P1 findings grouped into 8 themes).

### FE-002 direction (2026-04-19 → in progress)

Tracked by epic [#236](https://github.com/SilkSoftwareHouse/openlinker/issues/236) with six phase sub-issues (tokens → shell → primitives → detail pages → forms → dashboard).

This style guide is the measuring stick. Concepts under `docs/ui-audit/concepts/` are the rendering. Every phase PR attaches before/after screenshots against the FE-001 baseline.

---

This style guide complements `docs/frontend-architecture.md`, which remains the source of truth for technical architecture and state boundaries.

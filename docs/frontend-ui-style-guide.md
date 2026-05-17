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

Adopted during the UI refactor epic ([#236](https://github.com/SilkSoftwareHouse/openlinker/issues/236)).

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

- **No horizontal scrolling** at any breakpoint except inside `RawPayloadPanel` and virtualized tables' column-overflow area. `RawPayloadPanel` also scrolls vertically when content exceeds its `max-height` cap (#390).
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

Tracked by epic [#236](https://github.com/SilkSoftwareHouse/openlinker/issues/236) with six phase sub-issues (tokens → shell → primitives → detail pages → forms → dashboard). Every phase PR should attach before/after screenshots and reason about the change against this style guide.

---

This style guide complements `docs/frontend-architecture.md`, which remains the source of truth for technical architecture and state boundaries.

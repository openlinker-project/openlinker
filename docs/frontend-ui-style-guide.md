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

The left navigation is persistent and grouped by domain.

Recommended information architecture:

- Dashboard
- Orders
- Products
- Inventory
- Integrations
- Jobs & Logs
- Automations
- Shipping
- Invoices
- Settings

Future modules may appear disabled or hidden before implementation, but the information architecture should anticipate them.

### Top Utility Bar

The top bar should prioritize utility over decoration and may contain:

- organization or workspace context
- environment context
- global search
- issues or notifications
- quick actions
- profile or permissions

### Main Workspace

Every major screen should follow this structure:

```text
Header
├── title
├── status summary
└── contextual actions

Workspace
├── filters or search
├── primary content
└── optional detail panel or secondary context
```

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
- reserve blue for active, selected, focused, and primary action states
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

  --border-subtle: #e5eaf0;
  --border-default: #d7dee8;
  --border-strong: #c2ccd8;

  --text-primary: #16202b;
  --text-secondary: #4f5f73;
  --text-muted: #728197;
  --text-disabled: #9aa6b5;

  --accent-primary: #2f6fed;
  --accent-primary-hover: #245fd1;
  --accent-primary-soft: #e8f0ff;
  --accent-focus: #7ea6ff;

  --status-success: #1f9d63;
  --status-success-soft: #eaf8f1;
  --status-success-border: #b9e5cd;

  --status-warning: #b7791f;
  --status-warning-soft: #fff6e5;
  --status-warning-border: #f1d39a;

  --status-error: #c24141;
  --status-error-soft: #fdecec;
  --status-error-border: #efb7b7;

  --status-info: #2b7de9;
  --status-info-soft: #eaf3ff;
  --status-info-border: #bfd7fb;

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
- blue is reserved for active, selected, focused, and primary CTA usage
- semantic colors appear mainly in badges, icons, row markers, and compact highlights
- large panels should not use semantic fills unless the whole panel is an alert or incident state
- neutral borders should dominate the interface

### Color

Use a restrained semantic palette:

- neutral background
- neutral surface
- elevated surface
- strong primary text
- muted secondary text
- clear border color

Status colors should be semantic and reusable:

- success
- warning
- error
- info
- inactive
- conflict or manual review

Color must never be the only signal. Every status must also have text and, where useful, an icon.

### Typography

Typography should prioritize scanning and system clarity.

Use:

- one main UI sans-serif family
- one monospaced family for technical data

Recommendations:

- restrained page-title sizes
- clear section headings
- compact body text
- consistent metadata style

Suggested type scale:

- page title: `24 / 30`, semibold
- section title: `16 / 24`, semibold
- body: `14 / 20`
- metadata or labels: `12 / 16`
- uppercase section labels: `11 / 16`, medium

Use monospace for:

- identifiers
- payload field labels
- system references
- low-level technical values

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

The FE-003 baseline should establish a small reusable primitive layer in `apps/web/src/shared/ui`.

Required MVP primitives:

- `Button`
- `Input`
- `Select`
- `Textarea`
- `StatusBadge`
- `DataTable`
- `ConfirmDialog`
- `Alert`
- lightweight toast feedback
- form helpers such as `FormField`, `FieldError`, and `FormErrorSummary`

Implementation rules:

- prefer native HTML semantics first and wrap them with thin React components
- keep primitives token-driven and aligned with `apps/web/src/index.css`
- avoid over-generalized APIs; build only the surface the current product needs
- use the same primitive in real pages immediately after introducing it
- prefer one explicit primitive over many near-duplicate variants

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

## Current Baseline Application

The FE-001 app should already reflect this direction in a lightweight way:

- flat and structured shell
- grouped left navigation
- utilitarian top bar
- status summary in the workspace
- denser surfaces and panels
- no decorative hero styling
- dashboard shaped around triage rather than product-roadmap content

This style guide complements `docs/frontend-architecture.md`, which remains the source of truth for technical architecture and state boundaries.

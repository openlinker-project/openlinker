# Implementation Plan — Connect wizard layout fix + two-column redesign (#368)

## 1. Goal

Fix three structural layout bugs in the PrestaShop and Allegro connection wizards and redesign them as a two-column (form + live summary) flow on desktop:

1. **Stepper overflow** — `.setup-stepper__list` is a nowrap flex row sized at ~641 px inside a card capped at 560 px, clipping the "4 Review & connect" label on every step.
2. **Card floating in a void** — at wide viewports `.wizard-card` is flush-left inside a full-width `section.page-section`, leaving ~900 px of empty gutter on the right.
3. **Detached Back button** — `PageLayout`'s `actions` slot renders the Back link at the section's right edge via `.page-header--split`, visually unrelated to the form.

On top of the fixes, introduce a reusable `WizardLayout` primitive so this composition is available to future wizards for free, and surface a live per-step summary panel that makes the right-hand gutter productive instead of empty.

**Layer:** Frontend — Shared UI primitive + two feature-level setup forms + two page modules + global CSS. No backend, no domain changes.

**Non-goals:**
- **No live capability probe / verification panel** (step 2). The issue speculates about "live check-state per capability probe"; the existing form has no such probe (the PS `/test` endpoint requires a saved connection, per `prestashop-setup-form.tsx:5-10`), and adding one is a separate product concern. Step 2's summary shows the same identity fields as step 1 with a muted "runs after save" note.
- **No token/color changes** — tracked separately in #371.
- **No SetupStepper API or visual rewrite** — only a `flex-wrap` safety net on `.setup-stepper__list`.
- **No new form fields or validation changes** — this is purely a compositional refactor.
- **No `PageLayout` API change** — `page-header--split` is already suppressed when `actions` is falsy (`page-layout.tsx:24`), so the fix is "stop passing `actions` on wizard pages," not "add an opt-out prop."
- **No deduplication of the inline review/verify DLs inside each form** against the summary panel. Some identity fields will appear in both places on ≥ 1024 px; that is acceptable cosmetic overlap and out of scope.

## 2. Research notes

### Current structure

- **PrestaShop page** (`apps/web/src/pages/connections/prestashop-setup-page.tsx:1-32`) wraps the form in `<PageLayout>` with `actions={<Link>Back</Link>}`, which triggers the split header layout.
- **Allegro page** (`apps/web/src/pages/connections/allegro-setup-page.tsx:1-27`) does the same thing.
- **Both forms** render `<form className="wizard-card">` with `<SetupStepper>` as the first child:
  - `apps/web/src/features/connections/components/prestashop-setup-form.tsx:135-136`
  - `apps/web/src/features/allegro/components/AllegroSetupForm.tsx:117-118`
- `PageLayout` (`apps/web/src/shared/ui/page-layout.tsx:1-33`) only applies `page-header--split` when `actions` is truthy — nothing to change in the primitive itself.

### CSS baselines

- `.setup-stepper__list` — `apps/web/src/index.css:3663-3668` — `display: flex` on desktop (`@media (min-width: 768px)` at 3713). No `flex-wrap`. Each step's `.setup-stepper__label` at 3748-3750 is `white-space: nowrap`. This is the overflow root cause.
- `.wizard-card` — `apps/web/src/index.css:3792-3801` — `max-width: 100%` base, `max-width: 560px` at 768px+ (`:3843-3848`). No `margin-inline: auto`, so it lives flush-left inside any full-width container.
- Tokens used below are already defined in `:root` (`apps/web/src/index.css:185-322`): `--space-*`, `--radius-*`, `--bg-surface`, `--border-default`, `--shadow-soft`, `--text-muted`, `--text-primary`. No new tokens needed.
- "Phase 5 — Wizard layout" comment lives at `apps/web/src/index.css:3787-3791`, so all new rules go adjacent to it.

### Form state patterns

Both forms already own stepper state (`stepIndex`, `completedSteps`), already expose live values via `form.watch()`, and already track the supported capabilities. The summary panel reuses these — no new state needed.

PrestaShop uses `useAdaptersQuery()` to resolve the capability list (`prestashop-setup-form.tsx:70, 93-97`); the Allegro form pulls `useProductMasterConnections()` (`AllegroSetupForm.tsx:50-51`) for the Product-catalog step. Both hooks already return the data the summary panels need — no new query hooks.

### Shared UI inventory

- `page-layout.tsx`, `setup-stepper.tsx`, `button.tsx`, `alert.tsx` already exist. No duplication risk.
- No existing `wizard-*.tsx` primitive in `shared/ui/`.
- Naming per `.claude/rules/frontend.md` — kebab-case filename `wizard-layout.tsx`, PascalCase export `WizardLayout`.

### Existing tests

- `apps/web/src/features/connections/components/prestashop-setup-form.test.tsx` — 10+ cases, queries by text/role, no DOM-shape assertions that break when we wrap the form in `.wizard-layout`.
- `apps/web/src/features/allegro/components/AllegroSetupForm.test.tsx` — similar shape.
- `apps/web/src/shared/ui/setup-stepper.test.tsx` — unchanged by this work.

## 3. Design

### Markup

```
<WizardLayout
  stepper={<SetupStepper steps={STEP_LABELS} currentStep={stepIndex} completedSteps={completedSteps} />}
  summary={<PrestashopSetupSummary values={values} stepIndex={stepIndex} capabilities={supportedCapabilities} />}
>
  <form className="wizard-card" onSubmit={...}>
    <Link className="wizard-card__back" to="/connections/new">
      ← Back to connections
    </Link>
    {/* existing step content unchanged */}
    <div className="wizard-actions">...</div>
  </form>
</WizardLayout>
```

`WizardLayout` itself:

```tsx
interface WizardLayoutProps extends PropsWithChildren {
  stepper: ReactNode;
  summary?: ReactNode;
  className?: string;
}
```

Rendered as three grid areas (`stepper`, `form`, `summary`). `summary` is optional so future wizards without a summary panel can still use the primitive. `summary` is wrapped in `<aside aria-label="Setup summary">` for landmark a11y.

### Responsive grid

| Breakpoint | Template |
|---|---|
| `< 1024px` | single column: `stepper` / `form` / `summary` stacked |
| `≥ 1024px` | two columns: stepper full-width top, form `minmax(0, 560px)` + summary `minmax(0, 360px)`, `justify-content: center`, `column-gap: 2rem` |

At `< 768px` the `SetupStepper` already swaps to its `.setup-stepper__mobile` dot variant (no regression).

The 1024 px cutoff matches the issue's explicit criterion. Form+summary+gap = 560 + 360 + 32 = 952 px of content, leaving ~72 px of breathing room at 1024 px before the centered block starts approaching viewport edges.

### CSS deltas (all in `apps/web/src/index.css`)

**A. Stepper safety net** (amend existing rule at `:3663-3668`):
```css
.setup-stepper__list {
  display: none;
  list-style: none;
  margin: 0;
  padding: 0;
  flex-wrap: wrap;
  row-gap: 0.5rem;
}
```

**B. Wizard card centering** (amend media query at `:3843-3848`):
```css
@media (min-width: 768px) {
  .form-narrow,
  .wizard-card {
    max-width: 560px;
    margin-inline: auto;
    min-width: 0;
  }
}
```
Harmless when the card is placed inside `.wizard-layout__form` (the grid track already positions it); essential when the card is rendered bare on tablets.

**C. New `.wizard-layout` + `.wizard-summary` + `.wizard-card__back` rules** (new block, appended to the Phase 5 section right after `:3848`):
```css
.wizard-layout {
  display: grid;
  gap: 1.5rem;
  grid-template-columns: minmax(0, 1fr);
  grid-template-areas:
    'stepper'
    'form'
    'summary';
}
.wizard-layout__stepper { grid-area: stepper; }
.wizard-layout__form    { grid-area: form; min-width: 0; }
.wizard-layout__summary { grid-area: summary; min-width: 0; }

@media (min-width: 1024px) {
  .wizard-layout {
    grid-template-columns: minmax(0, 560px) minmax(0, 360px);
    grid-template-areas:
      'stepper stepper'
      'form    summary';
    column-gap: 2rem;
    justify-content: center;
  }
  /* Card is positioned by the grid track; drop its own auto-centering. */
  .wizard-layout .wizard-card {
    margin-inline: 0;
  }
}

.wizard-summary {
  display: grid;
  gap: 1rem;
  padding: 1rem;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  background: var(--bg-surface);
  box-shadow: var(--shadow-soft);
  align-self: start;
  min-width: 0;
}
.wizard-summary__section       { display: grid; gap: 0.5rem; min-width: 0; }
.wizard-summary__section-title {
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-muted);
}
.wizard-summary__row   { display: grid; gap: 0.125rem; min-width: 0; }
.wizard-summary__label { font-size: 0.75rem; color: var(--text-muted); }
.wizard-summary__value { font-size: 0.875rem; color: var(--text-primary); word-break: break-word; }
.wizard-summary__capabilities {
  display: flex;
  flex-wrap: wrap;
  gap: 0.375rem;
}

.wizard-card__back {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  font-size: 0.8125rem;
  color: var(--text-muted);
  text-decoration: none;
  justify-self: start;
}
.wizard-card__back:hover,
.wizard-card__back:focus-visible {
  color: var(--text-primary);
  text-decoration: underline;
}
```

### Summary panel content (per step)

**PrestashopSetupSummary** — always renders the identity section; switches supplemental content per step:

| Step | Step title | Summary content |
|---|---|---|
| 0 | Credentials | Identity (name + webservice endpoint `${baseUrl}/api` + storefront URL + shop ID + default currency) |
| 1 | Verify credentials | Identity + muted note: *"Live test available after the connection is saved — see the connection detail page."* (matches the existing inline verify-step alert copy at `prestashop-setup-form.tsx:246-250` to reduce redundant framing) |
| 2 | Capabilities | Identity + capability list |
| 3 | Review & connect | Identity + capability list (read-only preview) |

Each row renders `<span className="wizard-summary__value mono-text">{value}</span>` for identifier-shaped fields (URL, key, shop ID). Unset fields render `<EmptyValue />` (existing `shared/ui/empty-value.tsx` → renders `—`).

Capabilities render as a flex-wrapped list of `<span className="mono-text wizard-summary__capability">{capability}</span>`, **not** as `<Chip>`. `shared/ui/chip.tsx` is a tone-keyed status primitive (`success`/`warning`/`error`/`info`/`review`/`neutral`) per `docs/frontend-ui-style-guide.md` §Status Badge; capability identifiers aren't a status tone, so using `Chip` for them would drift the status palette. Plain mono spans keep the visual vocabulary honest.

The webservice key is intentionally **not** shown in the summary panel — it's already masked in the inline verify/review DLs, and duplicating even a masked secret into a persistent side panel is noise and a small attack-surface decision. Short comment on the summary explains this choice for future readers.

**AllegroSetupSummary**:

| Step | Step title | Summary content |
|---|---|---|
| 0 | Credentials | Identity (name + client ID) |
| 1 | Environment | Identity + environment label ("Sandbox" / "Production") |
| 2 | Product catalog | Identity + environment + selected catalog connection name (or "— not linked —") |
| 3 | Review & connect | All fields (read-only preview) |

The client secret is omitted for the same reason as the PrestaShop webservice key.

**Data flow for the selected-catalog name:** the form already subscribes to `useProductMasterConnections()` (`AllegroSetupForm.tsx:50-51`) and resolves `selectedCatalog` locally (`:112-114`). The summary receives `selectedCatalogName: string | null` as a prop instead of calling the hook a second time — two subscriptions for the same cached Query is avoidable noise, and passing the derived value down keeps the summary pure (no TanStack Query mocking needed in `allegro-setup-summary.test.tsx`).

### Mono-text on identifier inputs (PrestaShop)

Apply `className="mono-text"` to:
- `shop URL` input (`prestashop-setup-form.tsx:169-173`)
- `storefront URL` input (`:182-186`)
- `webservice key` input (`:195-201`)
- `shop ID` input (`:210-214`)

The `Input` primitive is a forwardRef'd `<input>` that already merges `className` (`shared/ui/input.tsx`), so this is a one-prop change per field. Allegro's `client ID` and `client secret` inputs already get mono presentation in their review/summary rows; the inputs themselves stay plain because the issue's mono-text requirement enumerates PrestaShop fields only.

## 4. Changes

**File-naming convention:** every new file in this plan uses **kebab-case** per `docs/frontend-architecture.md` §Naming and `.claude/rules/frontend.md` §Naming — including the new Allegro summary (`allegro-setup-summary.tsx` / `allegro-setup-summary.test.tsx`). The existing `AllegroSetupForm.tsx` / `AllegroSetupForm.test.tsx` are pre-existing PascalCase deviations and are **not** renamed as part of this PR (scope creep); a follow-up issue should rename them to match the convention. This plan deliberately stops the deviation from spreading.

**File headers:** every new `.tsx` source file in this plan (three production files + three test files) opens with a JSDoc header per `docs/engineering-standards.md` §File Headers — Purpose + one-line context + optional `@see` to related sources. Matches the existing headers in `prestashop-setup-form.tsx:1-15` and `AllegroSetupForm.tsx:1-13`.

### Step 1 — New `WizardLayout` primitive

- **Create** `apps/web/src/shared/ui/wizard-layout.tsx` — ~25 LOC, forwardRef not required (it's a layout container, not a form control), but accept + merge `className` per `frontend.md`. Opens with a JSDoc header describing the three-slot composition.
- **Create** `apps/web/src/shared/ui/wizard-layout.test.tsx` — four cases:
  1. renders stepper slot
  2. renders children (form) slot
  3. renders summary slot when provided
  4. omits summary area when `summary` prop is undefined

### Step 2 — CSS changes

- **Edit** `apps/web/src/index.css` sections listed above (A, B, C). Net: ~60 new lines in the Phase 5 block + 2 lines added to the existing stepper / wizard-card rules.

### Step 3 — PrestaShop form refactor

- **Edit** `apps/web/src/features/connections/components/prestashop-setup-form.tsx`:
  - Wrap the existing `<form>` return value in `<WizardLayout stepper={...} summary={...}>`.
  - Remove `<SetupStepper ... />` from inside the `<form>` (it moves into the `stepper` slot).
  - Insert `<Link className="wizard-card__back" to="/connections/new">← Back to connections</Link>` as the first element inside the `<form>`.
  - Add `className="mono-text"` to the four identifier inputs listed above.
- **Create** `apps/web/src/features/connections/components/prestashop-setup-summary.tsx` — pure component, takes `{ values, stepIndex, capabilities }`, renders the table above. Uses `shared/ui/empty-value`. Capability entries render as plain `mono-text` spans (not `shared/ui/chip`, per the rationale in §3).

### Step 4 — Allegro form refactor

Mirror Step 3:
- **Edit** `apps/web/src/features/allegro/components/AllegroSetupForm.tsx` — wrap in `<WizardLayout>`, move `<SetupStepper>` into the `stepper` slot, add Back link, pass `<AllegroSetupSummary values={values} stepIndex={stepIndex} selectedCatalogName={selectedCatalog?.name ?? null} />` into the `summary` slot. `selectedCatalog` is already derived in the form (`AllegroSetupForm.tsx:112-114`), so the summary gets the resolved name as a plain prop — no second `useProductMasterConnections()` subscription.
- **Create** `apps/web/src/features/allegro/components/allegro-setup-summary.tsx` (kebab-case — see §4 File-naming convention note).

### Step 5 — Suppress the page-level split header on both wizard pages

- **Edit** `apps/web/src/pages/connections/prestashop-setup-page.tsx` — remove the `actions={<Link>Back</Link>}` prop from `<PageLayout>`.
- **Edit** `apps/web/src/pages/connections/allegro-setup-page.tsx` — same.

### Step 6 — Tests

- **Edit** `apps/web/src/features/connections/components/prestashop-setup-form.test.tsx` — add three assertions:
  1. `← Back to connections` link renders with `href="/connections/new"`.
  2. Summary panel surfaces the name field value after typing (regression guard for the new wiring).
  3. Each of the four identifier inputs (`baseUrl`, `storefrontBaseUrl`, `webserviceKey`, `shopId`) carries the `mono-text` class — closes the acceptance criterion "Identifier inputs (URL, key, shop ID) use `.mono-text`" and guards against CSS refactors silently dropping the class.
  Existing text/role queries continue to work since `WizardLayout` only adds wrappers, not re-parented content.
- **Edit** `apps/web/src/features/allegro/components/AllegroSetupForm.test.tsx` — add the first two assertions (Back link + summary wiring). No mono-text assertion: the Allegro inputs are not in scope for the `.mono-text` criterion.
- **Create** `apps/web/src/features/connections/components/prestashop-setup-summary.test.tsx` — three cases: renders `—` for unset fields, renders the live `baseUrl` with `.mono-text`, renders the capability list on step 2.
- **Create** `apps/web/src/features/allegro/components/allegro-setup-summary.test.tsx` — three analogous cases (one for Sandbox label, one for `selectedCatalogName` prop rendering, one for `null` catalog fallback). Summary is a pure component taking props, so no TanStack Query provider or `useProductMasterConnections` mock is needed.
- **Create** `apps/web/src/shared/ui/wizard-layout.test.tsx` — as above.

## 5. Validation

- **Dependency rules:** `WizardLayout` lives in `shared/ui/` and imports nothing from `features/` or `pages/`. Summary components live in their feature modules and import `shared/ui/*` only — compliant with `frontend.md` dependency direction.
- **State ownership:** no new state; summary reads from `form.watch()` values the form already exposes. Per `.claude/rules/fe-pages.md` — form state stays in React Hook Form, no leak into global store.
- **Styling:** pure vanilla CSS + existing tokens, no new token definitions, no Tailwind / CSS-in-JS. Uses the existing 4 px spacing grid and radius tokens.
- **A11y:** `<aside aria-label="Setup summary">` wraps the summary panel as a landmark. The Back link is a `<Link>` (keyboard-native). `.wizard-card__back:focus-visible` preserves the focus outline. Mono font is never the sole signal — every mono row has a plain-language label.
- **No regressions expected:** existing test suites continue to assert the same user-visible text; the only DOM shift is an extra `<div class="wizard-layout">` wrapper. Mobile stepper behavior unchanged (the dot variant is styled outside the 1024 px media query).
- **Security:** no new data flow; the summary explicitly excludes the webservice key and client secret, so no secret leaks into a new UI surface.
- **Quality gate:** `pnpm lint && pnpm type-check && pnpm test` must pass.
- **Manual visual verification** (done in self-review, not in CI):
  - `/connections/new/prestashop` at 1800 px, 1280 px, 1024 px, 768 px, 375 px across all four steps — no empty gutter at ≥ 1024 px; summary stacks below form at 768-1023 px; mobile stepper at < 768 px.
  - `/connections/new/allegro` — same checks.
  - Stepper row never clips "4 Review & connect" on any breakpoint.
  - Focus ring on the Back link is visible on both light and dark themes.

## 6. Risks / open questions

- **Inline review DLs (step 1 and step 3) overlap with the summary on ≥ 1024 px.** Accepted as cosmetic overlap rather than deleted, because removing them would regress the `< 1024 px` experience where the summary stacks below (and the user reading the verify step wants the review detail up top, not below the fold). Easy follow-up: once we validate the side panel carries its weight, a later polish pass can hide the inline DL at ≥ 1024 px with `display: none` in a media query.
- **`WizardLayout` has exactly two consumers at merge time.** That meets the "only abstract when there's a second consumer" bar from the MVP rule — both setup forms use it, and a third future wizard (e.g. the future Shopify connect flow) is anticipated. If the two consumers diverge later, the primitive is ~30 lines of CSS grid and trivially inlineable.
- **Adapters query** on the PrestaShop form runs on mount regardless of step. The summary reads `supportedCapabilities` from the same hook result (passed in as a prop from the form), so no new network cost. If the adapters query is loading, the summary shows the current `values.enabledCapabilities ?? []` (default fallback set from the schema) — same fallback the inline capability list already uses.
- **Allegro summary** receives `selectedCatalogName` as a prop derived from the form's existing `useProductMasterConnections()` subscription — single subscription in the tree, pure summary component.
- **Follow-up:** rename `apps/web/src/features/allegro/components/AllegroSetupForm.tsx` and `AllegroSetupForm.test.tsx` to kebab-case to bring them in line with `docs/frontend-architecture.md` §Naming. Out of scope for this PR; file a fresh issue rather than piggybacking.
- **No new migration, no backend change.**

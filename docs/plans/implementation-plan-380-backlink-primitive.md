# Implementation Plan — #380 Standard BackLink Primitive

**Issue:** [SilkSoftwareHouse/openlinker#380](https://github.com/SilkSoftwareHouse/openlinker/issues/380)
**Branch:** `380-backlink-primitive`
**Layer:** Frontend (shared UI + page-level migrations)
**Classification:** Frontend refactor / tech-debt
**Scope size:** Small primitive + 15 call-site migrations + doc + 2 test updates

---

## 1. Understand the Task

### Goal
Introduce a single `<BackLink>` primitive in `shared/ui/` and a corresponding `backTo` prop on `PageLayout`, then retire 15 ad-hoc "← Back to X" `<Link>` instances scattered across detail pages, connection sub-pages, and two wizard setup forms.

### Why
- Ad-hoc links have drifted into five variants (mixed glyph, mixed label shape, mixed destinations, mixed CSS classes: `button--ghost` vs `button--secondary`).
- Back-navigation currently sits in `PageLayout.actions`, where it competes with primary CTAs.
- There is no dedicated slot for "retreat one level" — every page re-invents the affordance.
- Label prose is inconsistent with the sidebar nav ("Back to integrations" vs. the "Connections" nav entry).

### Non-goals (explicit)
- **No browser-history mode** (`navigate(-1)`). The issue flagged it as a possible opt-in; every current site has an explicit destination, so adding this speculatively violates MVP-appropriate scope. Revisit only when a real wizard cancel case shows up.
- **Auth-form "Back to sign in"** stays as-is — different chrome (auth layout, not `PageLayout`), out of scope per the issue.
- **Wizard "Cancel" buttons** — form semantics, not navigation. Unaffected.
- **Breadcrumb changes** in `AppShell` — separate concern.
- **No new icon library** — use the literal `←` glyph rendered via `aria-hidden` span.

---

## 2. Research — Current State

### Zero browser-history calls
```
$ grep -rn 'navigate(-1)|history.back|router.back' apps/web/src  →  no matches
```

### The 15 in-scope call sites

**Group A — detail pages (`to=".." relative="path"`, `.button button--ghost`):** 7 sites
| File | Current label |
|---|---|
| `pages/customers/customer-detail-page.tsx:179` | `← Back to customers` |
| `pages/products/product-detail-page.tsx:206` | `← Back to products` |
| `pages/listings/listing-detail-page.tsx:78` | `← Back to listings` |
| `pages/sync-jobs/sync-job-detail-page.tsx:100` | `← Back to jobs` |
| `pages/webhook-deliveries/webhook-delivery-detail-page.tsx:124` | `← Back to deliveries` |
| `pages/inventory/inventory-detail-page.tsx:75` | `← Back to inventory` |
| `pages/orders/order-detail-page.tsx:186` | `← Back to orders` |

**Group B — connection sub-pages (absolute `to`, `.button button--secondary`):** 5 sites
| File | Current label | Destination |
|---|---|---|
| `pages/connections/connection-detail-page.tsx:161` | `Back to integrations` (no glyph) | `/connections` |
| `pages/connections/new-connection-page.tsx:21` | `Back to integrations` (no glyph) | `/connections` |
| `pages/connections/edit-connection-page.tsx:19` | `Back to detail` (no glyph) | `/connections/:id` |
| `pages/connections/connection-mappings-page.tsx:101` | `Back to connection` (no glyph) | `/connections/:id` |
| `pages/connections/connection-category-mappings-page.tsx:143` | `Back to connection` (no glyph) | `/connections/:id` |

**Group C — outlier list-page link:** 1 site
| File | Current label |
|---|---|
| `pages/orders/failed-orders-page.tsx:121` | `← All Orders` (label-shape outlier) |

**Group D — wizard-card back-links (inside WizardLayout, class `wizard-card__back`):** 2 sites
| File | Current label |
|---|---|
| `features/allegro/components/AllegroSetupForm.tsx:134` | `← Back to connections` |
| `features/connections/components/prestashop-setup-form.tsx:149` | `← Back to connections` |

**Out of scope (left as-is):** 3 auth-form links (`ForgotPasswordForm.tsx:48,83`, `ResetPasswordForm.tsx:95`).

### Existing patterns worth reusing
- `shared/ui/page-layout.tsx` — props: `eyebrow | title | description | summary | actions | children`. No test file yet. Will add `backTo?` and a colocated test.
- shared/ui conventions (from `.claude/rules/ui-components.md` + existing files like `button.tsx`, `entity-label.tsx`): `forwardRef` over the native element, `ComponentPropsWithoutRef<>` extension, `className` merging via `['base', mod, className].filter(Boolean).join(' ')`, no utility libraries.
- Tokens live in `apps/web/src/index.css`. `.back-link` will use `--text-muted` at rest, `--text-primary` on hover, `--accent-focus` for focus ring.

### Tests that assert on affected text
- `features/connections/components/prestashop-setup-form.test.tsx:314` → `/Back to connections/`
- `features/allegro/components/AllegroSetupForm.test.tsx:158` → `/Back to connections/`

No other page tests assert on back-link labels (confirmed via grep).

---

## 3. Design

### 3.1 `BackLink` primitive — `apps/web/src/shared/ui/back-link.tsx`

**API (minimal, explicit):**
```tsx
interface BackLinkProps extends Omit<ComponentPropsWithoutRef<typeof Link>, 'to' | 'children'> {
  to: string;
  label: ReactNode;
}
```

**Render:**
```tsx
<Link to={to} className={['back-link', className].filter(Boolean).join(' ')} {...rest}>
  <span className="back-link__glyph" aria-hidden="true">←</span>
  <span className="back-link__label">{label}</span>
</Link>
```

**Justifications:**
- `to` is required (no history mode). Matches 100% of current usage.
- `label` is a ReactNode, not a string, so Group B sites that may want `{connection?.name ?? 'Connection'}` work cleanly.
- Glyph is a child span with `aria-hidden="true"` — screen readers announce only the label.
- Uses React Router `<Link>` (same as every existing back-link). No new dep.
- **No `forwardRef`.** `.claude/rules/ui-components.md` mandates `forwardRef` "required for React Hook Form `register()` integration" — which doesn't apply to a navigation link. No current or planned consumer needs to attach a ref to a BackLink. Noted in the file header so the deviation from the form-control norm is explicit. If a ref need surfaces later, widening to `forwardRef` is a one-line change.

### 3.2 CSS — `apps/web/src/index.css`

```css
.back-link {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  font-size: 0.8125rem;       /* 13px */
  line-height: 1.2;
  color: var(--text-muted);
  text-decoration: none;
  padding: 0.25rem 0;          /* hit-target without visual weight */
  transition: color 120ms ease;
}
.back-link:hover { color: var(--text-primary); }
.back-link:focus-visible {
  outline: 2px solid var(--accent-focus);
  outline-offset: 2px;
  border-radius: 0.25rem;
}
.back-link__glyph { font-size: 0.9em; line-height: 1; }
```

**Rationale:** Restrained, muted-by-default, steps up to primary text on hover. No button chrome — this is navigation, not an action. Focus ring matches the token system per existing rules.

**Focus-ring parity check:** Before finalising the CSS, compare against `.button--ghost:focus-visible` in `index.css`. If `.button--ghost` uses a different `outline-width`, `outline-offset`, or `border-radius`, match those values on `.back-link` so the focus-state experience on migrated detail pages doesn't visibly regress for keyboard users. Worst case: the prescribed `border-radius: 0.25rem` here becomes whatever `.button--ghost` currently uses.

### 3.3 `PageLayout.backTo` integration — `apps/web/src/shared/ui/page-layout.tsx`

**API extension (descriptor-only, no escape hatch):**
```tsx
interface PageLayoutProps extends PropsWithChildren {
  actions?: ReactNode;
  backTo?: { to: string; label: ReactNode };
  description?: ReactNode;
  eyebrow?: string;
  summary?: ReactNode;
  title: ReactNode;
}
```

Descriptor-only per `docs/frontend-ui-style-guide.md` → *Implementation rules*: "Avoid over-generalized APIs; build only the surface the current product needs." Every current site is a simple `{ to, label }` tuple. Widening to `ReactNode` if an exotic header surfaces later is a one-line type change; narrowing once exported is riskier.

**Render position:** Above `eyebrow`, inside `page-header__content`. A new CSS class `.page-header__back` scopes vertical rhythm:
```css
.page-header__back { margin-bottom: 0.25rem; }
```

### 3.4 Wizard-card back-link — `AllegroSetupForm.tsx`, `prestashop-setup-form.tsx`

These currently use class `wizard-card__back` inside `WizardLayout`, not inside `PageLayout`. Migration:
```tsx
<BackLink to="/connections/new" label="Connections" className="wizard-card__back" />
```
The primitive accepts and merges `className`, so the existing `.wizard-card__back` positioning rule continues to apply. BackLink's own `.back-link` class brings the typography + colour baseline.

**`.wizard-card__back` audit (required before merge):** Open `index.css` and locate the `.wizard-card__back` rule. It must declare **positioning only** (margin / offset / alignment). If it also sets `color`, `font-size`, `font-weight`, or `text-decoration`, those declarations must be removed so the shared `.back-link` owns typography — otherwise the two classes collide and the wizard back-links silently drift from the rest of the app (the exact drift this refactor is eliminating). Record the outcome in the PR description.

### 3.5 Label normalisation (sidebar-nav aligned)

| Current | New `label` | `to` |
|---|---|---|
| `← Back to orders` | `Orders` | `/orders` |
| `← All Orders` | `Orders` | `/orders` |
| `← Back to listings` | `Listings` | `/listings` |
| `← Back to customers` | `Customers` | `/customers` |
| `← Back to products` | `Products` | `/products` |
| `← Back to inventory` | `Inventory` | `/inventory` |
| `← Back to jobs` | `Jobs & Logs` | `/jobs-logs` |
| `← Back to deliveries` | `Webhooks` | `/webhook-deliveries` |
| `Back to integrations` | `Connections` | `/connections` |
| `Back to detail` / `Back to connection` | `connection?.name ?? 'Connection'` | `/connections/:id` |
| `← Back to connections` (wizard) | `Connections` | `/connections/new` |

Accessible name after migration is `"← Orders"` (glyph hidden) → screen readers hear `"Orders"`. Test `name: /Connections/` replaces `name: /Back to connections/`.

---

## 4. Step-by-Step Implementation

### Step 1 — Primitive + CSS + test
- [ ] Create `apps/web/src/shared/ui/back-link.tsx` per §3.1 (with file header, named export, **no `forwardRef`** — document the deviation inline).
- [ ] Add `.back-link` block to `apps/web/src/index.css` in the navigation/links section.
- [ ] **Before writing CSS**, inspect `.button--ghost:focus-visible` in `index.css` and mirror its `outline-width` / `outline-offset` / `border-radius` on `.back-link:focus-visible` (see §3.2 focus-ring parity check).
- [ ] Create `apps/web/src/shared/ui/back-link.test.tsx` covering:
  - Renders a React Router `<Link>` pointing at `to` (confirms client-side navigation, not a plain `<a href>`)
  - Glyph is rendered with `aria-hidden="true"`
  - Accessible name equals the `label` (no glyph in computed name)
  - Merges custom `className` without overriding `back-link`
  - Renders a `ReactNode` label (e.g. `<span>Custom</span>`) faithfully

**Acceptance:** `pnpm --filter @openlinker/web test -- back-link` passes.

### Step 2 — Extend `PageLayout`
- [ ] Add `backTo?: { to: string; label: ReactNode }` to `PageLayoutProps` per §3.3 (descriptor-only, no ReactNode escape hatch).
- [ ] Render the back slot above `eyebrow` inside `page-header__content` via `<BackLink>`.
- [ ] Add `.page-header__back { margin-bottom: 0.25rem; }` to `index.css`.
- [ ] Create `apps/web/src/shared/ui/page-layout.test.tsx` (new file) covering:
  - Renders without `backTo` (existing shape preserved — smoke test against current consumers)
  - Renders `backTo` descriptor via `<BackLink>` (accessible name matches `label`)
  - Renders `backTo` + `actions` simultaneously (distinct regions, no DOM overlap)
  - Renders the three-line stack (backTo → eyebrow → title) in that vertical order when all three are provided

**Acceptance:** New tests pass; no existing `PageLayout` usage regresses (re-confirmed at the Step 9 quality gate, which runs the full FE test suite).

### Step 3 — Migrate Group A (7 detail pages)
Replace the `actions` back-link with `backTo` descriptor in each of:
- `pages/customers/customer-detail-page.tsx`
- `pages/products/product-detail-page.tsx`
- `pages/listings/listing-detail-page.tsx`
- `pages/sync-jobs/sync-job-detail-page.tsx`
- `pages/webhook-deliveries/webhook-delivery-detail-page.tsx`
- `pages/inventory/inventory-detail-page.tsx`
- `pages/orders/order-detail-page.tsx`

For each: change `to=".." relative="path"` → absolute `to` (per §3.5 table), drop the `← ` glyph, drop the ghost button.

**Note on listing-detail:** currently has `actions={<>Button + Link</>}` — the Link moves to `backTo`, the Button stays in `actions`.

**Acceptance:** Each page renders with BackLink above eyebrow; any existing primary/secondary CTAs in `actions` remain visually unchanged.

### Step 4 — Migrate Group B (5 connection sub-pages)
- `pages/connections/connection-detail-page.tsx` → `backTo={{ to: '/connections', label: 'Connections' }}`
- `pages/connections/new-connection-page.tsx` → same
- `pages/connections/edit-connection-page.tsx` → `backTo={{ to: `/connections/${connectionId}`, label: connection?.name ?? 'Connection' }}`
- `pages/connections/connection-mappings-page.tsx` → same pattern, resolve connectionId from route params
- `pages/connections/connection-category-mappings-page.tsx` → same pattern

**Loading-state label decision (intentional):** During `connectionQuery.isLoading`, `connection` is `undefined` and the label renders as the static string `'Connection'`; once the query resolves, it becomes the actual `connection.name`. **Accept the flicker.** This matches the existing page-title behaviour on the same routes (the `title` prop already flickers from `'Connection'` → `{name}` under the same conditions), and suppressing the back-link until the query resolves would make the retreat-one-level affordance temporarily unavailable — worse UX than a one-frame label swap. Call this out in the PR description so reviewers know it's a deliberate choice.

**Acceptance:** No `button--secondary` ghost-of-a-back-link remains in these files.

### Step 5 — Migrate Group C (failed-orders)
- `pages/orders/failed-orders-page.tsx` → `backTo={{ to: '/orders', label: 'Orders' }}`. Normalise label shape (currently outlier `All Orders`).

### Step 6 — Migrate Group D (wizard cards)
- [ ] **Audit `.wizard-card__back` in `index.css`** per §3.4: if it sets anything beyond positioning (i.e. any `color`, `font-size`, `font-weight`, `text-decoration`), remove those declarations so `.back-link` owns typography. Record the before/after in the PR description.
- [ ] `features/allegro/components/AllegroSetupForm.tsx:134` → `<BackLink to="/connections/new" label="Connections" className="wizard-card__back" />`
- [ ] `features/connections/components/prestashop-setup-form.tsx:149` → same
- [ ] Update the two affected tests (`name: /Back to connections/` → `name: /Connections/`).

### Step 7 — Style-guide documentation
- [ ] Add a short entry under `### Navigation & overlays` (or `## Composition patterns`) in `docs/frontend-ui-style-guide.md` covering:
  - The BackLink primitive and when to use it (retreat-one-level only, never confused with Cancel).
  - Slot placement: rendered via `PageLayout.backTo`, positioned **above** `eyebrow` and outside `actions`.
  - The three-line vertical stack when all slots are populated: `backTo → eyebrow → title`. Future page designs that use all three should anticipate this composition; if a tighter header is wanted on a specific page, omit `eyebrow`.
  - CSS token contract: `.back-link` reads from `--text-muted`, `--text-primary`, `--accent-focus`; no custom hex permitted.
  - Label convention: labels match the sidebar nav entry name (e.g. `"Jobs & Logs"`, not `"Jobs"`).

### Step 8 — Verification sweep
- [ ] Case-insensitive sweep — `grep -rniE "back to |← " apps/web/src --include="*.tsx" | grep -v auth/ | grep -v "back-link"` returns **zero** matches. (The `-i` catches lowercase `"back to"` drift; the extended regex pattern is scoped to back-nav specifically.)
- [ ] `grep -rn "navigate(-1)\|history.back" apps/web/src` returns zero (unchanged from baseline — no new history calls introduced).
- [ ] No `.button button--ghost` or `.button button--secondary` anchor remains in page headers as a back-nav (eyeball the 12 migrated page files + 2 wizard files).

### Step 9 — Quality gate
```bash
pnpm lint
pnpm type-check
pnpm test
```
All three must pass. Fix root causes on any failure.

---

## 5. Validation

### Architecture compliance
- ✅ Shared primitive lives in `shared/ui/`. No imports from `features/` or `pages/` — direction is respected.
- ✅ No new runtime dependencies. Uses existing React Router `<Link>`.
- ✅ CSS tokens only — no raw hex.
- ✅ `className` merging via `['base', className].filter(Boolean).join(' ')` + `tone`-less (navigation, not an action) match `.claude/rules/ui-components.md`.
- ⚠️ **Deliberate deviation:** no `forwardRef`. Documented inline in the component header; rationale is that the form-integration need that motivates the rule doesn't apply to navigation links. Revisit if a ref consumer emerges.
- ✅ `backTo` is descriptor-only (no `ReactNode` escape hatch), matching the style guide's "no unused abstractions" rule.

### Naming
- ✅ File `back-link.tsx` (kebab-case per `.claude/rules/frontend.md`), export `BackLink` (PascalCase).
- ✅ Test colocated: `back-link.test.tsx`.

### Testing strategy
- Unit tests for primitive (5 cases per §Step 1).
- Unit tests for PageLayout integration (4 cases per §Step 2).
- Existing form tests updated (2 files).
- No page-level snapshot tests broken (confirmed: no existing page test asserts on back-link text).

### Accessibility
- Glyph is `aria-hidden="true"` — screen readers announce only the label.
- Focus ring uses `--accent-focus` token at AA-visible contrast.
- Hit target: `padding: 0.25rem 0` keeps the link clickable beyond the glyph/label bounding box without inflating visual weight.

### Security
- N/A for this change — no user input, no auth boundaries, no data fetches.

### Risks / open questions
- **`to=".." relative="path"` → absolute `to`** drift risk: if a detail page is rendered in a context where its parent isn't `/listings` (etc.), the old `..` would follow the URL tree, the new absolute would jump to the list. Reviewed: all 7 detail pages are mounted only at `/{list}/:id` per the route tree in `apps/web/src/app/routes/*.route.tsx`, so absolute paths are equivalent in current routing.
- **`.wizard-card__back` collision** (Group D): resolved via the audit step in §3.4 / Step 6. Typography-owning declarations, if any, get stripped; positioning declarations remain.
- **Connection-sub-page loading-state label flicker**: resolved by deliberate decision in Step 4 (accept the flicker; matches existing page-title behaviour).

---

## 6. Done criteria (from issue #380)

- [x] `<BackLink>` exists in `shared/ui/` with colocated test (glyph `aria-hidden`, merges `className`, renders `<Link>`, supports `to` + `label`)
- [x] `PageLayout` accepts `backTo` (descriptor-only); existing usages unchanged
- [x] All 15 migration sites use the new primitive
- [x] Case-insensitive `grep` for `back to |← ` returns zero matches outside auth forms and the primitive itself
- [x] Labels match sidebar nav names
- [x] `.wizard-card__back` audited; any typography declarations removed so `.back-link` owns them
- [x] Style-guide doc updated, including the `backTo → eyebrow → title` three-line stack note
- [x] `pnpm lint`, `pnpm type-check`, `pnpm test` pass

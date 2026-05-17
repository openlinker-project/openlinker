# Implementation Plan — UI Primitives Overhaul (#775)

**Branch:** `775-ui-primitives-overhaul`
**Scope:** Whole-FE visual refresh + per-primitive overhaul + dev-only design-system page, shipped in one PR.

## 1. Goal

Replace the current monochrome "graphite" visual language with a polished, distinctive system inspired by shadcn structure + Linear polish: warm-neutral light + cool-neutral dark, signal-orange accent (reintroducing chroma — explicitly reverses the #371 decision), IBM Plex Sans/Mono kept, OKLCH-driven palette, both themes first-class.

**Out of scope for this PR:** new feature-level patterns (filter bars, detail headers, side panels), replacing Radix or TanStack Table, page-level redesigns beyond what tokens automatically restyle.

## 2. Reference

- Visual mockup: `docs/plans/ui-overhaul-mockup.html` (open in browser; toggle theme top-right)
- Screenshots: `docs/plans/ui-overhaul-mockup-light.png`, `docs/plans/ui-overhaul-mockup-dark.png`
- Issue: #775

## 3. Architecture decisions

| Decision | Rationale |
|---|---|
| Re-introduce a brand accent (signal orange) | The previous monochrome stance produced the "flat / undifferentiated" complaint that triggered this issue. Accent is used sparingly (primary action, active-tab underline, KPI top-rule, pulsing dot). Status hues stay reserved for status meaning. |
| OKLCH-driven palette | Single perceptual model across both themes; cleaner ramp than ad-hoc hex. sRGB fallbacks rendered implicitly. |
| Keep token NAMES stable | Existing CSS continues to work; only values change. New tokens are added (`--text-on-accent`, `--accent-active`, `--bg-strong`, `--accent-ring`, `--status-*-fg-soft`) where the new design needs them. |
| Keep vanilla CSS in `index.css` | No Tailwind, no CSS-in-JS — same constraint as today. Per `.claude/rules/frontend.md`. |
| Drift-checker (`scripts/check-design-tokens.mjs`) still runs | Every new CSS var must appear in `tokens.ts`. |
| Dev page lives at `/dev/ui` inside the authenticated tree | No new gating mechanism; admin-only by virtue of the layout. Not added to nav. |

## 4. File-level change list

### A. Foundations

1. **`apps/web/src/index.css` `:root` block (lines 185–331)** — replace token values with OKLCH-derived light palette. Keep existing token names; add ~8 new ones (`--bg-strong`, `--accent-active`, `--text-on-accent`, `--accent-ring`, `--shadow-lg`, `--shadow-inset-top`, `--tracking-tight`, `--tracking-caps`).
2. **`apps/web/src/index.css` `html[data-theme='dark']` block (lines 333–434)** — replace dark values with cool graphite ramp. Same names + new names.
3. **`apps/web/src/shared/theme/tokens.ts`** — add new entries for the new tokens above. Drift linter passes.

### B. Primitive CSS

All in `apps/web/src/index.css`. Each rewritten section is bounded by section comments so the file stays scannable. Where existing classes already work for the new design, we keep their declarations. Where the new design needs different rules, we replace them.

- `.button`, `.button--{primary|secondary|ghost|danger}`, `.button--{xs|sm|md|lg}`, `.button--icon`, `.button__shortcut`
- `.control` (Input/Textarea/Select base), `.control--invalid`, `.input-group`, `.input-group__icon`, native select arrow
- `.chip`, `.chip--accent`, `.chip__close`
- `.field`, `.field__label`, `.field__hint`, `.field__error`, `.field__label-required`
- `.status-badge` + tone modifiers + `.status-badge--pulse` + `.status-badge--solid`
- `.alert` + tone modifiers (left-accent rule + icon)
- `.feedback-state` (Empty/Loading/Error variants)
- `.kpi`, `.kpi__label`, `.kpi__value`, `.kpi__delta`, `.kpi__sparkline`, `.kpi__foot`
- `.metric`, `.metric__icon`, `.metric__label`, `.metric__value`
- `.kv` (KeyValueList), `.payload` (RawPayloadPanel)
- `.data-table` + `.table-shell` + `.table-toolbar` + `.cell-actions` + `.entity-label` + `.channel-pill`
- `.tabs`, `.tab`, `.tab__count`
- Dialog (`.dialog`, `.dialog__head`, `.dialog__body`, `.dialog__foot`) — Radix-wrapped
- `.menu` (DropdownMenu — Radix-wrapped), `.menu__item`, `.menu__shortcut`
- `.tooltip`
- `.stepper`, `.stepper__step`, `.stepper__index`, `.stepper__label`, `.stepper__line`
- Topbar / shell — minor — restyle command-bar pill, brand mark, accent indicators
- `.theme-toggle` (already exists — touch only if it doesn't match new visual)

### C. TSX changes (kept minimal — most primitives are CSS-driven)

Each `.tsx` is reviewed; only changed where the new design adds a structural element (e.g., Button's `button__shortcut` slot is a new prop) or removes an obsolete one.

| Primitive | Change |
|---|---|
| `button.tsx` | Add optional `shortcut?: string` prop that renders a `<span class="button__shortcut">`. Add optional `iconOnly?: boolean` ↔ `button--icon`. Keep `tone` API. |
| `input.tsx`, `textarea.tsx`, `select.tsx` | Likely zero change — class names already correct. Verify `invalid` boolean still wires `aria-invalid`. |
| `combobox.tsx`, `file-upload.tsx`, `category-tree-browser.tsx` | Review CSS class names against the new system; structural changes only if needed. |
| `chip.tsx` | Verify new `--accent` modifier still maps. |
| `status-badge.tsx` | Add `withPulse?: boolean` prop ↔ `status-badge--pulse`. Add `solid?: boolean` ↔ `status-badge--solid`. |
| `alert.tsx` | Already wraps tones — verify icon slot exists. |
| `feedback-state.tsx` | Verify component composition matches new `.feedback-state` block. |
| `kpi-card.tsx` | Add support for a sparkline child (already accepts children — verify). |
| `data-table.tsx` | No structural change — restyled via CSS only. |
| `dialog.tsx`, `confirm-dialog.tsx`, `dropdown-menu.tsx`, `popover.tsx`, `tooltip.tsx` | Radix wrappers — verify class names match new CSS blocks. |
| `tabs.tsx` | Add support for optional `count` on each tab item (renders `.tab__count`). |
| `setup-stepper.tsx` | Verify class names match new `.stepper` block. |
| `page-layout.tsx`, `back-link.tsx`, `wizard-layout.tsx`, `wizard-summary-row.tsx`, `desktop-only-banner.tsx`, `environment-badge.tsx` | Verify class names; structural changes only if needed. |
| `entity-label.tsx`, `product-thumbnail.tsx`, `time-display.tsx`, `empty-value.tsx`, `key-value-list.tsx`, `raw-payload-panel.tsx`, `metric-card.tsx`, `sparkline.tsx` | Verify; cosmetic only. |
| `structured-error-list.tsx`, `form-field.tsx`, `field-error.tsx`, `form-error-summary.tsx`, `theme-toggle.tsx`, `toast-provider.tsx` | Verify. |

### D. Dev-only design-system page

**Route:** `/dev/ui` — added to `apps/web/src/app/root.route.tsx` `coreChildren`. Lazy-loaded. No nav entry.

**Files:**
- `apps/web/src/pages/dev-ui/dev-ui-page.tsx` — page entry, wraps `PageLayout`, hosts `<Tabs>` with three panels
- `apps/web/src/pages/dev-ui/dev-ui.route.tsx` — route module mirroring existing pattern
- `apps/web/src/pages/dev-ui/sections/brandbook-section.tsx` — token swatches, type ramp, spacing/radius/shadow scales, motion, brand identity
- `apps/web/src/pages/dev-ui/sections/primitives-section.tsx` — kitchen-sink gallery of every primitive with all variants/sizes/states
- `apps/web/src/pages/dev-ui/sections/patterns-section.tsx` — composed examples (orders cockpit slice, form pattern, empty/loading/error trio)
- `apps/web/src/pages/dev-ui/sections/section-block.tsx` — small helper for "Component: name · description · live example · code" cards

**Brandbook tab contents:**
- Logo + brand mark (existing topbar mark, isolated)
- Color palette — swatch grid for neutrals + accent + each status (light and dark side-by-side via `data-theme` scopes)
- Typography — Plex Sans + Plex Mono samples at every type-scale step
- Spacing — 4px grid visualised
- Radius scale visualised
- Shadow scale visualised
- Motion — easings + durations with live demo on hover

**Primitives tab contents:**
- Every component in `shared/ui/index.ts`, in catalog order
- For each: tone × size × state matrix where applicable
- Inline `<details>` blocks with the JSX snippet for copy-paste

**Patterns tab contents:**
- "Orders cockpit" — replication of the mockup composed-screen using only real primitives
- "Form pattern" — Zod-validated form showing FormField/FieldError/FormErrorSummary/Alert wiring
- "Loading / Empty / Error trio" — DataTable cycling through the three states

### E. Test updates

- Existing tests that assert specific class names (e.g., `button--primary`) still pass because tone modifiers are unchanged.
- Tests that assert structural elements (e.g., `forwardRef` works) still pass because we keep the same component shapes.
- New props (`shortcut`, `iconOnly`, `withPulse`, `solid`) get colocated test coverage in the existing `*.test.tsx` files.
- `pnpm test` must pass.

### F. Quality gate

```bash
pnpm lint        # drift-checker passes; all token names sync
pnpm type-check  # strict-mode TypeScript clean
pnpm test        # unit tests pass
```

Visual smoke-test via the `/dev/ui` page in a browser (both themes).

## 5. Risks & mitigations

| Risk | Mitigation |
|---|---|
| **Accent re-introduction is contentious** (#371 explicitly removed it). | Documented as a deliberate reversal in this plan and in the PR description; the change is reversible by editing a single token value if the team later prefers monochrome again. |
| **CSS file is 6,725 lines** — diff will be huge | Edits stay localised to bounded sections by comment markers; tokens-only blocks first, primitive blocks second, so reviewers can chunk it. |
| **Existing pages may visually regress** even though their CSS classes are unchanged. | The `/dev/ui` Patterns tab includes a snapshot of common page compositions; we'll also click-through real pages (dashboard, orders, connections) post-implementation. |
| **Drift-checker false positives** if a CSS var name changes and `tokens.ts` doesn't update | Linter is part of `pnpm lint`; the quality gate enforces alignment. |
| **PR size — hard to review** | Commit message + PR body group changes by file/section. Self-review pass before pushing. |

## 6. Step-by-step execution order

1. Rewrite `:root` and `html[data-theme='dark']` token blocks in `index.css`. Add new tokens to `tokens.ts`. Run `pnpm lint` — drift-checker passes.
2. Rewrite primitive CSS blocks in `index.css` (button → input → status-badge → alert → feedback-state → kpi → metric → kv → payload → data-table → tabs → dialog → menu → tooltip → stepper).
3. Update primitive `.tsx` files that need new props (button, status-badge, tabs).
4. Create `/dev/ui` page (route + page + three section files).
5. Run quality gate. Fix anything broken.
6. Visual smoke-test: dev/ui page + dashboard + orders list + connections list, both themes.
7. Self-review per `docs/code-review-guide.md`. Fix BLOCKING/IMPORTANT.
8. Commit, push, open PR with `Closes #775`.

## 7. Acceptance (mirrors issue #775)

- [ ] Every primitive in the issue checklist reviewed + updated (or marked kept-as-is in the PR body).
- [ ] `pnpm lint && pnpm type-check && pnpm test` all pass.
- [ ] `/dev/ui` page renders with all three tabs working in both themes.
- [ ] Visual smoke-test of 3+ real pages confirms no regression.
- [ ] PR body lists any breaking API changes (new optional props are not breaking).
- [ ] Mockup + screenshots referenced from PR description.

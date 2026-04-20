# Implementation Plan: #228 — MetricCard warning/error needs shape, not just color

## 1. Task Understanding

**Goal**: Make warning and error states on `MetricCard` perceivable by color-blind users and quick to scan at a glance. Currently distinguished only by a tinted background + border + colored value; needs a non-color signal (icon) as well.

**Layer**: Frontend (shared UI primitive + pages that consume it).

**Non-goals**:
- No change to neutral/success/info visual (those aren't signalling a problem state).
- No new icon-library dependency; use an inline SVG we own.
- No restructuring of `MetricCard` API beyond what's needed for the a11y fix.
- **Defer `'review'` tone** — no current page renders a MetricCard with `review`. Per `.claude/rules/ui-components.md` ("Use the same primitive in a real page immediately after introducing it — no unused abstractions"), it'll land with its first consumer in a follow-up. Out of scope here.

## 2. Research findings

Since the issue was filed (2026-04-17), two things moved:

1. **`.metric-card--warning` and `.metric-card--error` already have soft backgrounds** — the stale "only border changes" snippet in the issue no longer applies. PR #249 added those rules when the dashboard moved onto `MetricCard`. CSS state today (`apps/web/src/index.css:2450-2484`):
   - `--warning`: `var(--status-warning-soft)` bg + `var(--status-warning-border)` + `--status-warning-strong` value color ✅
   - `--error`: `var(--status-error-soft)` bg + `var(--status-error-border)` + `--status-error-strong` value color ✅
   - Also `--success` and `--info` already tint correctly.
2. **`.metric-card--review` does not exist**. The `MetricCardTone` union is `'neutral' | 'success' | 'warning' | 'error' | 'info'` — no `review`. The design tokens (`--status-review`, `--status-review-soft`, `--status-review-border`) do exist but nothing consumes them on the dashboard.

So the real gap is the **"color is never the only signal"** a11y rule from `docs/frontend-ui-style-guide.md` and `.claude/rules/frontend.md`. Today a colour-blind operator sees identical shape/layout on a warning card and a neutral card.

## 3. Solution

### 3.1 `MetricCard` — migrate tone to `as const` + add tonal icon

**Union migration** — align with engineering-standards "Union Types: `as const` Pattern":

```tsx
export const MetricCardToneValues = ['neutral', 'success', 'warning', 'error', 'info'] as const;
export type MetricCardTone = (typeof MetricCardToneValues)[number];
```

This replaces the current inline union. Consumers (dashboard page, tests) don't change — the union shape is identical.

**Tonal icon** — when `tone === 'warning' || tone === 'error'`, render an inline SVG icon before the label.

Icon choice:
- **warning** → triangle-with-exclamation (SVG, not the `⚠` glyph — inconsistent across fonts).
- **error** → circle-with-exclamation.

Both use `currentColor` so they inherit the tone-scoped value color (`--status-warning-strong` / `--status-error-strong`) already set on the value. Place the SVG inside a wrapping `<span className="metric-card__icon" aria-hidden="true">` — `aria-hidden` on the wrapper hides the whole subtree, matching the pattern in `app-shell.tsx` and `status-badge.tsx`.

### 3.2 Markup change

Before:
```tsx
<span className="metric-card__label">{label}</span>
<span className="metric-card__value">{value}</span>
```

After:
```tsx
<span className="metric-card__label">
  {showToneIcon(tone) ? <ToneIcon tone={tone} /> : null}
  {label}
</span>
<span className="metric-card__value">{value}</span>
```

`ToneIcon` is a private component in the same file that emits `<span className="metric-card__icon" aria-hidden="true"><svg .../></span>`. `showToneIcon(tone)` returns `true` only for `'warning' | 'error'`.

## 4. Step-by-step

### Step 1 — Migrate tone union and add icon rendering

**File**: `apps/web/src/shared/ui/metric-card.tsx`

- Replace `type MetricCardTone = '...'` with `const MetricCardToneValues = [...] as const` + `type MetricCardTone = (typeof MetricCardToneValues)[number]` (keep the same five values — no `'review'`).
- Add inline `ToneIcon` component that renders `<span className="metric-card__icon" aria-hidden="true"><svg>...</svg></span>` for `'warning' | 'error'` and `null` otherwise.
- Render the icon inside `.metric-card__label` for warning/error tones.

**Acceptance**: Component compiles; public API unchanged (tone union still accepts the same five values); neutral/success/info render without an icon; warning/error render with an icon wrapped in an `aria-hidden` span.

### Step 2 — CSS for icon

**File**: `apps/web/src/index.css`

- Add `.metric-card__icon { display: inline-flex; align-items: center; margin-right: 0.375rem; color: inherit; }` and ensure the SVG inside is sized to 14px (consistent with body type scale) via `width/height`.
- Update `.metric-card__label` to use `display: inline-flex; align-items: center;` so the icon aligns with label text cleanly. Verify no regression on existing neutral cards (no icon, no layout shift).

**Acceptance**: Visual: neutral cards identical to before; warning/error cards show icon; no change to existing CSS for tone modifiers.

### Step 3 — Tests

**File**: `apps/web/src/shared/ui/metric-card.test.tsx`

Add cases:
- `renders a warning icon for tone="warning"` — `.metric-card__icon` is in the DOM with `aria-hidden="true"` on the span.
- `renders an error icon for tone="error"` — same.
- `does not render a tone icon for tone="neutral" | "success" | "info"`.
- `MetricCardToneValues includes all five expected tones` — guards the runtime array so future additions require an explicit update.

Keep existing tests passing.

### Step 4 — Dashboard snapshot sanity

**File**: `apps/web/src/pages/dashboard/dashboard-page.test.tsx`

No behavioural change expected, but confirm the existing "Integration health" warning assertion still passes and add a check that the warning icon appears when there's an error connection. Keep to one extra assertion to avoid test bloat.

### Step 5 — Quality gate

```
pnpm lint && pnpm type-check && pnpm test
```

Must pass with zero errors.

### Step 6 — PR description

Include a **desktop before/after screenshot** of the dashboard metric strip showing the warning card with and without the new icon. Makes the color-blind case visible to reviewers without running the app. Mobile/tablet shots optional — this is an a11y polish, not a Phase-3 primitive migration.

## 5. Validation

- **Architecture**: Change is confined to one shared primitive + its test + one CSS section. Respects `shared → no imports from features/pages`. ✅
- **Rules**: `aria-hidden="true"` on decorative icon (frontend.md "Accessibility"); no color-only signal (frontend-ui-style-guide.md "Color Usage Rules"). ✅
- **Tokens**: All new colors via existing `--status-*` tokens — no raw hex. ✅
- **Scope discipline**: No new icon library; no changes outside the metric card + its callers' tests. ✅
- **Non-goals respected**: no change to neutral/success/info visual, no API rename. ✅

## 6. Open questions resolved

| Question | Decision |
|---|---|
| Unicode vs SVG? | SVG — cross-font-consistent, inherits `currentColor`. |
| Icon on info/success too? | No — only on problem states (warning/error). Others are already positive/neutral. |
| Is `.metric-card--review` in scope? | **Deferred** — no consumer exists. Per `ui-components.md` "no unused abstractions", add with its first consumer in a follow-up. |
| Should the icon be announced to screen readers? | No — tone is already in the label text + value; the icon is decorative. `aria-hidden` on the wrapping span. |
| Inline union vs `as const` + typeof[number]? | Migrate to `as const` per engineering-standards "Union Types" guidance. Public type name and values unchanged. |

---
paths:
  - "apps/web/src/shared/ui/**"
---

# UI Component Rules

These rules apply when creating or modifying shared UI components in `apps/web/src/shared/ui/`.

## Design System Foundation

This project uses **no external styled UI library** (no Tailwind, shadcn, MUI, Mantine, Chakra) — primitives are thin wrappers over native HTML elements, styled with vanilla CSS and OKLCH-driven design tokens defined in `apps/web/src/index.css`. Headless libraries (Radix, TanStack Table, TanStack Virtual) are permitted when wrapped by a project primitive.

The visual identity is **signal-orange accent + warm-neutral light + cool-neutral dark**, both themes first-class. Reference and live preview: navigate to `/dev/ui` (hidden route, admin tree). The three tabs there are the canonical source of truth:

- **Brandbook** — every token, type ramp, spacing/radius/shadow/motion scale rendered live.
- **Primitives** — kitchen sink for every component with all variants and states.
- **Patterns** — composed examples (orders cockpit, settings form).

The standalone HTML mockup `docs/plans/ui-overhaul-mockup.html` is the offline reference if the dev server isn't running.

## Component Structure

Every shared UI component must follow this pattern:

```tsx
import { forwardRef, type ComponentPropsWithoutRef } from 'react';

interface InputProps extends ComponentPropsWithoutRef<'input'> {
  invalid?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  function Input({ className = '', invalid = false, ...props }, ref) {
    const classes = ['control', invalid ? 'control--invalid' : '', className]
      .filter(Boolean)
      .join(' ');
    return <input ref={ref} className={classes} {...props} />;
  },
);
```

### Required Patterns

1. **Always use `forwardRef`** — required for React Hook Form `register()` integration
2. **Named function inside forwardRef** — `forwardRef<El, Props>(function Name(...) {})` for DevTools clarity
3. **Extend native element props** — use `ComponentPropsWithoutRef<'element'>` as base
4. **Accept `className` prop** — merge with internal classes, never override
5. **Spread remaining props** — `{...props}` on the root element to preserve native behavior
6. **Export the component and its props type** — consumers may need the type

### Class String Construction

No utility libraries (no `cn()`, no `clsx`, no CVA). Use manual concatenation:

```tsx
const classes = ['base-class', condition ? 'modifier' : '', className]
  .filter(Boolean)
  .join(' ');
```

### Prop Naming

- Boolean toggles: `invalid`, `compact`, `withDot`, `pulse`, `solid` — not `isInvalid`, `isCompact`
- Variant selectors: `tone` (not `variant`, `color`, or `type`)
- Standard tones: `'primary' | 'secondary' | 'danger' | 'ghost'` for actions
- Status tones: `'success' | 'warning' | 'error' | 'info' | 'review' | 'neutral'`
- Size modifiers: append `--xs|--sm|--md|--lg` to the BEM class (e.g. `.button--sm`), don't add a `size` prop unless the size requires structural change

## Styling

### Use CSS Custom Properties (Design Tokens)

Never hardcode colors, spacing, or typography. Always reference tokens from `index.css`. Use `var(--token-name)` in CSS, or `tokens['token-name']` in TS (typed via `TokenName`):

```css
/* Good */
color: var(--text-primary);
background: var(--bg-surface);
border: 1px solid var(--border-subtle);
border-radius: var(--radius-md);
box-shadow: var(--shadow-xs), var(--shadow-inset-top);

/* Bad */
color: #16202b;
background: white;
border: 1px solid #e5eaf0;
border-radius: 10px;
```

### Key Token Categories

- **Surfaces:** `--bg-canvas`, `--bg-shell`, `--bg-surface`, `--bg-surface-elevated`, `--bg-surface-muted`, `--bg-surface-hover`, `--bg-strong`, `--bg-muted`
- **Borders:** `--border-subtle`, `--border-default`, `--border-strong`, `--border-focus`
- **Text:** `--text-primary`, `--text-secondary`, `--text-muted`, `--text-disabled`, `--text-inverse`, `--text-on-primary`, `--text-link`
- **Accent (signal orange — see #775):** `--accent-primary`, `--accent-primary-hover`, `--accent-primary-active`, `--accent-primary-soft`, `--accent-primary-soft-strong`, `--accent-primary-border`, `--accent-focus`, `--accent-ring`
- **Status:** `--status-{tone}`, `--status-{tone}-soft`, `--status-{tone}-border`, `--status-{tone}-fg`, `--status-{tone}-strong` — tones are `success`, `warning`, `error`, `info`, `review`, `conflict`, `disabled`
- **Shadows:** `--shadow-xs`, `--shadow-sm`, `--shadow-md`, `--shadow-lg`, `--shadow-soft`, `--shadow-soft-hover`, `--shadow-overlay`, `--shadow-focus`, `--shadow-inset-top`
- **Motion:** `--duration-fast` (120ms), `--duration-normal` (180ms), `--duration-slow` (280ms), `--ease-out`, `--ease-standard`, `--ease-in-out`
- **Tracking:** `--tracking-tight` (-0.012em), `--tracking-normal` (0), `--tracking-wide` (0.02em), `--tracking-caps` (0.08em)
- **Spacing scale:** `--space-1`–`--space-8` (4px grid)
- **Radii:** `--radius-xs` (4px), `--radius-sm` (6px), `--radius-md` (8px), `--radius-lg` (10px), `--radius-xl` (14px), `--radius-pill` (9999px)

Drift check: `scripts/check-design-tokens.mjs` runs under `pnpm lint` and fails if a token in `tokens.ts` is missing from `index.css`. Add to `index.css` first, then `tokens.ts`.

### Spacing Scale (4px Increments)

Use `var(--space-{n})` tokens. Avoid inline rem values — keeps the 4px grid honest at refactor time.

### Border Radius

- Form controls (`.control`, `input`, `select`, `textarea`), buttons: `var(--radius-md)` — 8px
- Cards (`.kpi-card`, `.metric-card`, `.feedback-state`, table container): `var(--radius-lg)` — 10px
- Dialogs, toasts, dev-ui section surface: `var(--radius-xl)` — 14px
- Pills, badges, chips: `var(--radius-pill)` — 9999px
- Status badges (mono+caps treatment): `var(--radius-sm)` — 6px

### CSS Class Naming

Use BEM-like flat convention matching existing patterns:

```css
.component-name { }
.component-name--modifier { }
.component-name__child { }
```

Add new styles in `apps/web/src/index.css` in the appropriate section. Use bounded section comments (`/* ── Component (#775) ── */`) so reviewers can chunk large diffs.

### Native Checkbox / Radio Convention

Native `<input type="checkbox">` and `<input type="radio">` are styled with `accent-color: var(--accent-primary)` so the browser paints the indicator in our brand orange without rebuilding it from scratch. The form-controls rule explicitly excludes these types (and other non-text inputs like `file`, `color`, `range`) so they keep their native 14–16 px size instead of being stretched to 32 px tall.

Don't wrap them in custom div trees unless you need a tri-state or a behaviour `accent-color` can't give you.

## Accessibility

### Non-Negotiable Requirements

1. **Semantic HTML first** — use `<button>`, `<input>`, `<dialog>`, `<table>`, not `<div>` with roles
2. **Labels on all form controls** — via `<label htmlFor>` or `aria-label`
3. **`aria-invalid` on invalid controls** — wired through `invalid` prop or `FormField`
4. **`aria-describedby` for descriptions and errors** — `FormField` handles this automatically
5. **`role="alert"` for errors** — immediate screen reader announcement
6. **`aria-live="polite"` for loading/status** — non-intrusive updates
7. **`aria-hidden="true"` on decorative elements** — dots, icons, chevrons
8. **Visible focus rings** — `box-shadow: var(--shadow-focus)` (3px accent-ring glow, no layout shift). Never remove. Prefer over `outline` so it can coexist with hover borders.
9. **Color is never the only signal** — always pair with text, icon, or dot. `StatusBadge` enforces this by combining colour + dot + mono-caps label.

### Dialog Pattern

Wrap Radix Dialog (`@radix-ui/react-dialog`) with the project `Dialog` primitive. The CSS provides the centered surface card with rounded corners, entrance translate, and a shell-bg footer slot:

```tsx
<Dialog>
  <DialogTrigger>Open</DialogTrigger>
  <DialogContent>
    <DialogTitle>Title</DialogTitle>
    <DialogDescription>Why we're asking.</DialogDescription>
    {/* body */}
    <DialogFooter>
      <Button tone="ghost">Cancel</Button>
      <Button tone="primary">Confirm</Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
```

### Table Pattern

Always include a `<caption>` (use `.sr-only` if visually hidden):

```tsx
<DataTable
  caption="Recent orders"
  columns={columns}
  rows={rows}
  rowKey={(r) => r.id}
/>
```

The `.data-table` CSS auto-applies mono-caps sticky thead, tabular-nums on right-aligned cells, color-mix hover.

## Testing

Every shared UI component gets a colocated `*.test.tsx`:

```tsx
// button.test.tsx
import { render, screen } from '@testing-library/react';
import { Button } from './button';

describe('Button', () => {
  it('should render with primary tone by default', () => {
    render(<Button>Click me</Button>);
    expect(screen.getByRole('button', { name: 'Click me' })).toHaveClass('button--primary');
  });

  it('should forward ref to native button element', () => {
    const ref = { current: null as HTMLButtonElement | null };
    render(<Button ref={ref}>Test</Button>);
    expect(ref.current).toBeInstanceOf(HTMLButtonElement);
  });

  it('should merge custom className with internal classes', () => {
    render(<Button className="custom">Test</Button>);
    expect(screen.getByRole('button')).toHaveClass('button', 'custom');
  });
});
```

### Testing Priorities

1. **Renders correctly** with default and custom props
2. **Forwards ref** to the native element
3. **Merges className** without overriding internal classes
4. **Accessibility attributes** are correct (aria-invalid, aria-describedby, roles)
5. **Keyboard interaction** works (focus, Enter, Escape for dialogs)
6. **Tone/variant modifiers** apply correct CSS classes

## Existing Component Inventory

Before creating a new component, check if one already exists in `shared/ui/index.ts`:

- **Controls:** `Button` (tones × sizes × icon × `.button__shortcut` slot), `Input`, `Textarea`, `Select`, `Combobox`, `Chip`, `FileUpload`, `ThemeToggle`
- **Form composition:** `FormField`, `FieldError`, `FormErrorSummary`
- **Feedback / status:** `Alert` (4 tones, left-rule), `StatusBadge` (7 tones, `pulse`, `solid`, `withDot`, `compact`), `EmptyState`, `LoadingState`, `ErrorState`, `StructuredErrorList`, `EnvironmentBadge`
- **Layout / navigation:** `PageLayout`, `BackLink`, `Tabs` + `TabsList` + `TabsTrigger` + `TabsContent` (with `.tabs__count` badge slot), `SetupStepper`, `WizardLayout`, `WizardSummaryRow`, `DesktopOnlyBanner`
- **Overlays (Radix-wrapped):** `Dialog`, `ConfirmDialog`, `DropdownMenu` (with `.dropdown-menu__shortcut` slot), `Popover`, `Tooltip`, `ToastProvider` / `useToast()`
- **Data surfaces:** `DataTable` + `DataTableSkeleton`, `KeyValueList`, `RawPayloadPanel`, `TimeDisplay`, `MetricCard`, `KpiCard` (with sparkline + tone), `Sparkline`
- **Identity / labels:** `EntityLabel`, `ProductThumbnail`, `CategoryTreeBrowser`

Reuse and extend before creating new components. If you're tempted to add a primitive, first check whether composing existing ones in the consuming page is enough — the `/dev/ui` Patterns tab is a good model for composition.

## Recent Primitive APIs (#775)

- `Button` — `tone='primary'|'secondary'|'danger'|'ghost'`. Size via `className="button--{xs|sm|md|lg}"`. Icon-only via `className="button--icon"`. Keyboard shortcut affordance via `<span className="button__shortcut">⌘K</span>`.
- `StatusBadge` — `tone`, `withDot`, `compact`, plus new `pulse?: boolean` (animates dot for live/syncing states, implies `withDot`) and `solid?: boolean` (high-emphasis inverted variant for Draft / Outbox / etc).
- `Tabs` — count badge via `<span className="tabs__count">12</span>` inside the trigger; active tab tints the count in accent-soft automatically.
- `DropdownMenu` — group items under `.menu__group`; add `.dropdown-menu__shortcut` for trailing mono-caps shortcut hints.

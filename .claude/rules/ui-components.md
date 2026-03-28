---
paths:
  - "apps/web/src/shared/ui/**"
---

# UI Component Rules

These rules apply when creating or modifying shared UI components in `apps/web/src/shared/ui/`.

## Design System Foundation

This project uses **no external UI library** — components are thin wrappers over native HTML elements, styled with vanilla CSS and design tokens (`index.css`). The goal is Shopify admin clarity, Linear polish, and operations console efficiency.

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

- Boolean toggles: `invalid`, `compact`, `withDot` — not `isInvalid`, `isCompact`
- Variant selectors: `tone` (not `variant`, `color`, or `type`)
- Standard tones: `'primary' | 'secondary' | 'danger' | 'ghost'` for actions
- Status tones: `'success' | 'warning' | 'error' | 'info' | 'review' | 'neutral'`

## Styling

### Use CSS Custom Properties (Design Tokens)

Never hardcode colors, spacing, or typography. Always reference tokens from `index.css`:

```css
/* Good */
color: var(--text-primary);
background: var(--bg-surface);
border: 1px solid var(--border-subtle);
border-radius: 0.625rem;

/* Bad */
color: #16202b;
background: white;
border: 1px solid #e5eaf0;
```

### Key Token Categories

- **Backgrounds:** `--bg-canvas`, `--bg-shell`, `--bg-surface`, `--bg-surface-elevated`, `--bg-muted`
- **Borders:** `--border-subtle`, `--border-default`, `--border-strong`
- **Text:** `--text-primary`, `--text-secondary`, `--text-muted`, `--text-disabled`, `--text-on-primary`
- **Accent:** `--accent-primary`, `--accent-primary-hover`, `--accent-primary-soft`, `--accent-focus`
- **Status:** `--status-{tone}`, `--status-{tone}-soft`, `--status-{tone}-border`, `--status-{tone}-fg`

### Spacing Scale (4px Increments)

Use rem values on the 4px grid: `0.25rem`, `0.5rem`, `0.75rem`, `1rem`, `1.5rem`, `2rem`.

### Border Radius

- Form controls, buttons: `0.625rem` (10px)
- Dialogs, toasts, cards: `0.75rem` (12px)
- Pills, badges: `999px`

### CSS Class Naming

Use BEM-like flat convention matching existing patterns:

```css
.component-name { }
.component-name--modifier { }
.component-name__child { }
```

Add new styles in `apps/web/src/index.css` in the appropriate section.

## Accessibility

### Non-Negotiable Requirements

1. **Semantic HTML first** — use `<button>`, `<input>`, `<dialog>`, `<table>`, not `<div>` with roles
2. **Labels on all form controls** — via `<label htmlFor>` or `aria-label`
3. **`aria-invalid` on invalid controls** — wired through `invalid` prop or `FormField`
4. **`aria-describedby` for descriptions and errors** — `FormField` handles this automatically
5. **`role="alert"` for errors** — immediate screen reader announcement
6. **`aria-live="polite"` for loading/status** — non-intrusive updates
7. **`aria-hidden="true"` on decorative elements** — dots, icons, chevrons
8. **Visible focus outlines** — `2px solid var(--accent-focus)` with `2px` offset. Never remove.
9. **Color is never the only signal** — always pair with text, icon, or dot

### Dialog Pattern

Use native `<dialog>` with `.showModal()` / `.close()`:

```tsx
<dialog ref={dialogRef} aria-labelledby={titleId} aria-describedby={descId}>
```

### Table Pattern

Always include a `<caption>` (use `.sr-only` if visually hidden):

```tsx
<table className="data-table">
  <caption className="sr-only">{caption}</caption>
  <thead>
    <tr>{columns.map(col => <th key={col.id} scope="col">...)}</tr>
  </thead>
</table>
```

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

Before creating a new component, check if one already exists in `shared/ui/`:

- **Form controls:** `Button`, `Input`, `Select`, `Textarea`
- **Form layout:** `FormField`, `FieldError`, `FormErrorSummary`
- **Status:** `StatusBadge`, `Alert`, `EnvironmentBadge`
- **Feedback:** `LoadingState`, `EmptyState`, `ErrorState` (in `feedback-state.tsx`)
- **Data:** `DataTable` (generic, typed columns)
- **Overlays:** `ConfirmDialog`, `ToastProvider` / `useToast()`
- **Layout:** `AppShell`, `PageLayout`

Reuse and extend before creating new components.

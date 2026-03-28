---
description: "Scaffold a new shared UI component following all project patterns"
argument-hint: "<ComponentName>"
allowed-tools: Read, Write, Edit, Grep, Glob
---

# Create a New Shared UI Component

Create a new shared UI component named `$ARGUMENTS` in `apps/web/src/shared/ui/`.

## Before You Start

1. Read `apps/web/src/index.css` to understand existing design tokens and CSS patterns
2. Read `docs/frontend-ui-style-guide.md` for visual and interaction standards
3. Check existing components in `apps/web/src/shared/ui/` — reuse or extend before creating new
4. Read `.claude/rules/ui-components.md` for all component conventions

## Component File: `apps/web/src/shared/ui/{kebab-case-name}.tsx`

Follow this exact pattern:

```tsx
import { forwardRef, type ComponentPropsWithoutRef, type ReactNode } from 'react';

// 1. Props interface extending native element
interface {ComponentName}Props extends ComponentPropsWithoutRef<'{native-element}'> {
  // Custom props here (use `tone`, `invalid`, `compact` naming)
}

// 2. Component with forwardRef + named function
export const {ComponentName} = forwardRef<HTML{Element}Element, {ComponentName}Props>(
  function {ComponentName}({ className = '', /* custom props */, ...props }, ref) {
    // 3. Class string construction
    const classes = ['{base-class}', /* conditionals */, className]
      .filter(Boolean)
      .join(' ');

    // 4. Return native element with ref + spread
    return <{element} ref={ref} className={classes} {...props} />;
  },
);
```

### Rules

- **Always `forwardRef`** with a named function (not arrow function)
- **Extend native element props** via `ComponentPropsWithoutRef<'element'>`
- **Accept and merge `className`** — never override consumer's classes
- **Spread `...props`** on the root element
- **No external dependencies** — no clsx, no CVA, no UI library imports
- **Use design tokens** for all colors, spacing, typography in CSS

## CSS Styles: Add to `apps/web/src/index.css`

Add styles in the appropriate section of `index.css` following existing patterns:

```css
/* Component: {ComponentName} */
.{component-name} {
  /* Use design tokens */
  color: var(--text-primary);
  background: var(--bg-surface);
  border: 1px solid var(--border-subtle);
  border-radius: 0.625rem;
  padding: 0.75rem 1rem;
}

.{component-name}--{modifier} {
  /* Variant styles */
}
```

### CSS Rules

- Use BEM-like naming: `.component-name`, `.component-name--modifier`, `.component-name__child`
- All values from CSS custom properties (tokens) — no hardcoded colors
- Spacing on 4px grid: `0.25rem`, `0.5rem`, `0.75rem`, `1rem`, `1.5rem`, `2rem`
- Border radius: `0.625rem` (controls), `0.75rem` (cards/dialogs), `999px` (pills)
- Include focus styles: `outline: 2px solid var(--accent-focus); outline-offset: 2px;`
- Include disabled state: `opacity: 0.7; cursor: not-allowed;`

## Test File: `apps/web/src/shared/ui/{kebab-case-name}.test.tsx`

```tsx
import { render, screen } from '@testing-library/react';
import { {ComponentName} } from './{kebab-case-name}';

describe('{ComponentName}', () => {
  it('should render with default props', () => {
    render(<{ComponentName}>Content</{ComponentName}>);
    // Assert renders correctly
  });

  it('should forward ref to native element', () => {
    const ref = { current: null as HTML{Element}Element | null };
    render(<{ComponentName} ref={ref}>Test</{ComponentName}>);
    expect(ref.current).toBeInstanceOf(HTML{Element}Element);
  });

  it('should merge custom className', () => {
    render(<{ComponentName} className="custom">Test</{ComponentName}>);
    // Assert both internal and custom classes present
  });

  // Add tone/variant tests if applicable
  // Add accessibility tests (aria attributes, roles)
});
```

## Accessibility Checklist

Before marking complete, verify:

- [ ] Uses semantic HTML element (not `<div>` with role)
- [ ] Keyboard accessible (Tab, Enter, Escape where appropriate)
- [ ] Focus outline visible (`var(--accent-focus)`)
- [ ] `aria-invalid` supported if it's a form control
- [ ] Decorative elements have `aria-hidden="true"`
- [ ] Color is never the only signal — always pair with text
- [ ] Screen reader announces meaningful content

## Quality Gate

After creating the component:

```bash
pnpm test
pnpm type-check
pnpm lint
```

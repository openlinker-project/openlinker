# OpenLinker UI — how to build with these components

An operator cockpit for e-commerce orchestration: status-first, dense but readable.
Shopify-admin clarity, Linear polish, one signal-orange accent. No glassmorphism, no
heavy gradients, no glow.

## Setup

No provider is required for styling — the components read CSS custom properties from
`styles.css`, which the design already loads. Two cases do need a wrapper:

- **Router.** `BackLink`, `DataTable`, `EntityLabel`, `KpiCard` and `MetricCard` call
  `useNavigate()`. Render them inside a react-router context, or they throw
  `useNavigate() may be used only in the context of a <Router>`.
- **Toasts.** If you use `useToast`, mount its provider at the app root.

```jsx
<MemoryRouter>
  <PageLayout eyebrow="Orders" title="Recent orders" actions={<Button tone="primary">Export</Button>}>
    <DataTable caption="Recent orders" columns={columns} rows={rows} rowKey={(r) => r.id} />
  </PageLayout>
</MemoryRouter>
```

## Styling idiom: vanilla CSS + tokens. No Tailwind, no CSS-in-JS.

There is **no utility-class system**. Style your own layout glue with inline styles or
your own CSS, and take every value from a token — never a hardcoded hex or rem where a
token exists.

| Family | Real names | Use for |
|---|---|---|
| Spacing | `--space-1` … `--space-8` (4px grid, 4→64px) | gaps, padding, margins |
| Surfaces | `--bg-canvas`, `--bg-shell`, `--bg-surface`, `--bg-surface-elevated`, `--bg-surface-hover`, `--bg-surface-muted`, `--bg-muted`, `--bg-strong` | backgrounds; `elevated` for cards/dialogs above the page |
| Text | `--text-primary`, `--text-secondary`, `--text-inverse` | copy; `secondary` for supporting text |
| Borders | `--border-subtle`, `--border-default`, `--border-strong`, `--border-focus` | dividers, control outlines |
| Accent | `--accent-primary`, `--accent-primary-hover`, `--accent-primary-active`, `--accent-primary-soft`, `--accent-primary-border`, `--accent-ring`, `--accent-focus` | the brand signal-orange |
| Status | `--status-{success,warning,error,info,review,conflict}` plus `-soft`, `-strong`, `-border` variants | status meaning only |
| Radius | `--radius-xs`, `-sm`, `-md`, `-lg`, `-xl`, `-pill` | corners |
| Type | `--font-sans` (IBM Plex Sans), `--font-mono` (IBM Plex Mono) | body vs identifiers |
| Focus | `--shadow-focus` | focus rings — see below |

**Use the accent sparingly.** `--accent-primary` is reserved for primary buttons, the
active-tab underline, the KPI top-rule, a live pulsing dot, and focus rings. Status hues
are reserved for status meaning — never decoration.

## Non-negotiable house rules

1. **Colour is never the only signal.** Always pair it with text, an icon or a dot.
   `StatusBadge` enforces this: mono + caps label plus a tone-tinted dot.
2. **Monospace for machine values.** Identifiers, payload fields, system references and
   eyebrows use `var(--font-mono)`. Every numeric gets
   `font-variant-numeric: tabular-nums` so columns align.
3. **Never remove focus rings.** Prefer `box-shadow: var(--shadow-focus)` over `outline`
   so it coexists with hover borders and causes no layout shift.
4. **Semantic HTML first** — `<button>`, `<input>`, `<table>`, not `<div role=…>`.
5. **Handle all four states** on anything that loads data: loading → error → empty →
   data. `LoadingState`, `ErrorState` and `EmptyState` exist for the first three; give
   the error a retry and the empty state a CTA.

## Component notes that will bite you otherwise

- **`tone` is the variant prop** — not `variant`, not `color`. `Button` takes
  `primary | secondary | ghost | danger`; sizing is a class (`button--xs|sm|md|lg`).
- **`StatusBadge solid` ignores `tone`.** It paints one high-emphasis dark chip; there
  are no tone-specific solid rules. Use `tone` + `withDot` for status, `solid` only for
  flat emphasis.
- **`Alert` requires `children`**; `title` is optional. A title-only alert is not valid.
- **`BulkActionBar` renders invisibly when `count === 0`** — by design. Pass a real
  selection count.
- **`FormField` is what wires accessibility.** It supplies `aria-invalid` and
  `aria-describedby` to its control. A bare `<Input invalid />` outside `FormField` will
  not show its error border — wrap controls in `FormField`.
- `Combobox` takes `ariaLabel`, not `aria-label`.
- **Cockpit list page**, the canonical composition: `PageLayout` → a strip of 3–4
  `MetricCard`s → a filter chip row → a `DataTable` using `EntityLabel` for the identity
  column and `StatusBadge` for status.

## Where the truth lives

Read these before styling: `styles.css` and its `@import` closure (every token,
resolved), and each component's `<Name>.prompt.md` and `<Name>.d.ts` for its real API.
The `.d.ts` is authoritative for props; where it looks thin, the component still accepts
the underlying native element's props.

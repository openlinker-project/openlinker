---
paths:
  - "apps/web/**"
---

# Frontend Rules

## Architecture

- Dependency direction: `app` → `pages` → `features` → `shared`
- `shared` must NOT import from `features` or `pages`
- No general-purpose global store

## State Ownership

- Server state → TanStack Query (queries + mutations)
- URL state → route params / search params
- Form state → React Hook Form + Zod validation
- Session state → `SessionProvider`
- Local UI state → component-local `useState` / `useReducer`

## Naming

- Components: `kebab-case.tsx` (named export stays `PascalCase`, e.g. `kpi-card.tsx` exports `KpiCard`)
- Hooks: `use-*.ts` (kebab-case)
- Route modules: `*.route.tsx`
- Tests: `*.test.tsx` (colocated with source)
- API modules: `*.api.ts`
- Query keys: `*.query-keys.ts`
- Types: `*.types.ts`
- Zod schemas: `*.schema.ts`

## Styling

- **No Tailwind, no CSS-in-JS** — pure vanilla CSS with OKLCH-driven design tokens in `index.css`
- All colors, spacing, typography via CSS custom properties (`var(--token-name)`) — use `var(--space-*)` not hardcoded rem values where a token exists
- Spacing on 4px grid: `--space-1` (4px) through `--space-8` (64px)
- CSS class naming: `.component-name`, `.component-name--modifier`, `.component-name__child`
- New styles go in `apps/web/src/index.css` in the appropriate section. Use bounded section comments (`/* ── Component (#issue) ── */`) so reviewers can chunk large diffs.
- **Signal-orange accent (#775)** — `--accent-primary` is the brand colour. Use sparingly: primary buttons, active-tab underline, KPI top-rule, pulsing live dot, focus rings. Status hues stay reserved for status meaning.
- **Drift checker** runs under `pnpm lint` — every CSS var must appear in `apps/web/src/shared/theme/tokens.ts`. Add to `index.css` first, then `tokens.ts`.

## Component Patterns

- All shared UI components use `forwardRef` (required for React Hook Form)
- Extend native element props via `ComponentPropsWithoutRef<'element'>`
- Accept and merge `className` — never override
- No **styled** external UI library (no shadcn, MUI, Mantine, Chakra) — they bring visual opinions we don't want
- **Headless** libraries are permitted when wrapped by a project primitive in `shared/ui/` and styled with our own CSS:
  - `@tanstack/react-table` — `DataTable` state engine
  - `@tanstack/react-virtual` — virtualized long lists
  - `@radix-ui/react-*` — `Dialog`, `Select`, `DropdownMenu`, `Tooltip`, `Popover`, `Toast`, `Tabs` (a11y + keyboard behavior only)
- Rationale: we write every pixel of CSS (vanilla CSS + tokens), libraries only contribute behavior and a11y.
- Use `tone` for variant props (not `variant` or `color`)
- Class construction: `['base', condition ? 'modifier' : '', className].filter(Boolean).join(' ')`

## Data Fetching

- Use `useApiClient()` hook — never import API client directly
- Query hooks return full `UseQueryResult` — let consumer destructure
- Mutation hooks invalidate queries on success via `queryClient.invalidateQueries()`
- Always handle all states: loading → error → empty → data

## Form Patterns

- Zod schema in `*.schema.ts` colocated with form component
- Export `FormValues` (input type) and `FormSubmission` (output type)
- Show `FormErrorSummary` only after first submit (`submitCount > 0`)
- Show API errors in `Alert` at top of form (separate from validation)
- Disable submit button during mutation, show loading text
- Toast on success, `form.reset()` after successful mutation
- Add `noValidate` on `<form>` — Zod handles validation, not the browser

## Accessibility

- Semantic HTML first — `<button>`, `<input>`, `<dialog>`, `<table>`, not `<div>` with roles
- Labels on all form controls via `<label htmlFor>` or `aria-label`
- Use `FormField` for automatic `aria-invalid`, `aria-describedby` wiring
- `role="alert"` for errors, `aria-live="polite"` for loading/status
- `aria-hidden="true"` on decorative elements
- Visible focus rings — never remove. Prefer `box-shadow: var(--shadow-focus)` (3 px accent-ring glow, no layout shift) over `outline:` so it can coexist with hover borders.
- Color is never the only signal — always pair with text, icon, or dot (`StatusBadge` enforces this — mono+caps label + tone-tinted dot)

## Testing

- Use `renderWithProviders()` from `test/test-utils.tsx`
- Use `createMockApiClient()` to mock API responses
- Test priorities: happy path → loading → error → empty → form submission → interactions
- Mock API responses, not implementation details
- Test user interactions, not internal state
- Run: `pnpm test`

## UI Style

- Follow `docs/frontend-ui-style-guide.md` for layout, spacing, and component patterns
- The **live design system** lives at `/dev/ui` (hidden admin route). Three tabs: Brandbook (every token), Primitives (kitchen sink), Patterns (composed examples). Use it as the visual source of truth when polishing a feature.
- Use shared UI components from `shared/ui/` — check existing inventory before creating new
- Status-first, dense-but-readable operator cockpit style
- Shopify admin clarity + Linear polish + signal-orange accent (#775) — no glassmorphism, heavy gradients, or glow effects
- Monospace (`.mono-text` or `var(--font-mono)`) for identifiers, payload fields, system references, mono+caps eyebrows. Tabular figures (`font-variant-numeric: tabular-nums` or `.tabular`) on every numeric.

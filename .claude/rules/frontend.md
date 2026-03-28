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

- Components: `PascalCase.tsx`
- Hooks: `use-*.ts`
- Route modules: `*.route.tsx`
- Tests: `*.test.tsx`
- API modules: `*.api.ts`
- Query keys: `*.query-keys.ts`

## Patterns

- API calls go through `shared/api/api-client.ts` — no raw `fetch()` in components
- Query hooks live in `features/{domain}/hooks/use-*-query.ts`
- Mutation hooks live in `features/{domain}/hooks/use-*-mutation.ts`
- Zod schemas live alongside forms in `*.schema.ts`

## Testing

- Unit tests with Vitest + Testing Library
- Mock API responses, not implementation details
- Test user interactions, not internal state
- Run: `pnpm test`

## UI Style

- Follow `docs/frontend-ui-style-guide.md` for layout, spacing, and component patterns
- Use shared UI components from `shared/ui/`
- Status-first, dense-but-readable operator cockpit style

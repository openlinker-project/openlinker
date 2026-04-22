# Frontend Architecture

## Purpose

The frontend is a separate browser application responsible for operator workflows such as:

- connection and adapter management
- OAuth initiation and callback handling
- sync and validation visibility
- future auth-aware admin flows

The frontend must stay thin. Business orchestration, credential handling, webhook security, and integration-specific side effects remain in the API and core layers.

For visual and interaction guidance, see `docs/frontend-ui-style-guide.md`.

## FE-001 Baseline

For the initial foundation, OpenLinker uses:

- React + TypeScript
- Vite for local development and production builds
- React Router for explicit route definitions
- TanStack Query for server-state management
- React Hook Form + Zod for forms and client-side validation
- Vitest + Testing Library for frontend tests

This is intentionally a browser-first admin SPA baseline. The current platform is API-first, the first UI use cases are operational rather than SEO-driven, and the monorepo does not yet contain any frontend runtime.

## App Boundary

The frontend lives in `apps/web` and talks to the API over HTTP. It should not:

- embed secrets in browser code
- duplicate backend validation or authorization rules as a source of truth
- call platform APIs directly from the browser
- implement domain orchestration that belongs in `apps/api` or `libs/core`

## Folder Conventions

The `apps/web/src` folder is organized as:

- `app/`: application shell, providers, router, layouts, and route registration
- `pages/`: route-level page composition
- `features/`: vertical slices with feature-specific API hooks, mutations, and UI
- `shared/`: reusable UI, utilities, config, and cross-feature types
- `test/`: shared frontend test setup and helpers

Conventions:

- Pages compose features and shared UI, but do not perform raw API calls.
- Features own query hooks, mutations, view-model mapping, and feature-local components.
- Shared UI must stay domain-agnostic.
- Types that mirror backend contracts should preserve backend `camelCase` naming.

## Routing Conventions

Routing uses explicit React Router definitions under `src/app/routes`. Avoid file-system routing for FE-001 so the first app stays predictable and easy to refactor inside the monorepo.

Initial route set:

- `/`
- `/connections`
- `/connections/new`
- `/connections/:connectionId`
- `/integrations/allegro/connect/callback`
- `/settings`

Each route should have:

- a route module in `src/app/routes`
- a page component in `src/pages/<domain>`
- feature-level data hooks and UI under `src/features/<domain>`

## API Client Conventions

The frontend consumes the Nest REST API exposed by `apps/api`.

Rules:

- Use a single `createApiClient()` entrypoint configured from environment and session state.
- Split resource access into thin modules such as `connections.api.ts`, `adapters.api.ts`, `allegro.api.ts`, and `sync.api.ts`.
- Normalize HTTP, validation, and network failures into a shared `ApiError`.
- Use TanStack Query for server-state reads and writes.
- Do not call `fetch()` directly from pages or presentational components.

The first version should use hand-written request and response types for the endpoints the UI actually needs. Swagger-based generation can be evaluated later once the contract is stable enough to support it.

Contract strategy:

- start with hand-written feature contracts for early slices
- evaluate generated types once the API surface stabilizes
- do not mix generated and hand-written types for the same endpoint group
- keep transport types close to the API layer and map them to UI-friendly view models inside features when needed

## State Management

OpenLinker should avoid a catch-all frontend store. State must live in the narrowest layer that naturally owns it.

State ownership rules:

- server state: TanStack Query
- URL state: route params and search params
- form state: React Hook Form
- session state: `SessionProvider`
- local UI state: component-local `useState` or `useReducer`

### Server State

Use TanStack Query for all API-backed data:

- connection lists and detail views
- adapter discovery
- sync job status
- validation results
- future user/session profile reads

Rules:

- query hooks live under `features/<domain>/hooks`
- query keys live beside feature API modules
- pages do not call the API directly
- mutations invalidate or update the Query cache
- do not copy Query data into local component state or Context unless there is a very specific reason

### URL State

Use the URL for state that should be linkable, shareable, restorable, or browser-navigation-friendly:

- filters
- sort order
- pagination
- selected tab
- view mode

Examples:

- `/connections?platformType=allegro`
- `/connections?status=active&page=2`

### Form State

Use React Hook Form and Zod for draft and edit flows:

- create connection
- edit connection
- OAuth setup forms
- future settings screens

Rules:

- draft values stay inside the form
- submissions go through feature mutations
- server-side validation remains the source of truth
- server validation errors should be mapped back to fields where practical

### Local UI State

Use local component state for short-lived interaction state:

- modal open or closed
- row expansion
- selected item inside one page
- inline edit mode
- wizard step inside one composed flow

### Global Store Policy

Do not introduce a general-purpose global store for FE-001.

A global client store is only justified when all of the following are true:

- the state is client-owned, not API-owned
- it must be shared across distant branches of the app
- it must survive route transitions
- it does not belong naturally in the URL
- it is not session state and not just form draft state

Until those conditions are met, prefer Query, URL, form state, or local component state instead.

## Auth And Session

The backend does not yet expose a production-ready user session flow, so the frontend must define an abstraction without coupling the app to a premature implementation.

Baseline design:

- `SessionProvider` exposes session state and auth actions to the app
- `SessionAdapter` hides storage and transport details
- `NoopSessionAdapter` is the initial implementation for anonymous or mock mode
- `JwtBearerSessionAdapter` is the planned future implementation once API auth is active

FE-001 must not assume localStorage, cookies, or a BFF. Persistence decisions stay behind the session adapter boundary.

Session scope:

- current auth status
- current user/session data
- session refresh and clear actions
- auth header injection source for the API client

The session layer must not become a general app store.

### Preferred Evolution Path

The preferred future direction is:

1. secure HttpOnly cookie session if the backend supports it cleanly
2. refresh cookie plus in-memory access token if needed
3. browser-stored bearer token only if backend constraints require it

This means FE-001 intentionally preserves the adapter boundary while avoiding an early commitment to localStorage or sessionStorage.

## Environment Variables

Frontend environment variables are public build-time inputs. Only `VITE_*` variables may be consumed by browser code.

Initial variables:

- `VITE_API_BASE_URL`
- `VITE_APP_ENV`

Rules:

- keep secrets and credential references out of frontend env files
- use `apps/web/.env.example` to document required variables
- keep local overrides in `.env.local`
- prefer explicit API base URLs over implicit same-origin coupling for the initial baseline

## Runtime Configuration

Vite environment variables are injected at build time, not runtime.

This has two implications:

- if each environment builds its own artifact, `VITE_*` variables are sufficient
- if one artifact must be promoted across environments, OpenLinker will need a runtime config bootstrap strategy later

Until a deployment model is finalized, keep runtime configuration minimal and explicit. Do not assume same-origin API hosting or hidden runtime mutation of the frontend bundle.

## Components And Pages

Component conventions:

- page components own route composition and layout only
- feature components may depend on feature hooks and feature types
- shared components must not import feature modules
- keep reusable primitives in `shared/ui`
- colocate feature-only components with their feature

Naming conventions:

- components: `kebab-case.tsx` — the named export stays `PascalCase` (e.g. `shared/ui/kpi-card.tsx` exports `KpiCard`). This matches every existing primitive in `apps/web/src/shared/ui/` and `apps/web/src/features/*/components/`. Where a component needs multiple related files (Zod schema, types, test), they share the same kebab-case stem.
- hooks: `use-*.ts`
- route modules: `*.route.tsx`
- tests: `*.test.tsx`

### UI Library Policy

No **styled** external UI library (no shadcn/ui, MUI, Mantine, Chakra, Ant Design). Visual opinions are ours — every pixel is vanilla CSS against the tokens in `apps/web/src/index.css`.

**Headless** libraries are permitted when they contribute only behavior and accessibility — never visuals — and are always wrapped by a project primitive in `shared/ui/`:

| Library | Purpose | Wrapped as |
|---|---|---|
| `@tanstack/react-table` | sorting / filtering / column model for `DataTable` | `shared/ui/data-table.tsx` |
| `@tanstack/react-virtual` | row virtualization for long lists (Jobs & Logs) | used inside `DataTable` |
| `@radix-ui/react-dialog` | focus trap + a11y for modals | `shared/ui/dialog.tsx` |
| `@radix-ui/react-dropdown-menu` | menu keyboard behavior | `shared/ui/dropdown-menu.tsx` |
| `@radix-ui/react-select` | custom-styled select with keyboard/screen-reader parity | `shared/ui/select.tsx` |
| `@radix-ui/react-tabs` | tab keyboard/roving-tabindex semantics | `shared/ui/tabs.tsx` |
| `@radix-ui/react-tooltip` | hover + focus tooltip with delay group | `shared/ui/tooltip.tsx` |
| `@radix-ui/react-popover` | popover positioning + dismissal | `shared/ui/popover.tsx` |
| `@radix-ui/react-toast` | toast queue + swipe-to-dismiss | `shared/ui/toast-provider.tsx` |

Rules:

- A headless library may only be imported from the wrapping primitive in `shared/ui/` — never from a page or feature module directly.
- The wrapper is responsible for all CSS. No library-shipped CSS gets imported.
- When a native HTML element covers the use case (`<dialog>`, `<select>`, `<details>`), prefer it over a Radix wrapper.

See [`docs/ui-audit/library-analysis.md`](./ui-audit/library-analysis.md) for the decision record.

## Dependency Rules

Dependency direction must remain simple and enforceable:

- `app` may import `pages`, `features`, and `shared`
- `pages` may import `features` and `shared`
- `features` may import `shared`
- `shared` must not import `features` or `pages`

These boundaries are enforced by ESLint `no-restricted-imports` rules in `.eslintrc.js` — violations fail `pnpm lint`. Raw `fetch()` calls are also blocked in `shared/`, `features/`, and `pages/` via `no-restricted-globals` to ensure all HTTP calls go through shared API client modules.

> **Note:** Features may import `useApiClient` from `app/api/` — this is the designed dependency-injection boundary for API access. A future refactor may move the hook to `shared/`, but the current crossing is intentional and not restricted by lint.

Additional rules:

- pages compose features but should not contain raw transport logic
- feature modules may define feature-specific types, hooks, and view-model mapping
- shared modules must remain generic enough to be reused across features

## Async UX Conventions

All API-driven screens should implement the same baseline UX states:

- loading state for initial fetch
- empty state when no data exists
- error state with actionable messaging
- success feedback for mutations
- predictable retry behavior

FE-001 defaults:

- Query retries disabled by default unless a feature explicitly justifies retries
- no optimistic updates by default
- mutations should prefer explicit invalidation over clever cache mutation until workflows are well understood
- every list and detail screen should render loading, empty, error, and success-aware states deliberately

## Testing Baseline

The frontend must ship with:

- `lint`
- `type-check`
- `test`

Minimum test coverage for FE-001:

- one app-shell smoke test
- one feature-oriented test around the connections area or API hook behavior

## Relationship To Existing Architecture

This frontend baseline complements, but does not replace, the backend architecture described in `docs/architecture-overview.md`.

- API and core remain the source of truth for domain logic
- the frontend optimizes for operator workflows
- integration secrets, credential resolution, and sync orchestration remain server-side

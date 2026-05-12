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
- `plugins/`: build-time plugin registry — named extension points (routes, nav items, typed API namespaces) iterated by the host. The barrel at `plugins/index.ts` is the **single edit point** an OSS contributor touches to enable a new in-tree plugin. Mirrors the BE `apps/api/src/plugins.ts` shape (#604/#605).
- `shared/`: reusable UI, utilities, config, and cross-feature types
- `test/`: shared frontend test setup and helpers

Conventions:

- Pages compose features and shared UI, but do not perform raw API calls.
- Features own query hooks, mutations, view-model mapping, and feature-local components.
- Shared UI must stay domain-agnostic.
- Types that mirror backend contracts should preserve backend `camelCase` naming.

## Feature Public Surface

Every feature that is consumed by another feature or by a plugin exposes a single public barrel at `features/<name>/index.ts`. Cross-boundary callers import only from the barrel — never from `api/`, `hooks/`, `components/`, `lib/`, or `types/` subpaths inside the feature. Same-feature internals continue to use ordinary relative imports.

The barrel is the seam: anything not re-exported there is private. Adding a new public export is a deliberate edit (one line in the barrel) and shows up in the diff. Removing or renaming an internal file no longer breaks unrelated features.

```ts
// apps/web/src/features/connections/index.ts
export type { Connection, ConnectionStatus, /* … */ } from './api/connections.types';
export { useConnectionsQuery } from './hooks/use-connections-query';
export { ConnectionEntityLabel } from './components/ConnectionEntityLabel';
```

```ts
// ✅ Consumer (another feature or a plugin)
import { useConnectionsQuery, type Connection } from '../../connections';

// ❌ Banned — fails `pnpm lint`
import type { Connection } from '../../connections/api/connections.types';
```

**Enforcement.** Two `no-restricted-imports` patterns in `.eslintrc.js`:
- `apps/web/src/features/**/*.{ts,tsx}` — bans deep cross-feature imports (a feature reaching into another feature's internals).
- `apps/web/src/plugins/**/*.{ts,tsx}` — bans plugin → feature deep imports for the same reason.

The matcher does not support brace expansion, so each `<slug>/<part>` combination is enumerated explicitly, where `<part>` is one of the **canonical feature subdirectories**: `api`, `hooks`, `components`, `lib`, `types`. Same-feature relative imports (`../api/foo`, `../hooks/use-bar`) are unaffected because the import string has no `<slug>` segment.

A feature must keep its public-facing modules inside the canonical subdirectory set. If a new subdirectory (e.g. `schemas/`, `utils/`) is genuinely needed, extend the canonical set in the convention here and in the ESLint patterns at the same time — otherwise the rule will silently fail open for the new subdirectory.

**Adding a new public feature surface.**
1. Create `features/<name>/index.ts` and re-export the minimal set of symbols cross-feature/cross-plugin callers need (start narrow — adding an export later is one line).
2. Add the slug to both `no-restricted-imports` pattern groups in `.eslintrc.js` (the `features/**` rule and the `plugins/**` rule) for every canonical subdirectory.
3. Migrate existing consumers from deep imports to barrel imports.
4. `pages/` and `app/` remain free to deep-import from features for now — migrating those layers is a follow-up.

**Out of scope today.** Pages still deep-import from features (≈128 imports), and `app/api/api-client.ts` deep-imports each feature's `createXApi` factory to compose the host API client. Both are documented gaps — extending the rule to `pages/**` and `app/**` is a follow-up that doesn't change the architectural model, just expands enforcement scope.

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

Page-bearing route modules use React Router's `lazy` field so each page becomes its own bundle chunk (#606):

```ts
export const dashboardRoute: RouteObject = {
  index: true,
  lazy: async () => {
    const { DashboardPage } = await import('../../pages/dashboard/dashboard-page');
    return { Component: DashboardPage };
  },
};
```

Exceptions kept intentionally eager:

- `loginRoute` — first paint for unauthenticated cold visits; a lazy chunk there adds a blank-screen window for the most-common first impression.
- `prompt-templates-legacy-redirects.route.tsx` — inline `<Navigate>` element, no page module to defer.

A parameterized test at `apps/web/src/app/routes/route-lazy.test.ts` asserts the exact lazy-route count; bump `EXPECTED_LAZY_ROUTE_COUNT` when intentionally adding or removing a lazy route.

### Breadcrumb metadata on routes (#610)

Each authenticated route module declares its breadcrumb metadata inline via `route.handle` using the `RouteCrumbHandle` shape from `apps/web/src/app/nav-registry.types.ts`:

```ts
import type { RouteCrumbHandle } from '../nav-registry.types';

export const ordersRoute: RouteObject = {
  path: 'orders',
  children: [
    {
      index: true,
      handle: { crumb: { group: 'Operations', title: 'Orders' } } satisfies RouteCrumbHandle,
      lazy: async () => {
        const { OrdersListPage } = await import('../../pages/orders/orders-list-page');
        return { Component: OrdersListPage };
      },
    },
    // … sibling children with their own handles
  ],
};
```

The shell resolves the active crumb by calling `useMatches()` and walking the match chain deepest-first via `resolveCrumbFromMatches` (in `apps/web/src/app/breadcrumbs.ts`). The first match carrying a crumb-shaped handle wins; if no match in the chain carries one, the shell falls back to `{ group: 'OpenLinker', title: '' }`.

**Rules**:

- Leaf routes (including index children like `dashboardRoute`) own their crumb metadata. Parent shells with no semantic title carry no handle — `useMatches()`'s deepest-first walk picks the right one.
- Guest routes (`loginRoute`, `forgotPasswordRoute`, `resetPasswordRoute`) render outside `AppShell` and have no `handle.crumb`. They are excluded from the route-handle contract test.
- Marketplace-specific breadcrumbs (e.g. `Connect Allegro`, `Connect PrestaShop`) ship with the plugin route module — never with the host shell.
- A parameterized contract test at `apps/web/src/app/routes/route-handle.test.ts` asserts every authenticated leaf route declares a crumb. Same enforcement shape as `route-lazy.test.ts`.

Plugins contribute breadcrumbs the same way: a plugin route module's `RouteObject` carries its own `handle.crumb`. See [Platform Plugins](#platform-plugins-plugins) for the build-time `WebPlugin` route contribution shape and the optional `requiresRole` gate available on `NavContribution`.

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

## Design tokens (`shared/theme/tokens.ts`)

The frontend ships a typed catalog of every public design token at `apps/web/src/shared/theme/tokens.ts` (#611). The catalog is the contract plugin authors and host code bind against for TS-side discovery and typed inline styles.

```ts
// apps/web/src/shared/theme/tokens.ts
export const tokens = {
  'bg-canvas': 'var(--bg-canvas)',
  'bg-shell': 'var(--bg-shell)',
  // ... ~85 entries
} as const satisfies Record<string, `var(--${string})`>;

export type TokenName = keyof typeof tokens;
```

**Consumption model**: component CSS keeps writing `var(--name)` directly against `apps/web/src/index.css`. `tokens.ts` does NOT replace that path and isn't loaded by the runtime CSS engine — it's for:

- Plugin authors who need a typed list of supported token names.
- Inline styles in TS (`style={{ background: tokens['bg-canvas'] }}` — rare but valid).
- Discoverability via autocomplete + go-to-definition.

**Drift guarantee**: `scripts/check-design-tokens.mjs` runs under `pnpm lint` (chained into `check:invariants`). It asserts every token in `tokens.ts` is declared in `index.css` — adding a catalog entry without a corresponding CSS declaration fails the build. The check is one-directional in v1 (catalog → CSS); orphaned `--*` declarations in CSS that aren't in the catalog are tolerated as potentially internal-only.

**Adding a token**: declare it in `index.css` first, then add an entry to `tokens.ts` matching the name verbatim, then re-run `pnpm lint` to confirm the drift check passes. **Removing a token**: drop both sides in the same PR.

## Shared UI catalog (`shared/ui/index.ts`)

The frontend's public component catalog lives at `apps/web/src/shared/ui/index.ts` (#611). Anything re-exported there is part of the contract plugin authors and host code can compose against. Anything not in the catalog is internal — renaming, moving, or deleting it shouldn't break consumers.

**v1 scope** is narrow (~25 primitives covering the cockpit vocabulary documented in `docs/frontend-ui-style-guide.md` § Core Component Patterns). Adding a primitive is a one-line edit — keep the list scannable and add only what real consumers need.

Components that wrap headless libraries (Radix, TanStack) sit on the same footing as native-HTML wrappers — the wrapper is the public surface, the underlying library is an implementation detail.

## Internationalization (i18n)

The frontend ships a **no-op i18n seam** at `apps/web/src/shared/i18n/` (#612). The seam is the contract plugin authors bind against and the migration target for future per-feature string-migration PRs.

**Public surface**:

- `LocaleProvider` — mounted at the app root between `ThemeProvider` and `PluginRegistryProvider`. Defaults to `locale='en'` with an empty catalog.
- `useTranslation()` — returns `{ t, locale }`. `t(key, fallback)` returns the catalog hit or the fallback. With the host's empty catalog, every call returns its `fallback` argument today.
- `useNumberFormat(options?)` — memoised `Intl.NumberFormat` for the current locale. Replaces module-scope `new Intl.NumberFormat('en-US')` instantiations so number formatting follows locale, not en-US-pinned.
- `LocaleCode`, `TranslationCatalog`, `LocaleContextValue` — types.

**v1 scope** — explicitly **does NOT** migrate any existing English strings to `t()`. Every label, breadcrumb, button, and toast remains an inline string. The only host-side consumer is `useNumberFormat()` in `app-shell.tsx`. String migration is a per-feature follow-up issue per feature; each migration PR moves a single feature's strings to `t(key, fallback)` and ships an `en` catalog entry per key.

**Plugin authors**: ship message catalogs by wrapping (or, in the future, contributing to) the host `LocaleProvider`. Until the loader contract for plugin catalogs is finalised, plugin-local strings continue to use inline literals with `t(key, fallback)` so the fallback path keeps the UI usable.

**Out of scope (deferred)**:

- `setLocale` / `useLocale` / locale switcher UI — added together with the first localisation PR.
- Persistence of locale choice (localStorage / session / API).
- A pluggable catalog loader for plugin-shipped translations.
- Pluralization helpers (`tn(key, count, fallback)`), interpolation, date / currency formatting helpers beyond `useNumberFormat`.

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

- `app` may import `pages`, `features`, `plugins`, and `shared`
- `pages` may import `features` and `shared`
- `plugins` may import `pages`, `features`, `shared`, and type-only from `app/api/api-client` and `app/app-shell` (the public type seam — see [Plugins](#platform-plugins-plugins) for both the build-time `WebPlugin` and runtime `PlatformPlugin` contracts). Plugins must not import host internals — router, routes, layouts, hooks, providers, the API client provider hook.
- `features` may import `shared`
- `shared` must not import `features`, `pages`, or `plugins` — with one narrow exemption documented below

These boundaries are enforced by ESLint `no-restricted-imports` rules in `.eslintrc.js` — violations fail `pnpm lint`. Cross-feature and plugin → feature imports must additionally target the feature's public barrel — see [Feature Public Surface](#feature-public-surface) (#609). Raw `fetch()` calls are also blocked in `shared/`, `features/`, `pages/`, and `plugins/` via `no-restricted-globals` to ensure all HTTP calls go through shared API client modules.

> **Note:** Features may import `useApiClient` from `app/api/` — this is the designed dependency-injection boundary for API access. A future refactor may move the hook to `shared/`, but the current crossing is intentional and not restricted by lint.
>
> **Note (#608):** Features may also import `useOfferCreationWizard` from `app/plugin-bindings/` — same DI-boundary precedent. Features must NOT import `plugins/` directly; per-platform extension points go through the `app/`-tier hook that closes over the registry. The folder is named `plugin-bindings` (not `plugins`) so the `**/plugins/**` lint deny-glob can stay broad without carve-out exceptions.

> **Exemption — `shared/plugins/` (#578/#579):** The FE plugin contract in `shared/plugins/plugin.types.ts` is a feature-aware surface by design — plugins receive `Connection` and `UseFormReturn<EditConnectionFormValues>` shapes from the connections feature. To keep the contract fully typed without hoisting feature-private types into `shared/`, the ESLint rule allows `shared/plugins/**` to type-import `Connection` and `EditConnectionFormValues` (and nothing else) from `features/connections/`. Hoisting the types into a `shared/types/` boundary is the cleaner long-term move; it's deferred until a second consumer needs them.

Additional rules:

- pages compose features but should not contain raw transport logic
- feature modules may define feature-specific types, hooks, and view-model mapping
- shared modules must remain generic enough to be reused across features

## Platform Plugins (`plugins/`)

The in-tree plugins live in `apps/web/src/plugins/<name>/`. Two parallel concerns are surfaced from the same barrel (`plugins/index.ts`):

1. **Build-time `WebPlugin`** (#604/#605) — host composition: routes, nav contributions, typed API client namespaces. Authored via `definePlugin({...})`; collected as the exported `plugins: WebPlugin[]` array. Iterated by the router and `createApiClient` at boot. Both runtime composition AND TS declaration-merging require the plugin to be in this array.
2. **Runtime `PlatformPlugin`** (#578/#579) — per-platform UI affordances: setup card, callback-URL default, structured edit-form sections, extra sections, credentials panel, connection actions. Collected as the exported `IN_TREE_PLUGINS: readonly PlatformPlugin[]` array. Resolved at render time via `usePlugin(platformType)` / `usePlugins()` from `shared/plugins/`.

The two contracts live side-by-side because they answer different questions ("what does this plugin contribute to the app shell?" vs "what platform-specific UI does this connection's platformType expose?"). A single per-platform directory typically contributes both: `plugins/allegro/index.ts` exports an `allegroPlugin: WebPlugin`; `plugins/allegro/allegro.plugin.tsx` exports an `allegroPlatformPlugin: PlatformPlugin`.

`WebPlugin.navItems` accepts an optional `requiresRole?: Role` (today: `'admin'`) — admin-only contributions are filtered out for non-admin sessions, mirroring the declarative gate the in-tree `AI` group uses on `BASE_NAV_GROUPS` (#610). Authorization is still enforced backend-side; the gate only hides the nav affordance. Plugin route modules contribute breadcrumb metadata the same way host routes do — via `handle: { crumb: { group, title } } satisfies RouteCrumbHandle`. See [Breadcrumb metadata on routes](#breadcrumb-metadata-on-routes-610).

Adding a new in-tree platform is a single edit point: drop a new directory under `plugins/` and append entries to both arrays in `plugins/index.ts`.

Literal-equality dispatch on `platformType` (`connection.platformType === 'allegro'`) is forbidden outside `plugins/<platformType>/` — use `usePlugin()`, `usePlugins()`, or capability checks (`supportedCapabilities.includes('OfferManager')`) instead. The ESLint rule `no-restricted-syntax` enforces this.

### PlatformPlugin slot reference

Every slot is optional. A plugin contributes only the affordances its platform actually needs; the consuming surface falls back to a generic rendering (or hides the affordance entirely) when the slot is absent.

| Slot | Type | Consumed by | Purpose |
|---|---|---|---|
| `platformType` | `string` | registry lookup | Stable key — matches `connection.platformType`. Required. |
| `displayName` | `string` | dropdowns, alerts | Human-readable label. Required. |
| `setupCard` | `PlatformSetupCard` | `PlatformPicker` (`features/connections`) | One card on `/connections/new`. Omit for advanced-only platforms. |
| `requiresExternalAuthRedirect` | `boolean` | `CreateConnectionForm` | When true, the inline create form swaps in an Alert linking to the guided wizard (today: Allegro OAuth). Named broadly so non-OAuth redirect flows can opt in. |
| `getCallbackUrlDefault` | `() => string \| undefined` | `EditConnectionForm` | Default for the OL callback URL field when the connection has none stored. PrestaShop uses `window.location.origin`. |
| `StructuredConfigSection` | `ComponentType<StructuredConfigSectionProps>` | `EditConnectionForm` | Platform-specific structured-config inputs (PS: shop URL / storefront / shop ID / OL callback / fallback carrier). When absent, the form falls back to raw JSON. |
| `ExtraConfigSection` | `ComponentType<ExtraConfigSectionProps>` | `EditConnectionForm` | Extra section below the structured/raw block (Allegro: GPSR seller defaults). |
| `CredentialsPanel` | `ComponentType<{ connection }>` | `EditConnectionForm` | Full credentials panel including the rotate-key UI shape that fits the platform's credential model. When absent, the form renders a read-only "Stored securely (managed by integration)" / "Environment variable" affordance. |
| `ConnectionActions` | `ComponentType<{ connection }>` | `ConnectionActionsPanel` | Extra platform-specific actions on the connection-detail page (PS: "Configure webhooks"). |
| `supportsListingEdit` | `boolean` | `ListingDetailPage` | Gates the "Edit offer" button on the listing-detail page. |

Module-load validation in `apps/web/src/plugins/index.ts` rejects duplicate `platformType` keys before any provider mounts. `PluginRegistryProvider` re-runs the same check at mount time as belt-and-suspenders for test fixtures.

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

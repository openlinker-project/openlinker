# Implementation Plan — FE plugin-aware navigation & breadcrumbs (#610)

## Goal

Close H7 / FE-8 of Modularity Thread H. Move the FE shell's nav-group definitions out of a hardcoded `buildNavGroups()` function and breadcrumb metadata out of the central `staticCrumbs` table, so plugins can contribute nav items + breadcrumbs without editing core chrome. Remove the marketplace-specific entries (`/connections/new/allegro`, `/connections/new/prestashop`) that currently leak into `app-shell.tsx`.

## Layer

**Frontend / DX-shaped.** No API, no data, no domain changes. Two narrow surface changes inside `apps/web/src/app/`.

## Non-goals

- **Dynamic breadcrumb titles** (e.g., showing the actual order ID in `/orders/:id`). Today's crumbs use static "Order" fallback labels — preserved exactly. Dynamic titles would require Query state inside the shell; out of scope.
- **React Router data-router migration** (`createBrowserRouter` etc.). Existing `RouteObject` shape is kept.
- **NavLink / `react-router` replacement.** Same library, same primitives.
- **i18n of nav labels** — tracked separately by #612.
- **Plugin migration to contribute nav items.** None of the in-tree plugins use `navItems` today; introducing usage is a separate concern. This PR opens the seam; consumers can adopt it later.

## Research summary

### What exists today

- `apps/web/src/app/app-shell.tsx:76-134` — `buildNavGroups({ isAdmin })`: hardcoded array of 3-5 groups (Operations, Diagnostics, Platform, optional AI, Planned).
- `app-shell.tsx:136-156` — `staticCrumbs: Record<string, { group, title }>`: 19 exact-path entries, including marketplace-specific `/connections/new/allegro` and `/connections/new/prestashop`.
- `app-shell.tsx:158-172` — `resolveCrumbs(pathname)`: prefix-match fallback for parameterized routes (`/orders/`, `/products/`, …).
- `apps/web/src/plugins/plugin.types.ts:108` — `WebPlugin.navItems?: NavContribution[]` already declared.
- `apps/web/src/plugins/merge-nav-contributions.ts` — pure helper merging contributions by `groupLabel`. Has unit tests.
- No plugin currently uses `navItems`; the contribution surface is wired but unused.
- 27 route modules under `apps/web/src/app/routes/`; 3 plugin route modules (`plugins/allegro/{allegro-callback,allegro-setup}.route.tsx`, `plugins/prestashop/prestashop-setup.route.tsx`).
- No existing `useMatches()` usage or `route.handle` declarations in the codebase.
- `apps/web/src/app/routes/route-lazy.test.ts` parameterizes over every registered route + asserts `lazy` resolves to a `Component`. Useful pattern to mirror for breadcrumb coverage.
- **Router shape verified**: `apps/web/src/app/router.tsx` exports `appRouter = createBrowserRouter([...guestRoutes, rootRoute])`, mounted via `<RouterProvider>` in `app.tsx`. The Data Router is in use, so `useMatches()` resolves matches with `handle` exposed on each entry as documented. The route-colocated breadcrumb approach is valid for this codebase.

### React Router primitives we'll lean on

- `RouteObject.handle` — opaque arbitrary metadata; React Router doesn't interpret it but exposes it via `useMatches()`. Standard pattern for route-colocated breadcrumb metadata (documented in React Router docs).
- `useMatches()` — returns the matched route chain top-to-bottom; each entry exposes `handle`.

## Design

### Piece 1 — Move base nav groups to a registry

Two new modules under `apps/web/src/app/`:

- `nav-registry.types.ts` — `NavRegistryGroup`, `NavRegistryItem`, `RouteCrumbHandle`, `LiveNavGroup`, `PlannedNavGroup`, `NavGroup`, `LiveNavItem`, `PlannedNavItem`, the `RoleValues` runtime array + `Role` union, and the `isCrumbHandle` type guard.
- `nav-registry.ts` — the `BASE_NAV_GROUPS` data and the `buildNavGroups({ isAdmin })` helper.

```ts
// nav-registry.types.ts
export const RoleValues = ['admin'] as const;
export type Role = (typeof RoleValues)[number];

export interface NavRegistryGroup {
  label: string;             // canonical group name; plugin `groupLabel` matches against this
  kind: 'live' | 'planned';
  items: NavRegistryItem[];
  requiresRole?: Role;       // declarative gate; today only AI uses it
}
// LiveNavGroup / PlannedNavGroup / NavGroup move here verbatim from app-shell.tsx.
```

```ts
// nav-registry.ts
import { BASE_NAV_GROUPS_DATA, type NavRegistryGroup } from './nav-registry.types';

export const BASE_NAV_GROUPS: readonly NavRegistryGroup[] = [
  { label: 'Operations', kind: 'live', items: [...] },
  { label: 'Diagnostics', kind: 'live', items: [...] },
  { label: 'Platform', kind: 'live', items: [...] },
  { label: 'AI', kind: 'live', requiresRole: 'admin', items: [...] },
  { label: 'Planned', kind: 'planned', items: [...] },
];
```

`buildNavGroups({ isAdmin })` (also in `nav-registry.ts`) reduces to a small pure helper that:
1. Filters `BASE_NAV_GROUPS` by `requiresRole` against the session role.
2. Hands the survivors to `mergePluginNavContributions()` (unchanged).

The shell calls the helper with the resolved role; otherwise the call site stays the same. The `NavGroup` types in `app-shell.tsx` are re-exported from there for backward compatibility (e.g., `merge-nav-contributions.ts` already imports them by name) — the canonical home is now `nav-registry.types.ts`.

`NavContribution` (in `plugin.types.ts`) optionally grows `requiresRole?: Role` — same declarative gate for plugin items. Pure additive; no consumer needs to set it.

### Piece 2 — Route-colocated breadcrumbs

New type in `nav-registry.ts`:

```ts
export interface RouteCrumbHandle {
  crumb: { group: string; title: string };
}
```

Each route module gains a `handle` field. Examples:

```ts
// app/routes/orders.route.tsx — outer
export const ordersRoute: RouteObject = {
  path: 'orders',
  handle: { crumb: { group: 'Operations', title: 'Orders' } } satisfies RouteCrumbHandle,
  children: [
    // index → orders list, inherits parent crumb
    { index: true, lazy: ... },
    // failed → distinct title
    { path: 'failed', handle: { crumb: { group: 'Operations', title: 'Failed orders' } }, lazy: ... },
    // detail → static "Order" fallback today; same here
    { path: ':internalOrderId', handle: { crumb: { group: 'Operations', title: 'Order' } }, lazy: ... },
  ],
};
```

Shell-side resolver (new helper in `app/breadcrumbs.ts`):

```ts
export function resolveCrumbFromMatches(
  matches: ReturnType<typeof useMatches>,
): { group: string; title: string } {
  // Walk deepest-first; first match carrying `handle.crumb` wins.
  for (let i = matches.length - 1; i >= 0; i--) {
    const handle = matches[i].handle;
    if (isCrumbHandle(handle)) return handle.crumb;
  }
  return { group: 'OpenLinker', title: '' };
}
```

`AppShell` replaces `resolveCrumbs(location.pathname)` with `resolveCrumbFromMatches(useMatches())`. `staticCrumbs` and the old `resolveCrumbs` are deleted.

The marketplace-specific entries leave core: `plugins/allegro/allegro-setup.route.tsx` gains `handle: { crumb: { group: 'Platform', title: 'Connect Allegro' } }`; same for PrestaShop. The marketplace breadcrumb data ships with the plugin.

### Why this shape

- **Same composition model in both halves** — base groups are data; plugins add data; merger is pure. Breadcrumb metadata is data colocated with each route; resolver is pure.
- **Open at the seam, closed at the trunk** — the `requiresRole` gate and the contribution merger are open to additions; the core nav-registry array and crumb resolver are small and don't grow when a new plugin lands.
- **No new state, no new context** — everything is static-at-import-time + one `useMatches()` call.
- **Mechanical migration** — 30 route files gain a `handle` field; no behavior change in any other code path.

## Implementation steps

### Step 1 — Add `nav-registry.types.ts` + `nav-registry.ts`
- `apps/web/src/app/nav-registry.types.ts` — exports `NavRegistryGroup`, `NavRegistryItem`, `RouteCrumbHandle`, `LiveNavGroup`, `PlannedNavGroup`, `NavGroup`, `LiveNavItem`, `PlannedNavItem`, `RoleValues` runtime array + `Role` union, and the `isCrumbHandle` type guard. The `NavGroup` types move out of `app-shell.tsx`; the shell keeps a back-compat re-export so existing imports (`merge-nav-contributions.ts`) don't change.
- `apps/web/src/app/nav-registry.ts` — exports `BASE_NAV_GROUPS` (data) and `buildNavGroups({ isAdmin })` (helper that filters by role + applies plugin contributions).

### Step 2 — Extend `NavContribution` with optional `requiresRole`
- `apps/web/src/plugins/plugin.types.ts:24-46` — add `requiresRole?: Role` to `NavContribution` (imported from `nav-registry.types`).
- `merge-nav-contributions.ts` — drop contributions whose `requiresRole` doesn't match (new optional `isAdmin` arg, defaults to `false`).
- Extend `merge-nav-contributions.test.ts` to cover the gate.

### Step 3 — Use the registry from `app-shell.tsx`
- Update `app-shell.tsx`: import `buildNavGroups` from `./nav-registry`; delete the inline `buildNavGroups` and its types. The `useMemo` dependency stays `[isAdmin]`.

### Step 4 — Add `route.handle.crumb` to every authenticated route module
- 27 host route modules under `apps/web/src/app/routes/` covered by `coreChildren` (every file except `route-lazy.test.ts` and the guest routes — see below).
- 3 plugin route modules (`allegro-callback`, `allegro-setup`, `prestashop-setup`).
- Each gets `handle: { crumb: { group, title } } satisfies RouteCrumbHandle` matching today's `staticCrumbs` + `resolveCrumbs` output.
- **Index-route rule**: leaf routes (including index children like `dashboardRoute`) own crumb metadata. Parent shells with no semantic title (e.g. `rootRoute` itself) carry no handle; `useMatches()`'s deepest-with-handle resolution picks the right one.
- **Guest routes are excluded**: `loginRoute`, `forgotPasswordRoute`, `resetPasswordRoute` render outside `AuthenticatedAppLayout` / `AppShell`, so `useMatches()` inside the shell never sees them. They get no `handle.crumb` and are NOT parametrized in the contract test.

### Step 5 — Replace shell crumb resolution
- New `apps/web/src/app/breadcrumbs.ts` exports `resolveCrumbFromMatches(matches)`. The `isCrumbHandle` guard lives alongside the types in `nav-registry.types.ts` and is re-imported here.
- `app-shell.tsx` swaps `resolveCrumbs(location.pathname)` → `resolveCrumbFromMatches(useMatches())`. Delete `staticCrumbs` + the inline `resolveCrumbs`.

### Step 6 — Tests
- `apps/web/src/app/breadcrumbs.test.ts` — table-driven: feed fake `useMatches()` results and assert resolved crumb. Cover: deepest match wins, no handle → fallback, plain string handle ignored.
- `apps/web/src/app/routes/route-handle.test.ts` — parametrized over `coreChildren` + plugin routes (NOT guest routes), asserts every leaf carries a `handle.crumb` shape. Same pattern as `route-lazy.test.ts`.

### Step 7 — Documentation
- Append a short subsection to `docs/frontend-architecture.md` under § Routing Conventions noting `route.handle.crumb` is the convention.
- Cross-link from § Platform Plugins so plugin authors discover `requiresRole` and the nav/crumb contribution shape from one place.
- Note: AI features (`/ai/prompt-templates`, `/ai/provider-settings`) stay in `BASE_NAV_GROUPS` with `requiresRole: 'admin'` because they're in-tree core features (`libs/core/ai`), not a plugin. If AI ever moves to its own plugin package, the AI group becomes a plugin nav contribution.

## Validation

- **Architecture** — all new modules live in `app/` (the layer that owns chrome). Plugins-side change is one optional field on an existing contribution type.
- **Naming** — kebab-case files, PascalCase types, `*.test.ts` colocated.
- **Types** — no `any`; `unknown` only where `useMatches()` exposes `handle` as `unknown`, narrowed via the `isCrumbHandle` guard.
- **Testing** — pure helpers under unit tests; route-handle contract test mirrors the existing `route-lazy` pattern.
- **Security** — declarative `requiresRole: 'admin'` mirrors the existing imperative `if (isAdmin)` gate; same trust boundary (UI hide, NOT authorization). Backend `@Roles('admin')` continues to gate the endpoints — unchanged.

## Risks & open questions

- **Index-route crumbs**: the dashboard is `{ index: true, lazy: ... }` inside `dashboardRoute`. The handle must live on the index child to surface the "Dashboard" title (otherwise the parent's handle dominates). Handled at Step 4.
- **Plugin contribution test fixture for `requiresRole`**: existing `merge-nav-contributions.test.ts` doesn't cover the new gate — add cases.
- **Breadcrumb regression coverage**: today's behavior is asserted only by manual visual checking. Adding `route-handle.test.ts` makes the contract explicit before the migration.

## Out-of-scope follow-ups

- **Dynamic crumb titles** (e.g., `Order #ol_order_abc`). Would require route loaders or a Query-driven shell. Distinct surface from this PR.
- **i18n of nav/crumb labels** — covered by #612.
- **Plugins contributing actual nav items in-tree** — Allegro/PrestaShop don't have user-facing routes inside the operator nav today. When that lands, it uses the now-fully-plugin-aware surface.
- **Static-discovery of plugin nav** — today's registry is imperative; #575 tracks moving toward static discovery. Independent.

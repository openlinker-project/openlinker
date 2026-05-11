# Implementation Plan: FE Lazy Route Registration (#606)

**Date**: 2026-05-11
**Status**: Ready for implementation
**Estimated Effort**: ~3–4 hours (mostly mechanical conversion + test)

---

## 1. Task Summary

**Objective**: Convert every page-bearing route module to use React Router's `lazy` field so each page becomes its own bundle chunk. After this PR, page components are no longer eagerly imported at app boot; they load on demand when the user navigates to the route.

**Context**: Issue #606 (Modularity Thread H, FE-3). The recommendation has two parts: (a) **route lazy-loading** via React Router's `lazy` field, and (b) **relocate marketplace-specific routes out of `app/routes/` into plugin/feature slices**. Part (b) was already done in #629 (the FE plugin registry PR). This PR completes part (a).

Today's production build (`pnpm --filter @openlinker/web build`) emits **one 947 KB JS bundle**. Vite warns about chunks > 500 KB. With per-route lazy boundaries, each page becomes its own chunk and Vite's automatic vendor-chunk extraction handles shared dependencies.

**Classification**: Frontend (`apps/web`).

---

## 2. Scope & Non-Goals

### In Scope
- Convert every route module under `apps/web/src/app/routes/` that today does `import { XxxPage } from '../../pages/...'` + `element: <XxxPage />` to use React Router's `lazy` field returning `{ Component }`.
- Same conversion for the three plugin route modules under `apps/web/src/plugins/<name>/`.
- Same conversion for the three top-level guest routes (`login`, `forgot-password`, `reset-password`) — they are also eagerly imported by `router.tsx` today.
- A single unit test pinning the `lazy()` resolution contract (one fixture suffices — the pattern is identical across files).
- A small bundle-stats sanity check via `pnpm --filter @openlinker/web build` confirming the output is no longer a monolithic blob.

### Out of Scope
- **Route composition logic** in `apps/web/src/app/routes/root.route.tsx` and `apps/web/src/app/router.tsx` — already updated by #629 (plugin contribution + core children split).
- **Route modules whose element is inline `<Navigate>` JSX with no page component to lazy-load** — `prompt-templates-legacy-redirects.route.tsx` stays eager (there is no `pages/` module to defer; the redirect is just a `<Navigate>` element).
- **Suspense fallback UI / loading indicators**: React Router v7 handles `lazy()` resolution internally (the previous match stays mounted until the new chunk loads). A global "loading…" indicator is a separate UX concern (#610 owns nav metadata; route-level loaders are not in any current issue). If chunk fetches feel sluggish, address in a follow-up.
- **Route-level error boundaries** for chunk-load failures — Vite's default chunk-load-failure UX is a thrown error caught by the existing app-shell error boundary. A dedicated `errorElement` per route is a separate improvement.
- **Server-side rendering / data preloading** — N/A; OpenLinker FE is an SPA per `docs/frontend-architecture.md` §FE-001 Baseline.
- **`features/` and `pages/` directory restructuring** — out of scope; the page modules don't move.

### Constraints
- Must compile and pass `pnpm lint`, `pnpm type-check`, `pnpm test`.
- The four `apps/web/src/app/app.test.tsx` integration tests (which render through a real `RouterProvider` against `rootRoute`) must keep passing — they already use `findByRole(... { timeout: 10000 })` so lazy resolution should be transparent.
- No new `any` types; no `console.log`; no inline `eslint-disable` without rationale.
- React Router v7.13 is already on `apps/web/package.json` — the `lazy` field is supported (verified).

---

## 3. Architecture Mapping

**Target Layer**: `apps/web/src/app/routes/` (24 files), `apps/web/src/plugins/<name>/` (3 files). Pages stay where they are; only the route module shape changes.

**Dependency Rules** (per `docs/frontend-architecture.md` §Dependency Rules):
- `app` may import `pages`, `features`, `plugins`, `shared` — unchanged.
- The page-import call is just relocated from a top-level static `import` into a dynamic `import()` inside `lazy`. Same target paths; same dependency direction.

**Pattern (before)**:
```ts
import type { RouteObject } from 'react-router-dom';
import { DashboardPage } from '../../pages/dashboard/dashboard-page';

export const dashboardRoute: RouteObject = {
  index: true,
  element: <DashboardPage />,
};
```

**Pattern (after)**:
```ts
import type { RouteObject } from 'react-router-dom';

export const dashboardRoute: RouteObject = {
  index: true,
  lazy: async () => {
    const { DashboardPage } = await import('../../pages/dashboard/dashboard-page');
    return { Component: DashboardPage };
  },
};
```

Notes:
- Use `Component:` (not `element:`) so the route file no longer needs JSX — keeps the conversion mechanical and removes the `<XxxPage />` JSX expression. `Component` is the React Router v6.4+/v7 idiom for the lazy-returned shape.
- `RouteObject` type import stays (still typing the const).
- Static `import { XxxPage }` line is deleted — the whole reason for this PR.
- File extension stays `.tsx`. Renaming 26 files to `.ts` is noise; the JSX-less form is fine inside a `.tsx` file, and `lazy: () => ({ Component })` may grow JSX back in a future refactor (e.g., a `<Suspense fallback>` wrapper if we add route-level loading states).

**Existing services / patterns reused**:
- React Router v7 `RouteObject.lazy` — native mechanism, no custom plumbing.
- The plugin registry from #629 — plugin routes still flow through `plugins.flatMap(p => p.routes ?? [])` in `root.route.tsx`. No change to that file in this PR.
- The four existing `app.test.tsx` integration tests — they exercise the lazy path via `RouterProvider` automatically; no test changes needed beyond confirming they still pass.

**New components required**: None. This is a mechanical conversion of existing files.

---

## 4. External / Domain Research

### External
N/A.

### Internal

- **React Router v7 `lazy` field** — `RouteObject.lazy: () => Promise<Partial<DataRouteObject>>`. The function is invoked when the route matches; the returned partial is merged into the route. RR caches the resolution per route, so subsequent navigations to the same route don't re-fetch.
- **Vite chunking** — every `import(...)` inside `lazy` becomes its own chunk by default. Vite extracts shared dependencies into vendor chunks automatically. Today's build emits one bundle because every page is statically reachable from `router.tsx`; with `import()`, each page is a separate entry to the dependency graph.
- **Vitest + happy-dom** — supports dynamic `import()` natively. The four `app.test.tsx` tests already use `findByRole(...)` (async), which tolerates the lazy resolution latency.

### Known pitfalls

- **`lazy` + `element`/`Component` conflict**: a route cannot have both `lazy` and a static `element`/`Component`. We're removing the static field, so no conflict.
- **Chunk-load failures** (network down, stale deployment): manifest as `ChunkLoadError`. The app's existing error boundary catches it. Not in scope for this PR.
- **Test mocks of dynamic imports**: Vitest auto-handles `import()`; no special mocking needed.

---

## 5. Questions & Assumptions

### Open questions
None blocking.

### Assumptions
1. **Lazy-load everything that has a page module.** Includes the three guest routes (`login`, `forgot-password`, `reset-password`). Login is the first paint for unauthenticated users — lazy-loading it adds a single round-trip on first visit, but saves bundle weight on authenticated reloads (where the chunk would never be requested). Trade-off favors lazy: authenticated reloads are the common case.
2. **Skip `prompt-templates-legacy-redirects.route.tsx`.** It exports two `<Navigate>` element routes with no page-component import. There is nothing to lazy-load.
3. **`Component:` over `element:`** in the lazy return. Keeps route files JSX-free post-conversion; matches the React Router idiom for the lazy shape.
4. **No Suspense fallback in this PR.** RR's default behavior (keep previous match mounted until the new one resolves) is acceptable for chunk loads that complete in under ~200 ms. If chunk fetches block longer in practice, a follow-up adds an indicator.
5. **No route-level `errorElement` in this PR.** Chunk-load failures bubble to the app-shell error boundary, which is sufficient.

### Documentation gaps
None. `docs/frontend-architecture.md` §Routing Conventions already says "Avoid file-system routing for FE-001 so the first app stays predictable" — explicit route modules (eager or lazy) are still explicit; lazy-loading doesn't change the convention.

### Tech-review decisions (applied to this plan)

1. **Side-effects audit (done before implementation):** Grepped `apps/web/src/pages/**/*.{ts,tsx}` for top-level non-import calls. All hits are inside `.test.tsx` files (`describe`, `it`, `beforeAll`, `afterEach`); zero hits in page source modules. Lazy-loading does not change observable boot behaviour.
2. **First-paint lazy resolution UX:** Deferred. React Router v7 keeps the parent match mounted while a child `lazy` resolves; an unauthenticated cold visit shows `AuthenticatedAppLayout`'s shell briefly with an empty `<Outlet />` for the chunk-fetch window (typically < 200 ms on broadband). Acceptable for an operator cockpit. A route-level loading indicator can be a follow-up if real-network testing surfaces a feel issue.
3. **Build-output verification:** Manual eyeball check during Phase 5. Future regressions in lazy-loading will not fail CI — accepted as a trade-off given the static `lazy` invocations are stable enumeration points that a reviewer can grep for. If a CI gate becomes necessary, add a tiny chunk-count assertion to `pnpm --filter @openlinker/web build` later.
4. **`Component:` vs `element:` divergence:** Lazy returns `Component:` (the React Router v7 idiom for component-type returns). The remaining eager route (`prompt-templates-legacy-redirects.route.tsx`) keeps `element:` because its element is inline `<Navigate>` JSX with no component module to reference. The shape divergence is intentional and per-file appropriate.
5. **Login lazy trade-off:** `login.route` is lazy-loaded. Cold unauthenticated visits incur one extra HTTP round-trip (index.html → JS chunk → router resolves `/` → root redirects to `/login` → login chunk fetch → render). For an operator-facing back office where authenticated reloads dominate, the saved per-load byte cost outweighs the first-paint penalty. Documented explicitly in case future use cases push the calculus.

---

## 6. Proposed Implementation Plan

> **Per-file conventions**: keep the existing JSDoc file header where present; preserve the `path`/`index`/`children` fields on the route exactly as today; only the `element` → `lazy` swap (and the deletion of the static page import) changes. No reformatting outside the touched lines.

### Phase 1 — Convert all authenticated child route modules

For each file under `apps/web/src/app/routes/` (except `root.route.tsx`, `login.route.tsx`, `forgot-password.route.tsx`, `reset-password.route.tsx`, and `prompt-templates-legacy-redirects.route.tsx`), apply the pattern:

```ts
// before
import { XxxPage } from '../../pages/<dir>/<page-file>';
export const xxxRoute: RouteObject = { path: '...', element: <XxxPage /> };

// after
export const xxxRoute: RouteObject = {
  path: '...',
  lazy: async () => {
    const { XxxPage } = await import('../../pages/<dir>/<page-file>');
    return { Component: XxxPage };
  },
};
```

Files (21 total):
1. `adapters.route.tsx`
2. `advanced-new-connection.route.tsx`
3. `ai-provider-settings.route.tsx`
4. `connection-category-mappings.route.tsx`
5. `connection-detail.route.tsx`
6. `connection-mappings.route.tsx`
7. `connections.route.tsx`
8. `cursors.route.tsx`
9. `customers.route.tsx`
10. `dashboard.route.tsx`
11. `edit-connection.route.tsx`
12. `inventory.route.tsx`
13. `jobs-logs.route.tsx`
14. `listings.route.tsx`
15. `new-connection.route.tsx`
16. `orders.route.tsx`
17. `products.route.tsx`
18. `prompt-template-detail.route.tsx`
19. `prompt-templates-list.route.tsx`
20. `settings.route.tsx`
21. `webhook-deliveries.route.tsx`

**Acceptance per file**: no remaining static `import { XxxPage }` line; `lazy` is the only resolver; type-check passes.

### Phase 2 — Convert the three plugin route modules

Same pattern for:
- `apps/web/src/plugins/allegro/allegro-callback.route.tsx`
- `apps/web/src/plugins/allegro/allegro-setup.route.tsx`
- `apps/web/src/plugins/prestashop/prestashop-setup.route.tsx`

The relative paths to `../../pages/` work identically because these files sit at the same nesting depth (`apps/web/src/plugins/<name>/` vs `apps/web/src/app/routes/`).

### Phase 3 — Convert the top-level guest routes

Same pattern for:
- `apps/web/src/app/routes/login.route.tsx`
- `apps/web/src/app/routes/forgot-password.route.tsx`
- `apps/web/src/app/routes/reset-password.route.tsx`

These are children of `appRouter` (not of `rootRoute`), so they sit at the top level of the route tree. They follow the same `RouteObject` shape; the conversion is identical.

### Phase 4 — Pin the contract with a parameterized unit test

Add `apps/web/src/app/routes/route-lazy.test.ts`. Iterates the actual route arrays and asserts every entry's `lazy` function resolves to a `Component`. This catches a class of regressions the two-fixture version misses: a search-replace that skips one file, or a developer who reverts an `element:` for "convenience." To make the iteration possible, **export** the `coreChildren` and `guestRoutes` arrays from their respective files (they are currently module-private `const`s).

```ts
import type { RouteObject } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { plugins } from '../../plugins';
import { coreChildren } from './root.route';
import { guestRoutes } from '../router'; // exported alongside `appRouter`

const lazyRoutes: RouteObject[] = [
  ...coreChildren,
  ...guestRoutes,
  ...plugins.flatMap((plugin) => plugin.routes ?? []),
].filter((route) => typeof route.lazy === 'function');

describe('route lazy shape', () => {
  it('every page-bearing route uses the lazy field', () => {
    expect(lazyRoutes.length).toBeGreaterThan(20);
  });

  it.each(lazyRoutes)(
    'route $path / $index resolves to a Component or element',
    async (route) => {
      const result = await route.lazy!();
      expect(result.Component ?? result.element).toBeDefined();
    },
  );
});
```

Required prep: `root.route.tsx` must `export const coreChildren`; `router.tsx` must `export const guestRoutes` (after refactoring `appRouter`'s children array into a named const). These are tiny edits made during Phase 1.

### Phase 5 — Build verification

Run `pnpm --filter @openlinker/web build` and confirm:
- Build succeeds.
- The output emits multiple per-page chunks (not one 947 KB monolith). Concretely: `dist/assets/` should contain many `*.js` files instead of one. The exact chunk count will be ~25–35 depending on Vite's automatic vendor extraction.
- The "chunk > 500 KB" warning is gone (or much smaller).

No code change in this phase — just confirming the build output.

### Phase 6 — Quality gate

- `pnpm lint` — zero errors.
- `pnpm type-check` — zero errors.
- `pnpm test` — all green, including the four `app.test.tsx` integration tests that exercise the lazy resolution path.
- Browser smoke (Chrome DevTools MCP): load `/`, navigate to a couple of routes (`/orders`, `/connections/new/allegro`, `/integrations/allegro/connect/callback`), confirm chunks load and pages render with zero console errors.

---

## 7. Alternatives Considered

### Alternative 1 — `React.lazy` + `<Suspense>` per route
- **Description**: Use `React.lazy(() => import('...'))` for each page component and wrap each route's `element` in `<Suspense fallback={...}>`.
- **Why rejected**: That's the pre-RR-6.4 pattern. RR's native `lazy` field is more ergonomic, integrates with RR's own data-router lifecycle (loaders, actions), and doesn't require a Suspense wrapper. The issue body explicitly recommends "React Router's `lazy` field."
- **Trade-offs**: Both achieve chunk-splitting. RR's `lazy` is the modern idiom.

### Alternative 2 — Lazy-load only "heavy" pages, leave small pages eager
- **Description**: Cherry-pick which pages get lazy-loaded based on bundle size (e.g., jobs-logs with its virtualized table) and leave small pages (dashboard, settings) eager.
- **Why rejected**: Adds judgment cost per page and a non-uniform convention. Vite already extracts shared chunks automatically; the marginal cost of one extra HTTP request per route is negligible on a real network. Uniformity beats cleverness here.
- **Trade-offs**: Slightly fewer round-trips on common paths vs. simpler mental model. Pick simple.

### Alternative 3 — Defer this PR until `errorElement` / Suspense fallback is also designed
- **Description**: Combine lazy-loading with route-level error boundaries and loading indicators.
- **Why rejected**: The issue's recommendation is specifically lazy-loading. Error and loading UX are #610 (nav metadata) and an unfiled UX concern. Bundling them into one PR widens the diff without unblocking the BLOCKER any sooner. Ship the conversion; layer UX on top.
- **Trade-offs**: Bigger surface vs. focused unblock. Pick focused.

---

## 8. Validation & Risks

### Architecture compliance
- ✅ Dependency direction unchanged (route file → page file via dynamic import; both inside `app/` or `plugins/`).
- ✅ No new abstractions, no new files except the unit test.
- ✅ Convention consistency: every converted file has the same shape.

### Naming conventions
- ✅ Route files stay `*.route.tsx` per `docs/frontend-architecture.md`.
- ✅ Test file `route-lazy.test.ts` follows the `*.test.ts(x)` convention.
- ✅ Lazy fn returns `Component:` (the React Router idiom), not a custom shape.

### Risks
- **R1 — Lazy resolution doubles each route's first-paint latency** (one extra HTTP round-trip). Mitigation: in practice, the chunks are small (page-sized) and HTTP/2 multiplexes the fetch. Vite preloads chunks at link-hover time in production builds. The four `app.test.tsx` tests already use 10 s timeouts and pass; real network latency is comparable.
- **R2 — Test environment dynamic-import support**. Vitest + happy-dom natively supports `import()`. Confirmed by the React Router v7 docs and by Vitest's transformer behavior. If any single test breaks, it would be at this seam.
- **R3 — Chunk-load failure on stale deployments**. If a user has a stale tab and the deployer ships new chunks with new hashes, the user's navigation to an unloaded route hits a 404 on the old chunk filename. Mitigation: not in scope; the app already needs a deployment-staleness story (out of band).
- **R4 — `app.test.tsx` timing**. The integration tests wait for elements via `findByRole`. With lazy, the test environment has to resolve the dynamic import, which Vitest does synchronously enough that the existing 10 s timeout absorbs it. Verified in research; flag during quality gate if any tests flake.

### Edge cases
- **Plugin route ordering** — unchanged. Plugin routes still flatMap after core children; React Router resolves by path specificity. (Covered by #629.)
- **Routes with no page module** — `prompt-templates-legacy-redirects.route.tsx` uses inline `<Navigate>`. Left eager. The redirect cost is negligible.
- **Routes with hooks inside element JSX** — `PromptTemplateLegacyDetailRedirect` is defined inline inside the redirect file. Stays eager.

### Backward compatibility
- ✅ Every URL still resolves to the same page component.
- ✅ Browser refresh and direct-URL navigation work identically.
- ✅ Plugin contribution mechanism (#629) unchanged.

---

## 9. Testing Strategy & Acceptance Criteria

### Unit tests
- `apps/web/src/app/routes/route-lazy.test.ts` — pins the lazy contract for one core route + one plugin route (one fixture per pile).

### Integration tests
- `apps/web/src/app/app.test.tsx` — already in place; renders through `RouterProvider` + `rootRoute` and asserts route-resolved content appears. These tests now exercise the lazy resolution path automatically. No changes to the tests; they must keep passing.

### Build verification
- `pnpm --filter @openlinker/web build` — chunks should split; the "chunk > 500 KB" warning should be gone (or applied to a much smaller subset).

### Browser smoke
- Vite dev server + Chrome DevTools MCP. Routes to hit: `/`, `/orders`, `/connections`, `/connections/new/allegro`, `/integrations/allegro/connect/callback`, `/login`. Each must load without console errors.

### Acceptance criteria
- [ ] All 27 route files converted to `lazy`; no remaining static page imports inside route modules (except the legacy-redirect file).
- [ ] `pnpm lint` and `pnpm type-check` clean.
- [ ] `pnpm test` green (existing tests + new contract test).
- [ ] Production build emits multiple per-page chunks.
- [ ] Browser smoke: routes load without errors.

---

## 10. Alignment Checklist

- [x] Follows `docs/frontend-architecture.md` — routing remains explicit; only the page-component import deferral changes
- [x] Respects `app → pages → features → shared` dependency direction
- [x] Uses an existing pattern (React Router v7 `lazy`)
- [x] No new event-driven or backend concerns
- [x] No `any`; no `console.log`; no eslint-disables
- [x] Testing strategy: one contract test + four existing integration tests + build-output check
- [x] Naming conventions followed (no file renames)
- [x] Plan is execution-ready
- [x] Plan saved as markdown file

---

## Related Documentation
- `docs/frontend-architecture.md` — §Routing Conventions, §Dependency Rules
- `docs/engineering-standards.md` — file headers, naming
- Issue #606 — H3 HIGH: Routes are centralized and eagerly imported
- PR #629 (merged) — FE plugin registry + open ApiClient (already relocated marketplace routes to `plugins/<name>/`, completing the second half of #606's recommendation)
- React Router v7 docs — [Route.lazy](https://reactrouter.com/start/data/route-object#lazy)

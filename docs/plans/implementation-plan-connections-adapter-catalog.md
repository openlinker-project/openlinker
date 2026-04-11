# Implementation Plan: Connections List Page (#61) + Adapter Catalog Page (#60)

## Goal

Build two operator-facing frontend pages:
1. **Connections list page** (#61) — Enhance the existing connections list with platform/status filters and entry points to detail/create flows
2. **Adapter catalog page** (#60) — New page exposing `/adapters` endpoint in a readable operator-facing view

## Classification

**Frontend** — `apps/web/src/`

## Non-Goals

- Connection create/edit forms (#62)
- Connection detail page (#63)
- Backend API changes (endpoints already exist)

## Existing State

### Already built:
- `features/connections/` — API client, types, query keys, query hook, overview component
- `features/adapters/` — API client, query keys, query hook
- `pages/connections/connections-list-page.tsx` — Basic page wrapping `ConnectionsOverview`
- Backend `GET /connections` with `?platformType=&status=` filters
- Backend `GET /adapters` returning `AdapterMetadata[]`

### What's missing:
- **Connections page**: No platform/status filter UI, no adapter key column refinement
- **Adapter catalog page**: No page component, no route, no sidebar nav entry
- **Adapter types**: `AdapterSummary` in FE doesn't match backend `AdapterMetadata` shape (missing `displayName`, `version`, uses `key`/`provider` instead of `adapterKey`/`platformType`)
- **Navigation**: No sidebar link to adapter catalog

---

## Implementation Steps

### Step 1: Fix adapter FE types to match backend contract

**File:** `apps/web/src/features/adapters/api/adapters.types.ts` (new)

Extract types from `adapters.api.ts` into a proper types file matching backend `AdapterMetadata`:

```typescript
export interface AdapterSummary {
  adapterKey: string;
  platformType: string;
  supportedCapabilities: string[];
  displayName?: string;
  version?: string;
}
```

**Update:** `adapters.api.ts` to import from types file, remove inline interface.

**Acceptance:** Types match `GET /adapters` response shape.

---

### Step 2: Add platform/status filters to connections list page

**File:** `apps/web/src/pages/connections/connections-list-page.tsx`

Enhance the existing page:
- Add `platformType` dropdown filter (options: all, prestashop, allegro)
- Add `status` dropdown filter (options: all, active, disabled, error)
- Pass filters to `useConnectionsQuery(filters)`
- Use `useSearchParams` for URL state
- Keep the existing `ConnectionsOverview` pattern but move the filter state up to the page

**File:** `apps/web/src/features/connections/components/connections-overview.tsx`

Update to accept `filters` prop so the page controls filtering.

**Acceptance:** Filters work via URL params, connections list updates reactively.

---

### Step 3: Create adapter catalog page

**File:** `apps/web/src/pages/adapters/adapters-catalog-page.tsx` (new)

Build page following the products list page pattern:
- `PageLayout` with eyebrow "Platform", title "Adapter Catalog"
- `DataTable` with columns: Adapter (displayName + adapterKey), Platform, Capabilities (badge list), Version
- Loading/Error/Empty states
- No pagination needed (small static list)

**Acceptance:** Page renders adapter list with all metadata visible.

---

### Step 4: Add adapter catalog route

**File:** `apps/web/src/app/routes/adapters.route.tsx` (new)

```typescript
export const adaptersRoute: RouteObject = {
  path: 'adapters',
  element: <AdaptersCatalogPage />,
};
```

**File:** `apps/web/src/app/routes/root.route.tsx`

Add `adaptersRoute` to root children.

**Acceptance:** `/adapters` renders the catalog page.

---

### Step 5: Add sidebar navigation entry

**File:** `apps/web/src/shared/ui/app-shell.tsx`

Add "Adapters" to the Platform navigation group (after Integrations):

```typescript
{ to: '/adapters', label: 'Adapters', state: 'live' },
```

**Acceptance:** Sidebar shows "Adapters" link, navigates correctly.

---

### Step 6: Add tests

**Files:**
- `apps/web/src/pages/adapters/adapters-catalog-page.test.tsx`
- `apps/web/src/pages/connections/connections-list-page.test.tsx`

Test: happy path (data renders), error state, empty state, filter interactions.

**Acceptance:** All tests pass via `pnpm test`.

---

## Risks & Notes

- Adapter API returns a small static list (2 adapters currently) — no pagination needed
- Connection filters are already supported by backend — just need FE wiring
- The existing `AdapterSummary` type uses `key`/`provider` which may not match actual API response; need to verify and fix

# Pre-Implement Analysis: Frontend — Global Command Palette (⌘K) #333

**Date**: 2026-06-19  
**Plan**: `docs/plans/implementation-plan-command-palette.md`  
**Verdict**: **NEEDS-REVISION**

---

## Summary

The plan is architecturally sound and correctly handles the frontend dependency boundaries. All new artifacts are confirmed absent — nothing is being reinvented. However, four concrete API surface assumptions in the provider implementation are wrong against the live codebase. None of the issues require a scope or architecture change; they are corrections to the mapping code the plan specifies for the Orders, Products, and SyncJobs sources.

---

## Reuse Audit — New vs. Exists

| Plan Artifact | Status | Notes |
|---|---|---|
| `shared/ui/command-palette.tsx` | **NEW** | Confirmed absent; no cmdk import anywhere in codebase |
| `app/command-palette-provider.tsx` | **NEW** | Confirmed absent; no CommandPaletteContext/Provider anywhere |
| `TopbarSearchPlaceholder` removal | **EXISTS** | Lines 148–169 of `app/app-shell.tsx`; only used in that file |
| `shared/ui/index.ts` — export addition | **PARTIAL** | Section `// ── Overlays / popovers` exists at lines 49–54; add after line 54 |
| `BASE_NAV_GROUPS` | **EXISTS** | `app/nav-registry.ts:28` — confirmed `.kind`, `.items[].to`, `.items[].label` |
| `LiveNavGroup` type guard (`.kind === 'live'`) | **EXISTS** | `app/nav-registry.types.ts` — `LiveNavGroup` exported |
| `useDebouncedValue` | **EXISTS** | `shared/hooks/use-debounced-value.ts` — confirmed |
| `useSession` at `shared/auth/use-session.ts` | **EXISTS** | Correct path; `session.status` is `'anonymous' | 'authenticated'` |
| `session.status === 'anonymous'` check | **EXISTS** | `ANONYMOUS_SESSION` constant confirms this literal value |
| `Dialog` / `DialogContent` with `className` + `aria-label` | **EXISTS** | `DialogContent` spreads `...props` to Radix `Dialog.Content`; both props work |
| Toast provider pattern | **EXISTS** | `shared/ui/toast-provider.tsx:66–101` — good model |
| `useConnectionsQuery` | **EXISTS** | `features/connections/hooks/use-connections-query.ts` |
| `useOrdersQuery` | **EXISTS** | `features/orders/hooks/use-orders-query.ts` |
| `useProductsQuery` | **EXISTS** | `features/products/hooks/use-products-query.ts` |
| `useSyncJobsQuery` | **EXISTS** | `features/sync-jobs/hooks/use-sync-jobs-query.ts` |
| CSS overlay section in `index.css` | **EXISTS** | Section after line 4290 (Popover) is correct slot |
| `app-providers.tsx` (provider tree) | **EXISTS** | `app/providers/app-providers.tsx` — reviewed for context |

---

## Backward-Compatibility Findings

No existing backend ports, DI tokens, ORM entities, or cross-context barrel surfaces are touched. All changes are within `apps/web`. No migrations required.

| Surface | Finding | Severity |
|---|---|---|
| `shared/ui/index.ts` barrel | Only additions (no removals/renames). Safe. | OK |
| `app-shell.tsx` | Removes `TopbarSearchPlaceholder` — not exported or used outside this file. Safe. | OK |
| ESLint `no-restricted-imports` for `cmdk` | **Rule does not yet exist**. Plan correctly calls for adding it; if skipped, future contributors can import `cmdk` from features. Must be added in Phase 1. | Warning |
| `@radix-ui` import restrictions | ESLint already blocks `@radix-ui/*` imports in `features/`, `pages/`, `app/`, `plugins/` layers. `shared/` is exempt. The cmdk restriction should mirror this pattern (add rule for `cmdk` to the same non-shared scopes). | Warning |

---

## Critical Issues (Must Fix Before Implementation)

### Issue 1 — `OrderFilters` has no `search` field

**Severity**: Critical  
**Plan step affected**: Phase 3, Step 8 (Orders source)

The plan proposes:
```typescript
const ordersQuery = useOrdersQuery(
  query.length >= 2 ? { search: debouncedQuery } : undefined,
  { limit: 10 },
);
```

**Reality**: `OrderFilters` (from `features/orders/api/orders.types.ts`) has no `search` field. The actual fields are `sourceConnectionId`, `syncStatus`, `customerId`, `createdFrom`, `createdTo`, `recordStatus`, `health`, `sort`, `dir`, `dueBefore`, `slaState`, `fulfillmentState`.

**Migration path**: For v1, fetch recent orders without a search filter (e.g. `useOrdersQuery(undefined, { limit: 10 })`) and apply client-side substring match on the mapped label — same approach the plan already uses for Connections. Orders lists are paginated; this means the palette only surfaces the most recent 10, which is acceptable for v1.

---

### Issue 2 — `SyncJobFilters` has no `search` field

**Severity**: Critical  
**Plan step affected**: Phase 3, Step 8 (SyncJobs source)

The plan proposes:
```typescript
const syncJobsQuery = useSyncJobsQuery(
  query.length >= 2 ? { search: debouncedQuery } : undefined,
  { limit: 10 },
);
```

**Reality**: `SyncJobFilters` has no `search` field. Fields: `status`, `connectionId`, `jobType`, `outcome`.

**Migration path**: Same as Issue 1 — fetch recent jobs without a search filter and apply client-side substring match on `jobType` + `id`. Job lists are also paginated; fetching the most recent 10 is fine for v1.

---

### Issue 3 — `OrderRecord` field names differ from plan assumptions

**Severity**: Critical  
**Plan step affected**: Phase 3, Step 8 (Orders source mapping)

The plan maps orders as:
```typescript
{ id: 'order:' + o.id, label: o.externalOrderNumber ?? o.id, description: o.status, to: '/orders/' + o.id }
```

**Reality** (from `features/orders/api/orders.types.ts`):
- Primary key is `o.internalOrderId`, not `o.id`
- `externalOrderNumber` is **nested** inside `o.syncStatus[].externalOrderNumber` (per-destination), not a top-level field
- There is **no top-level `status`** field; status lives in `o.syncStatus[]` array

**Migration path**: Correct the mapping to:
```typescript
{
  id: 'order:' + o.internalOrderId,
  label: o.syncStatus[0]?.externalOrderNumber ?? o.internalOrderId,
  description: o.syncStatus[0]?.status ?? o.recordStatus,
  to: '/orders/' + o.internalOrderId,
}
```
(Or use `o.recordStatus` as the top-level status proxy — it's a stable field.)

---

### Issue 4 — `useConnectionsQuery` does not expose `enabled`

**Severity**: Critical  
**Plan step affected**: Phase 3, Step 8 (risk/mitigation section)

The plan's risk section notes: "use `enabled: isOpen` for the first open". But `useConnectionsQuery(filters?, options?)` only accepts `{ refetchInterval?: number | false }` in its `options` — the underlying TanStack Query `enabled` option is not forwarded.

The same limitation applies to `useOrdersQuery`, `useProductsQuery`, and `useSyncJobsQuery` — none of their `options` objects expose `enabled`.

**Migration path**: Since `enabled` can't be passed through, the provider must use **conditional query keys** or simply accept that queries fire at mount. The simplest fix: call all hooks unconditionally (they fire once at mount when the provider mounts inside the authenticated shell, then cache). Remove the `enabled: isOpen` mitigation from the plan — it cannot be implemented without modifying the hook wrappers. The first-open-defer behavior is a nice-to-have; TanStack Query's caching makes it low-impact if omitted.

---

## Important Issues (Should Fix, Not Blocking)

### Issue 5 — `SyncJob.type` → actual field is `jobType`

**Plan says**: `j.type + ' — ' + j.id`  
**Reality**: The field is `j.jobType` (from `sync-jobs.types.ts`)  
**Fix**: Change to `j.jobType + ' — ' + j.id`

---

### Issue 6 — `useOrdersQuery` and `useSyncJobsQuery` not exported from feature barrels

**Plan's risk section** mentions verifying barrel exports. Confirmed:
- `features/orders/index.ts` — does NOT re-export `useOrdersQuery` (only types and query keys)
- `features/sync-jobs/index.ts` — does NOT re-export `useSyncJobsQuery` (only `TriggerSyncDialog`)

**`useConnectionsQuery`** and **`useProductsQuery`** ARE exported from their barrels.

**Migration path**: Import orders and sync-jobs hooks directly from their hook files:
```typescript
import { useOrdersQuery } from '../features/orders/hooks/use-orders-query';
import { useSyncJobsQuery } from '../features/sync-jobs/hooks/use-sync-jobs-query';
```
This is a valid intra-app relative import from `app/` to `features/` (same package).

---

## Cleared Assumptions

| Assumption | Verified |
|---|---|
| `BASE_NAV_GROUPS` exists with `.kind` / `.items[].to` / `.items[].label` | ✓ |
| `session.status === 'anonymous'` is the logout sentinel | ✓ |
| `useSession` at `shared/auth/use-session.ts` | ✓ |
| `DialogContent` accepts `className` + `aria-label` via `...props` | ✓ |
| `shared/ui/index.ts` overlays section at lines 49–54 | ✓ |
| No existing `cmdk` import anywhere in codebase | ✓ |
| `toast-provider.tsx` pattern available | ✓ |
| `useProductsQuery` accepts `{ search?: string }` | ✓ |
| `useConnectionsQuery` exported from `features/connections` barrel | ✓ |
| `useProductsQuery` exported from `features/products` barrel | ✓ |
| CSS overlay section near line 4290 is correct insertion point | ✓ |
| `CommandPaletteProvider` wrapping inside `app-shell.tsx` is correct (needs `useNavigate`, which requires Router context) | ✓ |
| Architecture boundary: `shared/ui` ← no feature imports; `app/` → features allowed | ✓ |

---

## Open Questions

1. **Order detail route** — `/orders/:orderId` is assumed. If the route uses `internalOrderId` as the param name (consistent with the type), navigation will be `/orders/:internalOrderId`. Verify against `app/routes/` before implementation.

2. **Connection detail route** — `/connections/:connectionId` assumed. Verify actual route param name.

3. **Product detail route** — `/products/:productId` assumed. Verify.

4. **SyncJob detail route** — `/jobs-logs/:syncJobId` assumed. Given `id` is the SyncJob primary key, the route is likely `/jobs-logs/:id`. Verify.

5. **`enabled` workaround** — Accept that connections query fires at shell mount (cached after first fetch). If the team later wants defer-to-first-open, the feature hook wrappers need to expose TanStack Query's `enabled` option — that is a small hook-signature change tracked separately.

---

## Recommended Plan Edits (Before `/work`)

Apply these before starting implementation:

1. **Orders source**: Remove `{ search: debouncedQuery }` filter. Fetch `useOrdersQuery(undefined, { limit: 10 })`. Apply client-side substring filter on the label.
2. **SyncJobs source**: Same — remove `{ search: debouncedQuery }`. Use `useSyncJobsQuery(undefined, { limit: 10 })` and filter client-side.
3. **Order mapping**: `id: 'order:' + o.internalOrderId`, `label: o.syncStatus[0]?.externalOrderNumber ?? o.internalOrderId`, `description: o.syncStatus[0]?.status ?? o.recordStatus`, `to: '/orders/' + o.internalOrderId`.
4. **SyncJob mapping**: `j.jobType` not `j.type`.
5. **Remove `enabled: isOpen` mitigation** from risks section — not implementable without hook-wrapper changes.
6. **Barrel imports for orders/sync-jobs**: Import directly from hook file paths, not barrels.
7. **ESLint cmdk rule**: Must be added in Phase 1 (Step 1 or as Step 1.5). Do not defer to Phase 5.

---

## Visual States

HTML mockup of all four palette states (faithful to `index.css` tokens and cmdk structure):  
**File**: [`docs/plans/analysis/command-palette-screens.html`](../mockups/command-palette-screens.html)

| State | Description |
|---|---|
| **1 — Idle** | Palette open, no query, Recent group visible (last 5 selections from `localStorage`) |
| **2 — Search** | Query `"orde"` — Navigation group filtered to "Orders", Orders group shows 3 most-recent matches |
| **3 — Loading** | First open before TanStack Query cache warms — spinner, no groups, `loading={true && groups.length === 0}` |
| **4 — No results** | Query `"xyz123qr"` yields no matches across any source — cmdk `<CommandEmpty>` renders the empty message |

Route destinations verified against live route definitions:
- Orders → `/orders/:internalOrderId` (`orders.route.tsx`)
- Products → `/products/:id` (`products.route.tsx`)
- Sync Jobs → `/jobs-logs/:id` (`jobs-logs.route.tsx`)
- Connections → `/connections/:id` (unchanged from plan)

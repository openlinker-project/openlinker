# Implementation Plan: `/shipments` page with filters (#770)

**Date**: 2026-05-26
**Status**: Ready for implementation
**Estimated Effort**: S (≈3 days) — one FE feature + page + route/nav + tests. No backend, no migration.
**Branch**: `770-shipments-page`

---

## 0. Premise

The backend is fully in place: `GET /shipments` (filters + offset pagination) shipped in **#846** (merged `a6256ff`). #770 is a pure **frontend** consumer — a cross-order shipments list, the operator's rollup view. It mirrors the **sync-jobs / "Jobs & Logs"** list-page vertical exactly (the closest analog: same paginated+filtered read-API shape).

## 1. Goal & layer

**Goal**: A top-level `/shipments` page listing all shipments across orders/connections, with URL-shareable filters, pagination, row→order-detail navigation, and the standard loading/empty/error states.

**Layer**: **Backend (small) + Frontend**. The pure-FE plan grew a backend read-model extension after the customer-column decision (see §2b).

**Explicit non-goals** (out of scope per the issue + clean slice):
- Per-row command actions (generate-label / cancel) — owned by **#769** (order Shipment panel). The list is read-only; row click → order detail.
- Bulk actions, CSV export, aggregate analytics (v2 per #727 A5).
- A `findByIds` batch read on `IOrderRecordService` — the customer enrichment uses per-page deduped single `getOrderRecord` lookups for now; batching is a tracked follow-up (see §2b N+1 note).

## 2. API ↔ filter mapping (1:1 with #846)

| FE filter | Query param | Backend support |
|---|---|---|
| status | `status` | ✅ `@IsEnum(ShipmentStatusValues)` |
| connection | `connectionId` | ✅ `@IsUUID` |
| method (paczkomat/kurier) | `shippingMethod` | ✅ `@IsEnum(ShippingMethodValues)` |
| has-tracking | `hasTracking` | ✅ boolean (coercion-fixed) |
| date range | `createdFrom` / `createdTo` | ✅ ISO-8601 |
| pagination | `limit` / `offset` | ✅ (limit cap 100) |

Response envelope: `{ items: ShipmentResponseDto[]; total; limit; offset }`.

## 2b. Customer column — backend read-model extension (decided)

A shipment carries only `orderId`; `Order` persists `customerId` (indexed), reachable via `IOrderRecordService.getOrderRecord(orderId)` (`@openlinker/core/orders`). The FE already has `CustomerEntityLabel(customerId)` (resolves name + links to `/customers/:id`, mirroring `ConnectionEntityLabel`). **Decisions:**
- **Expose `customerId` only** on `ShipmentResponseDto` (`customerId: string | null`); the FE resolves the name via `CustomerEntityLabel` — no PII duplicated into the shipment DTO.
- **Enrich at the API controller layer**: the `apps/api` shipping controller injects `IOrderRecordService` (token from `@openlinker/core/orders`), resolves the page's **distinct** `orderId`s → `customerId`, and sets it on each DTO. Core `Shipment` entity + `IShipmentQueryService` stay **unchanged** (smallest blast radius on #846). New allowed cross-context edge: `apps/api` shipping → orders `I*Service`.
- **N+1 note**: ≤ page-size deduped `getOrderRecord` calls per list page (no batch method exists). A `findByIds`/batch read on `IOrderRecordService` is a clean follow-up; acceptable at MVP page sizes.
- `fromDomain(shipment, customerId = null)` gains the optional arg; list/getById/getActive resolve + pass it; command responses (generate-label/cancel) pass `null` (customer isn't shown there).

## 3. Design — mirror the sync-jobs vertical

New feature `apps/web/src/features/shipments/`:
- `api/shipments.types.ts` — transport types (`Shipment`, `ShipmentFilters`, `ShipmentPagination`, `PaginatedShipments`) preserving backend `camelCase`; `ShipmentStatusValues` / `ShippingMethodValues` const arrays for the filter dropdowns + status-badge mapping; `SHIPMENTS_PAGE_SIZE`.
- `api/shipments.api.ts` — `createShipmentsApi(request)` with `list(filters, pagination)` → `request('/shipments' + buildQuery(...))`; a `buildQuery` URLSearchParams helper (mirrors `sync.api.ts`).
- `api/shipments.query-keys.ts` — key factory `shipmentsQueryKeys.list(filters, pagination)`.
- `hooks/use-shipments-query.ts` — `useShipmentsQuery(filters, pagination)` via `useApiClient().shipments.list`.
- `components/shipment-status-badge.tsx` — maps `ShipmentStatus` → `StatusBadge` tone (`draft`→review, `generated`→info, `dispatched`/`in-transit`→info+pulse, `delivered`→success, `failed`→error, `cancelled`→neutral).
- `index.ts` — public barrel (start minimal; export the status badge + types only if a cross-feature consumer needs them — likely none yet).

Page `apps/web/src/pages/shipments/shipments-page.tsx`:
- `useSearchParams()` for URL filter+offset state (read on render; `setFilter` clears offset on change — exact sync-jobs pattern).
- `PageLayout` + filter `Select`s (status / method / has-tracking / connection) + `DataTable` with `cardView` (mobile) + `DataTableSkeleton` (loading) + `ErrorState` / `EmptyState`.
- Columns: **status** (`ShipmentStatusBadge`), **created** (`TimeDisplay` on `createdAt`), **order** (`EntityLabel`/link → `/orders/:orderId`), **method** (paczkomat/kurier label+icon — capability-gated), **paczkomat id** (mono, `hideBelow`, capability-gated), **tracking** (mono `trackingNumber` or —). Row click → `/orders/:orderId`.
- **Capability-conditional rendering** (issue AC): the issue's literal `paczkomat-shipment` / `kurier-domestic-shipment` map to the real capability name **`ShippingProviderManager`** on `Connection.supportedCapabilities`. Gate the method-specific columns (method + paczkomat id) on `useConnectionsQuery().some(c => c.supportedCapabilities.includes('ShippingProviderManager'))`. Page + nav remain present regardless (no existing capability-nav-gate mechanism — see §6).
- Connection filter: reuse the connections query for the dropdown options (id → name), as other pages do.

Route + nav:
- `app/routes/shipments.route.tsx` — `path: 'shipments'`, index child, `handle.crumb { group: 'Operations', title: 'Shipments' }`, `lazy` import of `ShipmentsPage`. Register in `root.route.tsx` `coreChildren`.
- `nav-registry.ts` — **promote "Shipping"**: remove from the disabled **Planned** group, add `{ to: '/shipments', label: 'Shipments' }` to the **Operations** live group. (Keep the noun "Shipments" consistent across nav label / title / URL.)
- Bump `EXPECTED_LAZY_ROUTE_COUNT` in `route-lazy.test.ts` (+1); `route-handle.test.ts` walks dynamically (no count, but the new leaf must carry a crumb — it does).

ESLint feature registration (`.eslintrc.js`):
- Add the `shipments` slug to **both** `no-restricted-imports` groups (the `features/**` rule and the `plugins/**` rule), for each canonical subdir (`api`/`hooks`/`components`/`lib`/`types`), per frontend-architecture §"Feature Public Surface".

## 4. Step-by-step

1. `features/shipments/api/shipments.types.ts` — types + const value arrays + page size. *(AC: camelCase preserved; mirrors `sync-jobs.types.ts`.)*
2. `features/shipments/api/shipments.api.ts` — `createShipmentsApi` + `buildQuery`.
3. `features/shipments/api/shipments.query-keys.ts` — key factory.
4. `app/api/api-client.ts` — add `shipments: ShipmentsApi` to `CoreApiClient` + `shipments: createShipmentsApi(request)` in the factory.
5. `features/shipments/hooks/use-shipments-query.ts` — query hook.
6. `features/shipments/components/shipment-status-badge.tsx` — tone mapping.
7. `features/shipments/index.ts` — minimal public barrel + header.
8. `pages/shipments/shipments-page.tsx` — the page (filters + table + states + capability gate + row nav).
9. `app/routes/shipments.route.tsx` + register in `root.route.tsx`.
10. `app/nav-registry.ts` — promote Shipping → Operations `/shipments`.
11. `.eslintrc.js` — add `shipments` feature slug to both import-restriction groups.
12. `route-lazy.test.ts` — bump expected lazy-route count.
13. Tests: `pages/shipments/shipments-page.test.tsx` (loading / data / error / empty / filter-updates-URL / capability-gated columns) + `features/shipments/hooks/use-shipments-query.test.tsx` (key + fetch). Mirror `sync-jobs-page.test.tsx` via `renderWithProviders` + `createMockApiClient({ shipments, connections })`.
14. Update `createMockApiClient` in `test/test-utils.tsx` to include a default `shipments.list` mock (so other pages' tests still boot).

## 5. Validation

- **FE dep direction**: page (`pages/`) imports `features/shipments` via barrel + `shared/ui`; feature imports `shared` + `app/api` client (the sanctioned DI crossing). No raw `fetch` (goes through `useApiClient`). No `pages`→deep-feature-internal imports.
- **State ownership**: server state = TanStack Query; filters/pagination = URL search params; no global store. Matches the doc's state rules.
- **UI**: tokens-only via existing `shared/ui` primitives (DataTable / Select / StatusBadge / PageLayout / feedback-state); responsive **cardView** fallback ≤767px; mono for ids/tracking/timestamps; `StatusBadge` = tone + dot + text (never colour alone). a11y: `aria-label` on filter selects, accessible table semantics (DataTable provides).
- **Tests**: component tests for the 5 states + URL-filter behavior; `pnpm lint && pnpm type-check && pnpm test` green; `route-lazy`/`route-handle` contract tests pass.
- **No backend / no migration.**

## 6. Risks / open questions

- **OQ1 — Customer column (speced but no data)**: `ShipmentResponseDto` carries `orderId`, not customer. Options: (a) **omit** the customer column for v1 (order link covers click-through) — *recommended, keeps it a clean read of the shipment model*; (b) resolve customer per row via an order lookup (N+1, rejected for a list); (c) add `customerId`/customer summary to the backend read model (scope creep into #846 follow-up). **Defaulting to (a)**; flag for confirmation.
- **OQ2 — "PL + EN locale" AC vs the no-op i18n seam**: frontend-architecture §i18n explicitly **defers** string migration (v1 seam returns the fallback). Existing pages (sync-jobs) use inline English. **Matching that** (inline English, optionally via `t(key, fallback)`); full PL catalog is a separate per-feature i18n PR. Flag.
- **OQ3 — Capability gate scope**: gating *columns/terminology* on `ShippingProviderManager` (per AC) is in; gating the *nav item* on capability is **not** (no existing capability-nav-gate mechanism — only `requiresRole`). Page/nav always present; empty state covers no-shipping deployments. Note for a future enhancement.
- **R1 — order-detail route**: row nav targets `/orders/:orderId`; confirm that route exists during impl (it's in the Operations nav). If the order-detail route differs, adjust `rowHref`.

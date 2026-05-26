# Implementation Plan — #766 Paczkomat caching service (Redis 24h TTL)

**Issue:** #766 · **Design parent:** #727 (`docs/specs/product-spec-727-inpost-integration.md` SC-2)
**Layer:** CORE (shipping infrastructure + application) + Interface (API)
**Branch:** `766-paczkomat-cache`

---

## 1. Understand the task

Provide a fast, persistent paczkomat (pickup-point) lookup path so the manual
picker UI (#769) can search/render lockers without hammering ShipX on every
keystroke, and so a chosen point can be re-read in <10 ms when generating a
label.

### What already shipped (the foundation, #727.1 / #727.2 — verified on `main`)

- **`PickupPointCachePort`** (`domain/ports/pickup-point-cache.port.ts`) —
  deliberately **narrow**: `get(providerId): Promise<PickupPoint | null>` (does
  **not** refetch) and `put(point): Promise<void>` (TTL impl-handled). No
  `connectionId` in the key (paczkomat ids are a single national namespace —
  `providerId` is "globally unique per provider"), no query method, no
  `delete`/`refresh` ("explicit invalidation isn't a v1 use case; SC-2 is
  TTL-driven"). Token `PICKUP_POINT_CACHE_TOKEN` already exists.
- **`PickupPoint` / `PickupPointStatus`** (`domain/types/pickup-point.types.ts`)
  — `status: 'active' | 'temporarily-unavailable'`, structured address +
  opening hours. `FindPickupPointsQuery` co-located.
- **`PickupPointFinder`** sub-capability (`findPickupPoints(query) → PickupPoint[]`)
  + `isPickupPointFinder` guard. **Implemented by the InPost adapter** over ShipX
  `/v1/points` (and `FakeInpostShippingAdapter` with `seedPickupPoints`). It is
  **search-only — there is no get-by-id** finder call.
- **`CachePort`** (`@openlinker/shared/cache`) — `get<T>(key)`, `set<T>(key,val,ttlSec)`,
  `delete(key)`; Redis adapter + in-memory fake (`@openlinker/shared/cache/testing`).
  Token `CACHE_PORT_TOKEN`. This is the Redis seam #766 sits on.
- **`ShipmentDispatchService`** shows the per-connection adapter-resolution
  pattern to mirror: `integrations.getCapabilityAdapter<ShippingProviderManagerPort>(connId, 'ShippingProviderManager')`.
- `ShippingModule` already imports `IntegrationsModule` and carries a comment
  reserving the `PICKUP_POINT_CACHE_TOKEN` binding **for this issue**.

### Non-goals (explicit)

- Full snapshot of all ~15k PL paczkomats (issue: v2 if perf demands).
- Geo-radius / map search (issue: v2).
- Cache invalidation on ShipX update (issue: v2).
- **Per-search-query result caching** — the shipped port caches **by id only**;
  caching whole query→list results would mean widening the #727.1 contract,
  which its author explicitly argued against. Deferred (see §5 deviations).
- **Background refresh of "most-frequently-queried" points** — deferred to a
  follow-up (see §5). The shipped port has no `refresh`, the finder is
  search-only (so "refresh point X" is impossible by id), and "most-queried"
  needs new frequency state. Weak fit against the as-shipped design.

---

## 2. Design (recommended scope — "Option B")

Two collaborators, layered cleanly:

1. **`RedisPickupPointCacheAdapter implements PickupPointCachePort`**
   (infrastructure) — the literal port impl, backed by the shared `CachePort`.
   - `get(providerId)` → `cache.get<PickupPoint>(keyFor(providerId))`
   - `put(point)` → `cache.set(keyFor(point.providerId), point, TTL_SECONDS)`
   - Key: `paczkomat:point:{providerId}`. TTL: `PICKUP_POINT_CACHE_TTL_SECONDS`
     = 86_400 (24 h), env-overridable (`OL_PACZKOMAT_CACHE_TTL_SEC`, clamped).
   - The full `PickupPoint` (incl. `status`) round-trips through JSON, so
     `temporarily-unavailable` propagation is automatic (no field dropping).

2. **`PickupPointLookupService implements IPickupPointLookupService`**
   (application) — the read-through orchestration the picker consumes.
   - `search(connectionId, query) → PickupPoint[]`: resolve the connection's
     `ShippingProviderManagerPort` via `IIntegrationsService`, narrow with
     `isPickupPointFinder` (throw `PickupPointFinderNotSupportedException` if
     absent), call `findPickupPoints(query)`, **write each result through to the
     cache** (`put`), return the live list. Cache write-through failures are
     swallowed (warn-log) — they must never fail a live search.
   - `getCachedPoint(providerId) → PickupPoint | null`: thin pass-through to the
     cache for the fast by-id re-read (label generation / picker confirmation).

   This is the documented reading of the issue's "cache miss falls through to
   ShipX, then writes to cache": **search is always live (fresh list); each
   point is cached by id** for fast subsequent reads. There is no by-id live
   fall-through because the finder exposes no by-id call.

3. **`PickupPointController`** (API, `@Controller('pickup-points')`, `@Roles('admin')`)
   - `GET /pickup-points?connectionId=&searchText=&city=&postalCode=&limit=` →
     `lookup.search(...)` → `PickupPointResponseDto[]`.
   - `GET /pickup-points/:providerId?connectionId=` → `lookup.getCachedPoint(...)`
     (404 when not cached). (`connectionId` accepted for symmetry/forward-compat
     though the cache key is connection-agnostic.)
   - Maps `PickupPointFinderNotSupportedException` → 422, integration/transport
     errors → 502 (mirrors `ShipmentController.toHttpException`).

### Data flow

```
FE picker (#769)
  │  GET /pickup-points?connectionId=…&searchText=…
  ▼
PickupPointController → IPickupPointLookupService.search()
  │  resolve ShippingProviderManagerPort by connectionId (IntegrationsService)
  │  isPickupPointFinder guard
  ▼
InpostShippingAdapter.findPickupPoints(query)  ── ShipX GET /v1/points
  │  write-through each point → PickupPointCachePort.put()
  ▼                                   │
return PickupPoint[]                  ▼
                          RedisPickupPointCacheAdapter → CachePort.set(key, point, 86400)

later: GET /pickup-points/:id → lookup.getCachedPoint → CachePort.get  (<10ms)
```

---

## 3. Step-by-step

| # | File | Change | Acceptance |
|---|------|--------|-----------|
| 1 | `libs/core/src/shipping/infrastructure/adapters/redis-pickup-point-cache.adapter.ts` | `RedisPickupPointCacheAdapter implements PickupPointCachePort`; inject `CACHE_PORT_TOKEN`; key + TTL constant | get→cache.get; put→cache.set with 86400s; key `paczkomat:point:{id}` |
| 2 | `libs/core/src/shipping/application/interfaces/pickup-point-lookup.service.interface.ts` | `IPickupPointLookupService` (`search`, `getCachedPoint`) | interface-only file |
| 3 | `libs/core/src/shipping/application/services/pickup-point-lookup.service.ts` | `PickupPointLookupService` (resolve adapter, guard, search, write-through, cached read) | write-through failure swallowed; unsupported→exception |
| 4 | `libs/core/src/shipping/domain/exceptions/pickup-point-finder-not-supported.exception.ts` | domain exception | carries connectionId |
| 5 | `libs/core/src/shipping/shipping.tokens.ts` | add `PICKUP_POINT_LOOKUP_SERVICE_TOKEN` | Symbol only |
| 6 | `libs/core/src/shipping/shipping.module.ts` | import `CacheModule`; bind `PICKUP_POINT_CACHE_TOKEN`→adapter, `PICKUP_POINT_LOOKUP_SERVICE_TOKEN`→service; export both | boots; comment updated |
| 7 | `libs/core/src/shipping/index.ts` | export `IPickupPointLookupService` type (+ token via `export *`) + the new exception | barrel compiles |
| 8 | `apps/api/src/shipping/http/dto/list-pickup-points-query.dto.ts` | query DTO (class-validator) | `connectionId` required; rest optional |
| 9 | `apps/api/src/shipping/http/dto/pickup-point-response.dto.ts` | response DTO + `fromDomain` | Swagger-annotated |
| 10 | `apps/api/src/shipping/http/pickup-point.controller.ts` | `PickupPointController` | search + cached-read endpoints; exception mapping |
| 11 | `apps/api/src/shipping/shipping.module.ts` | register `PickupPointController` | controller resolves lookup via token |
| 12 | Specs: `redis-pickup-point-cache.adapter.spec.ts`, `pickup-point-lookup.service.spec.ts`, `pickup-point.controller.spec.ts` | unit | hit / miss / TTL value / write-through / unsupported / search→DTO |
| 13 | `apps/api/test/integration/pickup-point-cache.int-spec.ts` | integration (Testcontainers Redis) | round-trip + TTL expiry against real Redis |

---

## 4. Testing strategy

- **Cache adapter** (unit): in-memory `CachePort` fake — assert key + that `set`
  is called with `ttlSec=86400`; get-hit returns the point; get-miss → null;
  `temporarily-unavailable` status survives round-trip.
- **Lookup service** (unit): mock `CachePort` + `IIntegrationsService`; use
  `FakeInpostShippingAdapter.seedPickupPoints`. Cover: search returns live list
  and write-through `put`s each; adapter without finder → exception; cache `put`
  throwing does not fail search.
- **Controller** (unit): mock `IPickupPointLookupService`; search maps to DTOs;
  unsupported→422; cached-miss→404.
- **Integration** (`*.int-spec.ts`, Testcontainers Redis): real round-trip +
  short-TTL expiry (set ttl=1s via env, assert expiry) to prove "TTL respected"
  AC against real Redis, not a fake.

---

## 5. Validation / deviations from the literal issue

- **Architecture:** domain port untouched; impl is infra (depends on shared
  `CachePort`, not Redis directly); orchestration is an application service
  depending only on ports + `I*Service`; controller injects via Symbol token
  (never the repo/cache port directly across `apps/**`). ✔ cross-context rules.
- **No migration** (Redis only). **No new core→integration value imports**
  (adapter resolved at runtime via `IntegrationsService`).
- **Deviation 1 — query-result caching dropped:** the shipped port is by-id
  only; we cache each point by id, not whole query results. Honors #727.1's
  explicit "bulk/query semantics aren't a domain concern" decision rather than
  widening the contract. Search stays live (acceptable: lists must be fresh).
- **Deviation 2 — background refresh deferred:** carved to a follow-up issue
  (commented on #766). Rationale: no `refresh` on the port (by design), finder
  is search-only, "most-queried" needs new frequency state — genuine v2 polish,
  and TTL-driven freshness is the shipped design intent.

These two deviations are the reason this needs a ⏸️ scope confirmation before
implementing.

# Implementation Plan — Rewire content callers through IOfferMappingsService (#718, slice 3 of 4)

**Issue**: [#718 — Rewire cross-context repository-port couplings through service interfaces](https://github.com/openlinker-project/openlinker/issues/718)
**Slice**: 3 of 4 — `content` → `listings.OfferMappingRepositoryPort` callers.
**Branch**: `718-listings-repo-port-rewire`
**Drops**: 4 of the 8 remaining (post-slice-2) `(file, symbol)` allow-list entries.

---

## 0. Goal

Eliminate the two cross-context value-imports of `listings`-owned `OfferMappingRepositoryPort`. After this PR:

- `libs/core/src/content/application/services/content-state-reader.service.ts` no longer imports `OfferMappingRepositoryPort` — it calls a new `IOfferMappingsService` instead.
- `libs/core/src/content/application/services/integrations-content-publisher.service.ts` — same.
- 4 entries (2 production + 2 spec) drop from the allow-list.

**Non-goals**:
- Slice 4 (`ai` → `integrations.IntegrationCredentialRepositoryPort`).
- apps/worker callers of the same listings ports (none today — the slice-3 callers are all in libs/core).

---

## 1. Naming decision — `IOfferMappingsService`, not `IListingsService`

The issue body nominated `IListingsService` as the seam. Closer inspection reverses that call:

1. **Existing listings naming is per-purpose, not umbrella.** The context already has `OfferMappingSyncService`, `OfferStatusPollService`, `OfferCreationEnqueueService`, `OfferCreationExecutionService`, `OfferBuilderService`, `SellerPoliciesService`, `OfferLinkingService`, `CategoryResolutionService` — every service names what it does, not the context it belongs to. An umbrella `IListingsService` would break the precedent.
2. **The reviewer flagged this in the issue:** *"the offer-mapping query shape may not fit the existing service surface cleanly."* That's the same observation, written backwards — the reviewer foresaw the umbrella wouldn't fit.
3. **Slice 1's `IProductsService` precedent doesn't transfer.** That umbrella worked because all four call shapes read the same `Product`/`ProductVariant` aggregate family. Here, the two reads are narrowly about offer mappings; an umbrella would either bloat over time or sit awkwardly next to `OfferMappingSyncService` (which already writes).
4. **A narrow service is easier to evolve.** If the cross-context shape grows, methods can join `IOfferMappingsService` without touching unrelated listings code. If it shrinks, the service can be retired without disturbing the broader context.

Decision: **`IOfferMappingsService`** (plural, read-oriented). The name is honest about the surface: it queries offer mappings, parallel to how `OfferMappingSyncService` writes them.

---

## 2. Architecture mapping

| Layer | What lands here |
|---|---|
| **CORE — Listings application** | New `IOfferMappingsService` + `OfferMappingsService` (pass-through over `OfferMappingRepositoryPort`). |
| **CORE — Listings tokens** | New `OFFER_MAPPINGS_SERVICE_TOKEN` Symbol in `listings.tokens.ts`. |
| **CORE — Listings barrel** | `@openlinker/core/listings` re-exports the new interface + token. |
| **CORE — Listings services module** | `ListingsModule` (or the existing `services` sub-barrel — see §5) registers the concrete + token binding, exports both. |
| **CORE — Content application** | `content-state-reader.service.ts` and `integrations-content-publisher.service.ts` swap `OFFER_MAPPING_REPOSITORY_TOKEN` for `OFFER_MAPPINGS_SERVICE_TOKEN`. |
| **Lint** | Drop 4 entries from the allow-list. |

---

## 3. New service: IOfferMappingsService

### 3.1 Types

`libs/core/src/listings/application/services/offer-mappings.types.ts`

```ts
import type {
  OfferMappingPagination,
} from '../../domain/types/offer-mapping.types';

/**
 * Default page size for `findForVariant` when the caller passes no
 * explicit pagination. Matches the literal `{ limit: 100, offset: 0 }`
 * the legacy callers in `content` used.
 */
export const DEFAULT_OFFER_MAPPINGS_PAGE: OfferMappingPagination = {
  limit: 100,
  offset: 0,
};
```

(Note: the existing `PaginatedOfferMappings` / `OfferMappingFilters` / `OfferMappingPagination` types already live in `offer-mapping.types.ts` — we reuse, don't duplicate.)

### 3.2 Interface

`libs/core/src/listings/application/services/offer-mappings.service.interface.ts`

```ts
import type {
  OfferMappingPagination,
  PaginatedOfferMappings,
} from '../../domain/types/offer-mapping.types';

export interface IOfferMappingsService {
  /**
   * Page of offer mappings for one variant on one connection.
   *
   * Defaults to `{ limit: 100, offset: 0 }` when pagination is omitted
   * — matches the legacy content-side call shape and is comfortably
   * above the realistic per-variant offer count (typical: 1-3).
   *
   * Always scoped to `entityType = 'Offer'` by the underlying
   * repository.
   */
  findForVariant(
    connectionId: string,
    variantId: string,
    pagination?: OfferMappingPagination
  ): Promise<PaginatedOfferMappings>;

  /**
   * Count offer mappings grouped by `internalId` for a connection.
   * Returns `Map<internalId, count>`; keys with zero mappings are
   * omitted. Empty input list returns an empty map without hitting
   * the database (service-layer short-circuit, slice-1 pattern).
   */
  countForVariants(
    connectionId: string,
    variantIds: ReadonlyArray<string>
  ): Promise<Map<string, number>>;
}
```

Method names: `findForVariant` / `countForVariants` — the receiver variable will be `this.offerMappings`, so `offerMappings.findForVariant(...)` reads cleanly. Avoids the `offerMappings.findOfferMappingsForVariant(...)` redundancy a literal "findOfferMappingsForVariant" would produce.

### 3.3 Implementation

`libs/core/src/listings/application/services/offer-mappings.service.ts`

```ts
@Injectable()
export class OfferMappingsService implements IOfferMappingsService {
  constructor(
    @Inject(OFFER_MAPPING_REPOSITORY_TOKEN)
    private readonly repository: OfferMappingRepositoryPort,
  ) {}

  async findForVariant(
    connectionId: string,
    variantId: string,
    pagination: OfferMappingPagination = DEFAULT_OFFER_MAPPINGS_PAGE,
  ): Promise<PaginatedOfferMappings> {
    return this.repository.findMany({ connectionId, internalId: variantId }, pagination);
  }

  async countForVariants(
    connectionId: string,
    variantIds: ReadonlyArray<string>,
  ): Promise<Map<string, number>> {
    if (variantIds.length === 0) return new Map();
    return this.repository.countByConnectionAndVariants(connectionId, variantIds);
  }
}
```

`findForVariant` doesn't need an empty-input guard — there's no list parameter; the call is per single variant. `countForVariants` mirrors slice 1's empty-input service-layer short-circuit.

---

## 4. Tokens + barrel + module

### 4.1 `libs/core/src/listings/listings.tokens.ts`

```ts
export const OFFER_MAPPINGS_SERVICE_TOKEN = Symbol('IOfferMappingsService');
```

### 4.2 Barrel re-exports

The listings barrel has the structural twist documented in `engineering-standards.md § Sub-barrels`: the **contracts** (ports, types, capability guards, interfaces, exceptions, Symbol tokens) live on `@openlinker/core/listings`, while the **runtime wiring** (`@Injectable` services + `ListingsModule`) lives on the `@openlinker/core/listings/services` sub-barrel. This split exists to prevent runtime circular requires when sibling packages value-import the contract from the main barrel (#337/#359).

This rewire only needs the **interface** + **token** on the main barrel — both are pure contract surface. The concrete service registers on the `/services` sub-barrel.

```ts
// libs/core/src/listings/index.ts (main barrel — contracts only)
export type { IOfferMappingsService } from './application/services/offer-mappings.service.interface';
```

The token is already auto-exported because the listings barrel does `export * from './listings.tokens'` (per the Symbol-DI-Token convention, #595).

### 4.3 `ListingsModule` (services sub-barrel)

`libs/core/src/listings/services.ts` (or wherever `ListingsModule` lives — likely `libs/core/src/listings/listings.module.ts`) — register the concrete class + token binding alongside the other listings services, and export the token.

---

## 5. Consumer rewires

### 5.1 `content-state-reader.service.ts`

- Drop `OFFER_MAPPING_REPOSITORY_TOKEN` + `OfferMappingRepositoryPort` imports.
- Add `OFFER_MAPPINGS_SERVICE_TOKEN` + `IOfferMappingsService` imports.
- Constructor: same swap.
- Call site at line 72: `this.offerMappings.countByConnectionAndVariants(entry.connectionId, variants)` → `this.offerMappings.countForVariants(entry.connectionId, variants)`.
- Update file header `@see` if it references the repository port.

### 5.2 `integrations-content-publisher.service.ts`

- Drop `OFFER_MAPPING_REPOSITORY_TOKEN` + `OfferMappingRepositoryPort` imports.
- Add `OFFER_MAPPINGS_SERVICE_TOKEN` + `IOfferMappingsService` imports.
- Constructor: same swap.
- Call site at line 142: `this.offerMappings.findMany({ connectionId, internalId: variant.id }, { limit: 100, offset: 0 })` → `this.offerMappings.findForVariant(connectionId, variant.id)`. The `{ limit: 100, offset: 0 }` literal goes away — the service applies it as a default. Same wire behaviour; less ceremony at the call site.
- Update file header `@see` if it references the repository port.

---

## 6. Spec rewires

| Spec | `Pick<I*, …>` |
|---|---|
| `content-state-reader.service.spec.ts` | `Pick<IOfferMappingsService, 'countForVariants'>` |
| `integrations-content-publisher.service.spec.ts` | `Pick<IOfferMappingsService, 'findForVariant'>` |

Each spec drops the repository-port mock + its `provide: OFFER_MAPPING_REPOSITORY_TOKEN` binding and replaces with a service-token binding. Assertion verbs change one-for-one.

---

## 7. New service unit tests

`libs/core/src/listings/application/services/offer-mappings.service.spec.ts`:

| Method | Test cases |
|---|---|
| `findForVariant` | Forwards `(connectionId, variantId, pagination)` to `repository.findMany({connectionId, internalId})` and returns the page verbatim. Defaults to `{ limit: 100, offset: 0 }` when pagination is omitted. |
| `countForVariants` | Empty `variantIds` → returns empty Map without hitting the repository. Non-empty → forwards `(connectionId, variantIds)` and returns the map verbatim. |

---

## 8. Allow-list cleanup

Remove these four entries from `scripts/check-cross-context-imports.mjs`:

```
'libs/core/src/content/application/services/content-state-reader.service.ts'        → 'OfferMappingRepositoryPort'
'libs/core/src/content/application/services/content-state-reader.service.spec.ts'   → 'OfferMappingRepositoryPort'
'libs/core/src/content/application/services/integrations-content-publisher.service.ts'        → 'OfferMappingRepositoryPort'
'libs/core/src/content/application/services/integrations-content-publisher.service.spec.ts'   → 'OfferMappingRepositoryPort'
```

---

## 9. Acceptance criteria

- [ ] Both content consumer files no longer import `OfferMappingRepositoryPort` or `OFFER_MAPPING_REPOSITORY_TOKEN`.
- [ ] Both consumer specs mock `IOfferMappingsService` instead of the repository port.
- [ ] `IOfferMappingsService` + `OFFER_MAPPINGS_SERVICE_TOKEN` exist and are exported from `@openlinker/core/listings`.
- [ ] Allow-list drops the 4 entries listed in §8 (allow-list 8 → 4 remaining).
- [ ] `pnpm check:invariants`, `pnpm lint`, `pnpm type-check`, `pnpm test` all green.

---

## 10. Risks & open questions

- **Module placement**: `OfferMappingsService` needs to be registered against `ListingsModule`. The existing `OfferMappingSyncService` is one register-line in the same module — same shape, low risk.
- **Default pagination**: `findForVariant` defaults to `{ limit: 100, offset: 0 }`. The legacy `integrations-content-publisher` caller used this literal; no behaviour change. If a future consumer wants pagination, the optional argument supports it.
- **No `findMany`-without-variant escape hatch**: the existing repository port exposes `findMany(filters, pagination)` with an open `filters` shape (`connectionId?`, `internalId?`, `entityType` is fixed to `'Offer'` internally). The new service only exposes the `connectionId + single variant` shape that current consumers use. If a future cross-context caller needs a different filter combination, it adds a method to the service — not a regression of the seam back to the repository.

---

## 11. Out-of-scope follow-ups

- Slice 4 (`ai` → `integrations.IntegrationCredentialRepositoryPort`).
- Apps/worker rewires for listings repository ports — none exist today (this slice is core-only by accident of who calls what).

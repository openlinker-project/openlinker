# Implementation Plan — Extract `IInventoryQueryService` (#280)

**Branch:** `280-inventory-query-service`
**Layer:** CORE application + API interface
**Driver:** `InventoryController` injects `ProductRepositoryPort` directly and orchestrates a cross-aggregate read in the HTTP layer (`inventory.controller.ts:40-120`). Extract the composition into an application-layer query service so the controller keeps only HTTP-shape concerns.

---

## 1. Goal & non-goals

**Goal:** Behaviour-preserving refactor. HTTP response shape for `GET /inventory` and `GET /inventory/:id` is byte-identical to main.

**Non-goals:**
- Changing which product fields are returned (still `productName`, `productSku`, `productImageUrl`).
- Moving to a batch `GET /products?ids=…` FE pattern.
- Refactoring other controllers that do similar reads (orders, listings — file separately per domain if needed).
- Adding a `findByIds` batch method to `ProductRepositoryPort`. The current N individual `findById` pattern moves intact to the service; the TODO stays. Widening the port's read surface is separate architectural work.

---

## 2. Layer classification & doc alignment

Pure CORE + Interface refactor. Two modules touch:
- `libs/core/src/inventory/` — add `IInventoryQueryService` interface + impl + view-model types + Symbol token + module binding.
- `apps/api/src/inventory/` — rewrite controller to depend on the new service; rewrite tests.

Conventions enforced (`.claude/rules/backend.md`, `docs/engineering-standards.md`):
- Application services depend on port interfaces; query service injects `InventoryRepositoryPort` and `ProductRepositoryPort` via Symbol tokens.
- Interface in a separate `*.service.interface.ts`; impl naming `{Purpose}Service` → `InventoryQueryService` implements `IInventoryQueryService`.
- Types in a separate `*.types.ts` — view model goes in `application/types/inventory-view.types.ts`.
- View model is framework-free (no `@ApiProperty`, no ISO-string dates — `Date` stays `Date`). Serialization is a controller concern.
- Token bound with `useExisting` and exported from `inventory.tokens.ts` + `inventory.module.ts` + `index.ts`.

**Interface file placement.** `docs/engineering-standards.md` examples show `application/interfaces/*.service.interface.ts`, but the inventory module's established convention is to **colocate** interface + impl in `application/services/` (`inventory.service.interface.ts`, `inventory-sync.service.interface.ts`, `master-inventory-sync.service.interface.ts` all sit next to their impls). Following module consistency over doc example: new interface goes in `application/services/`.

---

## 3. Design

### 3.1 View model (framework-free)

`libs/core/src/inventory/application/types/inventory-view.types.ts`:

```typescript
import { InventoryItem } from '../../domain/entities/inventory-item.entity';

/**
 * Product details composed onto an inventory view. `null` when the
 * upstream product lookup returned no row — the inventory item still
 * exists, we just have no name/SKU/image to surface.
 */
export interface InventoryViewProduct {
  name: string;
  sku: string | null;
  coverImageUrl: string | null;
}

/**
 * Inventory item + joined product details. Application-layer type;
 * not decorated for Swagger. Serialization to the HTTP DTO lives in
 * the interface layer.
 */
export interface InventoryItemView {
  item: InventoryItem;
  product: InventoryViewProduct | null;
}

export interface PaginatedInventoryView {
  items: InventoryItemView[];
  total: number;
}
```

**Design note (nested vs flat).** The issue suggests flattening the view's `product` into three top-level fields. I'm keeping it nested — the controller needs `item.*` **and** `product.*` to build the DTO, so nesting the inventory fields under `item` and the product fields under `product` makes the "product absent" case explicit (it's `null`, not three silent nulls). The DTO stays flat; the view is internal.

**Design note (raw `InventoryItem` on view).** The view exposes the raw domain `InventoryItem` on `item` rather than a narrowed projection. Accepted tradeoff: the controller is the only consumer and maps 1:1 to DTO fields, so narrowing would be ceremony with no payoff. If this view ever grows a second consumer (e.g., worker, another controller), reconsider — exposing the raw entity silently widens the consumer contract whenever `InventoryItem` gains a field.

### 3.2 Service interface

`libs/core/src/inventory/application/services/inventory-query.service.interface.ts`:

```typescript
import { InventoryFilters, InventoryPagination } from '../../domain/types/inventory.types';
import { InventoryItemView, PaginatedInventoryView } from '../types/inventory-view.types';

export interface IInventoryQueryService {
  /**
   * List inventory items with filters + pagination, composing product details.
   * `product` on each view is `null` when the upstream product lookup failed.
   */
  listInventoryItems(
    filters: InventoryFilters,
    pagination: InventoryPagination,
  ): Promise<PaginatedInventoryView>;

  /**
   * Get a single inventory item by id with its product details composed.
   * Returns `null` when the inventory item does not exist. `view.product`
   * is `null` when the item exists but its product does not.
   */
  getInventoryItem(id: string): Promise<InventoryItemView | null>;
}
```

**Design note (null vs exception on get).** Returning `InventoryItemView | null` and letting the controller throw `NotFoundException` matches existing pattern in `InventoryRepositoryPort.findById` (returns `T | null`) and the current controller code. The domain doesn't know about HTTP 404s; the interface layer does.

### 3.3 Service implementation

`libs/core/src/inventory/application/services/inventory-query.service.ts`:

- `@Injectable()` class implementing `IInventoryQueryService`
- Inject both repositories via Symbol tokens
- Private `buildProductMap` helper (moved verbatim from the controller)
- `compose(item, product)` helper that produces an `InventoryItemView` with the `{ name, sku, coverImageUrl }` shape via `coverImageUrl(product)`
- `listInventoryItems` calls `inventoryRepository.findMany` + `buildProductMap`, then maps
- `getInventoryItem` calls `inventoryRepository.findById`, short-circuits on null, then `productRepository.findById`, then `compose`

### 3.4 Module binding + exports

**`libs/core/src/inventory/inventory.tokens.ts`** — add:
```typescript
export const INVENTORY_QUERY_SERVICE_TOKEN = Symbol('IInventoryQueryService');
```

**`libs/core/src/inventory/inventory.module.ts`** — add import, re-export, provider entry, export entry. Class-first + `useExisting` per established pattern.

**`libs/core/src/inventory/index.ts`** — add:
```typescript
export { INVENTORY_QUERY_SERVICE_TOKEN } from './inventory.tokens';
export { IInventoryQueryService } from './application/services/inventory-query.service.interface';
export { InventoryQueryService } from './application/services/inventory-query.service';
export {
  InventoryItemView,
  InventoryViewProduct,
  PaginatedInventoryView,
} from './application/types/inventory-view.types';
```

### 3.5 Controller rewrite

`apps/api/src/inventory/http/inventory.controller.ts`:

- Drop imports from `@openlinker/core/products`
- Replace the two `@Inject` repos with one: `@Inject(INVENTORY_QUERY_SERVICE_TOKEN) queryService: IInventoryQueryService`
- `listInventory` → delegate, then `items.map(inventoryViewToDto)` + paginate
- `getInventoryItem` → delegate, null → `NotFoundException`, else `inventoryViewToDto(view)`
- `inventoryViewToDto(view)` (replaces `toDto`): flattens `view.item.*` + `view.product?.*` into the DTO shape. `updatedAt` → ISO string, `productName`/`productSku`/`productImageUrl` from `view.product ?? { … null }`
- `buildProductMap` helper deleted (moved into the service)

### 3.6 Tests

**New:** `libs/core/src/inventory/application/services/__tests__/inventory-query.service.spec.ts`. Mirrors the pattern in existing inventory service specs. Covers:
1. `listInventoryItems` composes product onto each item
2. `listInventoryItems` deduplicates product lookups (two items, same productId → one `findById`)
3. `listInventoryItems` returns `product: null` when the product lookup returns null
4. `listInventoryItems` passes filters + pagination through to the repository unchanged
5. `listInventoryItems` returns empty items on empty repository result
6. `getInventoryItem` composes product when both exist
7. `getInventoryItem` returns `null` when the inventory item doesn't exist (and does NOT call the product repo)
8. `getInventoryItem` returns a view with `product: null` when the item exists but the product lookup returns null
9. `listInventoryItems` preserves the order of `repository.findMany` results after composition (dedup via `Set` must not reorder the output array)

Mocks use `jest.Mocked<InventoryRepositoryPort>` and `jest.Mocked<ProductRepositoryPort>` — ports, not concrete classes (per backend rules).

**Update:** `apps/api/src/inventory/http/inventory.controller.spec.ts`. Mocks a single `IInventoryQueryService`:
- `listInventoryItems: jest.fn()` returning `PaginatedInventoryView`
- `getInventoryItem: jest.fn()` returning `InventoryItemView | null`

Controller tests shrink to:
1. `listInventory` — service returns a two-item view; assert DTO shape (pagination echo, ISO string, flattened product fields)
2. `listInventory` with absent product on one item — assert flattened `productName/Sku/ImageUrl` are all `null`
3. `listInventory` passes filters + pagination into the service
4. `getInventoryItem` flattens the view into the DTO (happy path)
5. `getInventoryItem` — service returns null → `NotFoundException`

Composition-specific cases (deduplication, null product for shared productId) move to the service spec where the composition actually lives.

---

## 4. Step-by-step

| # | File | Action |
|---|---|---|
| 1.1 | `libs/core/src/inventory/inventory.tokens.ts` | Add `INVENTORY_QUERY_SERVICE_TOKEN`. |
| 1.2 | `libs/core/src/inventory/application/types/inventory-view.types.ts` | **New.** `InventoryItemView`, `InventoryViewProduct`, `PaginatedInventoryView`. |
| 1.3 | `libs/core/src/inventory/application/services/inventory-query.service.interface.ts` | **New.** `IInventoryQueryService` with `listInventoryItems` + `getInventoryItem`. |
| 1.4 | `libs/core/src/inventory/application/services/inventory-query.service.ts` | **New.** `@Injectable` impl; private `buildProductMap` + `compose`. |
| 1.5 | `libs/core/src/inventory/inventory.module.ts` | Import new class + token; provider + `useExisting`; add to exports; re-export token. |
| 1.6 | `libs/core/src/inventory/index.ts` | Export new token, interface, class, view types. |
| 2.1 | `libs/core/src/inventory/application/services/__tests__/inventory-query.service.spec.ts` | **New.** 9 unit tests per §3.6. |
| 3.1 | `apps/api/src/inventory/http/inventory.controller.ts` | Replace both repo injections with single service injection; rewrite `list`/`get`; delete `buildProductMap`; `toDto` → `inventoryViewToDto`; drop `@openlinker/core/products` imports. |
| 3.2 | `apps/api/src/inventory/http/inventory.controller.spec.ts` | Mock single `IInventoryQueryService`; rewrite tests per §3.6. |
| 4.1 | `apps/api/src/inventory/inventory.module.ts` | **Decision:** remove `ProductsModule` import — no longer needed once the controller stops reading `ProductRepositoryPort` directly. **Before deleting**, run `grep -R "@openlinker/core/products" apps/api/src/inventory/` **from the worktree root** (`.claude/worktrees/280-inventory-query-service/`) to confirm no other file in the module still imports from products. If anything remains, leave the import. |
| 5.1 | `apps/api/test/integration/inventory-read.int-spec.ts` | **Verify** (no code change expected): file already covers `GET /inventory` and `GET /inventory/:id`. This is the byte-identical safety net per §1. Must stay green after the refactor; if a case is missing, extend it here before shipping. |
| 5.2 | Quality gate | `pnpm lint && pnpm type-check && pnpm test && pnpm test:integration` per acceptance criteria. |

---

## 5. Risks & mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| HTTP response shape drifts (breaking FE / existing integration tests) | Low | Issue's primary acceptance: "byte-identical." Controller's `inventoryViewToDto` is a mechanical rewrite of `toDto`; every field maps 1:1. `pnpm test:integration` must pass. |
| N+1 regression — `buildProductMap` moves but loses dedup | Very low | Moving the helper verbatim, including `[...new Set(productIds)]`. Dedicated unit test covers the dedup invariant. |
| Circular DI (inventory module importing products module, both exposing services) | Very low | `inventory.module.ts` already imports `ProductsModule`. No new cycle introduced. |
| Test drift — controller spec and service spec overlap | Medium | Explicit split: composition correctness lives in the service spec; HTTP-shape correctness lives in the controller spec. Documented in §3.6. |
| Controller-spec coverage regression on the `inventoryViewToDto` branches (null-vs-populated product) | Low | §3.6 controller test #2 covers the "one item with absent product" branch; combined with test #1 (both items have products) the populated/null pair is exercised. Verify branch coverage on the controller spec after implementation. |
| Forgotten re-export from `index.ts` (consumers in `apps/api` rely on barrel exports) | Low | Step 1.6 is explicit; verified at type-check. |

---

## 6. Architecture compliance check

- ✅ `InventoryQueryService` is in `application/services/` and implements `I{Purpose}Service` in a separate `.interface.ts` (colocated per module convention — see §2).
- ✅ Depends only on port interfaces (`InventoryRepositoryPort`, `ProductRepositoryPort`) via Symbol tokens.
- ✅ View model is framework-free (no `@ApiProperty`, no transport-layer concerns).
- ✅ Types in a separate `*.types.ts` file.
- ✅ Controller interfaces → application dependency direction preserved; no infrastructure imports added.
- ✅ No `any`, no `console.log`, no new `synchronize: true`.
- ✅ Domain layer untouched.
- ✅ Unit tests mock ports, not concrete classes.

---

## 7. Rollout

Single commit. Reversible via `git revert`. No migration, no config, no env. Acceptance gate per issue: unit tests + integration tests + byte-identical responses. The integration test on `GET /inventory` and `GET /inventory/:id` is the safety net proving shape preservation end-to-end.

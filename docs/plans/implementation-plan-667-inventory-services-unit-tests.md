# Implementation Plan — #667 Add unit tests for inventory application services

| Layer | Scope | Risk |
|---|---|---|
| CORE / tests | Two `*.spec.ts` files in `libs/core/src/inventory/application/services/__tests__/` | Low — pure tests, no production-code change |

## 1. Scope reality check

The issue says three services have "no co-located `*.spec.ts`" but research shows only one is actually missing:

| Service | LoC | Existing spec | Real gap |
|---|---|---|---|
| `inventory-query.service.ts` | 98 | 9 tests, 200 LoC — list/get composition, dedup, null handling, filter passthrough, ordering | **No gap** — well-covered. |
| `inventory-sync.service.ts` | 91 | 2 tests, 78 LoC — batch happy path + per-item-fallback partial failure | Four narrow branches missing: single-item delegate, empty-items early return, non-batch-capable adapter, deterministic idempotency-key generation. |
| `master-inventory-sync.service.ts` | 97 | **none** | Whole file uncovered — the actual gap. |

Also: the issue describes `inventory-sync` as orchestrating "master-slave" inventory propagation, but the actual code propagates **offer quantities to a marketplace** via `OfferManagerPort`. The master→canonical responsibility lives in `MasterInventorySyncService`. The issue conflated the two; the implementation follows the code, not the issue text.

## 2. Layout decision

Existing specs in this module live in `__tests__/`, not as `*.spec.ts` siblings. Match local precedent — the issue's "co-located" wording is loose (per engineering-standards.md the test-file pattern is `*.spec.ts`; layout is mixed across the repo).

## 3. Files

### 3.1 `__tests__/master-inventory-sync.service.spec.ts` (new)

Mocks (per `engineering-standards.md § Mocking Ports`):

- `IIntegrationsService` (port mock — `getCapabilityAdapter` returns `InventoryMasterPort`)
- `IIdentifierMappingService` (port mock — `getOrCreateInternalId`)
- `IInventoryService` (port mock — `getInventory` + `setInventory`)
- `InventoryMasterPort` (port mock — `getInventory`)

Coverage plan (test names follow `should [behaviour] when [condition]`):

- `should resolve external→internal ID and set inventory when adapter returns a complete inventory record` — happy-path: identifier-mapping resolves, adapter returns `Inventory` with `available`/`reserved`/`updatedAt`, `inventoryService.setInventory` is called with a domain `InventoryItem` carrying the right quantities; result echoes the canonical IDs.
- `should derive available from quantity minus reserved when adapter omits available` — exercises the `available ?? quantity - reserved` fallback in `toDomainInventoryItem` (line 82-84).
- `should preserve existing inventory item ID when an InventoryItem already exists for the (product, variant, location)` — `inventoryService.getInventory` returns a pre-existing entity → `setInventory` is called with the *same* `inventoryItemId`. Tests the identity preservation that prevents duplicate rows.
- `should mint a fresh inventory item ID when no existing record matches` — `inventoryService.getInventory` returns null → `setInventory` receives a freshly generated UUID. Sister branch to the previous.
- `should propagate getCapabilityAdapter failures` — `integrationsService.getCapabilityAdapter` rejects (e.g. unsupported capability) → the error bubbles to the caller, no inventory write happens.
- `should propagate adapter.getInventory failures and skip the local write` — adapter fetch throws → no `inventoryService.setInventory` call, error bubbles. Confirms partial-failure safety (no half-written state).
- `should default updatedAt to now when adapter omits it` — adapter returns inventory without `updatedAt` → domain entity gets a current `Date`. Asserts via `expect.any(Date)`.

Total: 7 focused tests. ~150-180 LoC.

### 3.2 `__tests__/inventory-sync.service.spec.ts` (extend existing)

Add four tests covering the missing branches. Keep the two existing tests untouched (they work).

- `should return empty result without resolving the adapter when items is empty` — verifies the `if (!cmd.items || cmd.items.length === 0)` early return at line 37. Asserts `integrationsService.getCapabilityAdapter` was NOT called.
- `should delegate updateOfferQuantity to updateOfferQuantities` — single-command path: assert single-item batch is invoked end-to-end and the result shape matches.
- `should issue per-item updates when the adapter is not OfferQuantityBatchUpdater-capable` — mock `OfferManagerPort` *without* the `updateOfferQuantitiesBatch` method → forces per-item path via the `isOfferQuantityBatchUpdater` guard. Confirms `updateOfferQuantity` called N times, `updateOfferQuantitiesBatch` never called.
- `should auto-generate a deterministic idempotency key when an item omits one` — call with `{ offerId, quantity }` only (no `idempotencyKey`). Inspect the argument passed to `updateOfferQuantity` and assert it carries an `idempotencyKey` matching `/^inv:[a-f0-9]{16}$/`. Second call with the same shape produces the same key (deterministic SHA-256 truncation per `buildIdempotencyKey` at line 84-89).

Total: +4 tests. ~80-100 LoC delta on the file.

### 3.3 `inventory-query.service.spec.ts` — no changes

Already at 9 tests covering every branch. Touching it would be busywork.

## 4. Architecture compliance check

- **Mock ports, not concrete adapters**: ✓ All four mocks above target port/interface types (`InventoryMasterPort`, `IIntegrationsService`, `IIdentifierMappingService`, `IInventoryService`, `OfferManagerPort`).
- **Cross-context imports through top-level barrels** (`engineering-standards.md § Import Aliases`): ✓ Existing specs use `@openlinker/core/integrations`, `@openlinker/core/listings`, `@openlinker/core/identifier-mapping`, `@openlinker/core/products` — match.
- **Same-context cross-layer relative**: ✓ `../master-inventory-sync.service`, `../../../domain/...` (≤ `../..` rule).
- **No `any`**: any `as unknown as jest.Mocked<...>` cast is the established repo pattern (see existing inventory-sync spec line 16, 32) — used only at mock-construction boundaries.
- **Test names**: `should [behaviour] when [condition]` per the existing inventory-query spec and `engineering-standards.md § Test Naming`. ✓

## 5. Quality gate

```bash
pnpm lint                # 0 errors
pnpm type-check          # clean
pnpm test                # all suites green + new tests visible
```

Coverage check (informational — verify ≥80% on the three target files):

```bash
pnpm --filter @openlinker/core test:cov -- \
  --collectCoverageFrom='src/inventory/application/services/{inventory-query,inventory-sync,master-inventory-sync}.service.ts'
```

## 6. Commit + PR

Single conventional-commit:

```
test(inventory): add master-inventory-sync spec + close inventory-sync branch gaps (#667)
```

PR description notes:
- Issue's "three services missing specs" claim was partially out of date — only `master-inventory-sync` was truly uncovered.
- `inventory-query` already at 9 tests, intentionally untouched.
- Layout matches local `__tests__/` precedent.

## 7. Validation checklist

- [ ] `master-inventory-sync.service.spec.ts` exists with 7 tests covering: happy-path, available-fallback derivation, existing-ID preservation, fresh-ID minting, adapter-not-supported error, adapter-fetch error, updatedAt default.
- [ ] `inventory-sync.service.spec.ts` extended with 4 tests: empty-items early return, single-item delegate, non-batch-capable adapter, deterministic idempotency key.
- [ ] `pnpm lint && pnpm type-check && pnpm test` green.
- [ ] All mocks target port/interface types; no concrete-adapter instantiation.
- [ ] Test names match the `should [behaviour] when [condition]` pattern.

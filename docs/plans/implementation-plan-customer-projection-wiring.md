# Implementation Plan — #465: wire `OrderCustomerProjectionUpdater` into ingestion + backfill names

## 1. Goal

Make customer-projection rows actually populated when an Allegro (or any source) order is ingested:

- **Bug A — addresses**: `OrderCustomerProjectionUpdaterService` is registered but never called. Hook it into `OrderIngestionService.syncOrderFromSource()`.
- **Bug B — names**: identity resolver writes `firstName: null, lastName: null` because at that point names aren't available. Backfill from `order.shippingAddress` (fallback to `billingAddress`) inside the same updater, with non-clobbering semantics (don't overwrite a set name with `null`).

## 2. Layer classification

- **Bounded context**: Customers (extend updater), Orders (call site).
- **Layer**: Application services on both sides + a small interface addition on `ICustomerProjectionService`.
- **Hexagonal compliance**: Orders → Customers application interface (token-injected). No new infrastructure. No schema change.

## 3. Non-goals

- Backfilling the existing 19 sandbox orders. Re-ingest after fix.
- Making `firstName/lastName` available *during* identity resolution. The resolver's hardcoded `null` names at `customer-identity-resolver.service.ts:255-256` stay; backfill happens in the updater after the order is built.
- `phone` / `company` on the projection (schema doesn't carry them).
- Auto-promoting projection PII off `order.buyer` (no buyer block on `Order` today).
- Touching the destination provisioning path (PrestaShop customer create) — that already gets shipping name via `OrderCreate.shippingAddress`.

## 4. Existing-code baseline

| Path | Role today |
|---|---|
| `libs/core/src/customers/application/services/order-customer-projection-updater.service.ts` | Working impl for address projections only; never called in production. No interface (rule violation). |
| `libs/core/src/customers/application/services/customer-projection.service.ts` | Wraps repo `upsert`; `OL_STORE_PII` filter applied at the service. No `find` method. |
| `libs/core/src/customers/application/interfaces/customer-projection.service.interface.ts` | `ICustomerProjectionService` — three methods, no read. |
| `libs/core/src/customers/customers.module.ts` | Registers updater as a class. Comment: "Export service class for direct injection". No DI token. |
| `libs/core/src/customers/customers.tokens.ts` | Symbols for the other 3 services; **none for the updater**. |
| `libs/core/src/customers/application/services/customer-identity-resolver.service.ts:251-261` | Hardcodes `firstName: null, lastName: null`. Will not change. |
| `libs/core/src/orders/application/services/order-ingestion.service.ts:170-269` | Builds unified `Order` at :233, dispatches to `orderSyncService.syncOrder` at :236. **Insertion point: between :234 and :236.** |
| `libs/core/src/orders/orders.module.ts:30,43` | Already imports `CustomersModule`. |
| `apps/worker/src/sync/sync-worker.module.ts:44` | Imports `CustomersModule` "to access OrderCustomerProjectionUpdaterService" — cargo. Worker never injects it. Leaving as-is (module-level imports are cheap; removing is a separate cleanup). |

## 5. Design

### 5.1 Interface + token (Customers context)

Bring the updater in line with project rules: every service implements an interface; cross-context injection uses a Symbol token.

- New file `libs/core/src/customers/application/interfaces/order-customer-projection-updater.service.interface.ts`:
  ```ts
  export interface IOrderCustomerProjectionUpdaterService {
    updateProjectionsForOrder(
      order: Order,
      internalCustomerId: string,
      sourceConnectionId: string,
    ): Promise<void>;
  }
  ```
- Add `ORDER_CUSTOMER_PROJECTION_UPDATER_SERVICE_TOKEN = Symbol('IOrderCustomerProjectionUpdaterService')` to `customers.tokens.ts`.
- Bind `useExisting: OrderCustomerProjectionUpdaterService` to the new token and **export the token** from `CustomersModule`. **Remove the now-dead class export.** Per the review, keeping it preserves a code path that has never been used. Engineering-standards.md "Service Interface Implementation" says services are accessed via their interface; with the token wired, that's the only access path.
- Drop the worker's direct `CustomersModule` import at `apps/worker/src/sync/sync-worker.module.ts:44` (and its stale comment). The worker injects the updater transitively via `OrdersModule` (which already imports `CustomersModule` and is itself imported by the worker).

### 5.2 `ICustomerProjectionService.getProjection(internalCustomerId)`

The updater needs to read the existing projection to merge names without clobbering. Simplest dependency-correct path: extend the projection service (already injected into the updater) rather than adding a second collaborator. Implementation delegates to `repository.findById`.

Add to `ICustomerProjectionService`:
```ts
getProjection(internalCustomerId: string): Promise<CustomerProjection | null>;
```

Implementation in `CustomerProjectionService`:
```ts
async getProjection(internalCustomerId: string): Promise<CustomerProjection | null> {
  return this.repository.findById(internalCustomerId);
}
```

### 5.3 `OrderCustomerProjectionUpdaterService` extension

**Structure (post-review fix):** `updateProjectionsForOrder` becomes a thin orchestrator that calls two private helpers — `backfillCustomerNames` and `upsertAddresses`. Each helper owns its own short-circuiting; neither short-circuits the other. The address path stays exactly as it is today (just moved into a private method); the name-backfill path is new.

```ts
async updateProjectionsForOrder(order, internalCustomerId, sourceConnectionId): Promise<void> {
  if (!internalCustomerId?.trim()) {
    throw new CustomerProjectionException(...); // unchanged guard
  }
  await this.backfillCustomerNames(order, internalCustomerId, sourceConnectionId);
  await this.upsertAddresses(order, internalCustomerId);
}

private async backfillCustomerNames(order, internalCustomerId, sourceConnectionId): Promise<void> {
  const incomingFirst = trimToNull(order.shippingAddress?.firstName) ?? trimToNull(order.billingAddress?.firstName);
  const incomingLast  = trimToNull(order.shippingAddress?.lastName)  ?? trimToNull(order.billingAddress?.lastName);

  const existing = await this.customerProjectionService.getProjection(internalCustomerId);
  if (!existing) {
    this.logger.warn(
      `No projection found for ${internalCustomerId} (connection: ${sourceConnectionId}); skipping name backfill`,
    );
    return; // skips ONLY the name backfill — addresses still run from updateProjectionsForOrder
  }

  const piiOn = getPiiConfig().storePii;
  const mergedFirstName = piiOn ? (incomingFirst ?? existing.firstName) : null;
  const mergedLastName  = piiOn ? (incomingLast  ?? existing.lastName)  : null;

  const sameNames = mergedFirstName === existing.firstName && mergedLastName === existing.lastName;
  const sameConn  = sourceConnectionId === existing.lastSourceConnectionId;
  if (sameNames && sameConn) return;

  await this.customerProjectionService.upsertProjection(
    new CustomerProjection(
      existing.internalCustomerId,
      existing.emailHash,
      existing.normalizedEmail,
      mergedFirstName,
      mergedLastName,
      new Date(),                 // lastSeenAt
      sourceConnectionId,
      existing.createdAt,
      new Date(),                 // updatedAt
    ),
  );
}

private async upsertAddresses(order, internalCustomerId): Promise<void> {
  // exact body of today's address handling — extracted unchanged
}
```

**Helper:**

```ts
const trimToNull = (v?: string | null): string | null => {
  const t = v?.trim() ?? '';
  return t === '' ? null : t;
};
```

**Notes:**

- **Why the structural split** (review BLOCKING fix): the original sketch used bare `return` inside one big function; that would have skipped the address path on the "no projection found" or "idempotent" branches and silently regressed the existing 6 address tests. With two helpers, each branch is local.
- **Why the no-op skip is safe (lastSeenAt):** `customer-identity-resolver.service.ts:240-271` runs *earlier* in the ingestion pipeline (`order-ingestion.service.ts:188`) and already advances `lastSeenAt` on every order. So when names are unchanged we can safely skip the round-trip without leaving `lastSeenAt` stale.
- **PII-off behavior is intentionally clobbering:** when `OL_STORE_PII=false`, `mergedFirstName/lastName` are forced to `null`. If the toggle ever flips `true → false` mid-stream, the next ingestion purges any previously-stored names. This matches `CustomerProjectionService.upsertProjection` (`customer-projection.service.ts:30-44`), which already nulls names on save in hash-only mode. Documented here so it's not flagged again in PR review.
- **Read-modify-write race:** under truly concurrent ingestion of two orders for the same customer, last-write-wins. Same outcome as without the merge step. Not worth a transaction.
- **Rename:** `_sourceConnectionId` (currently unused, underscore-prefixed) becomes `sourceConnectionId` — it's now consumed.

### 5.4 Wiring into `OrderIngestionService`

Add one constructor dep, one call:

```ts
constructor(
  // …existing deps…
  @Inject(ORDER_CUSTOMER_PROJECTION_UPDATER_SERVICE_TOKEN)
  private readonly customerProjectionUpdater: IOrderCustomerProjectionUpdaterService,
) {}

// inside syncOrderFromSource, between persistOrder (line 234) and syncOrder (line 236):
if (internalCustomerId) {
  try {
    await this.customerProjectionUpdater.updateProjectionsForOrder(order, internalCustomerId, connectionId);
  } catch (error) {
    this.logger.warn(
      `Failed to update customer projections for order ${order.id} (customer: ${internalCustomerId}, connection: ${connectionId}): ${(error as Error).message}`,
      error,
    );
    // swallow — projections are non-authoritative
  }
}
```

Position chosen per the issue: *before* the destination dispatch so a destination failure doesn't drop projection updates. The `try/catch` mirrors `customer-identity-resolver.service.ts:264-269`'s posture.

### 5.5 Module wiring

`customers.module.ts`:
- Add token binding `{ provide: ORDER_CUSTOMER_PROJECTION_UPDATER_SERVICE_TOKEN, useExisting: OrderCustomerProjectionUpdaterService }`.
- Export the token. **Drop `OrderCustomerProjectionUpdaterService` from `exports`** — see §5.1 for rationale.

`orders.module.ts`: no change needed (already imports `CustomersModule`).

`apps/worker/src/sync/sync-worker.module.ts`: drop the direct `CustomersModule` import + comment. The worker reaches `OrderCustomerProjectionUpdaterService` transitively through the `OrdersModule` it already imports.

`libs/core/src/customers/index.ts`: barrel already re-exports `application/services/order-customer-projection-updater.service` and `customers.tokens`. Add a re-export for the new interface file: `export * from './application/interfaces/order-customer-projection-updater.service.interface'`.

## 6. Step-by-step implementation

| # | File | Action |
|---|---|---|
| 1 | `libs/core/src/customers/customers.tokens.ts` | Add `ORDER_CUSTOMER_PROJECTION_UPDATER_SERVICE_TOKEN` Symbol. |
| 2 | `libs/core/src/customers/application/interfaces/order-customer-projection-updater.service.interface.ts` | Create new interface file. |
| 3 | `libs/core/src/customers/application/interfaces/customer-projection.service.interface.ts` | Add `getProjection(internalCustomerId)` to `ICustomerProjectionService`. |
| 4 | `libs/core/src/customers/application/services/customer-projection.service.ts` | Implement `getProjection`. |
| 5 | `libs/core/src/customers/application/services/order-customer-projection-updater.service.ts` | Implement `IOrderCustomerProjectionUpdaterService`. Add name-backfill block. Use `sourceConnectionId` parameter. Add `Logger` field. Add `trimToNull` helper. |
| 6 | `libs/core/src/customers/customers.module.ts` | Bind + export `ORDER_CUSTOMER_PROJECTION_UPDATER_SERVICE_TOKEN`. |
| 7 | `libs/core/src/customers/index.ts` (barrel) | Re-export token + interface, if pattern matches the other tokens. |
| 8 | `libs/core/src/orders/application/services/order-ingestion.service.ts` | Inject updater, call before `syncOrder`, wrap try/catch. |
| 9 | `libs/core/src/customers/application/services/customer-projection.service.spec.ts` | Add `getProjection` happy + miss tests. |
| 10 | `libs/core/src/customers/application/services/order-customer-projection-updater.service.spec.ts` | Add 6 cases (see §7). Existing address tests stay green; update mock to include `getProjection` returning a base projection. |
| 11 | `libs/core/src/orders/application/services/__tests__/order-ingestion.service.spec.ts` | Add updater mock to constructor. Add tests for: updater called with correct args after `persistOrder`; updater error swallowed and `syncOrder` still called. |

## 7. Test cases for the updater (additions)

All operate on `backfillCustomerNames` behavior (observable via `upsertProjection` calls):

1. `shippingAddress.firstName/lastName` set, `OL_STORE_PII=true`, existing projection has `null` names → `upsertProjection` called once with merged names.
2. `shippingAddress` missing, `billingAddress` has names → falls back to billing.
3. Neither address has names, existing projection ALSO has `null` names → `upsertProjection` NOT called (nothing to merge, no `lastSourceConnectionId` change either).
4. Neither address has names, existing projection has `'Old'` names → preserved (no clobber, no upsert).
5. Existing has `'Old'`, incoming is empty string `""` or `"   "` → `trimToNull` returns null, preserved as `'Old'` (no clobber, no upsert).
6. Existing has `'Old'`, incoming has `'New'` → updated to `'New'`.
7. `OL_STORE_PII=false`, existing has `'Old'` names → upsert called with `firstName: null, lastName: null` (intentional clobber, mirrors `CustomerProjectionService.upsertProjection` behavior).
8. `getProjection` returns `null` → warn log emitted, no `upsertProjection` called, **address path still runs** (assert `upsertAddressProjection` is invoked normally for shipping/billing).
9. Existing projection identical to incoming names AND same `lastSourceConnectionId` → no `upsertProjection` (idempotent skip).

Existing 6 address-handling tests must continue to pass. Add `customerProjectionService.getProjection = jest.fn().mockResolvedValue(<base projection with null names>)` to the shared `beforeEach`. Test 8 specifically asserts the structural fix from §5.3 — address writes don't get short-circuited when name backfill bails.

## 8. Risks / open questions

- **Read-modify-write race**: addressed under §5.3. Acceptable LWW.
- **`getProjection` round-trip cost per order**: ~1ms PG primary-key lookup. Negligible against the rest of ingestion.
- **Backfill of existing 19 orders**: not in scope. User acknowledged "easier to just re-ingest" in dev.
- **Worker module's dead `CustomersModule` import comment**: leaving as-is. Any cleanup is a separate PR.

## 9. Quality gate

```bash
pnpm lint && pnpm type-check && pnpm test
```

No migrations. No `pnpm migration:show` needed.

## 10. Acceptance (mirrors issue)

- [ ] Customer detail shows buyer first/last name after one Allegro order with `shippingAddress.firstName/lastName`.
- [ ] Customer detail shows ≥1 `'shipping'` address projection after one such order.
- [ ] Two orders with identical shipping → one address row, `lastSeenAt` advances.
- [ ] `OL_STORE_PII=false`: emailHash + addressHash present, names + address fields all `null`.
- [ ] Projection-write failure does not break order sync.
- [ ] No new dependency from Orders → Customers infrastructure (only on the new interface + token).
- [ ] `pnpm lint && pnpm type-check && pnpm test` green.

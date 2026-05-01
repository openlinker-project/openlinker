# Implementation Plan — #467 PS Shipping Cost Reconcile via order_carriers PUT

## 1 — Goal

After `POST /orders` succeeds, reliably reconcile the per-order shipping cost in PrestaShop by issuing `PUT /order_carriers/{id}` with `shipping_cost_tax_excl` / `shipping_cost_tax_incl` derived from `order.totals.shipping`. This bypasses PS's habit of silently zeroing `total_shipping` when `id_carrier` doesn't resolve to a zone-priced carrier.

**Layer**: Integration / Infrastructure (PS adapter + WS client).

**Non-goals**:
- Real shipping-tax handling (still tax-included = tax-excluded).
- Carrier-mapping resolution improvements (operator workaround stands).
- Generalising to other destinations.
- Changing `OrderProcessorManagerPort`.

## 2 — Codebase research notes

- **Adapter happy path** lives in `libs/integrations/prestashop/src/infrastructure/adapters/prestashop-order-processor-manager.adapter.ts:59-466`. After Step 6 mints the identifier mapping, Step 7 returns the `OrderRef`. The reconcile call slots in **between** Step 6 and Step 7 — after the mapping is durable, so a reconcile failure can't orphan the mapping.
- **Hard-coded `id_carrier=1` warn log already exists** at `prestashop-order-processor-manager.adapter.ts:517-521`. So the AC about logging the fallback is **already met on main** — no companion change needed. I'll note it in the PR description rather than re-implement.
- **WS client interface** at `libs/integrations/prestashop/src/infrastructure/http/prestashop-webservice.client.interface.ts:33` exposes `getResource`, `listResources`, `createResource`. **No `updateResource`** — needs adding.
- **WS client implementation** at `libs/integrations/prestashop/src/infrastructure/http/prestashop-webservice.client.ts`. The `createResource` method (lines 175-287) does XML wrapping (`{ prestashop: { customer: {...} } }`), POSTs to `/{resource}`, and unwraps the response. `updateResource` will mirror this pattern with `PUT /{resource}/{id}`. PS WS `PUT` follows the same XML-wrap envelope as `POST`.
- **PS `order_carrier` shape**: needs adding next to `PrestashopOrder` in `libs/integrations/prestashop/src/infrastructure/mappers/prestashop.mapper.interface.ts:71-88`. Required fields for an update: `id`, `id_order`, `id_carrier` (PS validates these even on PUT), and the cost fields we want to write.
- **Looking up the `order_carrier.id`**: PS WS `POST /orders` does **not** echo the auto-created `order_carrier` row. We have to `GET /order_carriers?filter[id_order]=<orderId>&display=full` and pick the single row. This uses the existing `listResources` method.
- **Mock HTTP client factory** at `libs/integrations/prestashop/src/__tests__/mocks/mock-http-client.factory.ts` lists the existing methods. Adding `updateResource` requires a one-line edit to the factory so existing specs keep type-checking.
- **Existing adapter spec** at `libs/integrations/prestashop/src/infrastructure/adapters/__tests__/prestashop-order-processor-manager.adapter.spec.ts` uses an `IPrestashopWebserviceClient` jest-mocked from the factory; tests run sequentially through stubs. I'll add a dedicated `describe('shipping cost reconciliation', ...)` block.

## 3 — Solution design

### Sequence inside `createOrder`

The reconcile step runs in **both** the Step 0 early-return path and the Step 6 first-create path so retries can self-heal a partial first run (review feedback — IMPORTANT #1). Best-effort everywhere; no path bubbles a reconcile error.

```
if (order.totals.shipping > 0):
  try:
    // 1. Find the auto-created order_carrier row.
    rows = httpClient.listResources<PrestashopOrderCarrier>(
      'order_carriers',
      { custom: { id_order: externalOrderId } },
      1, 0,
    )
    if rows.length === 0:
      logger.warn('order_carrier row missing for ...')   // skip — nothing to update
      return

    orderCarrierId = rows[0].id

    // 2. Fetch the full row (PS WS PUT requires the complete resource — review #2).
    full = httpClient.getResource<PrestashopOrderCarrier>('order_carriers', orderCarrierId)

    // 3. Overlay the cost fields and PUT back.
    shippingCost = order.totals.shipping.toFixed(2)
    httpClient.updateResource<PrestashopOrderCarrier>(
      'order_carriers',
      orderCarrierId,
      {
        ...full,
        shipping_cost_tax_excl: shippingCost,
        shipping_cost_tax_incl: shippingCost,
      },
    )
  catch (error):
    logger.warn(`Shipping cost reconcile failed for internalOrderId=${internalOrderId} externalOrderId=${externalOrderId}: ${err.message}`, err.stack)
```

Reconcile failure is **swallow-and-log**. The order is already created and the mapping is durable; we'd rather have an order with €0 shipping than no order at all. The `OrderRef` returned to the orchestrator is unchanged.

**Replay semantics**: invoking the reconcile step again on an already-correct `order_carrier` row is a no-op (PUT writes the same `shipping_cost_*` values). Safe to run on retries.

### `updateResource` contract

```ts
updateResource<T = unknown>(
  resource: string,
  id: string | number,
  data: Record<string, unknown>,
): Promise<T>;
```

Mirrors `createResource` exactly except: `PUT /{resource}/{id}` and inner-id-injection. PS WS PUT requires the `id` to be present in the inner XML body (not just the path) — an asymmetry vs POST.

### `PrestashopOrderCarrier` type

```ts
export interface PrestashopOrderCarrier {
  id: string | number;
  id_order: string | number;
  id_carrier: string | number;
  id_order_invoice?: string | number;
  weight?: string | number;
  shipping_cost_tax_excl?: string | number;
  shipping_cost_tax_incl?: string | number;
  tracking_number?: string;
  date_add?: string;
  [key: string]: unknown;
}
```

## 4 — Step-by-step implementation

| # | File | Change |
|---|---|---|
| 1 | `libs/integrations/prestashop/src/infrastructure/mappers/prestashop.mapper.interface.ts` | Add `PrestashopOrderCarrier` interface next to `PrestashopOrder` (line ~89). |
| 2 | `libs/integrations/prestashop/src/infrastructure/http/prestashop-webservice.client.interface.ts` | Add `updateResource<T>(resource: string, id: string \| number, data: Record<string, unknown>): Promise<T>` to `IPrestashopWebserviceClient`. |
| 3 | `libs/integrations/prestashop/src/infrastructure/http/prestashop-webservice.client.ts` | Implement `updateResource`: build URL via `PrestashopQueryBuilder.buildResourcePath(resource, id)`, XML-wrap as `{ prestashop: { <singular>: data } }`, send `PUT` with `Content-Type: application/xml`, parse + unwrap response identically to `createResource`. |
| 4 | `libs/integrations/prestashop/src/__tests__/mocks/mock-http-client.factory.ts` | Add `updateResource: jest.fn()` to the factory return. |
| 5 | `libs/integrations/prestashop/src/infrastructure/adapters/prestashop-order-processor-manager.adapter.ts` | Add private `reconcileShippingCost(order, externalOrderId, internalOrderId)`. Call it on **both** the Step 0 early-return path AND between Step 6 and Step 7. Skip when `order.totals.shipping <= 0`. GET → spread → PUT pattern (full resource body). Try/catch the whole block; failures log a `warn` with `internalOrderId`, `externalOrderId`, error message — never re-thrown. |
| 6 | `libs/integrations/prestashop/src/infrastructure/adapters/__tests__/prestashop-order-processor-manager.adapter.spec.ts` | Add `describe('shipping cost reconciliation', ...)` with four tests, named per Engineering Standards `should [expected] when [condition]`: (a) `should write shipping_cost_* via order_carriers PUT when totals.shipping > 0`; (b) `should skip the order_carriers round-trip when totals.shipping is zero`; (c) `should warn and skip the PUT when no order_carrier row is found`; (d) `should swallow and log when the order_carriers update throws`. All tests assert the returned `OrderRef` is correct and no exception escapes. |
| 7 | `libs/integrations/prestashop/src/infrastructure/http/__tests__/prestashop-webservice.client.spec.ts` (or co-located) | Add minimal `updateResource` test if a spec file exists for the client; otherwise extend whatever covers `createResource`. (Will check for existence in step 7.) |

### Insertion points in the adapter

Two call sites, both best-effort. The same `reconcileShippingCost` private method is awaited from both, so retries self-heal a partially-completed first run.

**Site A — Step 0 early-return path** (after `getExternalIds` finds an existing destination mapping, before returning the existing `OrderRef`):
```ts
await this.reconcileShippingCost(order, existingPrestashopOrder.externalId, metadataInternalOrderId);
return { orderId: metadataInternalOrderId, orderNumber: ... };
```

**Site B — Step 6.5, between mapping write and return** (after `logger.log('Order mapping created: ...')`, before `// Step 7: Return order reference`):
```ts
// Step 6.5: Reconcile shipping cost on order_carriers (#467).
// PS silently zeros total_shipping on POST /orders when id_carrier
// doesn't resolve to a zone-priced carrier; PUT /order_carriers/{id}
// honours per-order cost regardless. Best-effort — failures are logged
// but never fail the order, which is already created and mapped.
await this.reconcileShippingCost(order, externalOrderId, internalOrderId);
```

## 5 — Validation

### Architecture compliance
- ✅ All changes inside `libs/integrations/prestashop/`. No new imports from CORE into integrations or vice-versa beyond what already exists.
- ✅ `OrderProcessorManagerPort` contract unchanged.
- ✅ `IPrestashopWebserviceClient` is the existing port-style interface — extending it is in-line with how `createResource` was added.

### Naming
- ✅ Method names follow camelCase (`updateResource`, `reconcileShippingCost`).
- ✅ Type `PrestashopOrderCarrier` matches existing `PrestashopOrder` shape and lives in the same file.

### Testing strategy
- All three branches covered as required by the issue (happy / skip / swallow-and-log).
- Mock-only — no real PS calls.
- Existing spec uses jest mocks via the factory; my additions extend the same patterns.

### Security
- No secrets or credentials in code.
- No new external calls beyond the existing PS WS surface (just a different verb).
- Logged values: `internalOrderId`, `externalOrderId`, `methodId`, error message — no PII.

### Risks
- **PS WS PUT format may need `<id>` inside the body** — handled by passing `id` in the data argument; if PS rejects, we'll see it in the swallow-and-log warn and can iterate. Worst case ships with reconcile silently failing; same result as today.
- **`id_order` filter on `listResources`** — `PrestashopQueryBuilder` already supports `custom` filters (used elsewhere in the adapter for `reference` lookup). If PS WS expects `filter[id_order]` differently for `order_carriers`, the `listResources` call will return empty and we'll log → no order corruption, just a missed reconcile.

### Open questions
- None blocking. Behaviour under PS 8.x vs 1.7.x not separately tested but the WS surface for `order_carriers` has been stable across both per Allegro/PS bridge code in the wild — reasonable starting point.

# Implementation Plan — #516: PS Adapter Sidecar Write + Reconcile Removal

**Issue**: [#516](https://github.com/SilkSoftwareHouse/openlinker/issues/516) — _PS adapter: sidecar write for OL carrier; remove reconcile workaround_
**Epic**: [#513](https://github.com/SilkSoftwareHouse/openlinker/issues/513) — _PrestaShop dynamic shipping via OL carrier module_
**Depends on**: #515 (PS module CarrierModule capability — landed via PR #524)
**Unblocks**: #517 (FE picker exposes OL Dynamic carrier), #518 (closes #510 / #511, rescopes #506)

---

## 1. Understand the Task

### Goal

Replace the post-create reconcile workarounds (`PUT /order_carriers/{id}` + the `PUT /orders/{id}` work in #510) with a **pre-create sidecar write** to the OL PS module's new endpoint (`POST ?module=openlinker&controller=cartshipping`, landed in #524). When the resolved PS carrier id equals the OL Dynamic carrier id, the adapter writes the buyer-paid amount into the sidecar table; PS then reads it via `getOrderShippingCostExternal()` at order-create time and the totals are correct on first POST. Result: no `current_state=8` (Payment error) badge, no reconcile, no double-write.

### Layer classification

**Integration** — pure changes inside `libs/integrations/prestashop/`. Two new files (HMAC-signed module client + a small types extension), one modified adapter, one modified mapper, one modified spec, plus deletions. Zero CORE / Frontend / Migration work.

### Explicit non-goals (carried from issue + epic)

- **No changes to the carrier-mapping data model** (`CarrierMapping` keeps `(allegroMethodId, psCarrierId)` shape; no mode/discriminator field).
- **No frontend changes** — #517 owns the carrier-mapping picker UI changes that surface OL Dynamic.
- **No backfill of orders synced under the reconcile-PUT path** (left at `current_state=8`; one-shot SQL is straightforward if needed).
- **No multistore / per-shop OL-carrier discovery** — single-store assumption matches #515's install pattern.
- **Carrier-id caching is deferred** — see §5 R3. Per-order GET to PS is the v1 simplification; revisit if it becomes a perf concern.

---

## 2. Research the Codebase

### Existing structures to reuse

| Surface | Location | How #516 reuses it |
|---|---|---|
| `MappingConfigService.resolveCarrierMapping(sourceConnId, methodId)` | `libs/core/src/mappings/application/services/mapping-config.service.ts` | Already wired into `resolveExternalCarrierId` at adapter line 602; keep this branch |
| `connection.config.defaultCarrierId` | `libs/integrations/prestashop/src/domain/types/prestashop-config.types.ts:123` | Already documented as fallback; keep semantics, just delete the carrier-1 hardcoded final fallback below it |
| `WebhookSecretProviderPort` / `WEBHOOK_SECRET_PROVIDER_TOKEN` | `libs/core/src/integrations/domain/ports/webhook-secret-provider.port.ts` | Used by the inbound webhook receiver to resolve `(provider, connectionId) → secret`. Reuse for **outbound** HMAC signing — same secret bytes the PS module uses to verify |
| `IPrestashopWebserviceClient` (Axios via `@nestjs/axios`) | `libs/integrations/prestashop/src/infrastructure/http/prestashop-webservice.client.ts` | Sibling pattern for the new `PrestashopOpenLinkerModuleClient` — same HTTP transport, same logging, same error-handling shape |
| `IdentifierMappingPort.getExternalIds('Cart', internalCartId)` | `libs/core/src/identifier-mapping/` | Used to resolve internal → external cart id at sidecar-write time. Cart already has its mapping persisted by `customer-and-cart` provisioning |
| Existing reconcile call site + method | adapter lines 101 (self-heal) + 478 (main path) + 521-581 (impl) | **Delete entirely.** Self-heal becomes a no-op return-existing |

### Inbound HMAC contract (mirror for outbound)

The PS module's `HmacRequestVerifier` (`apps/prestashop-module/openlinker/classes/HmacRequestVerifier.php`) verifies:
- `X-OpenLinker-Timestamp: <unix ms>` (numeric string)
- `X-OpenLinker-Signature: sha256=<64-char hex>`
- HMAC-SHA256 of `timestamp + "." + rawBody` with the connection's webhook secret
- ±5 min skew window
- `hash_equals` constant-time comparison

The TS sender (this PR) must produce the identical wire format. The inbound TS receiver at `apps/api/src/webhooks/application/services/webhook-auth.service.ts:34-129` already proves this contract works end-to-end — we mirror its `signedPayload = Buffer.concat([Buffer.from(timestamp), Buffer.from('.'), rawBody])` build, just on the outbound side.

### Code paths to delete (cleanup half of the issue)

1. `prestashop-order-processor-manager.adapter.ts:101-105` — self-heal call to `reconcileShippingCost`.
2. `prestashop-order-processor-manager.adapter.ts:473-478` — main-path call to `reconcileShippingCost`.
3. `prestashop-order-processor-manager.adapter.ts:521-581` — `reconcileShippingCost` private method.
4. `prestashop-order-processor-manager.adapter.ts:642-647` — the carrier-1 hardcoded fallback warn + `return undefined` path. Replaced by a `throw` with operator-actionable message.
5. `prestashop-order.mapper.ts:272-274` — `total_shipping`, `total_shipping_tax_incl`, `total_shipping_tax_excl` on the create-order body (PS recomputes from carrier regardless; leaving them was always cargo-cult).
6. `prestashop-order.mapper.ts:319-322` — comment block that documents the `id_carrier=0` reconcile path becomes stale; rewrite for the new flow or delete.
7. `prestashop-order-processor-manager.adapter.spec.ts` — the `'shipping cost reconciliation (#467)'` `describe` block tests for the deleted method. Replaced by the 6 new branches.
8. `IPrestashopWebserviceClient.put` if it exists ONLY for `order_carriers`. Verify via grep before deletion — likely retained for future use, in which case leave it in.

### Related docs / standards consulted

- `docs/architecture-overview.md §10 Plugin Manager / Integrations` — adapter resolution is per-connection; the new module client also resolves per-connection (HMAC secret is connection-scoped).
- `docs/engineering-standards.md §Naming Conventions` — adapters are `*-adapter.ts` / `{Platform}{Capability}Adapter`; the new HTTP helper is *not* an adapter (it doesn't implement a port), it's an HTTP client like `PrestashopWebserviceClient` — file naming `*.client.ts` matches the existing sibling.
- `docs/engineering-standards.md §Validation` — input validation belongs at interface layer, not in adapters; the cart-shipping payload is internally generated, no DTO validation needed.
- `.claude/rules/backend.md` — services implement interfaces in separate `*.service.interface.ts` files. The new module client follows the same pattern as `IPrestashopWebserviceClient`: interface in a `.interface.ts` file, implementation in the `.client.ts` file. Mock the interface in the adapter spec.

---

## 3. Design

### Data flow (this PR's scope)

```
OrderCreate (Allegro→PS sync, post-#516)
    │
    ▼
PrestashopOrderProcessorManagerAdapter.createOrder(order)
    │
    │ 1. Resolve customer (existing path, unchanged)
    │ 2. Resolve addresses (existing path, unchanged)
    │ 3. Resolve carrier:
    │       psCarrierId = await resolveExternalCarrierId(order, config)
    │         └─ mapping → defaultCarrierId → THROW (no carrier-1 fallback)
    │ 4. Discover OL Dynamic carrier id:
    │       olCarrierId = await openlinkerModuleClient.discoverDynamicCarrierId()
    │         └─ GET /api/carriers?filter[external_module_name]=openlinker&filter[active]=1&filter[deleted]=0
    │         └─ THROW if no row (operator hasn't installed/activated #515's module)
    │ 5. Create cart (existing path, unchanged) → externalCartId
    │ 6. IF psCarrierId === olCarrierId:
    │       await openlinkerModuleClient.writeCartShipping({
    │         externalCartId,
    │         amountTaxExcl: order.totals.shipping,
    │         amountTaxIncl: order.totals.shipping,
    │         source: `${order.source.platformType}:${order.source.externalOrderId}`,
    │       })
    │       └─ POST /index.php?fc=module&module=openlinker&controller=cartshipping
    │       └─ HMAC-signed; throws on non-2xx (NOT best-effort like reconcile was)
    │ 7. POST /orders (existing path, BUT mapper drops total_shipping* fields)
    │ 8. (DELETED) reconcileShippingCost
    │
    ▼
OrderRef (orderId, orderNumber)

PS-side (already shipped in #515):
  PS Cart::getOrderTotal(cart, with-shipping)
    → Carrier::getOrderShippingCost(cart, ..., $module = OpenLinker)
       → OpenLinker::getOrderShippingCostExternal($cart)
          → Db::getRow('SELECT amount_tax_incl FROM …openlinker_cart_shipping WHERE id_cart=?')
          → return (float) amount_tax_incl    ← authoritative
```

### File-level design

```
libs/integrations/prestashop/src/
├── infrastructure/
│   ├── adapters/
│   │   └── prestashop-order-processor-manager.adapter.ts        [MODIFIED]
│   │       - delete reconcileShippingCost (lines 521-581)
│   │       - delete self-heal reconcile call (lines 101-105)
│   │       - delete main-path reconcile call (lines 473-478)
│   │       - resolveExternalCarrierId: throw instead of returning undefined
│   │       - createOrder: discover OL carrier id, conditional sidecar write
│   │       - constructor: inject IPrestashopOpenLinkerModuleClient
│   ├── http/
│   │   ├── prestashop-openlinker-module.client.ts                [NEW]
│   │   │   - PrestashopOpenLinkerModuleClient implements IPrestashopOpenLinkerModuleClient
│   │   │   - Axios POST to module endpoint with HMAC headers
│   │   │   - discoverDynamicCarrierId() via WS GET /carriers
│   │   │   - writeCartShipping(input) → throws on non-2xx
│   │   └── prestashop-openlinker-module.client.interface.ts      [NEW]
│   │       - interface only (per backend.md naming rule)
│   └── mappers/
│       └── prestashop-order.mapper.ts                            [MODIFIED]
│           - drop total_shipping / total_shipping_tax_incl / total_shipping_tax_excl
│             from the create-order body (PS computes via the carrier module
│             regardless; leaving them was vestigial)
├── domain/
│   └── types/
│       └── prestashop-config.types.ts                            [MODIFIED]
│           - clarify defaultCarrierId doc: "should default to the OL Dynamic
│             carrier id at connection-create for the most common shape"
│           - no schema change
└── infrastructure/
    └── adapters/__tests__/
        └── prestashop-order-processor-manager.adapter.spec.ts    [MODIFIED]
            - delete the 'shipping cost reconciliation (#467)' describe block
            - add the 6 new test branches per §4 S6
```

### Class/interface shapes

**`IPrestashopOpenLinkerModuleClient`** (new port — write-only, refined per tech-review IMP-2):

The interface owns ONLY the HMAC-signed write path. Carrier discovery is a small private helper on the adapter that uses the existing `IPrestashopWebserviceClient` — different transport (WS XML vs. JSON HTTP), different auth (Basic vs. HMAC), so they don't belong on the same client.

```ts
export interface IPrestashopOpenLinkerModuleClient {
  /**
   * Write a per-cart shipping cost into the OL module's sidecar table via
   * its HMAC-authed front controller. Idempotent: re-writing the same
   * (idCart, amounts) tuple is a no-op modulo `updated_at`.
   *
   * @throws PrestashopOlModuleException on non-2xx response (NOT best-effort —
   *         order creation must abort so we don't ship at zero).
   */
  writeCartShipping(input: WriteCartShippingInput): Promise<void>;
}

export interface WriteCartShippingInput {
  idCart: number;
  amountTaxExcl: number;
  amountTaxIncl: number;
  source?: string;
}
```

**Adapter helper for carrier discovery (private method, not a separate client):**

```ts
// In PrestashopOrderProcessorManagerAdapter, private method:
private async discoverDynamicCarrierId(): Promise<number> {
  // Filter only by external_module_name. PS issue #28424 has reported
  // inverted-result bugs on filter[active] in some 8.x versions, so we fetch
  // all rows for this module and post-filter in TS.
  const rows = await this.webserviceClient.listResources<PrestashopCarrierRow>(
    'carriers',
    { custom: { external_module_name: 'openlinker' } },
  );
  const live = (rows ?? []).filter(
    (r) => Number(r.active) === 1 && Number(r.deleted) === 0,
  );
  if (live.length === 0) {
    throw new PrestashopOlCarrierMissingException(this.connection.id);
  }
  if (live.length > 1) {
    // Defensive log per tech-review SUGGESTION. Pathological case after a
    // module reinstall without uninstall (#515 R6); the post-filter takes
    // the first match.
    this.logger.warn(
      `OpenLinker: multiple live OL Dynamic carriers found on connection ` +
      `${this.connection.id} (count=${live.length}); using first id=${live[0].id}. ` +
      `Operator should soft-delete the duplicates from PS admin.`,
    );
  }
  return Number.parseInt(live[0].id, 10);
}
```

**`PrestashopOpenLinkerModuleClient`** (impl):

```ts
@Injectable()
export class PrestashopOpenLinkerModuleClient implements IPrestashopOpenLinkerModuleClient {
  // Three deps after IMP-2 split (down from 5). Discovery and WS-Basic-auth
  // path lives on the adapter, not here.
  constructor(
    private readonly connectionId: string,           // injected per-connection via factory
    private readonly baseUrl: string,                // PS storefront URL (no /api suffix)
    private readonly httpService: HttpService,
    @Inject(WEBHOOK_SECRET_PROVIDER_TOKEN)
    private readonly secretProvider: WebhookSecretProviderPort,
  ) {}

  async writeCartShipping(input: WriteCartShippingInput): Promise<void> {
    const secret = await this.secretProvider.getSecret('prestashop', this.connectionId);
    const body = JSON.stringify({
      id_cart: input.idCart,
      amount_tax_excl: input.amountTaxExcl,
      amount_tax_incl: input.amountTaxIncl,
      source: input.source ?? null,
    });
    const timestamp = String(Date.now());
    const signature = 'sha256=' + createHmac('sha256', secret)
      .update(timestamp + '.' + body)
      .digest('hex');

    const url = `${this.baseUrl.replace(/\/$/, '')}/index.php?fc=module&module=openlinker&controller=cartshipping`;
    const response = await firstValueFrom(
      this.httpService.post(url, body, {
        headers: {
          'Content-Type': 'application/json',
          'X-OpenLinker-Timestamp': timestamp,
          'X-OpenLinker-Signature': signature,
        },
        validateStatus: () => true,  // we read status ourselves to surface PS-side reasons
      }),
    );

    if (response.status >= 200 && response.status < 300) {
      return;
    }
    throw new PrestashopOlModuleException(
      this.connectionId,
      input.idCart,
      response.status,
      typeof response.data === 'object' ? (response.data as { error?: string }).error : undefined,
    );
  }
}
```

**Adapter changes (skeleton)**:

```ts
// In createOrder, the OL Dynamic carrier id is discovered up front so it's
// available for both the resolution-chain fallback (IMP-1) and the
// sidecar-write decision. Single discovery per createOrder call; per-order
// network cost is one extra GET (R3 — acceptable v1 trade-off).
const olCarrierId = await this.discoverDynamicCarrierId();
// throws PrestashopOlCarrierMissingException if module not installed/active

const psCarrierId = await this.resolveExternalCarrierId(order, config, olCarrierId);
// New 4-step chain (IMP-1):
//   1. Mapping → return mapped id
//   2. defaultCarrierId if set → return it
//   3. olCarrierId (passed in, already discovered) → return it as fallback
//   4. unreachable: discoverDynamicCarrierId() already threw if no live row
// Existing operator shops with un-set defaultCarrierId no longer get the
// silent id_carrier=1 fallback — they fall through to the OL Dynamic carrier
// (the recommended default per S8 doc), preserving sync correctness.

// ... cart creation (unchanged) → externalCartId comes from the cart-create
// return value (NOT a mapping lookup), so the sidecar-write below uses the
// freshly-created id without racing against mapping persistence.

if (psCarrierId === olCarrierId) {
  await this.openlinkerModuleClient.writeCartShipping({
    idCart: Number.parseInt(externalCartId, 10),
    amountTaxExcl: order.totals.shipping,
    amountTaxIncl: order.totals.shipping,
    source: order.source ? `${order.source.platformType}:${order.source.externalOrderId}` : undefined,
  });
  // throws on non-2xx — order creation aborts BEFORE POST /orders to avoid
  // shipping-at-zero outcomes
}

// ... POST /orders (mapper now drops total_shipping* fields)
// (DELETED) reconcileShippingCost
```

---

## 4. Step-by-Step Implementation Plan

| # | File | Change | Acceptance |
|---|---|---|---|
| **S1** | `libs/integrations/prestashop/src/domain/exceptions/prestashop-ol-module.exception.ts` (NEW) | Two new domain exceptions: `PrestashopOlCarrierMissingException(connectionId)` and `PrestashopOlModuleException(connectionId, idCart, status, reason?)`. Both extend `Error`, set `name`, `Error.captureStackTrace`. | Files compile; thrown instances carry the documented properties. |
| **S2** | `libs/integrations/prestashop/src/infrastructure/http/prestashop-openlinker-module.client.interface.ts` (NEW) | `IPrestashopOpenLinkerModuleClient` interface + `WriteCartShippingInput` type. | TypeScript compiles; spec can `jest.Mocked<IPrestashopOpenLinkerModuleClient>`. |
| **S3** | `libs/integrations/prestashop/src/infrastructure/http/prestashop-openlinker-module.client.ts` (NEW) | Implementation per §3. Constructor takes connectionId + baseUrl + HttpService + webserviceClient + secretProvider. `discoverDynamicCarrierId` via PS WS `listResources('carriers', {filter})`. `writeCartShipping` posts HMAC-signed JSON, throws on non-2xx. | Unit-tested via §S6.5 (new spec file alongside the client) — see §S6 below for the full test list. |
| **S4** | `libs/integrations/prestashop/src/infrastructure/adapters/prestashop-order-processor-manager.adapter.ts` | (a) Delete `reconcileShippingCost` method (lines 521-581). (b) Delete the two call sites (line 101 self-heal + line 478 main path). (c) Add private `discoverDynamicCarrierId()` helper using existing `webserviceClient.listResources('carriers', …)` with post-filter `active=1 && deleted=0`; warn on multi-row case; throw `PrestashopOlCarrierMissingException` on empty. (d) `resolveExternalCarrierId` now takes `olCarrierId: number` as param and uses it as the third resolution step (after mapping and `defaultCarrierId`); only throws if the discovery itself failed earlier (which already happens upstream). The carrier-1 hardcoded fallback is gone entirely. (e) Inject `IPrestashopOpenLinkerModuleClient` via constructor. (f) In `createOrder`: discover OL carrier first, pass to `resolveExternalCarrierId`, then after cart creation, conditionally call `writeCartShipping` when `psCarrierId === olCarrierId`. | Adapter file compiles; reconcile method gone; resolution chain has 3 functional fallbacks (mapping → defaultCarrierId → OL) before any throw; sidecar write happens iff resolved carrier matches OL; multi-row OL discovery emits warn-level log. |
| **S5** | `libs/integrations/prestashop/src/infrastructure/mappers/prestashop-order.mapper.ts` | Delete `total_shipping`, `total_shipping_tax_incl`, `total_shipping_tax_excl` from the create-order POST body builder (lines 272-274). Update the surrounding doc-comment block (lines 319-322) — drop the now-stale "id_carrier=0 / reconcileShippingCost" explanation, replace with "Shipping totals are computed PS-side via the resolved carrier (range tables for static carriers, OL sidecar for the dynamic carrier)". The `total_shipping*` entries in the field-strip list at line 462-464 stay (they apply on the read/parse path). | Mapper unit tests (`prestashop-order.mapper.spec.ts`) still pass after deletion — assertion that the body **does not** include `total_shipping*` is added. |
| **S6** | `libs/integrations/prestashop/src/infrastructure/adapters/__tests__/prestashop-order-processor-manager.adapter.spec.ts` | (a) Delete the entire `'shipping cost reconciliation (#467)'` describe block. (b) Add the 6 new branches per the refined matrix (post IMP-1): 1. **OL carrier mapped** → sidecar POST made, no reconcile, cart `id_carrier`=OL. 2. **Static PS carrier (id=2) mapped** → no sidecar POST, cart `id_carrier`=2. 3. **Unmapped, defaultCarrierId set to static carrier** → cart `id_carrier`=`defaultCarrierId`; no sidecar POST. 4. **Unmapped, no defaultCarrierId, OL module installed** → cart `id_carrier`=OL Dynamic (auto-fallback); sidecar POST happens. 5. **Sidecar POST fails (non-2xx)** → order create aborts, error surfaced (NOT best-effort). 6. **OL module not installed (discovery returns empty)** → order create aborts with `PrestashopOlCarrierMissingException` BEFORE any cart/order write. (c) Mock `IPrestashopOpenLinkerModuleClient` per `.claude/rules/backend.md` (mock the port interface, not the concrete client). Mock `IPrestashopWebserviceClient.listResources` for the carrier-discovery path. | All 6 branches green; 0 calls to the old `webserviceClient.put('order_carriers', …)` from the adapter; no carrier-1 hardcoded fallback in any test path; the new "unmapped → OL Dynamic auto-fallback" branch (#4) is exercised. |
| **S6.5** | `libs/integrations/prestashop/src/infrastructure/http/prestashop-openlinker-module.client.spec.ts` (NEW) | Unit tests for `PrestashopOpenLinkerModuleClient` with mocked `HttpService` + `WebhookSecretProviderPort` (no `IPrestashopWebserviceClient` after IMP-2 split): (a) `writeCartShipping` posts to the documented URL with the documented headers + body shape. (b) HMAC signature is computed over `timestamp + '.' + body` (assert via captured header value). (c) signature uses sha256 hex format with `sha256=` prefix. (d) `writeCartShipping` throws `PrestashopOlModuleException` on 401 with reason string surfaced. (e) `writeCartShipping` throws `PrestashopOlModuleException` on 500. (f) `writeCartShipping` succeeds (no throw) on 200. | All 6 tests green. |
| **S7** | `libs/integrations/prestashop/src/application/prestashop-adapter.factory.ts` (and its module wiring) | Wire the new `PrestashopOpenLinkerModuleClient` per-connection: pull connection's PS storefront baseUrl + connectionId, inject `WebhookSecretProviderPort` + `HttpService` + the per-connection `PrestashopWebserviceClient`. Pass into `PrestashopOrderProcessorManagerAdapter` constructor. | Factory builds an adapter that owns a working module client. Existing factory tests (if any) updated to cover the new dependency. |
| **S8** | `libs/integrations/prestashop/src/domain/types/prestashop-config.types.ts` + `libs/core/src/integrations/domain/ports/webhook-secret-provider.port.ts` | (a) Update `defaultCarrierId` JSDoc to reflect the new resolution chain (mapping → defaultCarrierId → OL Dynamic auto-fallback → throw). Note the operator-impact: setting `defaultCarrierId` to a static carrier id is now a deliberate opt-out from OL Dynamic auto-fallback. (b) Update `WebhookSecretProviderPort` JSDoc with the bidirectional note: "Used both for verifying inbound HMAC signatures AND for resolving the secret used to sign outbound requests to platform module endpoints (e.g. PS module's cartshipping endpoint per #516)." No port rename, no type-shape change. | Doc reads correctly; no compile churn elsewhere. |

### Quality gate

```bash
pnpm lint        # zero errors
pnpm type-check  # zero errors
pnpm test        # all 1557+ tests green; the new branches added in S6/S6.5 included
```

### Manual verification (per acceptance criteria)

On the dev shop after PR merge + module redeploy:
1. Sync a fresh Allegro order through the dynamic-carrier path.
2. Confirm `ps_orders.total_shipping = buyer-paid amount`, `total_paid = total_paid_real`, `current_state ≠ 8`.
3. Confirm no `PUT /order_carriers` or `PUT /orders` calls in the OL log for that sync (only `POST /cartshipping` then `POST /orders`).
4. Map an Allegro method to a static PS carrier, sync another order — confirm sidecar POST is **not** made; PS recomputes shipping from the carrier's price ranges.
5. Trigger the "no mapping, no defaultCarrierId" case (temporarily remove both) — confirm sync aborts cleanly with the operator-actionable error and **no partial PS state** (no orphan cart, no order_carriers row).

PR description carries the verification log.

---

## 5. Validate

### Architecture compliance

✅ **CORE / Integration boundary**: change is entirely within `libs/integrations/prestashop/`. `WebhookSecretProviderPort` consumed via DI per `.claude/rules/backend.md` (port-not-concrete). No CORE changes.
✅ **Service interface separation**: `IPrestashopOpenLinkerModuleClient` lives in a separate `.interface.ts` per backend.md.
✅ **Mocking ports not adapters**: spec mocks the new port interface, not the concrete client (per `engineering-standards.md §Mocking Ports`).
✅ **Domain exceptions in `domain/exceptions/`**: new exceptions live in `libs/integrations/prestashop/src/domain/exceptions/` (existing convention for the package — see `prestashop-authentication.exception.ts` etc.).
✅ **No `any` types**: all new code typed; `response.data` cast narrowed via type guard.
✅ **No deep relative imports**: `WebhookSecretProviderPort` + token come via `@openlinker/core/integrations` alias.

### Naming

✅ Client file: `prestashop-openlinker-module.client.ts` matches existing `prestashop-webservice.client.ts` sibling convention.
✅ Interface file: `prestashop-openlinker-module.client.interface.ts` matches `prestashop-webservice.client.interface.ts` sibling.
✅ Exception files: `prestashop-ol-module.exception.ts` matches existing `prestashop-*.exception.ts` pattern in the package.

### Testing strategy

- **Adapter spec**: 6 new branches covering the documented matrix. Mock the new port; assert call/no-call on sidecar POST; assert thrown exception types for failure branches.
- **Module-client spec**: 6 unit tests for the new client itself (HTTP shape, HMAC contract, error mapping). Mock `HttpService`, `IPrestashopWebserviceClient`, `WebhookSecretProviderPort` — three distinct concerns at the client's boundary.
- **Mapper spec**: assert the create-order body **does not** include `total_shipping*` fields (regression guard for the deletion).
- **No integration test added here** — #506 owns the real-PS coverage of the carrier-mapping vertical slice once #515 + #516 + #517 all land.

### Security

- **HMAC contract** mirrors the inbound TS receiver (proven; live in production for the webhook-outbox direction). Same secret bytes via `WebhookSecretProviderPort` — single source of truth for `(provider, connectionId) → secret`.
- **No new secret to manage** — operators who configured the webhook outbox secret have the same value installed in the PS module's `OPENLINKER_WEBHOOK_SECRET` config, which is what the PHP receiver verifies against.
- **Sidecar write is fail-loud, not best-effort.** Old `reconcileShippingCost` swallowed errors and proceeded; the new write throws and aborts order creation. Better failure mode: no order created at zero shipping cost vs. orphan order with wrong totals.
- **No SQL or OS-injection surface** — all module-client inputs are typed primitives serialized via `JSON.stringify`; HMAC headers built from controlled timestamp + computed signature.

### Risks / open questions

- **R1 — `discoverDynamicCarrierId` filter syntax (refined after market research).** PS WS expects `filter[field]=[value]` (brackets around the value) for string-field exact match per [the official tutorial](https://devdocs.prestashop-project.org/8/webservice/tutorials/advanced-use/additional-list-parameters/). The existing `PrestashopQueryBuilder` (line 130) already emits this shape correctly via the `custom` filter option, so passing `{ external_module_name: 'openlinker' }` as `custom` produces `filter[external_module_name]=[openlinker]` automatically. **However**, [PS GitHub issue #28424 reports inverted-result bugs on `filter[active]`](https://github.com/PrestaShop/PrestaShop/issues/28424) in some 8.x versions. To dodge that landmine the plan filters **only** by `external_module_name` at the WS layer and post-filters `active=1, deleted=0` in TypeScript. Two-row case (soft-deleted predecessor + current active carrier after a BO edit per #515 R6) is the common shape and the post-filter handles it cleanly.
- **R2 — Carrier id changes via BO edit.** PS duplicates the carrier row + assigns new id on every BO edit (#515 R6). Our discovery filters `active=1, deleted=0` — the new active row is found, the old soft-deleted row is filtered out. **No cache means no stale-id risk.** If we add caching later (R3) we need to subscribe to a refresh signal.
- **R3 — Cache deferred to v2.** Per-order `GET /carriers?filter=…` is one extra HTTP call per order create. For Allegro→PS sync at typical SMB volumes (10s-100s of orders/day) this is negligible. If a high-volume operator hits perf concerns, add an in-memory TTL cache (5 min) keyed by connectionId. Not gating.
- **R4 — Self-heal path no longer reconciles.** After the deletion, the `metadataInternalOrderId` early-return path simply returns the existing order ref. Orders that landed pre-#516 with `current_state=8` stay broken until manually reconciled (operator runs the SQL backfill from the epic non-goals). Acceptable — matches the explicit "no backfill" out-of-scope item.
- **R5 — `connection.config.defaultCarrierId` semantics shift (refined after tech-review IMP-1).** Pre-#516 the chain ended with `id_carrier=1` hardcoded fallback (PS's first carrier — a common cause of wrong totals). Post-#516 the chain is **mapping → defaultCarrierId → OL Dynamic auto-fallback → throw**. The OL Dynamic carrier (already discovered for the sidecar-write path; zero extra cost) acts as the runtime fallback when `defaultCarrierId` is unset. Existing shops with un-configured `defaultCarrierId` keep working — unmapped methods now route through the dynamic-pricing path (correct behaviour) instead of the carrier-1 wrong-totals path (broken behaviour). The only hard-failure path is "no mapping AND no `defaultCarrierId` AND OL module not installed", which throws `PrestashopOlCarrierMissingException` from discovery itself — operator-actionable.

- **R8 — Cart-id source (tech-review SUGGESTION).** The sidecar write must use the cart's external id from the cart-create return value, NOT from a `getExternalIds('Cart', …)` mapping lookup. Reason: the mapping write happens AFTER `cartProvisioner.createCart` returns, and a mapping-lookup at sidecar-write time would race against persistence. The existing adapter already returns the external id directly from the provisioner; #516 just propagates that value forward to `writeCartShipping`.

- **R9 — BO-edit-during-sync race (tech-review SUGGESTION).** Operator edits the OL Dynamic carrier in PS BO mid-sync: discovery returns `id=A`, BO edit makes `A` deleted=1 and assigns new `id=B`, then OL POSTs the cart with `id_carrier=A`. PS still resolves the carrier-module to OpenLinker via `external_module_name='openlinker'` (which now matches `B`), and the sidecar lookup is keyed by `id_cart` not `id_carrier`, so `getOrderShippingCostExternal` finds the row regardless. **The race is benign** in this code path. If POST /orders fails for any unrelated reason, the runner retries with a fresh discovery — natural self-healing. No cache-invalidation hook needed.

- **R6 — Architecture-novelty acknowledgement (research output).** Cross-referenced the PS shipping ecosystem (Colissimo, Mondial Relay, FedEx, ShipStation, BelVG tutorial). **No precedent for the OL pattern** of "external backend POSTs HMAC-signed JSON to a custom PS module endpoint that writes a sidecar table that PS reads at order-total time." All real-world shipping integrations either (a) install the carrier module *inside* PS and call out from there, or (b) post-process via PS WS after order-create (the reconcile pattern we're removing). The OL deviation is deliberate: PS's silent override of `total_shipping` makes (b) leak `current_state=8`, and (a) doesn't fit OpenLinker's role as an aggregator that doesn't own the carrier's shipping computation. The HMAC contract itself is well-trodden in PS (Stripe-style webhooks); what's novel is the *direction of use* (cart-shipping pre-write rather than event notification). No red flags surfaced; the design is sound but worth calling out in the PR description so future contributors understand why we don't just "install a module like everyone else does".

### Out-of-scope follow-ups (parking lot)

- Per-connection cache for `discoverDynamicCarrierId` (R3). File only if a real perf problem appears.
- Backfill SQL for orders synced under the reconcile-PUT path (epic non-goal). One-shot job; file when an operator asks.
- Generalize the OL-module-client pattern beyond the cartshipping endpoint — once the module grows a third capability beyond webhook outbox + carrier sidecar, consider extracting a `PrestashopModuleApiClient` that handles HMAC + URL building generically.

---

## Estimated diff size

≈ 350-450 LOC across 10 files: 3 new (HMAC client, interface, exception module), 1 new spec, 5 modified (adapter, mapper, factory, types doc, port-doc), 1 modified spec. Net deletion ≈ 100 LOC (reconcile method + tests). Zero TypeORM migrations, zero PS module changes (module side already shipped in #515 / PR #524). The discovery method is on the adapter itself per IMP-2 split, so it doesn't need a separate file.

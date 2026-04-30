# Implementation plan — Allegro→PrestaShop carrier mapping + pickup-point forwarding

Closes #455, #458. Both ride on the same `IncomingOrder.delivery` plumbing surface. Bundling avoids touching `IncomingOrder` / `Order` / `OrderCreate` and the PrestaShop adapter twice.

## Goals

**#455 — carrier mapping (Epic #1 US-4 BE):** Allegro orders currently land on PrestaShop `id_carrier: 1` regardless of what the buyer chose, because `PrestashopOrderMapper.mapOrderCreate` hardcodes `DEFAULT_CARRIER_ID = 1`. The carrier-mapping table (`carrier_mappings`), service (`MappingConfigService`), and FE config UI (#134) all exist already — wire them through the order-creation path so the configured mapping actually drives `id_carrier`.

**#458 — InPost pickup-point forwarding:** Allegro returns `delivery.pickupPoint` (`{ id: 'POZ08A', name: 'Paczkomat POZ08A', description, address: {street, zipCode, city, countryCode} }`) for locker shipments. We discard it today, so the PrestaShop order ships to the buyer's home address — broken for InPost (the dominant Polish marketplace fulfillment method). Forward the locker code into a place the courier can read.

## Non-goals

- Module-aware integration (Option 3) — file as follow-up.
- Webhook flow for post-purchase pickup-point changes.
- Mapping by name fallback when the Allegro `methodId` changes but `methodName` stays the same.
- Wiring `IMappingConfigService.resolvePaymentMapping` (sibling gap, separate scope).
- Shipping VAT handling (still tracked under #454).

## Layer classification

Cross-cutting: **CORE domain types + application service**, **Allegro integration adapter**, **PrestaShop integration adapter + provisioner + mapper + factory + config validation**. No frontend, no schema migration (the carrier-mapping table already exists; pickup-point identity rides on existing `Connection.config` JSON and existing PS address fields).

## Design decisions

### #455 — carrier resolution lives in the destination adapter (Option 2)

The issue asked for a decision between resolving in `OrderSyncService` (Option 1, mirrors status mapping) vs in `PrestashopOrderProcessorManagerAdapter` (Option 2). I'm picking **Option 2** for two reasons:

1. **`OrderCreate.shipping.methodId` is source-side neutral metadata** — every destination adapter wants it (Shopify might map differently; future POS adapters might use `methodName` to pick a carrier when `methodId` isn't mapped). Resolving upstream into a destination-specific `id_carrier` would force `OrderCreate` to carry a PrestaShop-specific field across context boundaries.
2. **Status is a flat enum we own** (`OrderStatus`); resolving it in the orchestrator collapses noise. A carrier id is a destination-owned resource — the destination is the natural owner of "given a source method id, pick my carrier."

The trade-off: `PrestashopAdapterFactory` gets a new optional `mappingConfigService` constructor dep. Worth it for the boundary cleanliness.

### #455 — fallback chain on `id_carrier`

```
mapped via CarrierMapping table → connection.config.defaultCarrierId → 1 (today's hardcoded default)
```

Both fallbacks log at `warn` so unmapped methods are detectable in production.

### #458 — Option 1 (locker code into shipping address) for MVP

Per the issue's recommendation: stamp the locker identity into the PS shipping address fields rather than touching carrier-module-specific columns (Option 3) or `gift_message` (Option 2). Concrete shape:

- `address1` / `city` / `postcode` / `country` ← `pickupPoint.address.{street,city,zipCode,countryCode}` (the locker's physical location).
- `address2` ← `${pickupPoint.name ?? 'Paczkomat'} ${pickupPoint.id}${pickupPoint.description ? ' · ' + pickupPoint.description : ''}` (e.g. `Paczkomat POZ08A · Stacja paliw BP`). Operators read this at a glance.
- `firstName` / `lastName` / `phone` ← buyer profile (the recipient is still the buyer).

`pickupPoint.id` is also included in the address-hash inputs so two orders shipping to the same locker reuse the same PrestaShop `id_address` row.

### #458 — keep `pickupPoint` as a separate field on `IncomingOrder` / `Order` / `OrderCreate`

Per the issue: rather than baking the locker info into `shippingAddress` only, also carry `pickupPoint?: { id, name?, description? }` as a structured top-level field. Survives address normalization, greppable, and lets a future Option-3 module-aware carrier integration consume the bare locker code without parsing free text.

### Allegro adapter behavior change for #458

Today (`AllegroOrderSourceAdapter.resolveShippingAddress`) when `delivery.address` is empty, falls back to `buyer.address` — which is the buyer's home, wrong for locker orders. After #458:

```
delivery.address (with geography) → pickupPoint.address (when pickupPoint present) → buyer.address
```

This changes one existing test ("fall back to buyer.address when delivery.address is an empty object" with `delivery: { address: {} }`) — it currently has no `pickupPoint`, so behavior stays unchanged. New tests cover the pickup-point branch.

## Changes by file

### Phase A — CORE domain types (foundations both issues use)

**`libs/core/src/orders/domain/types/order.types.ts`**
- Add two interfaces, defined once and reused on both sides of the ingestion boundary (no `IncomingOrderShipping` / `OrderShipping` split — shipping/pickup-point go through no resolution between `IncomingOrder` and `Order`, unlike items where `productRef` → `productId` resolution justifies separate types):
  - `OrderShipping { methodId: string; methodName?: string }` — `methodId` is required when the object is present (it's the carrier-mapping lookup key).
  - `OrderPickupPoint { id: string; name?: string; description?: string }`.
- Add optional `shipping?: OrderShipping` and `pickupPoint?: OrderPickupPoint` fields to `Order`.

**`libs/core/src/orders/domain/types/incoming-order.types.ts`**
- Value-import `OrderShipping` and `OrderPickupPoint` from `./order.types`. Add the same optional fields to `IncomingOrder`.

**`libs/core/src/orders/domain/types/order-processor.types.ts`**
- Re-use `OrderShipping` and `OrderPickupPoint` from `./order.types`. Add optional `shipping?: OrderShipping` and `pickupPoint?: OrderPickupPoint` fields to `OrderCreate`.
- Add a typed `source?: OrderSource` field on `OrderCreate`, where `OrderSource { connectionId: string; eventId?: string }`. This replaces the existing untyped reads of `order.metadata.sourceConnectionId` / `order.metadata.sourceEventId` in destination adapters. `OrderSyncService` populates both fields (existing string-keyed metadata stays alongside for one transition, but new code reads from `order.source`).

Acceptance: types compile in isolation; no behavior change yet.

### Phase B — Allegro source adapter (#454/#457 follow-up + #458 pickup-point)

**`libs/integrations/allegro/src/infrastructure/adapters/allegro-order-source.adapter.ts`**
- In `getOrder`:
  - Read `checkoutForm.delivery?.method` → `incoming.shipping = { methodId, methodName }` when `method.id` is present.
  - Read `checkoutForm.delivery?.pickupPoint` → `incoming.pickupPoint = { id, name, description }`.
  - Update `resolveShippingAddress`: insert pickup-point branch between the existing `delivery.address` branch and the `buyer.address` fallback. When `pickupPoint?.address` has geography, build the OL `IncomingOrderAddress` from the locker's address (firstName/lastName carry over from `buyer` since the recipient is still the buyer).

**`libs/integrations/allegro/src/infrastructure/adapters/__tests__/allegro-order-source.adapter.spec.ts`**
- New test: `should populate shipping.methodId/methodName from delivery.method`.
- New test: `should populate pickupPoint and synthesize shippingAddress from pickupPoint.address when delivery.address is empty`.
- Existing `should fall back to buyer.address when delivery.address is an empty object` keeps passing (no `pickupPoint` set → buyer.address fallback unchanged).

Acceptance: every Allegro fixture with `delivery.method` produces an `IncomingOrder.shipping`; every fixture with `delivery.pickupPoint` produces both `IncomingOrder.pickupPoint` *and* a locker-based `shippingAddress`.

### Phase C — Core orchestration plumbing

**`libs/core/src/orders/application/services/order-ingestion.service.ts`**
- `buildUnifiedOrder`: forward `incoming.shipping` and `incoming.pickupPoint` onto `Order`.

**`libs/core/src/orders/application/services/order-sync.service.ts`**
- Forward `order.shipping` and `order.pickupPoint` onto `OrderCreate`. No mapping resolution here — destination adapter owns it.
- Populate `OrderCreate.source = { connectionId: sourceConnectionId, eventId: sourceEventId }`. Keep the existing `metadata.sourceConnectionId` / `metadata.sourceEventId` keys in place for now (they're consumed elsewhere — touch only the carrier-resolution call site in this PR).

**`libs/core/src/orders/application/services/__tests__/order-ingestion.service.spec.ts`** *(if exists; otherwise skip)*
**`libs/core/src/orders/application/services/__tests__/order-sync.service.spec.ts`**
- Assert the new fields are propagated through `buildUnifiedOrder` → `OrderCreate`.

Acceptance: an `IncomingOrder` with `shipping` + `pickupPoint` survives unchanged into the `OrderCreate` passed to `OrderProcessorManagerPort.createOrder`.

### Phase D — Carrier-mapping resolver

**`libs/core/src/mappings/application/interfaces/mapping-config.service.interface.ts`**
- Add `resolveCarrierMapping(connectionId: string, allegroDeliveryMethodId: string): Promise<string | null>;`

**`libs/core/src/mappings/application/services/mapping-config.service.ts`**
- Implement `resolveCarrierMapping` mirroring `resolveStatusMapping` (find-by-connection, in-memory match, returns null when unmapped). Same TODO note about session-scoped caching.

**`libs/core/src/mappings/application/services/__tests__/mapping-config.service.spec.ts`**
- Add a `describe('resolveCarrierMapping')` block: happy-path returns `prestashopCarrierId`; miss returns `null`; empty mapping list returns `null`.

Acceptance: `resolveCarrierMapping` is callable via the existing `IMappingConfigService` token; existing status tests keep passing.

### Phase E — PrestaShop config & factory

**`libs/integrations/prestashop/src/domain/types/prestashop-config.types.ts`**
- Add `defaultCarrierId?: number` field to `PrestashopConnectionConfig`.

**`libs/integrations/prestashop/src/application/prestashop-adapter.factory.ts`**
- Constructor: add optional `mappingConfigService?: IMappingConfigService` (4th constructor arg, kept optional like the others to preserve test ergonomics).
- In `validateAndParseConfig`: validate `defaultCarrierId` if provided (positive integer, same shape as `langId`).
- In `createAdapters`: pass `mappingConfigService` to `PrestashopOrderProcessorManagerAdapter`.

**`libs/integrations/prestashop/src/__tests__/prestashop-adapter.factory.spec.ts`** *(if exists)*
- Add a test asserting `defaultCarrierId` validation rejects non-positive values.

Acceptance: factory wires up cleanly when the new dep is provided; throws config exception on invalid `defaultCarrierId`; OrderProcessorManager adapter still unbuilt when `customerProvisioner` is missing (existing behavior).

### Phase F — PrestaShop order processor + mapper (#455 + #458)

**`libs/integrations/prestashop/src/infrastructure/mappers/prestashop-order.mapper.ts`**
- `mapOrderCreate` signature: add optional `externalCarrierId?: number` parameter (placed after `externalLangId` to keep existing call sites compatible while we update them).
- Body: replace `id_carrier: DEFAULT_CARRIER_ID` with `id_carrier: externalCarrierId ?? DEFAULT_CARRIER_ID`. The connection's `defaultCarrierId` plumbing happens upstream in the adapter (see Phase G); the mapper stays a pure data transformer.

**`libs/integrations/prestashop/src/infrastructure/mappers/__tests__/prestashop-order.mapper.spec.ts`**
- New describe: `mapOrderCreate carrier resolution`:
  - explicit `externalCarrierId=4` → `id_carrier: 4`.
  - omitted `externalCarrierId` → `id_carrier: 1` (existing default).

**`libs/integrations/prestashop/src/infrastructure/adapters/prestashop-order-processor-manager.adapter.ts`**
- Constructor: add optional `mappingConfigService?: IMappingConfigService` and inject via factory.
- After step 5 (language resolve), insert step 5b: resolve carrier id.
  - `sourceConnectionId = order.source?.connectionId`
  - `methodId = order.shipping?.methodId`
  - `resolvedCarrierId: number | undefined`
    - If `mappingConfigService && sourceConnectionId && methodId`: call `resolveCarrierMapping(sourceConnectionId, methodId)`. If non-null, parse to int.
    - Else / on miss: leave undefined.
  - Final: `externalCarrierId = resolvedCarrierId ?? config.defaultCarrierId` (mapper handles the final `?? 1` default).
  - `logger.warn` when falling back to `defaultCarrierId` *or* further to the hardcoded `1` so unmapped methods are observable. Include `sourceConnectionId`, `methodId`, `methodName`, and the destination `connectionId` in the warn payload — `sourceConnectionId` is the actionable identifier (it points to the mapping table the operator needs to populate).
- Pass `externalCarrierId` into `mapOrderCreate(...)` and `mapCartCreate(...)` (cart inherits the carrier from the order — verify cart mapping uses it; if not used by carts, keep the change order-only).
- After step 3 (address resolution), pass `order.pickupPoint` into `addressProvisioner.resolveOrCreateAddress(...)`.

**`libs/integrations/prestashop/src/infrastructure/provisioners/prestashop-address-provisioner.ts`**
- `resolveOrCreateAddress` signature: add optional `pickupPoint?: OrderPickupPoint` parameter.
- **Single-source address view**: when `pickupPoint` is present, build a single locker-aware `Address` view at the top of the method:
  ```ts
  const effectiveAddress = pickupPoint
    ? { ...address, address2: formatPickupPointAddress2(pickupPoint, address.address2) }
    : address;
  ```
  Use this `effectiveAddress` as the input to **both** `computeAddressHash(effectiveAddress)` and the PS create payload (`addressData.address2 = effectiveAddress.address2`). The hash and the on-the-wire `address2` derive from the same string by construction, so re-syncing the same locker after a code change either changes both consistently (and creates one new mapping row) or stays stable. No silent drift.
- This keeps `NormalizedAddress` in `@openlinker/shared/config` unchanged — pickup-point-awareness lives entirely in the provisioner.
- Helper format: `formatPickupPointAddress2(pickupPoint, fallback)` returns e.g. `Paczkomat POZ08A · Stacja paliw BP` when name+description are present; falls back to `Paczkomat POZ08A` when only id is present; preserves the original `address2` when `pickupPoint` is undefined (caller passes `address.address2` as the fallback).
- The address-search fallback (the `addresses.find` against PrestaShop) keeps working because the locker address1/city/postcode are already distinct per locker; we don't need pickup-point-aware fuzzy matching there.

**`libs/integrations/prestashop/src/infrastructure/adapters/__tests__/prestashop-order-processor-manager.adapter.spec.ts`**
- New tests:
  - `creates order with mapped carrier id when MappingConfigService resolves`.
  - `falls back to connection.config.defaultCarrierId when carrier mapping is missing` + asserts the warn log.
  - `falls back to 1 when both mapping and defaultCarrierId are absent` + asserts the warn log.
  - `passes pickupPoint into addressProvisioner when present on OrderCreate`.

**`libs/integrations/prestashop/src/infrastructure/provisioners/__tests__/prestashop-address-provisioner.spec.ts`** *(if exists; otherwise add)*
- New tests:
  - `address2 contains pickup-point name and id when pickupPoint is supplied`.
  - `two orders to the same locker reuse the same PS address (hash includes pickup-point id)`.
  - `two orders to different lockers create distinct PS addresses`.

Acceptance: a fixture order with `delivery.method.id='1fa56f79-…'` + a configured `CarrierMapping → '4'` lands as `id_carrier: 4`; a fixture order with `delivery.pickupPoint` lands with the locker code in PS `address2`; two orders to the same locker share `id_address`.

### Phase G — Wiring the new factory dep at module level

**Both API and worker construct `PrestashopAdapterFactory` (the worker via `OrdersPollHandler` running through the integrations registry).** Both must pass `mappingConfigService`, otherwise carrier mapping silently falls back to `defaultCarrierId → 1` for every order processed by the worker — exactly the bug we're trying to fix. Verify by greping for `PrestashopAdapterFactory` / `new PrestashopAdapterFactory` and updating every construction site.

Concretely:
- `apps/api/src/integrations/...` — add `IMappingConfigService` dep, pass to factory; ensure `MappingsModule` is imported.
- `apps/worker/src/integrations/...` (or equivalent) — same.

Acceptance: API + worker both build the factory with a non-null `mappingConfigService` at runtime; existing factory tests that don't supply it keep working (it stays optional in the constructor signature for ergonomics).

## Quality gate

```bash
pnpm lint && pnpm type-check && pnpm test
```

No schema migration — the `carrier_mappings` table already exists and `PrestashopConnectionConfig` is JSONB on `Connection.config`.

## Risks

1. **Type-export ergonomics.** `OrderShipping` / `OrderPickupPoint` need to be re-exported from `@openlinker/core/orders` so adapters can value-import them. Plan: extend the existing `libs/core/src/orders/index.ts` barrel.
2. **Mapper signature creep.** `mapOrderCreate` is already up to 8 parameters. Adding a 9th (`externalCarrierId`) is acceptable for now; if a 10th is needed, refactor to an options object — out of scope for this PR.
3. **Address-hash inclusion of `pickupPoint.id`.** If `NormalizedAddress` isn't extensible cleanly, mixing the id into the `address2` slot for the hash *only* (without mutating the caller's `Address`) is a workable shortcut — as long as the on-the-wire PS `address2` we end up writing matches the same input, the hash stays stable across re-syncs.
4. **PS adapter test surface.** The order-processor adapter spec is already the largest in the codebase. Add the new cases as their own `describe('carrier resolution')` and `describe('pickup-point forwarding')` blocks rather than threading them into existing tests.

## Open questions

None blocking. The `defaultCarrierId` validation should reject `0` and negative integers (matching `langId`); `carrier_id=0` in PrestaShop is invalid.

## Out-of-band follow-ups (not in this PR)

- `IMappingConfigService.resolvePaymentMapping` + payment-module wiring at `prestashop-order.mapper.ts:254`. **Use the same Option-2 pattern this PR establishes for carrier resolution**: destination adapter resolves via `MappingConfigService` reading `OrderCreate.source.connectionId` + a new `OrderCreate.payment.providerId`. Don't bikeshed the boundary again.
- Module-aware (Option 3) InPost integration: write the bare `pickupPoint.id` into `orders.inpost_locker_code` (or equivalent) for downstream label printing.
- FE auto-suggestion of unmapped delivery methods after first order rejection.

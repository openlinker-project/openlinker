# Implementation Plan — feat(prestashop): read paczkomat ID from official InPost PS module on direct orders (#767)

**Date**: 2026-06-22
**Status**: Ready for Review
**Estimated Effort**: S — 3 days
**Branch**: `767-paczkomat-ps-reader-plan`
**Parent spec**: `docs/specs/product-spec-727-inpost-integration.md` §3.7 + AC-5
**Blocked by**: #727.1 (domain layer — `IncomingOrder.pickupPoint`) — **already resolved**: `OrderPickupPoint` and `IncomingOrder.pickupPoint?` exist at `libs/core/src/orders/domain/types/order.types.ts:173` and `incoming-order.types.ts:71`. No blocker.

---

## 1. Task Summary

**Objective**: Surface paczkomat (InPost locker) ID on `IncomingOrder.pickupPoint` for PrestaShop direct orders when the operator's connection declares the official InPost PS module is installed.

**Context**: Spec §3.7 identifies a gap: OL's PS order-source adapter never populates `pickupPoint`, because the PS module doesn't surface paczkomat data and the adapter never queries for it. Allegro already populates `pickupPoint` (#458). This issue closes the PS-origin leg of the three paczkomat-selection flows (A2).

**Classification**: Integration (primary) + shared domain config (minor)

---

## 2. Scope & Non-Goals

### In Scope
- Add `inpostPsModuleType` operator setting to `PrestashopConnectionConfig` + DTO
- Read paczkomat code from `ps_address.address2` via PS webservice in `PrestashopOrderSourceAdapter.getOrder()` — gated on `inpostPsModuleType === 'official_inpost'`
- Unit tests: adapter + (if PHP branch needed) PHP
- Documentation: troubleshooting note in integrations docs

### Out of Scope
- Reader for presta-mod.pl / prestahelp / WP-Desk (v1.1 per spec)
- Auto-detection of installed PS InPost module
- "PS InPost integration contract" doc for future module authors (v2 per spec)
- FE connection-edit UI for the new config field (can ship as plain text field; FE polish deferred)
- Any Allegro adapter changes (already done in #458)

### Constraints
- No migration required — `inpostPsModuleType` is stored in `Connection.config` JSONB, not a separate column
- Must pass `pnpm lint && pnpm type-check && pnpm test` (no integration tests required for this issue)

---

## 3. Architecture Mapping

**Target Layers**:
- `libs/integrations/prestashop/src/domain/types/` — config type extension
- `libs/integrations/prestashop/src/application/dto/` — config DTO extension
- `libs/integrations/prestashop/src/infrastructure/mappers/` — explicit `id_address_delivery` field on `PrestashopOrder`
- `libs/integrations/prestashop/src/infrastructure/adapters/` — paczkomat read logic

**Capabilities Involved**: `OrderSourcePort` (existing, unchanged interface)

**Existing Components Reused**:
- `PrestashopOrderSourceAdapter` — extended with private `resolvePickupPoint()`
- `IPrestashopWebserviceClient.getResource()` — used for address fetch
- `PrestashopConnectionConfig` — extended with new optional field
- `OrderPickupPoint` from `@openlinker/core/orders` — return type (already exists)

**No new ports, services, or cross-context dependencies** — all changes are local to `libs/integrations/prestashop`.

**CORE vs Integration**: No CORE changes. `IncomingOrder.pickupPoint` already exists. The logic of "read address2 when inpostModuleType = official_inpost" is PS-specific adapter logic — correct to live in the integration.

---

## 4. Schema Discovery (Implementation Step 0 — Must Do First)

**Before writing any code**, the implementer must probe the official InPost PS module schema:

1. Install the official InPost PS module in the dev PS stack.
2. Create a test order selecting a paczkomat (`POZ08A` format).
3. Run:
   ```sql
   SELECT id_address_delivery, id_address_invoice FROM ps_orders WHERE id_order = <test_order_id>;
   SELECT * FROM ps_address WHERE id_address = <id_address_delivery>;
   SHOW TABLES LIKE '%inpost%';
   SELECT * FROM ps_inpost_machine_orders WHERE id_order = <test_order_id>;  -- if table exists
   ```
4. **Result A** — paczkomat code is in `ps_address.address2`: proceed with the primary implementation path below (Phases 1–4). No PHP changes needed.
5. **Result B** — paczkomat code is in a custom InPost module table (e.g. `ps_inpost_machine_orders`): the primary path still works but requires an additional PHP endpoint. See **Appendix B** for the full alternative path.

The primary implementation below is written for **Result A**, which is the most likely outcome based on the official InPost module's documented behaviour (address2 is the canonical paczkomat-code carrier in standard PS InPost module installs).

---

## 5. Questions & Assumptions

### Assumptions
- **A1**: Official InPost PS module writes the paczkomat code into `ps_address.address2` on the delivery address. Must be verified (Step 0). Fallback: Appendix B.
- **A2**: Paczkomat codes follow the format `[A-Z]{3}\d{2}[A-Z]?` (e.g. `POZ08A`, `WAW12B`, `KRK05`). This format is stable and distinguishable from a real address `address2` value.
- **A3**: `IncomingOrder.pickupPoint` does not need to carry `name` or `description` from this source — `id` alone is sufficient for label generation (same as Allegro AC-4).
- **A4**: PS webservice `addresses` resource is always available on a standard PS install (not a custom endpoint, not the OL module).

### Open Questions
- **OQ-1**: Confirmed during Step 0 — exact DB field. The plan proceeds on A1 above.
- **OQ-2**: Should `address2` be cleared after OL reads it (to avoid PS admin UI showing locker code instead of a real address2)? → **No** — OL must not mutate source data. The operator can configure their PS InPost module's address formatting separately.

---

## 6. Implementation Plan

### Phase 1: Config layer — `inpostPsModuleType` setting

**Step 1** — Add `InpostPsModuleType` values + type to `prestashop-config.types.ts`

- **File**: `libs/integrations/prestashop/src/domain/types/prestashop-config.types.ts`
- **Action**: Following the `ResponseFormatValues`/`ResponseFormat` pattern already in the file, add:
  ```ts
  export const InpostPsModuleTypeValues = ['official_inpost', 'none'] as const;
  export type InpostPsModuleType = (typeof InpostPsModuleTypeValues)[number];
  ```
- **Rationale**: `as const` + union, per engineering standards (no TypeScript enums). Runtime array enables `@IsIn()` in the DTO.
- **Acceptance**: `InpostPsModuleType` is a union `'official_inpost' | 'none'`; `InpostPsModuleTypeValues` is a runtime array.

**Step 2** — Add `inpostPsModuleType?` to `PrestashopConnectionConfig`

- **File**: `libs/integrations/prestashop/src/domain/types/prestashop-config.types.ts`
- **Action**: Add to the `PrestashopConnectionConfig` interface:
  ```ts
  /**
   * Which official InPost-for-PS module is installed on this shop's PrestaShop.
   * Controls whether OL attempts to auto-read paczkomat ID from the order's
   * delivery address on PS direct orders (AC-5, #767).
   *
   *   'official_inpost' — OL reads address2 of the delivery address; expects the
   *                        official InPost PS module to have stored the locker code there.
   *   'none'            — no auto-read; manual picker handles paczkomat selection.
   *
   * Absent / undefined is treated as 'none' by the adapter.
   */
  inpostPsModuleType?: InpostPsModuleType;
  ```
- **Import**: Add import of `InpostPsModuleType` (same file, no import needed — it's defined above).
- **Acceptance**: `PrestashopConnectionConfig.inpostPsModuleType` is typed `InpostPsModuleType | undefined`.

**Step 3** — Add `@IsIn` validator to `PrestashopConnectionConfigDto`

- **File**: `libs/integrations/prestashop/src/application/dto/prestashop-connection-config.dto.ts`
- **Action**: Following the `responseFormat` field pattern exactly, add:
  ```ts
  @IsOptional()
  @IsIn(InpostPsModuleTypeValues as readonly string[])
  inpostPsModuleType?: InpostPsModuleType;
  ```
  Also add the import: `import { InpostPsModuleType, InpostPsModuleTypeValues } from '../../domain/types/prestashop-config.types';`
- **Acceptance**: A connection config with `inpostPsModuleType: 'invalid'` fails validation; `'official_inpost'` and `'none'` pass; omitting the field passes.

---

### Phase 2: Explicit `id_address_delivery` on `PrestashopOrder`

**Step 4** — Add `id_address_delivery` to `PrestashopOrder` interface

- **File**: `libs/integrations/prestashop/src/infrastructure/mappers/prestashop.mapper.interface.ts`
- **Action**: Add an explicit optional field alongside the existing fields in `PrestashopOrder`:
  ```ts
  id_address_delivery?: string | number;
  ```
- **Rationale**: The PS webservice returns this field on `GET /api/orders/{id}`. Without it, TypeScript types the field as `unknown` via `[key: string]: unknown`, making intent opaque and requiring callers to narrow `unknown`. Adding it explicitly makes `resolvePickupPoint` type-safe and readable.
- **Note**: `PrestashopAddress` already exists in `prestashop-provisioner.types.ts:60–72` with the exact `address2?: string` field OL needs — no new type required. Step 5 imports it from there directly.
- **Acceptance**: `PrestashopOrder.id_address_delivery` is typed `string | number | undefined`.

---

### Phase 3: Adapter — paczkomat read

This is the core of the feature. All logic is private to the adapter; the public `OrderSourcePort` interface is unchanged.

**Step 5** — Add `resolvePickupPoint()` private method to `PrestashopOrderSourceAdapter`

- **File**: `libs/integrations/prestashop/src/infrastructure/adapters/prestashop-order-source.adapter.ts`
- **Action**: Add two private helpers:

  ```ts
  /**
   * Locker code format for official InPost Paczkomat (e.g. POZ08A, WAW12B, KRK05).
   * Three uppercase letters + two digits + optional trailing letter. Case-insensitive
   * match; the raw value is uppercased before populating pickupPoint.id so downstream
   * label-gen code can rely on a canonical form.
   */
  private static readonly PACZKOMAT_CODE_RE = /^[A-Z]{3}\d{2}[A-Z]?$/i;

  /**
   * Returns pickupPoint when the connection declares official_inpost module and
   * the delivery address carries a recognisable paczkomat code in address2.
   * Returns undefined in all other cases (wrong config, no address, no address2,
   * address2 not a locker code, fetch error).
   */
  private async resolvePickupPoint(
    order: PrestashopOrder,
    config: PrestashopConnectionConfig
  ): Promise<OrderPickupPoint | undefined> {
    if (config.inpostPsModuleType !== 'official_inpost') {
      return undefined;
    }
    const addressId = order.id_address_delivery;
    if (!addressId) {
      return undefined;
    }
    let address: PrestashopAddress;
    try {
      address = await this.httpClient.getResource<PrestashopAddress>(
        'addresses',
        String(addressId)
      );
    } catch (err) {
      this.logger.warn(
        `Failed to fetch delivery address ${String(addressId)} for paczkomat read on order ${String(order.id)}: ${(err as Error).message}`
      );
      return undefined;
    }
    const raw = address.address2;
    if (!raw || !PrestashopOrderSourceAdapter.PACZKOMAT_CODE_RE.test(raw)) {
      return undefined;
    }
    return { id: raw.toUpperCase() };
  }
  ```

- **Imports to add**:
  - `PrestashopAddress` from `'../mappers/prestashop.mapper.interface'`
  - `PrestashopConnectionConfig` from `'../../domain/types/prestashop-config.types'`
  - `OrderPickupPoint` from `'@openlinker/core/orders'`

- **Acceptance**: The method returns `{ id: 'POZ08A' }` when all conditions are met; `undefined` in every other case.

**Step 6** — Wire `resolvePickupPoint()` into `getOrder()`

- **File**: `libs/integrations/prestashop/src/infrastructure/adapters/prestashop-order-source.adapter.ts`
- **Action**: In `getOrder()`, after fetching `prestashopOrder` and before building the return object:
  ```ts
  const config = this.connection.config as PrestashopConnectionConfig;
  const pickupPoint = await this.resolvePickupPoint(prestashopOrder, config);
  ```
  Then add `pickupPoint` to the returned `IncomingOrder`:
  ```ts
  return {
    externalOrderId,
    // ... all existing fields ...
    pickupPoint,   // <-- add this line
  };
  ```
- **Why cast `connection.config`**: `Connection.config` is typed `Record<string, any>` at the core boundary. The cast to `PrestashopConnectionConfig` is the same pattern used in `PrestashopAdapterFactory.createAdapters()`. The config was already validated by `PrestashopConnectionConfigShapeValidatorAdapter` at connection-create/update time, so the cast is safe.
- **Acceptance**: `IncomingOrder.pickupPoint` is set when conditions are met; the field is absent (undefined spread) otherwise.

---

### Phase 4: Tests

**Step 7** — Update `prestashop-order-source.adapter.spec.ts`

- **File**: `libs/integrations/prestashop/src/infrastructure/adapters/__tests__/prestashop-order-source.adapter.spec.ts`
- **Action**: Add a `describe('getOrder — pickupPoint resolution')` block with the following cases. The existing `createTestConnection()` fixture returns a connection with an empty config; tests that need `inpostPsModuleType` create a connection via `createTestConnection({ inpostPsModuleType: 'official_inpost' })` (or patch `connection.config` directly in the test — prefer the fixture approach for readability).

  Test cases:

  1. **`should populate pickupPoint when inpostPsModuleType is official_inpost and address2 is a paczkomat code`**
     - Config: `inpostPsModuleType: 'official_inpost'`
     - `httpClient.getResource` returns the order with `id_address_delivery: '5'`
     - Second `getResource` call (addresses, '5') returns `{ address2: 'POZ08A' }`
     - Assert: returned `IncomingOrder.pickupPoint` equals `{ id: 'POZ08A' }`

  2. **`should leave pickupPoint undefined when inpostPsModuleType is none`**
     - Config: `inpostPsModuleType: 'none'`
     - Assert: `pickupPoint` is `undefined`; no address fetch occurs (httpClient.getResource called once — for the order only)

  3. **`should leave pickupPoint undefined when inpostPsModuleType is absent`**
     - Config: `{}` (no `inpostPsModuleType`)
     - Assert: `pickupPoint` is `undefined`

  4. **`should leave pickupPoint undefined when address2 does not match paczkomat format`**
     - Config: `inpostPsModuleType: 'official_inpost'`
     - Address returns `{ address2: 'Piętro 2' }` (real address line)
     - Assert: `pickupPoint` is `undefined`

  5. **`should leave pickupPoint undefined when address fetch fails`**
     - Config: `inpostPsModuleType: 'official_inpost'`
     - Second `getResource` throws `PrestashopApiException` (e.g. 404)
     - Assert: `pickupPoint` is `undefined`; no exception propagates

  6. **`should normalise paczkomat code to uppercase`**
     - Address returns `{ address2: 'poz08a' }` (lowercase — defensive)
     - Assert: `pickupPoint.id` is `'POZ08A'`

- **Mock update**: The `createMockHttpClient()` factory returns a `jest.Mocked<IPrestashopWebserviceClient>`. Tests that need both an order fetch and an address fetch must chain `mockResolvedValueOnce` calls (order first, address second) via `mockHttpClient.getResource.mockResolvedValueOnce(...)`.
- **Acceptance**: All six cases pass. `pnpm test --filter @openlinker/integrations-prestashop` green.

---

### Phase 5: Documentation

**Step 8** — Add troubleshooting note to integrations docs

- **File**: `docs/integrations/prestashop.md` (create if it doesn't exist; if the file doesn't exist, add the note to `docs/integrations/README.md` or the closest existing PS integration doc)
- **Action**: Add a section or callout:

  ```markdown
  ## InPost paczkomat auto-read

  OL can automatically populate the paczkomat locker ID for PrestaShop direct orders
  when the official InPost PrestaShop module (published by InPost, available free) is
  installed. Set **InPost PS module** to **Official InPost** in the connection settings.

  ### Troubleshooting

  **Paczkomat ID not auto-populated?**

  - If your shop uses the **presta-mod.pl**, **prestahelp**, or **WP-Desk** InPost
    module, paczkomat ID will not auto-populate in v1 — these modules use a different
    schema. Use the manual paczkomat picker in OL until v1.1 adds support for your
    module.
  - Make sure the connection's **InPost PS module** setting is set to **Official InPost**
    (not "Other / none").
  - Confirm the official InPost PS module is configured to save the locker code to the
    delivery address `address2` field (default behaviour).
  ```

- **Acceptance**: Operator-facing text clearly explains the limitation and the manual fallback.

---

## 7. Appendix B — Alternative Path (if Step 0 finds a custom InPost table)

If schema discovery reveals the paczkomat code is stored in a custom InPost module table (e.g. `ps_inpost_machine_orders`) rather than `ps_address.address2`, the approach changes:

### B.1 — PHP: Add `InpostPaczkomat` repository to OL PS module

- **File**: `apps/prestashop-module/openlinker/classes/InpostPaczkomat.php`
- **Action**: Read paczkomat code from the InPost module's table by `id_order`. Pattern mirrors `CartShippingRepository.php`. Return `null` if the table doesn't exist (graceful — some shops don't have the InPost module installed).
- **Security**: Cast `id_order` to `(int)`, escape string fields with `pSQL()`. No raw interpolation.

### B.2 — PHP: Add `inpostpaczkomat.php` front controller

- **File**: `apps/prestashop-module/openlinker/controllers/front/inpostpaczkomat.php`
- **Action**: HMAC-authenticated GET endpoint, pattern mirrors `cartshipping.php`. Accepts `id_order`, returns `{ "paczkomat_id": "POZ08A" }` or `{ "paczkomat_id": null }`. PHP error handler wraps in `Throwable` catch so PHP fatals don't surface as Apache 500s (per `docs/lessons.md` lesson "PS module PHP fatal errors surface as opaque...").

### B.3 — PHP test

- **File**: `apps/prestashop-module/openlinker/tests/Unit/InpostPaczkomtTest.php`
- **Action**: Covers the repository read logic. Pattern mirrors `EventIdGeneratorTest.php`.

### B.4 — TS adapter: call OL PS module endpoint instead

- **File**: `libs/integrations/prestashop/src/infrastructure/adapters/prestashop-order-source.adapter.ts`
- **Action**: In `resolvePickupPoint()`, instead of `httpClient.getResource('addresses', ...)`, call:
  ```ts
  const result = await this.moduleClient.get<{ paczkomat_id: string | null }>(
    `/inpostpaczkomat?id_order=${encodeURIComponent(String(order.id))}`
  );
  if (!result.paczkomat_id) return undefined;
  return { id: result.paczkomat_id.toUpperCase() };
  ```
  This requires the factory to pass a `PrestashopOpenLinkerModuleClient` to the `PrestashopOrderSourceAdapter` (it currently only receives `IPrestashopWebserviceClient`). Factory change: add optional `moduleClient` parameter.

---

## 8. Alternatives Considered

### Alternative 1: Enrich the webhook payload (PHP-side)

Include the paczkomat code in `payloadJson` of `hookActionValidateOrderAfter`. The OL TS adapter would read it from the job payload.

**Why rejected**: The OL webhook event only carries `orderId` + `status`; the full order is always re-fetched via `getOrder()`. Adding paczkomat to the event payload would mean either (a) duplicating it in the payload AND in `getOrder()`, or (b) keeping payload as the sole source and threading it through the ingestion stack. Neither is clean. The re-fetch approach in `getOrder()` is simpler, consistent with how `order_rows` are fetched, and means paczkomat data is always live (not potentially stale from a snapshot in the event payload).

### Alternative 2: Auto-detect installed InPost PS module

OL probes PS DB schema at connection-config time to determine which InPost module is installed.

**Why rejected**: DB introspection is fragile (module version changes, table renames). Explicit operator setting is the spec's chosen approach (§3.7: "Explicit > auto-detection (PS DB introspection is fragile)").

### Alternative 3: Custom PHP endpoint for address2 path too

Add a PHP endpoint even when `address2` is the field, to keep the TS adapter from fetching PS webservice addresses directly.

**Why rejected**: The PS webservice `addresses` resource is a standard, stable endpoint. Adding a PHP proxy for it adds surface area with no benefit. The direct fetch approach mirrors how `order_rows` are fetched today.

---

## 9. Architecture Compliance

### Compliance Checks
- ✅ Domain layer unchanged — `IncomingOrder.pickupPoint` already exists; no CORE modifications
- ✅ CORE ↔ Integration boundary: all paczkomat-read logic lives in `libs/integrations/prestashop`
- ✅ `OrderSourcePort` interface unchanged — `getOrder()` already returns `IncomingOrder` which has `pickupPoint?`
- ✅ Config changes in the integration-owned `PrestashopConnectionConfig` — no cross-context exposure
- ✅ No new DI tokens, no new modules, no migration
- ✅ Naming: `InpostPsModuleType`, `InpostPsModuleTypeValues` follow `as const` + union pattern
- ✅ Logger: `this.logger.warn(...)` on address-fetch failure; no `console.log`
- ✅ Type safety: no `any`; `connection.config` cast via `as PrestashopConnectionConfig` (same factory pattern)
- ✅ No DB migration (JSONB config field)

### Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Official InPost module stores code in custom table, not `address2` | Medium | Step 0 schema probe determines path; Appendix B ready |
| Address fetch adds latency to `getOrder()` | Low | Only fires when `inpostPsModuleType === 'official_inpost'`; single PS webservice call per order |
| `address2` occasionally contains a real address line that matches the paczkomat regex | Very low | Regex is quite specific (`[A-Z]{3}\d{2}[A-Z]?`); real PL address2 values (`Piętro 2`, `lok. 5`) don't match |
| Operator sets `official_inpost` but the module isn't installed | Medium | `address2` will be empty or a real address line → regex won't match → `pickupPoint` stays `undefined` → graceful fallback to manual picker |

### Edge Cases

| Case | Handling |
|---|---|
| PS order without `id_address_delivery` | `resolvePickupPoint` returns `undefined` early |
| Address2 is empty string | `if (!raw)` guard catches it |
| Address fetch returns 404 | `try/catch` logs warn and returns `undefined` |
| `inpostPsModuleType` absent from config | Treated as `'none'` (guard `!== 'official_inpost'`) |
| Kurier InPost order (no locker selected) | Address2 won't contain a paczkomat code; returns `undefined` |

---

## 10. Testing Strategy & Acceptance Criteria

### Unit Tests (new)
- `prestashop-order-source.adapter.spec.ts`: 6 new cases in `describe('getOrder — pickupPoint resolution')` — see Phase 4 above
- If Appendix B path is taken: `InpostPaczkomtTest.php` PHP unit test

### Integration Tests
None required — the feature is a pure integration-adapter addition with no DB schema change and no cross-context orchestration.

### Acceptance Criteria
- [ ] PS direct order, connection `inpostPsModuleType: 'official_inpost'`, `address2 = 'POZ08A'` → `IncomingOrder.pickupPoint.id = 'POZ08A'`
- [ ] PS direct order, connection `inpostPsModuleType: 'none'` → `pickupPoint` absent
- [ ] PS direct order, `address2` absent or not a paczkomat code → `pickupPoint` absent
- [ ] PS direct order, address fetch 404 → `pickupPoint` absent (no throw)
- [ ] `pnpm lint && pnpm type-check && pnpm test` all pass

---

## 11. Alignment Checklist

- [x] Follows hexagonal architecture — changes confined to integration layer
- [x] Respects CORE vs Integration boundary — no CORE modifications
- [x] Uses existing patterns — follows `resolvePickupPoint` pattern from Allegro adapter; follows `as const` type pattern from same file
- [x] Idempotency — `getOrder()` is always stateless read-only; repeated calls are safe
- [x] Error handling — address fetch failures are logged+swallowed (non-fatal); does not block order ingest
- [x] Testing strategy complete — 6 unit test cases covering happy path + all failure modes
- [x] Naming conventions — `InpostPsModuleType`, `InpostPsModuleTypeValues`, `PACZKOMAT_CODE_RE` per standards
- [x] File structure matches standards — new types in `*.types.ts`, new interface in `prestashop.mapper.interface.ts`
- [x] No unnecessary abstractions — the pattern mirrors the existing Allegro `resolvePickupPoint` exactly
- [x] Plan is execution-ready — schema discovery is the only open question; both paths (A + B) are fully specified

---


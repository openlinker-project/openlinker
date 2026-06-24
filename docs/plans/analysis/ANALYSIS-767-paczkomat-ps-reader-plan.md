# Pre-implement Analysis — #767 PS Paczkomat Reader

**Plan**: `docs/plans/implementation-plan-767-prestashop-inpost-paczkomat-reader.md`
**Date**: 2026-06-22
**Verdict**: **NEEDS-REVISION**

---

## Reuse Findings

| Plan Artifact | Status | File |
|---|---|---|
| `InpostPsModuleTypeValues` / `InpostPsModuleType` | NEW (confirmed absent) | — |
| `PrestashopConnectionConfig.inpostPsModuleType` | NEW (confirmed absent) | — |
| `PrestashopConnectionConfigDto.inpostPsModuleType` | NEW (confirmed absent) | — |
| **`PrestashopAddress`** (Step 4) | **ALREADY EXISTS** | `libs/integrations/prestashop/src/infrastructure/provisioners/prestashop-provisioner.types.ts:60–72` |
| `PrestashopOrderSourceAdapter.resolvePickupPoint` | NEW (confirmed absent) | — |
| `OrderPickupPoint` (from `@openlinker/core/orders`) | EXISTS — barrel-exported | `libs/core/src/orders/domain/types/order.types.ts:173`, `index.ts:55` |
| `IncomingOrder.pickupPoint?` | EXISTS — field already declared | `libs/core/src/orders/domain/types/incoming-order.types.ts:71` |
| `IPrestashopWebserviceClient.getResource<T>()` | EXISTS — generic-capable | `libs/integrations/prestashop/src/infrastructure/http/prestashop-webservice.client.interface.ts:57` |
| `Logger` in `PrestashopOrderSourceAdapter` | EXISTS — already initialised | `adapter.ts:44` (`private readonly logger = new Logger(...)`) |
| `createTestConnection()` fixture | EXISTS — accepts `Partial<Connection>` | `libs/integrations/prestashop/src/__tests__/fixtures/connection.fixture.ts` |

---

## Backward-Compatibility Findings

### Critical

#### C-1 — `PrestashopAddress` naming collision

**Surface**: Type definition in `libs/integrations/prestashop`
**Severity**: Critical

The plan (Step 4) proposes creating a new minimal `PrestashopAddress` interface in `prestashop.mapper.interface.ts`:

```ts
export interface PrestashopAddress {
  id?: string | number;
  address2?: string | null;
}
```

A `PrestashopAddress` interface **already exists** at `libs/integrations/prestashop/src/infrastructure/provisioners/prestashop-provisioner.types.ts:60–72`:

```ts
export interface PrestashopAddress {
  id: string;               // required — conflicts with plan's optional id?
  id_customer?: string | number;
  id_country?: string | number;
  alias?: string;
  firstname?: string;
  lastname?: string;
  address1?: string;
  address2?: string;        // <-- this field already exists
  city?: string;
  postcode?: string;
  phone?: string;
}
```

Two `PrestashopAddress` types with the same name but different shapes in the same package is a naming collision. TypeScript doesn't error on same-name exports from different modules, but any consumer that imports both (e.g. adapter tests) will see whichever was imported last, and IDE tooling will show duplicate definitions.

**The fix is also simpler than creating a new type**: the existing `PrestashopAddress` already has `address2?: string`, so the adapter can import it directly from `../provisioners/prestashop-provisioner.types` (relative path within integration) and use it as-is. No new type definition needed in the mapper interface.

**Migration path**: Remove Step 4 from the plan. In Step 5, change the import to:
```ts
import { PrestashopAddress } from '../provisioners/prestashop-provisioner.types';
```
No other change required.

---

### Warnings

#### W-1 — `id_address_delivery` not declared on `PrestashopOrder`

**Surface**: `PrestashopOrder` interface in `prestashop.mapper.interface.ts:72–89`
**Severity**: Warning

The plan accesses `order.id_address_delivery` in `resolvePickupPoint()`. This field is **not declared** in the `PrestashopOrder` interface. The interface has a catch-all `[key: string]: unknown` index signature, so the access compiles, but TypeScript types `order.id_address_delivery` as `unknown` rather than `string | number | undefined`.

In practice, `const addressId = order.id_address_delivery` works (falsy check + `String()` are both fine on `unknown`), but the intent is opaque to readers and future refactors.

**Suggested fix**: Add `id_address_delivery?: string | number` to `PrestashopOrder` in `prestashop.mapper.interface.ts` as an additional sub-step of Step 4 (or Step 5). The PS webservice does return this field on `GET /api/orders/{id}`, and the `[key: string]: unknown` index signature is compatible with adding an explicit optional field.

#### W-2 — `createTestConnection` call signature in tests

**Surface**: Step 7 test fixture usage
**Severity**: Warning

The plan says to create per-test connections via `createTestConnection({ inpostPsModuleType: 'official_inpost' })`. The fixture signature is:

```ts
function createTestConnection(overrides: Partial<Connection> = {}): Connection
```

`inpostPsModuleType` is a field in `Connection.config` (a `Record<string, any>` JSONB field), not a root-level `Connection` property. The override `{ inpostPsModuleType: '...' }` would add an unknown root-level property, not populate `config`.

**Correct call**:
```ts
createTestConnection({ config: { inpostPsModuleType: 'official_inpost' } })
```

Or, patch in the test body:
```ts
connection = createTestConnection();
connection.config['inpostPsModuleType'] = 'official_inpost';
```

The plan's existing test cases use `connection.config` directly in one alternative mention (`"or patch connection.config directly in the test"`), so the implementer may naturally discover this — but the fixture example in the plan will silently not work as written.

---

## Open Questions

None that block the verdict. All architecture assumptions check out; the implementation path is valid. Schema discovery (Step 0) remains a runtime question, not a static one.

---

## Summary

The plan is architecturally sound, boundary-clean, and uses the right patterns throughout. Two issues need resolution before coding starts:

1. **(Critical)** Step 4 must be removed — `PrestashopAddress` already exists in `prestashop-provisioner.types.ts` with the exact field needed (`address2?: string`). The adapter should import it from there directly rather than creating a duplicate type with an incompatible `id` shape.

2. **(Warning)** Add `id_address_delivery?: string | number` to `PrestashopOrder` in `prestashop.mapper.interface.ts` as part of Step 4 (or as a new sub-step). Without this, TypeScript types the field as `unknown` via the index signature.

3. **(Warning)** Fix the `createTestConnection` example in Step 7: config values go under `{ config: { inpostPsModuleType: '...' } }`, not at root level.

After these three corrections the plan is implementation-ready.

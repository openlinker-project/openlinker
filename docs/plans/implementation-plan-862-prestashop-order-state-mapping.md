# Implementation Plan — #862 Operator-configurable OL→PrestaShop order-state mapping

## 1. Goal

Replace the PrestaShop adapter's **hardcoded** OL `OrderStatus` → PS order-state-id translation
(`PrestashopOrderMapper.mapStatusToPrestashopStateId`: `shipped→4`, `delivered→5`, …) with a
**per-connection resolution chain**:

> OL `OrderStatus` → PS state-id = **per-connection configured override → hardcoded default-install map**

This fixes a live correctness/UX bug: on customized PS installs (renamed/re-id'd/added states) the
hardcoded id is wrong, and on the `updateFulfillment` path (#858) with `sendmail=1` a wrong state-id
fires the **wrong buyer email + wrong side-effects** (stock/invoice). Vanilla shops keep working with
zero config (the hardcoded map stays as the fallback tier).

**Layer:** CORE (`mappings` context) + Integration (PrestaShop adapter) + Interface (config API) +
Frontend (mapping editor) + a migration. Mirrors the existing **carrier-mapping** chain at every layer.

### Non-goals (from the issue)
- The #858 adapter projection itself — it ships the default tier; this slots the override in front.
- Inbound source→OL status mapping (`StatusMapping.resolveStatusMapping`) — already exists; this is the
  **outbound** OL→PS direction.
- No change to the `OrderStatus` vocabulary.

## 2. Key design decisions

**D1 — Destination-scoped (not source-scoped).** The existing `resolveCarrierMapping` /
`resolveStatusMapping` are scoped by the **source** connection (Allegro). This new mapping is the PS
shop's own state catalogue, so it is scoped by the **destination** PrestaShop connection —
`this.connection.id` in `PrestashopOrderProcessorManagerAdapter` (which is bound to the PS connection).
The new table's `connection_id` therefore references the destination PS connection. *(This is the one
real conceptual divergence from the carrier precedent; everything else copies it verbatim.)*

**D2 — Two tiers, no middle config tier.** Carrier resolution has a `config.defaultCarrierId` middle
tier; a single default state-id can't represent 6 statuses, so we use exactly: configured override map
→ hardcoded `mapStatusToPrestashopStateId` default. Clean and matches the issue's stated model.

**D3 — Extend `MappingConfigService`, not a new subsystem** (per the issue's explicit steer). New
`OrderStateMapping` entity + `connection_order_state_mappings` table sit alongside carrier/status/payment
mappings in `libs/core/src/mappings/`.

**D5 — PS-targeted behavior, neutrally-named storage.** Confirmed scope: the resolution chain + default
map are PS-only (live in the PS adapter/mapper; no cross-destination port — premature with one
destination). The *storage* is named neutrally so a future destination reuses the table shape without a
migration: entity field `externalStateId`, column `external_state_id`, value = the destination
platform's native state id as a string (PS = numeric state id). No `prestashop_*` in the new schema.

**D4 (open — for the ⏸️ checkpoint) — FE target-options source.** The carrier panel populates its
target dropdown from a live PS carrier read. For PS order-states there is **no existing catalogue read**.
Two options:
- **D4a (MVP, recommended):** operator enters the **numeric PS state-id** as free text (reads it from
  their PS admin), mirroring how `prestashopCarrierId` is a free string. Lowest risk, ships now.
- **D4b (better UX, deferred):** add a PS `order_states` catalogue read (new adapter capability +
  endpoint) so the FE shows a **dropdown of real state names**. Bigger — its own slice.

  Plan builds **D4a**; D4b is a flagged follow-up. (Sided this way because D4b adds an adapter read +
  endpoint that is arguably its own issue, and free numeric entry is exactly the carrier-id precedent.)

## 3. Resolution chain (the adapter change)

New private method on `PrestashopOrderProcessorManagerAdapter`, mirroring `resolveExternalCarrierId`:

```ts
private async resolveStateId(status: OrderStatus): Promise<number> {
  if (this.mappingConfigService) {
    const mapped = await this.mappingConfigService.resolveOrderStateMapping(this.connection.id, status);
    if (mapped) {
      const parsed = Number.parseInt(mapped, 10);
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
      this.logger.warn(`Order-state mapping resolved to non-positive "${mapped}" for status='${status}' — ignoring.`);
    }
  }
  return this.orderMapper.mapStatusToPrestashopStateId(status); // default-install fallback (#858 tier)
}
```

**Call sites rewired (both in the destination adapter):**
- `updateFulfillment` (`adapter:739`): `const targetStateId = await this.resolveStateId(status);`
- `createOrder` → `mapOrderCreate`: the mapper currently resolves the id internally (`mapper:176`).
  Mirror the carrier pattern — the **adapter** resolves the state id and **passes it into**
  `mapOrderCreate` as a param; the mapper keeps `mapStatusToPrestashopStateId` only as the default-tier
  function the resolver falls back to. (Confirm `mapOrderCreate` signature and thread `stateId` exactly
  as `externalCarrierId` is threaded.)

## 4. Files

### CORE — `libs/core/src/mappings/` (copy carrier-mapping files)
| File | Change |
|---|---|
| `domain/entities/order-state-mapping.entity.ts` | NEW. `OrderStateMapping { id, connectionId, olStatus: OrderStatus, prestashopStateId: string }`. |
| `domain/types/mapping.types.ts` | Add `OrderStateMappingInput { olStatus: OrderStatus; prestashopStateId: string }`. |
| `domain/ports/order-state-mapping-repository.port.ts` | NEW. `findByConnectionId`, `replaceForConnection` (verbatim carrier port shape). |
| `infrastructure/persistence/entities/order-state-mapping.orm-entity.ts` | NEW. `@Entity('connection_order_state_mappings')`, unique `(connectionId, olStatus)`, cols `connection_id`, `ol_status` (varchar 20), `prestashop_state_id` (varchar 20), timestamps. |
| `infrastructure/persistence/repositories/order-state-mapping.repository.ts` | NEW. Mirror `CarrierMappingRepository` (`findByConnectionId`, transactional `replaceForConnection`). |
| `application/interfaces/mapping-config.service.interface.ts` | Add `getOrderStateMappings`, `upsertOrderStateMappings`, `resolveOrderStateMapping(connectionId, olStatus): Promise<string \| null>`. |
| `application/services/mapping-config.service.ts` | Implement the three methods (mirror carrier impl; inject the new repo via token). |
| `mappings.tokens.ts` | Add `ORDER_STATE_MAPPING_REPOSITORY_TOKEN = Symbol('OrderStateMappingRepositoryPort')`. |
| `mappings.module.ts` | Register ORM entity (`TypeOrmModule.forFeature`), repo provider + `useExisting` token bind. |
| `index.ts` (barrel) | Export `OrderStateMapping` entity + `OrderStateMappingInput` type (tokens auto-exported via `export * from './mappings.tokens'`). |
| `orm-entities` sub-barrel | Add the new ORM entity export (host registers it; TypeORM CLI discovers via glob). |

### Integration — `libs/integrations/prestashop/`
| File | Change |
|---|---|
| `infrastructure/adapters/prestashop-order-processor-manager.adapter.ts` | Add `resolveStateId`; rewire `updateFulfillment` + the order-create state-id resolution to use it. Reuses the already-injected `mappingConfigService?: IMappingConfigService`. |
| `infrastructure/mappers/prestashop-order.mapper.ts` | `mapOrderCreate` accepts the resolved `stateId` (param) instead of calling `mapStatusToPrestashopStateId` internally; keep `mapStatusToPrestashopStateId` as the default-tier export. |

### Interface — `apps/api/src/mappings/http/`
| File | Change |
|---|---|
| `mappings.controller.ts` | Add `GET /order-states` + `PUT /order-states` (parallel to carriers). |
| `dto/order-state-mapping-input.dto.ts` | NEW. `olStatus` (`@IsIn(OrderStatusValues)`), `prestashopStateId` (`@IsString @IsNotEmpty`). |
| `dto/upsert-order-state-mappings.dto.ts` | NEW. `items: OrderStateMappingInputDto[]`. |
| `dto/order-state-mapping-response.dto.ts` | NEW. `fromDomain(m)`. |

### Migration — `apps/api/src/migrations/`
| File | Change |
|---|---|
| `{ts}-add-connection-order-state-mappings.ts` | NEW. `CREATE TABLE connection_order_state_mappings` (PK, FK→connections ON DELETE CASCADE, unique `(connection_id, ol_status)`), mirroring the carrier table DDL. Fresh 13-digit timestamp; class suffix matches (lint-enforced). `down()` drops the table. |

### Frontend — `apps/web/src/features/mappings/` + page
| File | Change |
|---|---|
| `api/mappings.types.ts` | Add `OrderStateMapping` + `UpsertOrderStateMappingsPayload`. |
| `api/mappings.api.ts` | Add `getOrderStateMappings` / `upsertOrderStateMappings`. |
| `api/mappings.query-keys.ts` | Add `orderStates(connectionId)`. |
| `hooks/use-order-state-mappings.ts` | NEW. Query + upsert-mutation (mirror `use-carrier-mappings.ts`). |
| `pages/connections/connection-mappings-page.tsx` | Add an **Order states** `MappingPanel` tab. `sourceOptions` = `OrderStatusValues` (fixed list); `targetOptions` = free numeric entry (D4a). |

## 5. Data flow

```
createOrder / updateFulfillment (PS adapter, dest connection = this.connection.id)
  → resolveStateId(status)
      → MappingConfigService.resolveOrderStateMapping(this.connection.id, status)   [override tier]
          → OrderStateMappingRepository.findByConnectionId → match olStatus
      → mapStatusToPrestashopStateId(status)                                          [default tier]
  → targetStateId used in cart/order create + order_histories transition (sendmail)
Config:  FE editor → PUT /connections/:id/mappings/order-states → upsertOrderStateMappings → replaceForConnection
```

## 6. Testing

- **CORE unit** (`mapping-config.service.spec.ts`): `resolveOrderStateMapping` returns override when present, `null` when absent; `upsert`/`get` round-trip (mirror carrier specs).
- **CORE repo** covered by service specs with a mocked repo port.
- **Integration adapter unit** (`prestashop-order-processor-manager.adapter.spec.ts`): `resolveStateId` returns the override id when configured; falls back to the hardcoded map when unset / non-positive; `updateFulfillment` transitions to the **overridden** id. (Mock `IMappingConfigService`.)
- **API**: controller spec for the new `GET/PUT order-states` (mirror carrier controller spec) — validation rejects unknown `olStatus`.
- **FE**: `use-order-state-mappings` + the panel — query/empty/save happy path (mirror carrier-mapping tests).
- **Migration**: `pnpm --filter @openlinker/api migration:show` lists it; `migration:run` + `migration:revert` clean locally.

## 7. Validation / risks
- Architecture: new mapping lives in `mappings` CORE context; adapter depends on `IMappingConfigService`
  via token (already injected) — no boundary break. ORM entity stays in infrastructure; cross-context
  access via the `mappings` barrel + `orm-entities` sub-barrel.
- **D1 scoping** is the load-bearing decision — `connection_id` = destination PS connection. A reviewer
  should sanity-check this against the source-scoped carrier/status convention; documented in entity + method JSDoc.
- Migration timestamp uniqueness (lint-enforced) — pick a fresh prefix.
- `OrderStatus` is a closed 6-value union — `@IsIn(OrderStatusValues)` keeps the API strict.
- Backward compatible: no override rows ⇒ identical behaviour to today (vanilla shops untouched).
- **Deferred:** D4b live PS `order_states` catalogue dropdown (better FE UX) — follow-up issue.

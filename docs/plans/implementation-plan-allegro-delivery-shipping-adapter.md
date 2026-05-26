# Implementation Plan — #833 Allegro Delivery shipping adapter (`/shipment-management/*`)

**Issue:** [#833](https://github.com/openlinker-project/openlinker/issues/833) (E2 of #732)
**Spec:** `docs/specs/product-spec-732-allegro-delivery-shipment.md` (§3.1–3.3, §3.7, §5 AC-2)
**Branch:** `833-allegro-delivery-shipping-adapter`
**Layer:** Integration (allegro) + a small, justified core change (with migration)
**Effort:** L

> Design settled via a `/grill-me` pass — see **§6 Decision log** for the resolved forks and rationale. Two shifts from the first draft: the adapter is **agnostic** (a resolved `deliveryMethodId` is supplied; OQ-B1 lives behind a dispatch-layer seam), and #833 now carries a **migration** (persist `sourceDeliveryMethodId` for audit).

---

## 1. Goal & scope

`AllegroDeliveryShippingAdapter` in `@openlinker/integrations-allegro`, implementing the existing core
`ShippingProviderManagerPort` + `ShipmentCanceller`, over `/shipment-management/*`. Hosted on the **Allegro source
connection** — the `source_brokered` processor of the #832 routing model. #835's `ShipmentDispatchService` already
routes `source_brokered` through `getCapabilityAdapter(...).generateLabel(...)`, so **declaring the capability wires
dispatch** with no dispatch-branch changes.

**In scope:**
- `generateLabel` — async `POST .../create-commands` (deterministic `commandId`) → bounded poll → opaque `labelPdfRef`.
- `getTracking` — `GET .../shipments/{id}` → **coarse** status (cancelled / generated; fallback in-transit+WARN).
- `cancelShipment` — async `POST .../cancel-commands` → poll.
- `getSupportedMethods()` → `['paczkomat', 'kurier']` (static).
- Allegro create/cancel rejections → readable domain errors.
- Core: persist `sourceDeliveryMethodId` on `Shipment` (audit) + the dispatch-layer identity **seam** that supplies the adapter's `deliveryMethodId`.
- Unit tests (adapter + mapper, HTTP mocked); migration with `down()`.

**Out of scope (other issues / behind seams):**
- Source→Allegro-service **mapping** store + UI → behind the resolution seam (the mapping vertical; cf. `CarrierMapping`/#836).
- `pending` lifecycle + create-command **reconciliation** of timed-out creates → **#838**.
- Carrier-level tracking (in-transit/delivered) → **#838**.
- Label-PDF **byte retrieval** (`POST .../label`) — a cross-provider `LabelDocumentReader` capability + binary HTTP + download endpoint → follow-up.
- Order-side dispatch (fulfillment `SENT` + waybill attach + propagation) → **#837**.
- `/delivery-services` fetch → travels with the mapping vertical.
- Dispatch manifest, courier pickup → **#831** (v2).

---

## 2. Research findings (codebase + Allegro docs)

### 2.1 Port + routing are ready (capability-string compatibility)
- `ShippingProviderManagerPort` (`libs/core/src/shipping/domain/ports/shipping-provider-manager.port.ts`): `generateLabel`/`getTracking`/`getSupportedMethods`; `ShipmentCanceller.cancelShipment` is the co-located sub-capability + `isShipmentCanceller` guard.
- `FulfillmentRoutingService.evaluateCompatibility` (`libs/core/src/mappings/application/services/fulfillment-routing.service.ts:201`) decides compatibility **purely** from `metadata.supportedCapabilities` + topology: `source_brokered` requires `ShippingProviderManager` **and** `processorConnectionId === sourceConnectionId`. Both satisfied by adding the capability to the Allegro manifest (adapter rides the source connection). `getSupportedMethods()`/`/delivery-services` are **not** consumed by routing.

### 2.2 The two ids — the seam (B2 + ADR-012)
ADR-012 §"Rule shape & compatibility": OQ-B1 (does order `delivery.method.id` share a namespace with `/delivery-services[].id.deliveryMethodId`?) is "a #833 refinement **layered behind the routing-compatibility seam, not a dependency** … compatibility lives behind the service seam so the routing model never reshapes if the compatibility signal's source changes." Branch-1's destination carrier is sourced from the co-keyed `CarrierMapping` — **never** namespace-assumed. So:
- `sourceDeliveryMethodId` — the order's method id (`OrderShipping.methodId`). **Persisted** on `Shipment` for audit/forensics (A2), alongside the existing `paczkomatId`/`shippingMethod` create-inputs.
- `deliveryMethodId` — the **resolved Allegro delivery-service id** the adapter sends. Supplied to the adapter via `GenerateLabelCommand`. Resolved at dispatch by a **named v1-identity seam** (`deliveryMethodId := sourceDeliveryMethodId`), flagged as the OQ-B1 swap point. The future source→service mapping (cf. `CarrierMapping`) replaces the seam body with zero model reshape.
- The **adapter never reads `sourceDeliveryMethodId`** — it consumes the resolved `deliveryMethodId` and throws a readable error if absent. OQ-B1 stays entirely behind the seam.

### 2.3 `labelPdfRef` is opaque (A3)
`ShipmentDispatchService` (`…/shipment-dispatch.service.ts:152`) persists `result.labelPdfRef` verbatim → surfaced as a string on `ShipmentResponseDto`. No PDF-byte download path exists anywhere (InPost returns `shipx:label:{id}`). So `generateLabel` returns `allegro-delivery:label:{providerShipmentId}`; byte retrieval is a cross-provider follow-up.

### 2.4 Async create + idempotency (A4)
- `findActiveByOrderId` returns the most-recent **non-terminal** row (`shipment-repository.port.ts:54-58`); `failed` is **terminal** (`shipment-status.types.ts:28`) → re-dispatch creates a *new* row. The dispatch note (`…:131-135`) flags the resulting provider double-create on retry.
- **Deterministic `commandId = f(shipmentId)`** (UUIDv5-style hash) is the idempotency primitive (the dispatch note asks for exactly this): same-row retry dedups at Allegro; a timed-out `failed` row is recoverable (commandId re-derivable from `shipmentId`) → no silent orphan; a genuine re-issue is a new row → new commandId → correctly a new shipment.
- `pending` was **deliberately rejected** from `ShipmentStatusValues` (`shipment-status.types.ts:10-12`, "overloaded in OL"). So #833 does **not** add a status: `SUCCESS`→`generated`, `ERROR`→`failed`+readable, timeout→throw `AllegroShipmentPendingException` (→ dispatch persists `failed`). The `pending`/`draft`-holding state + create-command reconciliation are **#838's** (its resolver + #839's surfacing co-exist there; the residual double-create window isn't operator-reachable until the FE, which post-dates #838).

### 2.5 Allegro HTTP client unchanged
`IAllegroHttpClient` `get/post` return `{ data, status, headers }`, JSON-only (`allegro-http-client.ts:335` `response.text()` → `:351` `JSON.parse`; `:268` `Accept: …+json`). Create/poll/cancel/shipment-GET are JSON → **no client change**. (Label byte fetch would need binary support → deferred with `LabelDocumentReader`.) 429 `Retry-After` + 401 refresh already handled.

### 2.6 `/shipment-management/*` wire shapes — doc-verified, with `needs-sandbox-probe` flags
Verified against the "Wysyłam z Allegro" tutorial + the real payload in [allegro/allegro-api#12047](https://github.com/allegro/allegro-api/issues/12047):
- **Create** `POST .../create-commands`: `{ commandId, input: { deliveryMethodId, receiver{ name, company?, street, postalCode, city, countryCode, email, phone, point? }, referenceNumber, packages[{ type, length{value,unit}, width{…}, height{…}, weight{value,unit}, textOnLabel? }], labelFormat } }`. `{ commandId, input }` wrapper + field names **confirmed**. `sender` omitted (Allegro-defaults, Q6). `credentialsId`/`insurance`/`cashOnDelivery` omitted v1.
- **Poll** `GET .../create-commands/{commandId}` → `{ commandId, status, errors[], shipmentId }`; status `IN_PROGRESS|SUCCESS|ERROR` — **probe**, localized constant.
- **Shipment read** `GET .../shipments/{id}` → `{ id, packages[{ waybill, transportingInfo[{ carrierId, carrierWaybill }] }], canceledDate?, createdDate, … }` — no clean state enum → coarse derivation.
- **Cancel** `POST .../cancel-commands` `{ commandId, input: { shipmentId } }` → poll (same enum).
- Units `CENTIMETER`/`KILOGRAMS` + dimension value encoding — **probe**, localized.

### 2.7 Pattern references
InPost adapter (`libs/integrations/inpost/src/infrastructure/adapters/inpost-shipping.adapter.ts` + mapper/exceptions/spec). Allegro HTTP/error/logging style: `allegro-offer-manager.adapter.ts`. Wiring: `inpost-plugin.ts` ↔ `allegro-plugin.ts` + `allegro-adapter.factory.ts`.

---

## 3. Design

```
libs/core/src/shipping/                                 [MODIFY + migration]
  domain/types/generate-label.types.ts                  + deliveryMethodId?: string (resolved; adapter input)
  domain/types/shipment.types.ts                        CreateShipmentInput + sourceDeliveryMethodId?: string
  domain/entities/shipment.entity.ts                    + sourceDeliveryMethodId: string | null (audit)
  infrastructure/persistence/entities/shipment.orm-entity.ts   + sourceDeliveryMethodId text null
  infrastructure/persistence/repositories/shipment.repository.ts  map in create() + toDomain()
  application/types/shipment-dispatch.types.ts          Omit also drops deliveryMethodId (resolved by seam)
  application/services/shipment-dispatch.service.ts     identity seam → deliveryMethodId; persist sourceDeliveryMethodId

apps/api/src/migrations/<ts>-add-shipment-source-delivery-method.ts   additive nullable column (+ down)
apps/api/src/shipping/http/dto/shipment-response.dto.ts               surface sourceDeliveryMethodId (read model)

libs/integrations/allegro/src/                          [NEW + wiring]
  domain/types/allegro-shipment.types.ts                wire types + localized probe constants + poll-config defaults
  domain/exceptions/allegro-shipment-rejected.exception.ts    create/cancel ERROR + validation
  domain/exceptions/allegro-shipment-pending.exception.ts     poll exhausted (retriable)
  infrastructure/mappers/allegro-shipment.mapper.ts     buildCreateInput, deriveCommandId, mapShipmentStateToStatus, toGenerateLabelResult
  infrastructure/mappers/__tests__/allegro-shipment.mapper.spec.ts
  infrastructure/adapters/allegro-delivery-shipping.adapter.ts        AllegroDeliveryShippingAdapter
  infrastructure/adapters/__tests__/allegro-delivery-shipping.adapter.spec.ts
  application/allegro-adapter.factory.ts                construct + return shippingManager
  application/interfaces/allegro-adapter.factory.interface.ts   AllegroAdapters.shippingManager
  allegro-plugin.ts                                     manifest supportedCapabilities + dispatch table
  index.ts                                              barrel: new exceptions/types
```

**Adapter constructor:** `(connectionId, httpClient: IAllegroHttpClient, connection: Connection, pollConfig?: Partial<AllegroShipmentPollConfig>)`. Reuses the connection's OAuth/HTTP — no new connection config/credentials validators.

**`generateLabel` flow:** `commandId = deriveCommandId(cmd.shipmentId)` → `POST create-commands { commandId, input: buildCreateInput(cmd) }` (throws readable validation error if `cmd.deliveryMethodId` or parcel dims/weight absent) → bounded poll (`maxAttempts ~8`, exp backoff, Retry-After-aware) → `SUCCESS` (shipmentId) | `ERROR` (`AllegroShipmentRejectedException(errors)`) | exhausted (`AllegroShipmentPendingException`). Return `{ providerShipmentId, trackingNumber: null, labelPdfRef: 'allegro-delivery:label:{shipmentId}' }`.

**`cancelShipment`:** `POST cancel-commands { commandId: deriveCommandId('cancel:'+id), input: { shipmentId: id } }` → poll → throw on `ERROR`.

**`getTracking`:** `GET shipments/{id}` → `canceledDate` ⇒ `cancelled`; else `generated`; unknown ⇒ `in-transit`+WARN. `{ status, providerStatus }`.

---

## 4. Step-by-step plan

1. **Core threading + seam.** Add `deliveryMethodId?` to `GenerateLabelCommand`; add `sourceDeliveryMethodId?` to `CreateShipmentInput` + `Shipment` entity + ORM column. `ShipmentDispatchService`: resolve `deliveryMethodId` via the named v1-identity seam (`const deliveryMethodId = input.sourceDeliveryMethodId ?? undefined;` — flagged OQ-B1 swap point), persist `sourceDeliveryMethodId` in `create()`, thread `deliveryMethodId` into `generateLabel()`. Repo maps the new column. *AC:* existing dispatch/repo specs stay green; InPost unaffected.
2. **Migration.** `pnpm --filter @openlinker/api migration:generate` for the additive nullable column; verify `up`/`down` round-trip (`docs/migrations.md`). Surface `sourceDeliveryMethodId` on `ShipmentResponseDto`.
3. **Allegro wire types + probe constants** (`allegro-shipment.types.ts`) — each `partial` spelling a single named export with a `// needs-sandbox-probe (#833)` comment; `AllegroShipmentPollConfig` defaults.
4. **Domain exceptions** — `AllegroShipmentRejectedException(message, errors?)`, `AllegroShipmentPendingException(commandId)`; barrel-exported.
5. **Mapper (pure)** — `deriveCommandId` (deterministic UUID via `crypto`), `buildCreateInput` (recipient→receiver, parcel→packages w/ unit conversion + required-field validation, `deliveryMethodId` required, `referenceNumber=shipmentId`, sender omitted), `mapShipmentStateToStatus`, `toGenerateLabelResult`. Mapper spec: locker + courier + missing-dims + missing-deliveryMethodId + status derivations + deterministic commandId.
6. **Adapter** — `AllegroDeliveryShippingAdapter implements ShippingProviderManagerPort, ShipmentCanceller`; map Allegro API/auth/rate-limit failures to readable domain errors. Spec (HTTP mocked): create→poll(SUCCESS), create→poll(ERROR)→rejected, poll-exhausted→pending, cancel happy/ERROR, getTracking mappings, getSupportedMethods.
7. **Factory + manifest + dispatch table** — `AllegroAdapters.shippingManager`; construct in `createAdapters`; manifest `supportedCapabilities += 'ShippingProviderManager'`; dispatch table `+ ShippingProviderManager`. Update manifest/dispatch unit tests.
8. **Quality gate** — `pnpm lint && pnpm type-check && pnpm test`; `migration:show` confirms the new migration applies, none pending.

---

## 5. Validation

- **Architecture:** domain framework-free; adapter depends only on `IAllegroHttpClient` + core port types and never reads `sourceDeliveryMethodId` (OQ-B1 behind the seam); core change is additive (optional field + nullable column). No `*OrmEntity`/repo-port cross-context imports.
- **Naming:** `*-adapter.ts`/`{Platform}{Capability}Adapter`, `*.types.ts`, `*.mapper.ts`, `*.exception.ts`, `*.spec.ts`, `*.orm-entity.ts`.
- **Testing:** unit (HTTP mocked) on adapter + mapper; migration round-trip checked. No integration test needed beyond migration verification.
- **Security:** no secrets logged; vault-resolved OAuth reused; create input validated before send.
- **Flagged caveats (code + PR):** command-status enum / unit literals / dimension encoding / OQ-B1 identity seam are doc-derived, not live-sandbox-verified — each localized to a single change-point. Label byte fetch, `pending` lifecycle + reconciliation, carrier tracking, and the source→service mapping are deferred to the named follow-ups.

## 6. Decision log (from `/grill-me`)

| # | Fork | Resolution | Why |
|---|---|---|---|
| Q1 | core change scope | **A2** persist `sourceDeliveryMethodId` (migration) | `Shipment` is a self-describing audit record (persists `paczkomatId`/`shippingMethod`); consistent + future-proofs forensics/analytics; A1→A2 was additive so we did it now while in core |
| Q2 | method-id resolution | **B2** agnostic adapter + identity seam | ADR-012: OQ-B1 behind the seam, not a dependency; mirrors `CarrierMapping` (never namespace-assumed); mapping store/UI is the mapping vertical's job |
| Q3 | label PDF | **A** opaque ref | matches InPost; no download endpoint exists; byte fetch is a cross-provider vertical (capability + binary HTTP + endpoint + FE), not Allegro-only #833 |
| Q4 | async-create timeout | **A** + deterministic `commandId` | `pending` deliberately rejected from the enum; deterministic commandId gives recoverability + idempotent retry; double-create window not operator-reachable before #838 (the resolver) |
| Q5 | `/delivery-services` | **(i)** not fetched | B2 removed its create-path role; routing keys on capabilities; Allegro rejection already names the bad method |
| Q6 | `sender` | **A** omit | "Wysyłam z Allegro" is a broker program → Allegro holds sender; localized escape hatch if sandbox proves it required |
| Q7 | parcel → packages | **A** require dims+weight, fail readably | Allegro has no size-template; fabricating dims is a wrong external commitment; `type=PACKAGE`, mm→cm/g→kg |
| Q8 | `getTracking` | **A** coarse shipment-GET | shipment resource has no lifecycle enum; carrier tracking is #838's scope |
| Q9 | poll config | constants + optional ctor override | mirrors `quantityPollConfig`; no new plugin knob |
| Q10 | testing | unit-only, HTTP mocked, no fake subpath | no downstream consumer needs a fake yet |

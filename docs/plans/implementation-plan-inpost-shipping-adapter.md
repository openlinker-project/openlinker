# Implementation Plan — InPost ShipX shipping adapter + fake (#764, #765)

> Design locked via `/grill-me` (2026‑05‑22) and grounded against the official
> ShipX docs (dokumentacja-inpost.atlassian.net, EN space). One PR closes both.

## 1. Task & layer

Ship `@openlinker/integrations-inpost` whose `InpostShippingAdapter` implements
`ShippingProviderManagerPort` (#763) + the `ShipmentCanceller` and
`PickupPointFinder` sub-capabilities, against InPost's **ShipX REST API**, plus
the `FakeInpostShippingAdapter` (#765).

**Layer: CORE (shipping) + Integration.** ⚠️ Correction to the first draft —
this is **not** "new package only." `GenerateLabelCommand` lacks the recipient
+ parcel data ShipX needs, and `#763`'s `generate-label.types.ts` header
explicitly designates **this PR** as the one that adds them. So #764 also edits
`libs/core/src/shipping/domain/types/`.

**Contract correction:** #764's body lists `getCapabilities()`; the merged port
(#763) is `generateLabel` / `getTracking` / `getSupportedMethods()` +
optional `ShipmentCanceller` / `PickupPointFinder`. Implement the merged port.

**Non-goals (sibling #727.x):** webhooks (#768), FE pages/settings (#769–#771),
paczkomat cache (#766 — `findPickupPoints` is pass-through), polling
orchestration (#772), `psModuleChoice` reader (#767), express/COD/international/
multi-package/Allegro-method (v2), worker registration (→#772), connection
tester (→#771), retry classifier (→#772).

## 2. Locked decisions (from the grill)

| # | Decision |
|---|---|
| Auth | Static **Bearer API token** (portal-generated; no OAuth refresh). creds = `{ apiToken }`; `organizationId` in **config** |
| Module | SDK **`createNestAdapterModule`** — no plugin-specific Nest provider; config-validator registered via `plugin.register(host)` |
| `labelPdfRef` | Opaque **re-fetchable ref** (`shipx:label:{id}`); no blob storage, no bytes (label is async-buffered anyway) |
| Idempotency | **Thin adapter** + stamp ShipX `reference = cmd.shipmentId`; retry-safety at the **job layer**. Downstream guard required of #769/#772 (skip if `providerShipmentId` set; enqueue with idempotency key) |
| Status mapping | Unknown ShipX code → non-terminal **`in-transit` + WARN**, never auto-terminal; full 42→7 table in `inpost-shipx.mapper.ts` (§4) |
| Connection tester | Deferred to **#771** |
| Registration | **API-only** this PR; worker reg deferred to **#772** |
| HTTP client | Dedicated axios **`InpostHttpClient`** behind **`IInpostHttpClient`** (jittered 429/5xx retry, structured logging) |
| Packaging | **One PR**, `Closes #764` + `Closes #765` |
| Exceptions | `InpostUnauthorizedException` (401) · `InpostValidationException` (4xx + pre-submit) · `PaczkomatUnavailableException` · `InpostConfigException` · `InpostNetworkException` (5xx/timeout). 429 retried → `InpostNetworkException`; retry-classifier → #772 |
| Config DTO | v1 = `{ environment, organizationId, senderAddress }`; `psModuleChoice` deferred to #767/#771 |
| Command extension | Add **required** typed `recipient` + `parcel` (+ `ShipmentAddress`) to canonical `GenerateLabelCommand` (carrier-neutral; serves #732). **Breaking change** to the merged #763 input — update existing constructors + refresh the #763 header (Step 1). No `platformParams` escape hatch |

## 3. ShipX API reference (verified against the docs)

- **Base URLs:** sandbox `https://sandbox-api-shipx-pl.easypack24.net`, prod `https://api-shipx-pl.easypack24.net`. Header `Authorization: Bearer {apiToken}`.
- **Create (simplified mode):** `POST /v1/organizations/{organizationId}/shipments`.
  - Paczkomat: `receiver{company_name,first_name,last_name,email,phone}` (**no address**), `parcels` = object `{template}` (`small|medium|large`), `custom_attributes{sending_method:"dispatch_order", target_point}`, `service:"inpost_locker_standard"`, `reference`.
  - Courier: `receiver{...,address{street,building_number,city,post_code,country_code}}` (**address required**), `parcels` = array `[{dimensions{length,width,height,unit:"mm"}, weight{amount,unit:"kg"}, is_non_standard}]`, `service:"inpost_courier_standard"`, `reference`.
  - `sender` = connection `senderAddress` (same `Peer` shape, with address).
  - Response `{ id: int, status, tracking_number: string|null }` → `providerShipmentId = String(id)`, `trackingNumber` nullable.
- **Label:** `GET /v1/shipments/{id}/label?format=Pdf&type=normal` → binary PDF, **only ≥ `confirmed`**. Async-buffered after create ⇒ store the ref, fetch on demand later (#769).
- **Cancel:** `DELETE /v1/shipments/{id}` → 204, **only `created`/`offers_prepared`**; else `invalid_action`. ⚠️ See §6 finding.
- **Tracking:** the timeline (`tracking_details[]{status,origin_status,datetime}`) lives on `GET /v1/tracking/{tracking_number}` — keyed by *tracking number*, **unavailable in sandbox**. The port hands `providerShipmentId`, so `getTracking` reads current `status` from `GET /v1/shipments/{id}`; `dispatchedAt`/`deliveredAt` come from the timeline **only if the shipment-by-id response carries it — shape to confirm (Step 5)**. v1 fallback: return mapped `status` and leave the timestamps `null` (documented) rather than guess a two-call path.
- **Points:** `GET /v1/points` (exact query/response fields — page `18153493` — to confirm during Step 5; pass-through, no cache).
- **Status → OL bucket** (`inpost-shipx.mapper.ts`; unknown → `in-transit` + WARN):
  - `generated`: created, offers_prepared, offer_selected, confirmed
  - `dispatched`: dispatched_by_sender(_to_pok), collected_from_sender, taken_by_courier(_from_pok), adopted_at_source_branch, sent_from_source_branch, adopted_at_sorting_center, taken_by_courier_from_customer_service_point
  - `in-transit`: out_for_delivery(_to_address), ready_to_pickup(_from_pok/_from_branch), pickup_reminder_sent(_address), avizo, readdressed, redirect_to_box, oversized, delay_in_delivery, stack_*/unstack_*, courier_avizo_in_customer_service_point, claimed
  - `delivered` (terminal): delivered
  - `cancelled` (terminal): canceled, canceled_redirect_to_box
  - `failed` (terminal): returned_to_sender, rejected_by_receiver, undelivered, undelivered_wrong_address, undelivered_cod_cash_receiver, pickup_time_expired, stack_parcel_*_pickup_time_expired

## 4. Design — core additions + package layout

**CORE (`libs/core/src/shipping/domain/types/`):**
- `shipment-recipient.types.ts` — `ShipmentRecipient { name?, firstName?, lastName?, email, phone, address?: ShipmentAddress }`, `ShipmentAddress { street, buildingNumber, city, postCode, countryCode }`.
- `shipment-parcel.types.ts` — `ShipmentParcel { template?, dimensions?: {length,width,height}, weightGrams? }`.
- Extend `GenerateLabelCommand` with **required** `recipient: ShipmentRecipient` + `parcel: ShipmentParcel`; export the new types from `@openlinker/core/shipping`. Required (not optional) — no carrier can label without them; this is a deliberate breaking change to the #763 input, mitigated in Step 1.

**Plugin package `libs/integrations/inpost/`:** mirrors the Allegro layout —
`package.json` (`.` + `./testing` exports), `index.ts`, `testing.ts`,
`inpost.tokens.ts`, `inpost-plugin.ts` (`createInpostPlugin` + `inpostAdapterManifest`
`{adapterKey:'inpost.shipx.v1', platformType:'inpost', supportedCapabilities:['ShippingProviderManager'], isDefault:true}`),
`inpost-integration.module.ts` (`createNestAdapterModule`), `domain/types/inpost-shipx.types.ts`,
`domain/types/inpost-credentials.types.ts`, `domain/exceptions/*`, `application/inpost-adapter.factory.ts`,
`application/dto/inpost-connection-config.dto.ts`, `infrastructure/http/{inpost-http-client.ts, inpost-http-client.interface.ts}`,
`infrastructure/adapters/{inpost-shipping.adapter.ts, inpost-connection-config-shape-validator.adapter.ts}`,
`infrastructure/mappers/inpost-shipx.mapper.ts` (the single ShipX↔domain seam + status map),
`testing/fake-inpost-shipping.adapter.ts`.

Adapter class `InpostShippingAdapter` — deliberately shortened from the `{Platform}{Capability}Adapter` rule's `InpostShippingProviderManagerAdapter` (the capability name is unwieldy; the short form matches #764/#765 and the shipping-domain vocabulary). `getSupportedMethods()` → `['paczkomat','kurier']`; `generateLabel` validates method + paczkomatId, builds the per-service body, POSTs (simplified), returns `{providerShipmentId, trackingNumber, labelPdfRef:'shipx:label:'+id}`, stamps `reference=shipmentId`; `cancelShipment` → `DELETE`, maps `invalid_action`→`InpostValidationException`; `findPickupPoints` → `GET /v1/points`; `getTracking` → `GET /v1/shipments/{id}`.

## 5. Steps

1. **CORE types** — add `ShipmentRecipient`/`ShipmentAddress`/`ShipmentParcel`, extend `GenerateLabelCommand` with the two **required** fields, export from barrel. **Grep every existing `GenerateLabelCommand` constructor (specs/fixtures) and update them** — required fields are a breaking change. Replace `generate-label.types.ts`'s "#764 adds them / speculate later" header note with the landed `recipient`+`parcel` shape so #732 inherits the resolved contract (this header note is the contract record; no separate ADR). Run core build + existing shipping specs.
2. **Scaffold package** (`package.json` `.`+`./testing`, tsconfigs, barrels, tokens); `pnpm install`.
3. **Domain types + exceptions** (`inpost-shipx.types.ts`, `inpost-credentials.types.ts`, 5 exceptions).
4. **HTTP client** (`IInpostHttpClient` + axios impl: Bearer, jittered 429/5xx retry, request-id logging).
5. **Mapper** — request builders (paczkomat object / courier array), response→`GenerateLabelResult`, `GET /v1/points`→`PickupPoint`, tracking→`TrackingSnapshot` + the 42→7 status map. (Confirm points query/response shape from page `18153493` here.)
6. **Adapter** — base port + `ShipmentCanceller` + `PickupPointFinder`; pre-submit validation; error mapping.
7. **Config DTO + shape validator** (`environment`,`organizationId`,`senderAddress`) → `InvalidConnectionConfigException`.
8. **Factory** — validate config → resolve `{apiToken}` via `credentialsResolver` → build client → adapter.
9. **Plugin descriptor + `createNestAdapterModule`** (register config-validator in `register(host)`).
10. **Fake (#765)** — `testing/fake-inpost-shipping.adapter.ts` + `./testing` sub-barrel; deterministic data + `seedFailure`/`seedPickupPoints`/`seedShipment`/`clear`.
11. **Register** in `apps/api/src/plugins.ts` only.
12. **Unit specs** — adapter (generate paczkomat/courier, method-unsupported throw, label-ref, cancel + `invalid_action`, tracking status map incl. unknown→in-transit+WARN, 401/validation/429 mapping), mapper, config-validator, fake. Mock `IInpostHttpClient`.
13. **Gate** — `pnpm lint && pnpm type-check && pnpm test`. No migration (uses core `Shipment`).

## 6. Validation, risks, downstream

- **Architecture:** new package implements a CORE port; additive CORE-type change is sanctioned by #763's header; deps via barrels; domain-exception mapping; capability dispatch via SDK. ✓
- **🔴 Cancel-window finding:** ShipX cancel is **pre-confirmation only** (`created`/`offers_prepared`). Simplified-mode shipments auto-advance to `confirmed`, so AC-7's "cancel while generated" is **not satisfiable via `DELETE`** for confirmed shipments. The adapter surfaces `invalid_action` as `InpostValidationException`; **#769 must treat cancel as best-effort** and use return/claim flows for already-confirmed parcels. Recorded for #769.
- **Sandbox tracking unavailable** → `getTracking` can't be E2E-verified in sandbox; covered by unit tests + fake only.
- **Can't E2E without creds** → offline deliverable = full adapter + fake + mocked-HTTP unit specs; sandbox verification is operator-side.
- **Downstream requirements to carry forward:** #769/#772 idempotency guard; #772 worker registration + retry classifier; #771 connection tester + `psModuleChoice` config; #769 label-download proxy endpoint + best-effort cancel; #768 webhooks.
- **To confirm in Step 5:** `GET /v1/shipments/{id}` response shape (does it carry the tracking timeline? — drives whether `getTracking` can populate `dispatchedAt`/`deliveredAt`); `GET /v1/points` query/response (`18153493`); ShipX error-body shapes; **`sending_method` per-method behaviour** — a wrong default yields unfulfillable shipments, so confirm before hardcoding `dispatch_order` and derive it from `shippingMethod` if it varies.

## References
- ShipX EN docs: Shipment `18153485`, simplified-create `18153501`, label `18153509`, cancel `18153504`, statuses `18153478`, tracking `18153479`, points `18153493`, webhooks `18153494`.
- `libs/core/src/shipping/**` (#763), `libs/integrations/allegro/**` (template), `libs/plugin-sdk/src/{adapter-plugin,host-services,create-nest-adapter-module,dispatch-capability}.ts`, `apps/api/src/plugins.ts`.
- `docs/specs/product-spec-727-inpost-integration.md`.

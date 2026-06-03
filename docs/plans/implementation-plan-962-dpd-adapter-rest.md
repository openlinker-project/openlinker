# Implementation Plan: DPD Polska adapter package + REST transport (courier-to-door + COD)

**Date**: 2026-06-03
**Status**: Ready for Review — grounded in the live `DPDServices` OpenAPI
**Issue**: #962 (Part of #961)
**Spec**: [`docs/specs/product-spec-961-dpd-polska-shipping.md`](../specs/product-spec-961-dpd-polska-shipping.md)
**Implementation branch**: `962-dpd-adapter-rest`
**Estimated Effort**: M (~1–1.5 weeks)

> **Grounding note:** the DPD Polska REST `DPDServices` contract below was pulled
> from the live OpenAPI (Swagger at `dpdservices.dpd.com.pl`, via an
> authenticated browser session). Endpoints, auth, schemas, COD shape and the
> error model are verified, not assumed. The one residual unknown is the **test-
> server credentials** (gated behind the DPD account) → the live round-trip is a
> pre-merge manual AC. Transport decision: **REST**, see ADR-018.

---

## 1. Task Summary

**Objective**: Build `@openlinker/integrations-dpd-polska` — courier-to-door label generation + COD on the seller's own DPD contract, against the DPD Polska **REST `DPDServices`** API, behind `ShippingProviderManagerPort` + `LabelDocumentReader`. Thread the COD amount through the core command so a caller can submit it.

**Context**: Second OL-managed carrier after InPost (#727), customer-driven (#961). REST/JSON over native `fetch` — the InPost pattern. Two-call flow: create packages (waybills) → render label (PDF).

**Classification**: **CORE + Integration.** New REST integration package + a small additive CORE COD field. No DB migration.

---

## 2. Scope & Non-Goals

### In Scope
**CORE (additive, ~3 edits):** `ShipmentCod` type (`{ amount: string; currency: string }`); `GenerateLabelCommand.cod?` (auto-flows into `ShipmentDispatchInput` via its `Omit<>`); one pass-through line in `ShipmentDispatchService` (`cod: input.cod`, beside `recipient`/`parcel`) — **caller-supplied, not order-sourced** (the dispatch seam is caller-owns-payload). `PaymentStatus='cod'` already exists; operator-facing COD-amount entry is #966.

**Integration (`libs/integrations/dpd-polska/`):** REST `IDpdHttpClient` (native fetch + JSON, Basic auth) mirroring `InpostHttpClient`; `DpdShippingAdapter implements ShippingProviderManagerPort, LabelDocumentReader`; mapper; config DTO + validator; manifest `dpd.polska.rest.v1`; plugin descriptor; API host registration.

### Out of Scope (#961 children)
DPD Pickup / `PickupPointFinder` (#963 — `pudoReceiver` + `DPD_PICKUP` service); bulk + `generateProtocol` (#964); real tracking via DPD InfoServices + worker reg (#965); FE connection form + COD-amount input (#966); cancel (no API op); international/returns; `generateShipmentV1` single-call variant.

### Constraints
- CORE change additive only. No new runtime dep (native fetch + JSON). No migration (reuses `shipments`).

---

## 3. Architecture Mapping

**Layers**: CORE (`libs/core/src/shipping/` — command field + dispatch pass-through) + Integration (`libs/integrations/dpd-polska/`).
**Capabilities**: `ShippingProviderManagerPort` + `LabelDocumentReader` (from `@openlinker/core/shipping`).
**Reused unchanged**: `ShipmentDispatchService` (one-line `cod` pass-through), `ShipmentLabelService`, `CredentialsResolverPort`, `ConnectionConfigShapeValidatorRegistryService`, `createNestAdapterModule` + `dispatchCapability`.
**Core-vs-Integration**: COD is carrier-neutral → canonical command (matches `recipient`/`parcel`, #764). REST/JSON specifics stay in the integration. No new core port.

---

## 4. External / Domain Research — DPD Polska `DPDServices` REST (verified from live OpenAPI)

- **Base URL** `https://dpdservices.dpd.com.pl`. **Auth**: HTTP **Basic** (`securitySchemes.basicAuth`) → `Authorization: Basic base64(login:password)`. Accept `application/json`. UTF-8.
- **Errors**: HTTP `200/201` ok; `400` → `Errors { errors:[{code,subCode,userMessage,rejectedValue,field}], traceId }`; `401` → `Error401 { status:'MISSING_PERMISSION' }`; `403/404/422/429` standard. **Crucially, business validation failures come back `200` with non-OK status in the body** (see below).

**Create — `POST /public/shipment/v1/generatePackagesNumbers`**
Request `GeneratePackagesNumbersRequest`:
```
{ generationPolicy: 'STOP_ON_FIRST_ERROR'|'IGNORE_ERRORS'|'ALL_OR_NOTHING',
  packages: [ SinglePackage ] }
SinglePackage(req: parcels, payerFID, sender):
  { reference?(≤50), receiver?:SenderOrReceiver, pudoReceiver?:PudoReceiver,
    sender:SenderOrReceiver, payerFID:int, ref1?/ref2?/ref3?(≤100),
    services?:[TransportService], parcels:[Parcel] }
SenderOrReceiver(req: address, city, countryCode, postalCode):
  { company?(≤100), name?(≤100), address(≤100), city(≤50),
    countryCode(2), postalCode(≤10), phone?(≤100), email?(≤100) }
Parcel(req: weight): { reference?(≤50), weight:number /*kg*/,
    sizeX?/sizeY?/sizeZ?:number /*cm*/, content?(≤300), customerData1..3?(≤200) }
TransportService(req: code): { code: ServiceCode, attributes?:[{code(≤50),value(≤100)}] }
ServiceCode enum incl: COD, DPD_PICKUP, DECLARED_VALUE, SATURDAY, ALLEGRO_DELIVERY, …
COD → { code:'COD', attributes:[ {code:'AMOUNT',value:'39.99'}, {code:'CURRENCY',value:'PLN'} ] }
       (currencies: PLN, EUR, RON, CZK; COD excludes INTERNATIONAL/PALETTE)
```
Response `GeneratePackagesNumbersResponse`:
```
{ status: MultiPackageGenerationStatus /*OK|UNKNOWN_ERROR|INCORRECT_DATA|DISABLED_API|
            ERROR_NO_FID_PERMISSION|DUPLICATED_*|NOT_PROCESSED|DISALLOWED_FID*/,
  sessionId:long,
  packages: [ { status: PackageGenerationStatusGPN /*OK|INCORRECT_DATA|NOT_PROCESSED|…*/,
                reference?, validationInfo:[{errorCode: PackageValidationErrorCodeGPN, info}],
                parcels: [ { status: ParcelGenerationStatusGPN, reference?, waybill,
                             validationInfo:[{errorCode: ParcelValidationErrorCodeGPN, info}] } ] } ],
  traceId }
```
Validation error enums are rich and map straight to provider-rejection codes: e.g. `INCORRECT_PAYER_FID`, `INCORRECT_RECEIVER_POSTAL_CODE`, `COD_IS_NOT_AVAILABLE_FOR_POSTAL_CODE`, `COD_CURRENCY_NOT_AVAILABLE_FOR_COUNTRY`, `INCORRECT_WEIGHT`, `SIZE_*_OUT_OF_RANGE`.

**Label — `POST /public/shipment/v1/generateSpedLabels`**
Request `GenerateSpedLabelsRequest(req: format, labelSearchParams, outputDocFormat, outputType)`:
```
{ labelSearchParams: { policy:'STOP_ON_FIRST_ERROR'|'IGNORE_ERRORS',
      session: { type:'DOMESTIC'|'INTERNATIONAL', sessionId?:long,
                 packages?:[ { reference?, parcels:[ { reference?, waybill } ] } ] },
      documentId? },
  outputDocFormat:'PDF'|'EPL'|'ZPL'|'XML', format:'A4'|'LBL_PRINTER',
  outputType:'BIC3'|'EXTENDED'|'RETURN', variant?:'STANDARD'|… }
```
Response `GenerateSpedLabelsResponse`: `{ status:GenerateSpedLabelsStatus /*OK|NOT_FOUND|…*/, documentData: base64 PDF, session:{…PrintStatus}, documentId?, traceId }`.

### Internal patterns to mirror
- **Adapter scaffolder** `scripts/create-adapter.mjs` (14-file template, drift-guarded). Start here.
- **InPost** `libs/integrations/inpost/` — `InpostHttpClient` (native fetch, retry, `requestBinary`), factory, adapter, config DTO + validator, manifest/descriptor. DPD's client = same shape, Basic auth instead of Bearer, JSON label (base64 in body) instead of binary GET.
- **`ShipmentDispatchInput`** `…/application/types/shipment-dispatch.types.ts` (`Omit<GenerateLabelCommand,…>`, caller-owns-payload).

---

## 5. Questions & Assumptions

### Open Questions
- **OQ-1 (only blocker for the live spike):** REST **test-server Basic-auth credentials** — in the gated Swagger doc; the customer/account must supply. Unit tests don't need them (canned fixtures); the live round-trip is a pre-merge AC.
- **OQ-2:** does `payerFID` (FID sub-number) come from connection **config** or **credentials**? Assume credentials alongside Basic login/password (it identifies the paying account). Confirm in the spike.
- **OQ-3:** production vs any separate test base URL (both appear to be `dpdservices.dpd.com.pl`; test is creds-gated, not host-gated). Confirm.

### Assumptions
- `labelPdfRef` = the waybill (locator); `fetchLabel` re-renders via `generateSpedLabels` (InPost precedent; no blob store).
- `getSupportedMethods()` → `['kurier']` only (pickup = #963).
- v1 sends one package with one parcel per OL shipment (multi-parcel = future).
- `generationPolicy: 'ALL_OR_NOTHING'` for single-shipment create (fail atomically).

---

## 6. Proposed Implementation Plan

### Phase 0 — Spike (de-risk auth + JSON; needs OQ-1 creds)
1. With test creds, `POST generatePackagesNumbers` (plain + COD) → waybills; `POST generateSpedLabels` (PDF) → decode `documentData` → PDF. Confirm Basic-auth header, `payerFID` placement (OQ-2), and the per-parcel `status` shape on success + on a forced-invalid request. Spike code NOT merged. (If creds aren't available yet, build Phases 1–4 against the canned OpenAPI fixtures and leave this as the pre-merge AC.)

### Phase 1 — CORE: COD field on the command (additive)
2. `ShipmentCod` type + `GenerateLabelCommand.cod?` in `libs/core/src/shipping/domain/types/`. Auto-flows into `ShipmentDispatchInput`.
   - **Acceptance**: type-check green; InPost/Allegro adapters unaffected (optional field).
3. `ShipmentDispatchService` forwards `cod: input.cod` (one line). Unit-test forwards when present, `undefined` otherwise. **No order-sourcing.**
   - **Acceptance**: `shipment-dispatch.service.spec.ts` green; existing shipping int-spec unaffected.

### Phase 2 — Integration scaffold + REST client
4. `node scripts/create-adapter.mjs dpd-polska`; layer DPD files on top. `package.json` deps: `@openlinker/{core,plugin-sdk,shared}`, `class-validator`, `class-transformer` (no `fast-xml-parser`).
5. **Types** `domain/types/{dpd-config,dpd-credentials,dpd-rest}.types.ts` — REST request/response shapes from §4 as `as const` unions + interfaces. **Exceptions** `domain/exceptions/{dpd-config,dpd-unauthorized,dpd-network}.exception.ts` (mirror InPost).
6. **`IDpdHttpClient` + `DpdHttpClient`** (`infrastructure/http/`): native `fetch`, `Authorization: Basic`, `Content-Type/Accept: application/json`; `request<T>(method, path, body)`; retry loop (429/5xx/network, jittered) + 30 s timeout (InPost constants). Error mapping: `401` → `DpdUnauthorizedException`; `Errors`/`Error401` body → `ShippingProviderRejectionException('dpd', code, userMessage, {field,subCode})`; network/timeout → `DpdNetworkException`.
   - **Acceptance**: unit tests (mock `fetch`): success parse, `Errors` body → rejection, 401 → unauthorized, timeout → network, retry-on-5xx.

### Phase 3 — Mapper + adapter
7. **`dpd-shipment.mapper.ts`**: `GenerateLabelCommand` → `GeneratePackagesNumbersRequest` — one `SinglePackage` (sender from config, `receiver` from `cmd.recipient`, `payerFID` from creds/config, `reference` = OL shipment id, `ref1` = orderId), one `Parcel` (**`weight` = `weightGrams/1000`**, dims cm), `services` incl. **COD from `cmd.cod`** → `{code:'COD', attributes:[{code:'AMOUNT',value:cod.amount},{code:'CURRENCY',value:cod.currency}]}`. Response → `{ providerShipmentId: waybill, trackingNumber: waybill, labelPdfRef: waybill }`. Build `generateSpedLabels` request from a waybill; decode `documentData` base64 → `Uint8Array`.
   - **Acceptance**: mapper unit tests — plain + COD; grams→kg (`1500 → 1.5`); base64 → bytes.
8. **`DpdShippingAdapter`** (`implements ShippingProviderManagerPort, LabelDocumentReader`):
   - `generateLabel` → mapper → `client.request('POST','/public/shipment/v1/generatePackagesNumbers', body)`; **assert top-level `status==='OK'` AND every `packages[].status` AND `parcels[].status` === 'OK'**, else throw `ShippingProviderRejectionException('dpd', validationInfo.errorCode, info, …)` (business failures arrive as 200 — Phase-B "COD fails where labels succeed"); extract `parcels[0].waybill`.
   - `fetchLabel` → `POST /public/shipment/v1/generateSpedLabels` (`outputDocFormat:'PDF'`, `format:'A4'`, `outputType:'BIC3'`, `session.type:'DOMESTIC'`, packages→parcels→waybill) → check `status==='OK'` → `LabelDocument{ contentType:'application/pdf', body }`.
   - `getSupportedMethods()` → `['kurier']`.
   - `getTracking` → **throws typed `tracking.unavailable`** (no fabricated status); DPD stays out of the worker until #965 (real tracking via DPD InfoServices).
   - **Acceptance**: adapter unit tests (mock `IDpdHttpClient`): plain, COD, non-OK package/parcel status → rejection, `Errors`-401 propagation, `fetchLabel`, `getSupportedMethods`, `getTracking` throws.

### Phase 4 — Validator, factory, plugin, host wiring
9. **Config DTO + validator** (`application/dto/dpd-connection-config.dto.ts` + `infrastructure/adapters/dpd-connection-config-shape-validator.adapter.ts`): `environment`, sender block (PL postcode `NN-NNN`/`\d{2}-\d{3}`, ISO-3166-1 alpha-2 country). Registered in `register(host)`.
10. **`dpd-adapter.factory.ts`** `createDpdShippingAdapter(connection, credentialsResolver)`: extract config, resolve `DpdCredentials { login, password, payerFid }` (throw `DpdConfigException` if missing), pick base URL by `environment`, construct `DpdHttpClient` + adapter.
11. **`dpd-plugin.ts`**: `dpdAdapterManifest { adapterKey:'dpd.polska.rest.v1', platformType:'dpd', supportedCapabilities:['ShippingProviderManager'], displayName:'DPD Polska REST v1', version:'1.0.0', isDefault:true }` + `createDpdPlugin()` (register config-validator; `createCapabilityAdapter` → `dispatchCapability({ ShippingProviderManager: () => adapter })`). **`dpd-integration.module.ts`** = `createNestAdapterModule({ plugin: createDpdPlugin() })`.
12. **Barrels** `index.ts` + `testing.ts` (`FakeDpdShippingAdapter`). **Host wiring**: add `DpdIntegrationModule` to `apps/api/src/plugins.ts` + the two `^@openlinker/integrations-dpd-polska$` / `/(.*)$` lines to `apps/api/test/jest-integration.cjs` (#917 — `check-jest-integration-mappers.mjs` prints them).
    - **Acceptance**: `pnpm --filter @openlinker/api build` + boot resolve the plugin; `getCapabilityAdapter` returns the DPD adapter for a `dpd` connection.

### Config / Migrations / Events
- No env vars; no migration (reuses `shipments`); no new events (`ShipmentDispatchService` owns persistence).

---

## 7. Alternatives Considered
- **SOAP `DPDPackageObjServices`** — rejected; legacy XML/WSDL, hand-rolled envelopes, while REST `DPDServices` covers the same flow natively (ADR-018).
- **COD via untyped `platformParams`** — rejected; typed `cod?` per the command-type header.
- **Sourcing COD in dispatch from the order** — rejected; contradicts the caller-owns-payload seam.
- **`generateShipmentV1` single-call** — deferred; the two-step create→label is the documented primary flow and keeps `fetchLabel` clean.

---

## 8. Validation & Risks
- ✅ Additive carrier-neutral CORE change; REST integration mirrors InPost; barrel-only imports; shared `ShippingProviderRejectionException`; no migration.
- **Business failures arrive as HTTP 200 with non-OK body status** — adapter must check all three status levels (Phase 3 step 8); dedicated test. Highest-risk correctness item.
- **grams→kg** explicit + tested (1000× error otherwise).
- **End-to-end COD needs #966** (operator amount entry); #962 ships backend capability + pass-through, proven by unit test.
- **Idempotency**: no API idempotency key; at-most-once via core `findActiveByOrderId` + DB partial-unique on `providerShipmentId`; set `reference` = OL shipment id (double-COD risk noted).
- **Live creds (OQ-1)** gate only the live round-trip (pre-merge AC), not the build/unit tests.
- Backward compatible — purely additive; new plugin + two host lines.

---

## 9. Testing Strategy & Acceptance Criteria

### Unit Tests
- **Core**: `shipment-dispatch.service.spec.ts` — `cod` pass-through.
- `dpd-http-client.spec.ts` — Basic-auth header, JSON success, `Errors`/401 → exceptions, timeout, retry.
- `dpd-shipment.mapper.spec.ts` — plain + COD (`AMOUNT`/`CURRENCY`), grams→kg, base64 decode.
- `dpd-shipping.adapter.spec.ts` — `generateLabel` plain/COD, non-OK package/parcel status → rejection, `fetchLabel`, `getSupportedMethods`, `getTracking` throws.
- `dpd-connection-config-shape-validator.adapter.spec.ts` — valid/invalid config.

### Integration Tests
- None new (existing `/shipments/*` cover DPD once registered). Live REST round-trip = manual Phase-0 spike (needs OQ-1 creds).

### Acceptance Criteria (#962)
- [ ] Operator creates a "DPD Polska" connection (login + password + payerFID + sender); connection-test reaches the REST API.
- [ ] Courier label generates → downloadable PDF; shipment `generated`.
- [ ] COD threads `cmd.cod` → `services[COD].attributes[AMOUNT,CURRENCY]` (unit-proven); DPD COD/validation errors surface verbatim (errorCode + info). Operator COD-amount entry is #966.
- [ ] Invalid recipient data (postcode/phone/weight) rejected with the DPD `errorCode`.
- [ ] `pnpm lint` / `type-check` / unit tests green; jest-integration mapper added; `check-create-adapter` invariant satisfied.
- [ ] **Manual (pre-merge):** live REST test-server round-trip produces a real PDF for a plain + a COD shipment.

---

## 10. Alignment Checklist
- [x] Hexagonal architecture (integration implements core ports; additive core change)
- [x] CORE vs Integration boundary justified (COD carrier-neutral; caller-owns-payload)
- [x] Existing patterns (scaffolder, InPost HTTP-client, plugin-sdk)
- [x] Idempotency considered (core pre-check; `reference`=shipment id; double-COD noted)
- [x] Rate limits & retries (retry loop + timeout)
- [x] Error handling comprehensive (HTTP + body-status + shared rejection)
- [x] Testing strategy complete (5 unit suites incl. core dispatch)
- [x] Naming + file structure per standards (mirrors InPost / scaffolder)
- [x] Plan execution-ready (only live creds outstanding)

---

## Related Documentation
- Spec: [`product-spec-961-dpd-polska-shipping.md`](../specs/product-spec-961-dpd-polska-shipping.md)
- ADR: [`018-dpd-polska-rest-api-over-soap.md`](../architecture/adrs/018-dpd-polska-rest-api-over-soap.md)
- Reference: `libs/integrations/inpost/`, `scripts/create-adapter.mjs`
- [Architecture Overview](../architecture-overview.md) · [Engineering Standards](../engineering-standards.md) · [Testing Guide](../testing-guide.md)

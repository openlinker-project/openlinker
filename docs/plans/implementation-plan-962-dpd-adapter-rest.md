# Implementation Plan: DPD Polska adapter package + REST transport (courier-to-door + COD)

**Date**: 2026-06-03
**Status**: Ready for Review — grounded in the live `DPDServices` OpenAPI; revised post tech-review (#968)
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
**CORE (additive, ~3 edits):** `ShipmentCod` type (`{ amount: string; currency: string }`) in its **own** `domain/types/shipment-cod.types.ts` (mirrors the `shipment-recipient.types.ts` / `shipment-parcel.types.ts` one-shape-per-file precedent — *not* inlined into `generate-label.types.ts`); `GenerateLabelCommand.cod?` (auto-flows into `ShipmentDispatchInput` via its `Omit<>`); one pass-through line in `ShipmentDispatchService` (`cod: input.cod`, beside `recipient`/`parcel`) — **caller-supplied, not order-sourced** (the dispatch seam is caller-owns-payload). `PaymentStatus='cod'` already exists; operator-facing COD-amount entry is #966.

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
  - **⚠ Credential-model caveat (resolve in Phase 0, OQ-2):** the DPD *customer* doc describes an `X-DPD-FID` **header** (= payer/masterFid) **in addition to** the body `payerFID` (the numkat/fid sub-number), whereas the OpenAPI declares only `basicAuth` + a body `payerFID`. If the header is in fact required, the credential model below is incomplete (it needs a `masterFid`). The spike MUST confirm header-vs-body before the live round-trip.
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
- **Adapter scaffolder** `scripts/create-adapter.mjs` (capability-agnostic 14-file `createNestAdapterModule` skeleton, drift-guarded). Start here, then layer the shipping capability on top — verified the scaffolder hard-codes no capability, so a shipping adapter is a clean fit.
- **InPost** `libs/integrations/inpost/` — `InpostHttpClient` (native fetch, retry, `requestBinary`), factory, adapter, config DTO + validator, manifest/descriptor. DPD's client = same shape, Basic auth instead of Bearer, JSON label (base64 in body) instead of binary GET. **Note:** InPost's `register(host)` wires *only* a config-shape validator — no live connection-tester — so DPD follows the same shape (see OQ on AC-1).
- **`ShipmentDispatchInput`** `…/application/types/shipment-dispatch.types.ts` (`Omit<GenerateLabelCommand,…>`, caller-owns-payload).

---

## 5. Questions & Assumptions

### Open Questions
- **OQ-1 (only blocker for the live spike):** REST **test-server Basic-auth credentials** — in the gated Swagger doc; the customer/account must supply. Unit tests don't need them (canned fixtures); the live round-trip is a pre-merge AC.
- **OQ-2 (credential model — widened post-review):** resolve the **auth shape end-to-end**, not just storage location:
  1. Is an `X-DPD-FID` **header** (masterFid) required *in addition to* HTTP Basic + body `payerFID`? (customer doc says yes; OpenAPI shows Basic-only.) If yes, add `masterFid` to the credential model and set the header in the client.
  2. Does `payerFID` (FID sub-number, int32) come from connection **config** or **credentials**? Assume credentials alongside Basic login/password (it identifies the paying account).
  Both confirmed in the Phase-0 spike. The credential model is provisional until then.
- **OQ-3:** production vs any separate test base URL (both appear to be `dpdservices.dpd.com.pl`; test is creds-gated, not host-gated). Confirm.
- **OQ-4 (poller interaction):** confirm whether the #838 `ShipmentStatusSyncService` worker handler enumerates **all** `ShippingProviderManager` connections (which would sweep DPD shipments and trip the `getTracking` throw — swallowed as a `warn`, but recurring) or is opt-in per connection. Drives the `getTracking` decision in §6 step 8.

### Assumptions
- `labelPdfRef` = the waybill (locator); `fetchLabel` re-renders via `generateSpedLabels` (InPost precedent; no blob store).
- `getSupportedMethods()` → `['kurier']` only (pickup = #963).
- v1 sends one package with one parcel per OL shipment (multi-parcel = future).
- `generationPolicy: 'ALL_OR_NOTHING'` for single-shipment create (fail atomically).

---

## 6. Proposed Implementation Plan

### Phase 0 — Spike (de-risk auth + JSON; needs OQ-1 creds)
1. With test creds, `POST generatePackagesNumbers` (plain + COD) → waybills; `POST generateSpedLabels` (PDF) → decode `documentData` → PDF. Confirm: (a) the **auth shape** — Basic only vs Basic + `X-DPD-FID` header, and `payerFID` placement (OQ-2); (b) the per-parcel `status` shape on success **and** on a forced-invalid request (so the body-status assertion in step 8 is correct); (c) whether a network-timeout-then-retry on create double-creates (informs the retry policy in step 6). Spike code NOT merged. (If creds aren't available yet, build Phases 1–4 against the canned OpenAPI fixtures and leave this as the pre-merge AC.)

### Phase 1 — CORE: COD field on the command (additive)
2. New `domain/types/shipment-cod.types.ts` (`ShipmentCod { amount: string; currency: string }` — own file per the one-shape-per-file precedent) + `GenerateLabelCommand.cod?` referencing it in `generate-label.types.ts`. Auto-flows into `ShipmentDispatchInput`.
   - **Acceptance**: type-check green; InPost/Allegro adapters unaffected (optional field).
3. `ShipmentDispatchService` forwards `cod: input.cod` (one line). Unit-test forwards when present, `undefined` otherwise. **No order-sourcing.**
   - **Acceptance**: `shipment-dispatch.service.spec.ts` green; existing shipping int-spec unaffected.

### Phase 2 — Integration scaffold + REST client
4. `node scripts/create-adapter.mjs dpd-polska`; layer DPD files on top. `package.json` deps: `@openlinker/{core,plugin-sdk,shared}`, `class-validator`, `class-transformer` (no `fast-xml-parser`).
5. **Types** `domain/types/{dpd-config,dpd-credentials,dpd-rest}.types.ts` — REST request/response shapes from §4 as `as const` unions + interfaces. `dpd-credentials.types.ts` carries `{ login, password, payerFid }` **plus a provisional `masterFid?`** pending OQ-2. **Exceptions** `domain/exceptions/{dpd-config,dpd-unauthorized,dpd-network}.exception.ts` (mirror InPost).
6. **`IDpdHttpClient` + `DpdHttpClient`** (`infrastructure/http/`): native `fetch`, `Authorization: Basic` (+ `X-DPD-FID` header iff OQ-2 confirms it), `Content-Type/Accept: application/json`; `request<T>(method, path, body)`; 30 s timeout (InPost constants). Error mapping: `401` → `DpdUnauthorizedException`; `Errors`/`Error401` body → `ShippingProviderRejectionException('dpd', code, userMessage, {field,subCode})`; network/timeout → `DpdNetworkException`.
   - **Retry policy (post-review — guards double-COD):** auto-retry is restricted to **idempotent-safe** failures (HTTP 429 / 503 with back-off, jittered). The client must **NOT** auto-retry `generatePackagesNumbers` on a **network/timeout** error: DPD's `reference` is a free-text ref, *not* a dedup key, so a retry after DPD already committed produces a **second waybill + second COD charge**. A create-timeout surfaces as `DpdNetworkException` (caller treats it as indeterminate → manual reconciliation), never a silent re-POST. The idempotent `generateSpedLabels` read may retry on network/timeout freely.
   - **Acceptance**: unit tests (mock `fetch`): success parse, `Errors` body → rejection, 401 → unauthorized, timeout → network, retry-on-429/503, **no retry on create-network-timeout**.

### Phase 3 — Mapper + adapter
7. **`dpd-shipment.mapper.ts`**: `GenerateLabelCommand` → `GeneratePackagesNumbersRequest` — one `SinglePackage` (sender from config, `receiver` from `cmd.recipient`, `payerFID` from creds/config, `reference` = OL shipment id, `ref1` = orderId), one `Parcel`. Field-flattening the mapper owns:
   - **Address** — OL `ShipmentAddress` splits `street` + `buildingNumber`; DPD `address` is a single ≤100 field → concatenate (`` `${street} ${buildingNumber}` ``).
   - **Name** — OL recipient is `name? / firstName? / lastName?`; DPD wants a single `name` (≤100) → resolve (`name ?? `` `${firstName} ${lastName}` ``).
   - **Weight** — DPD `weight` is **kg**; OL is `weightGrams` → `weightGrams / 1000`. Dims cm.
   - **`payerFID`** is `int32` → `Number(creds.payerFid)` (validator rejects non-numeric).
   - **COD** from `cmd.cod` → `{code:'COD', attributes:[{code:'AMOUNT',value:cod.amount},{code:'CURRENCY',value:cod.currency}]}`. `amount` stays a string end-to-end (no float rounding); optionally pre-validate `currency ∈ {PLN,EUR,RON,CZK}` for a clearer error than DPD's `COD_CURRENCY_NOT_AVAILABLE_FOR_COUNTRY` (otherwise DPD rejects, surfaced verbatim).
   - Response → `{ providerShipmentId: waybill, trackingNumber: waybill, labelPdfRef: waybill }`. Build `generateSpedLabels` request from a waybill; decode `documentData` base64 → `Uint8Array`.
   - **Acceptance**: mapper unit tests — plain + COD; address/name flatten; grams→kg (`1500 → 1.5`); `payerFID` parse; base64 → bytes.
8. **`DpdShippingAdapter`** (`implements ShippingProviderManagerPort, LabelDocumentReader`):
   - `generateLabel` → mapper → `client.request('POST','/public/shipment/v1/generatePackagesNumbers', body)`; **assert top-level `status==='OK'` AND every `packages[].status` AND `parcels[].status` === 'OK'**, else throw `ShippingProviderRejectionException('dpd', validationInfo.errorCode, info, …)` (business failures arrive as 200 — Phase-B "COD fails where labels succeed"); extract `parcels[0].waybill`.
   - `fetchLabel` → `POST /public/shipment/v1/generateSpedLabels` (`outputDocFormat:'PDF'`, `format:'A4'`, `outputType:'BIC3'`, `session.type:'DOMESTIC'`, packages→parcels→waybill) → check `status==='OK'` → `LabelDocument{ contentType:'application/pdf', body }`.
   - `getSupportedMethods()` → `['kurier']`.
   - `getTracking` → **throws typed `tracking.unavailable`** (`ShippingProviderRejectionException`; no fabricated status — the adapter receives only `providerShipmentId`, so it has no basis to echo a real status). Real tracking is #965 (DPD InfoServices). **Poller note (OQ-4):** `ShipmentStatusSyncService` calls `getTracking` for every non-terminal shipment of a scanned connection and **catches+`warn`s** the throw (`failed += 1`, loop continues — no crash). If the #838 worker enumerates all `ShippingProviderManager` connections, DPD shipments will trip this every cycle (benign but recurring noise indistinguishable from a real outage). Confirm OQ-4: if enumerate-all, gate DPD out of the scan until #965 (e.g. capability/registration check) rather than relying on "DPD isn't in the worker."
   - **Acceptance**: adapter unit tests (mock `IDpdHttpClient`): plain, COD, non-OK package/parcel status → rejection, `Errors`-401 propagation, `fetchLabel`, `getSupportedMethods`, `getTracking` throws.

### Phase 4 — Validator, factory, plugin, host wiring
9. **Config DTO + validator** (`application/dto/dpd-connection-config.dto.ts` + `infrastructure/adapters/dpd-connection-config-shape-validator.adapter.ts`): `environment`, sender block (PL postcode `NN-NNN`/`\d{2}-\d{3}`, ISO-3166-1 alpha-2 country), numeric `payerFID`. Registered in `register(host)` — **config-shape validator only**, mirroring InPost (no live connection-tester; see AC-1).
10. **`dpd-adapter.factory.ts`** `createDpdShippingAdapter(connection, credentialsResolver)`: extract config, resolve `DpdCredentials { login, password, payerFid, masterFid? }` (throw `DpdConfigException` if missing), pick base URL by `environment`, construct `DpdHttpClient` + adapter.
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
- **Auto-retrying the create on network/timeout** — rejected; no DPD-side idempotency key on `generatePackagesNumbers` → a blind retry risks a second waybill + second COD charge (see §6 step 6).
- **Returning a fabricated `getTracking` snapshot** — rejected; the adapter receives only `providerShipmentId` (no current status) so any returned status would be a lie. Throwing (swallowed by the poller) is the honest degradation until #965.
- **`generateShipmentV1` single-call** — deferred; the two-step create→label is the documented primary flow and keeps `fetchLabel` clean.

---

## 8. Validation & Risks
- ✅ Additive carrier-neutral CORE change; REST integration mirrors InPost; barrel-only imports; shared `ShippingProviderRejectionException`; no migration.
- **Business failures arrive as HTTP 200 with non-OK body status** — adapter must check all three status levels (Phase 3 step 8); dedicated test. Highest-risk correctness item.
- **Double-COD on retry (real money)** — `generatePackagesNumbers` has no DPD-side idempotency key (`reference` is free-text, not a dedup key). Mitigation is layered: (1) the HTTP client does **not** auto-retry create on network/timeout (§6 step 6); (2) core `findActiveByOrderId` blocks re-dispatch; (3) DB partial-unique on `providerShipmentId`. A create-timeout is therefore an indeterminate state requiring manual reconciliation, **not** an automatic re-POST.
- **grams→kg** explicit + tested (1000× error otherwise).
- **getTracking dormant-throw vs #838 poller** — confirm OQ-4 (enumerate-all vs opt-in). The throw is caught+`warn`ed (no crash), but if the poller sweeps DPD connections it's recurring noise; prefer gating DPD out of the scan until #965 over relying on "not wired into the worker."
- **End-to-end COD needs #966** (operator amount entry); #962 ships backend capability + pass-through, proven by unit test.
- **Live creds (OQ-1) + auth shape (OQ-2)** gate only the live round-trip (pre-merge AC), not the build/unit tests.
- Backward compatible — purely additive; new plugin + two host lines.

---

## 9. Testing Strategy & Acceptance Criteria

### Unit Tests
- **Core**: `shipment-dispatch.service.spec.ts` — `cod` pass-through.
- `dpd-http-client.spec.ts` — Basic-auth header (+ `X-DPD-FID` iff OQ-2), JSON success, `Errors`/401 → exceptions, timeout, retry-on-429/503, **no retry on create-network-timeout**.
- `dpd-shipment.mapper.spec.ts` — plain + COD (`AMOUNT`/`CURRENCY`), address/name flatten, grams→kg, `payerFID` parse, base64 decode.
- `dpd-shipping.adapter.spec.ts` — `generateLabel` plain/COD, non-OK package/parcel status → rejection, `fetchLabel`, `getSupportedMethods`, `getTracking` throws.
- `dpd-connection-config-shape-validator.adapter.spec.ts` — valid/invalid config.

### Integration Tests
- None new (existing `/shipments/*` cover DPD once registered). Live REST round-trip = manual Phase-0 spike (needs OQ-1 creds).

### Acceptance Criteria (#962)
- [ ] Operator creates a "DPD Polska" connection (login + password + payerFID + sender); **config-shape validation rejects a malformed config** (postcode/country/numeric-payerFID). A *live* connection-test against the REST API is out of scope for v1 (mirrors InPost, which ships none) — deferred unless OQ-2 surfaces a cheap probe endpoint.
- [ ] Courier label generates → downloadable PDF; shipment `generated`.
- [ ] COD threads `cmd.cod` → `services[COD].attributes[AMOUNT,CURRENCY]` (unit-proven); DPD COD/validation errors surface verbatim (errorCode + info). Operator COD-amount entry is #966.
- [ ] Invalid recipient data (postcode/phone/weight) rejected with the DPD `errorCode`.
- [ ] A create-network-timeout does **not** auto-retry (no double-waybill) — unit-proven.
- [ ] `pnpm lint` / `type-check` / unit tests green; jest-integration mapper added; `check-create-adapter` invariant satisfied.
- [ ] **Manual (pre-merge):** live REST test-server round-trip produces a real PDF for a plain + a COD shipment, with the auth shape (OQ-2) confirmed.

---

## 10. Alignment Checklist
- [x] Hexagonal architecture (integration implements core ports; additive core change)
- [x] CORE vs Integration boundary justified (COD carrier-neutral; caller-owns-payload)
- [x] Existing patterns (scaffolder, InPost HTTP-client, plugin-sdk)
- [x] Idempotency considered (core pre-check; `reference`=shipment id; **create not auto-retried on network/timeout** to prevent double-COD)
- [x] Rate limits & retries (retry restricted to 429/503 + timeout; create excluded)
- [x] Error handling comprehensive (HTTP + body-status + shared rejection)
- [x] Testing strategy complete (5 unit suites incl. core dispatch)
- [x] Naming + file structure per standards (mirrors InPost / scaffolder; `ShipmentCod` in its own types file)
- [x] Plan execution-ready (live creds + auth shape outstanding, scoped to pre-merge AC)

---

## Related Documentation
- Spec: [`product-spec-961-dpd-polska-shipping.md`](../specs/product-spec-961-dpd-polska-shipping.md)
- ADR: [`018-dpd-polska-rest-api-over-soap.md`](../architecture/adrs/018-dpd-polska-rest-api-over-soap.md)
- Reference: `libs/integrations/inpost/`, `scripts/create-adapter.mjs`
- [Architecture Overview](../architecture-overview.md) · [Engineering Standards](../engineering-standards.md) · [Testing Guide](../testing-guide.md)

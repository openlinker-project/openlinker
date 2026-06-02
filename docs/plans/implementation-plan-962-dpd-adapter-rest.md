# Implementation Plan: DPD Polska adapter package + REST transport (courier-to-door + COD)

**Date**: 2026-06-02
**Status**: Ready for Review (transport reversed SOAP→REST after the API was verified)
**Issue**: #962 (Part of #961)
**Spec**: [`docs/specs/product-spec-961-dpd-polska-shipping.md`](../specs/product-spec-961-dpd-polska-shipping.md)
**Implementation branch**: `962-dpd-adapter-rest`
**Estimated Effort**: M–L (~1–1.5 weeks; smaller than the SOAP estimate)

> **Transport note:** DPD Polska has a native **REST `DPDServices`** API (JSON;
> Swagger at `dpdservices.dpd.com.pl`; documented test server) that covers
> shipment + label (PDF/ZPL/EPL/XML) + COD + protocol + courier. We build against
> **REST**, not the legacy SOAP `DPDPackageObjServices` — see **ADR-018**. This is
> the InPost pattern (native `fetch` + JSON); no SOAP envelopes, no
> `fast-xml-parser`.

---

## 1. Task Summary

**Objective**: Build the `@openlinker/integrations-dpd-polska` plugin package — courier-to-door label generation + COD on the seller's own DPD contract, against DPD Polska's **REST `DPDServices`** API, behind `ShippingProviderManagerPort` + `LabelDocumentReader`. Add a typed optional `cod` to the core command so a caller can thread the COD amount.

**Classification**: **CORE + Integration.** Bulk is a new REST Integration package (InPost-shaped); COD adds a small additive CORE change (a typed optional command field + a one-line dispatch pass-through). No DB migration.

---

## 2. Scope & Non-Goals

### In Scope
**CORE (additive COD field — ~3 tiny edits):** `ShipmentCod` type (`{ amount: string; currency: string }`); `GenerateLabelCommand.cod?` (auto-flows into `ShipmentDispatchInput` via its existing `Omit<>`); one pass-through line in `ShipmentDispatchService` (`cod: input.cod`, beside `recipient`/`parcel`). **Caller-supplied**, like `recipient`/`parcel` — not order-sourced (the dispatch seam is *caller-owns-payload*). `PaymentStatus = 'cod'` already exists on the order; the operator-facing COD-amount input is **#966**.

**Integration (`libs/integrations/dpd-polska/`):**
- REST transport `IDpdHttpClient` — native `fetch` + JSON, mirroring `InpostHttpClient` (`request<T>()` + `requestBinary()` for label bytes); retry loop + 30 s timeout; error mapping → `ShippingProviderRejectionException('dpd', …)`.
- Auth: `X-DPD-FID` header (= masterFid); body `payerFID` (= numkat/fid sub-number). **Exact token/credential scheme TBD from Swagger (OQ-1).**
- `DpdShippingAdapter implements ShippingProviderManagerPort, LabelDocumentReader`:
  - `generateLabel` → `POST shipment/v1/generatePackagesNumbers` (sender/receiver/services incl. **COD**, refs) → per-parcel waybill + status.
  - `fetchLabel` → `POST shipment/v1/generateSpedLabels` (format `PDF`) → `LabelDocument`.
  - `getSupportedMethods()` → `['kurier']`.
  - `getTracking` → coarse contract (see §6) — tracking is the separate DPD InfoServices, #965.
- Config DTO + `ConnectionConfigShapeValidatorPort`; credentials enforced at factory construction.
- Manifest `dpd.polska.rest.v1`, plugin descriptor, **API** host registration (`apps/api/src/plugins.ts` + `jest-integration.cjs` mapper, #917).
- Unit tests: http client, mapper, adapter, config validator, **+ core dispatch COD pass-through test**.

### Out of Scope (other #961 children)
- DPD Pickup points / `PickupPointFinder` (#963).
- Bulk labels + `generateProtocol` (#964).
- Real tracking via DPD InfoServices + worker registration (#965).
- FE connection form + operator-facing COD-amount input (#966).
- Cancel/re-issue — no cancel op (re-issue = new shipment).

### Constraints
- CORE change additive only (optional field + pass-through); InPost/Allegro ignore `cod`.
- No new runtime dependency — native `fetch` + JSON (no `fast-xml-parser`).

---

## 3. Architecture Mapping

**Layers**: CORE (`libs/core/src/shipping/` — command field + dispatch pass-through) + Integration (`libs/integrations/dpd-polska/`).
**Capabilities**: `ShippingProviderManagerPort` + `LabelDocumentReader`.
**Reused unchanged**: `ShipmentDispatchService` (one-line `cod` pass-through), `ShipmentLabelService`, `CredentialsResolverPort`, `ConnectionConfigShapeValidatorRegistryService`, `createNestAdapterModule` + `dispatchCapability`.
**Justification**: COD is carrier-neutral → canonical command (matches `recipient`/`parcel`, #764). REST/JSON specifics stay in the integration.

---

## 4. External / Domain Research

### DPD Polska REST `DPDServices` — verified from the carrier's customer docs (`DPD-Services.zip`)
- **Docs**: `https://dpdservices.dpd.com.pl/redoc-ui` · `…/swagger-ui/index.html` (includes test-server login details). Live OpenAPI JSON is gated (`/v3/api-docs` → 403).
- **Flow** (REST/JSON):
  - `POST shipment/v1/generatePackagesNumbers` — sender + receiver + selected services (**COD**, Saturday, …) → one waybill number per parcel.
  - `POST shipment/v1/generateSpedLabels` — labels in **PDF / ZPL / EPL / XML** for those waybills.
  - `shipment/v1/generateProtocol` — collective handover protocol (#964).
  - `courierorder/v1/courierOrderAvailability` + `…/packagesPickupCall` — courier (out of #962).
- **Auth/headers**: `X-DPD-FID` = payer/masterFid; body `payerFID` = numkat/fid sub-number.
- **References**: `ref1/ref2/ref3` (shipment-level — use for order/invoice numbers), `customerData1..3` (parcel-level), `reference` = a unique GUID (set to the OL shipment id for idempotency traceability).
- **Field references** (for the spike): the zip ships `Length of fields.xlsx`, `Length on DPD label.xlsx`, and `Error codes.xlsx` — concrete request field names/lengths + error catalogue.

### Internal patterns to mirror
- **Adapter scaffolder** `scripts/create-adapter.mjs` (14-file template, drift-guarded) — the blessed starting point.
- **InPost package** (`libs/integrations/inpost/`) — the REST adapter + `InpostHttpClient` (native fetch, retry, `requestBinary` for the label PDF) are the direct template; DPD's client is the same shape with `X-DPD-FID` auth.

---

## 5. Questions & Assumptions

### Open Questions (resolve in the Phase-0 spike via the Swagger doc + test server)
- **OQ-1**: exact auth/credential scheme — is it a long-lived token in a header alongside `X-DPD-FID`, or login/password→token? (The Baltic REST sibling used a Bearer token; confirm PL.)
- **OQ-2**: exact JSON request body for `generatePackagesNumbers` (sender/receiver/parcels/services nesting) + the COD service object (amount/currency field names).
- **OQ-3**: REST test-server base URL + creds (in the Swagger doc).
- **OQ-4**: production base URL path (`https://dpdservices.dpd.com.pl/…`).

### Assumptions
- `labelPdfRef` is a locator string (waybill), not stored bytes (InPost precedent); `fetchLabel` re-renders via `generateSpedLabels`.
- `getSupportedMethods()` → `['kurier']` only (pickup = #963).

---

## 6. Proposed Implementation Plan

### Phase 0 — Spike against the REST test server (de-risk JSON shapes)
1. Using the Swagger doc's test creds, `POST shipment/v1/generatePackagesNumbers` (plain + COD) → waybills; `POST shipment/v1/generateSpedLabels` (PDF) → decode → PDF. Capture: auth scheme, exact JSON bodies, COD object, per-parcel `status` shape (success + invalid). Spike code NOT merged.

### Phase 1 — CORE: COD field on the command (additive)
2. `ShipmentCod` type + `GenerateLabelCommand.cod?` in `libs/core/src/shipping/domain/types/`. Auto-flows into `ShipmentDispatchInput`.
3. One pass-through line in `ShipmentDispatchService` (`cod: input.cod`). Unit-test forwards `cod` when present, `undefined` otherwise. No order-sourcing.

### Phase 2 — Integration: scaffold + REST client
4. Scaffold via `node scripts/create-adapter.mjs dpd-polska`; layer DPD files on top.
5. **`IDpdHttpClient` + `DpdHttpClient`** — native `fetch` + JSON, `X-DPD-FID` header, retry + timeout (InPost constants); `request<T>()` + `requestBinary()`. Error mapping: HTTP 4xx/5xx + per-response error body → `ShippingProviderRejectionException`; 401/403 → `DpdUnauthorizedException`; network/timeout → `DpdNetworkException`. Unit tests with a mocked `fetch`.
6. **Config/credential + SOAP-free types** (`dpd-config.types.ts`, `dpd-credentials.types.ts`, `dpd-rest.types.ts`) from the spike findings.

### Phase 3 — Mapper + adapter
7. **`dpd-shipment.mapper.ts`**: `GenerateLabelCommand` → `generatePackagesNumbers` JSON (sender from config, receiver from recipient, parcels with **grams→kg / cm conversion** [tested: `1500 → "1.5"`], `payerType='SENDER'`, **`services.cod` from `cmd.cod`**, `reference` = OL shipment id). Response → `{ providerShipmentId, trackingNumber: waybill, labelPdfRef: waybill }`; label base64 → `Uint8Array`.
8. **`DpdShippingAdapter`**:
   - `generateLabel` → mapper → client → **assert per-parcel `status` is OK** (DPD returns COD/validation failures in the response body, not as an HTTP error — Phase B's "COD fails where labels succeed"); non-OK → `ShippingProviderRejectionException`.
   - `fetchLabel` → `generateSpedLabels` (format `PDF`) → `LabelDocument`.
   - `getSupportedMethods()` → `['kurier']`.
   - `getTracking` → **throws a typed `tracking.unavailable` rejection** (no fabricated status); DPD stays out of the worker until #965 wires real tracking via DPD InfoServices.
   - Unit tests (mock `IDpdHttpClient`): plain, COD, non-OK-status → rejection, `fetchLabel`, `getSupportedMethods`, `getTracking` throws.

### Phase 4 — Validator, factory, plugin, host wiring
9. Config DTO + validator (mirror InPost; PL postcode `NN-NNN`, ISO-3166-1 country). Registered in `register(host)`.
10. `dpd-adapter.factory.ts` — extract config, resolve `DpdCredentials` (throw `DpdConfigException` if missing), pick base URL by `environment`, construct client + adapter.
11. `dpd-plugin.ts` (`dpdAdapterManifest`: `adapterKey: 'dpd.polska.rest.v1'`, `platformType: 'dpd'`, `supportedCapabilities: ['ShippingProviderManager']`, `isDefault: true`) + `createDpdPlugin()`; `dpd-integration.module.ts` via `createNestAdapterModule`.
12. Barrels + `FakeDpdShippingAdapter`. Host: add `DpdIntegrationModule` to `apps/api/src/plugins.ts` + the two mapper lines to `apps/api/test/jest-integration.cjs` (#917).

### Migrations / Events
- **None** — reuses the core `shipments` table; `ShipmentDispatchService` owns persistence.

---

## 7. Alternatives Considered
- **SOAP `DPDPackageObjServices`** — rejected (legacy XML/WSDL; hand-rolled envelopes; REST is simpler and the carrier's modern API). See ADR-018.
- **COD via untyped `platformParams`** — rejected; typed `cod?` per the command-type header.
- **Sourcing COD in dispatch from the order** — rejected; contradicts the caller-owns-payload seam.

---

## 8. Validation & Risks
- ✅ Additive carrier-neutral CORE change; REST integration mirrors InPost; barrel-only imports; shared rejection exception.
- **End-to-end COD needs #966** — #962 ships backend capability + pass-through; operator COD-amount input is FE (#966). Don't over-claim.
- **DPD returns business failures in the JSON response `status`, not HTTP errors** — adapter must check per-parcel status (Phase 3 step 8); dedicated test.
- **grams→kg / cm conversion** — explicit + tested.
- **Idempotency** — no idempotency key; at-most-once via core `findActiveByOrderId` + DB partial-unique; set `reference` = OL shipment id (double-COD risk noted).
- **Spike-gated unknowns** (OQ-1..4) — exact auth + JSON shapes + test creds from the Swagger doc; the zip's `Length of fields.xlsx` / `Error codes.xlsx` are concrete references.

---

## 9. Testing Strategy & Acceptance Criteria

### Unit Tests
- **Core**: `shipment-dispatch.service.spec.ts` — forwards `cod` when present, else `undefined`.
- `dpd-http-client.spec.ts` — JSON request build + `X-DPD-FID`, success parse, error-body → rejection, 401 → unauthorized, timeout → network, retry.
- `dpd-shipment.mapper.spec.ts` — plain + COD mapping; grams→kg + cm; base64 → `Uint8Array`.
- `dpd-shipping.adapter.spec.ts` — `generateLabel` plain/COD, non-OK status → rejection, `fetchLabel`, `getSupportedMethods`, `getTracking` throws.
- `dpd-connection-config-shape-validator.adapter.spec.ts` — valid/invalid config.

### Integration Tests
- None new (existing `/shipments/*` cover DPD once registered). Live REST round-trip is the manual Phase-0 spike.

### Acceptance Criteria (#962)
- [ ] Operator creates a "DPD Polska" connection; connection-test reaches the REST API.
- [ ] Courier label generates → downloadable PDF; shipment `generated`.
- [ ] COD threads `cmd.cod` → `services.cod` (unit-proven); DPD COD/validation errors surface verbatim. (Operator COD-amount input is #966.)
- [ ] Invalid recipient data rejected pre-submission.
- [ ] `pnpm lint` / `type-check` / unit tests green; jest-integration mapper added; `check-create-adapter` invariant satisfied.
- [ ] **Manual (pre-merge):** live REST test-server round-trip produces a real PDF for a plain + a COD shipment.

---

## Related Documentation
- Spec: [`docs/specs/product-spec-961-dpd-polska-shipping.md`](../specs/product-spec-961-dpd-polska-shipping.md)
- ADR: [`docs/architecture/adrs/018-dpd-polska-rest-api-over-soap.md`](../architecture/adrs/018-dpd-polska-rest-api-over-soap.md)
- Reference: `libs/integrations/inpost/`, `scripts/create-adapter.mjs`
- [Architecture Overview](../architecture-overview.md) · [Engineering Standards](../engineering-standards.md) · [Testing Guide](../testing-guide.md)

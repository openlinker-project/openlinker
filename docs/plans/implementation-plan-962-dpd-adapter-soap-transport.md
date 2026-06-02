# Implementation Plan: DPD Polska adapter package + SOAP transport (courier-to-door + COD)

**Date**: 2026-06-02
**Status**: Ready for Review (revised after `/tech-review` 2026-06-02)
**Issue**: [#962](https://github.com/openlinker-project/openlinker/issues/962) (Part of [#961](https://github.com/openlinker-project/openlinker/issues/961))
**Spec**: [`docs/specs/product-spec-961-dpd-polska-shipping.md`](../specs/product-spec-961-dpd-polska-shipping.md)
**Plan branch**: `962-dpd-soap-plan` · **Implementation branch (later)**: `962-dpd-adapter-soap-transport`
**Estimated Effort**: L (~2 weeks), spike-first

> **Revision note (post-`/tech-review`):** COD (in scope per spec + customer)
> cannot be delivered as an integration-only change — the core
> `GenerateLabelCommand` carries no COD field, so the adapter can't receive the
> amount. #962 is therefore re-classified **CORE + Integration**: it extends the
> core command + dispatch to thread COD, then implements the adapter. Also fixed:
> `getTracking` coarse contract, scaffolder usage, gram→kg conversion, and the
> SOAP business-status check. WSDL op list verified in full (§4).

---

## 1. Task Summary

**Objective**: Build the `@openlinker/integrations-dpd-polska` plugin package — the foundation of the DPD Polska integration — implementing **courier-to-door label generation + COD** on the seller's own DPD contract, behind `ShippingProviderManagerPort` + `LabelDocumentReader`. Thread the COD amount from the order through the core dispatch command so the adapter can submit it.

**Context**: DPD is the customer-pulled second OL-managed carrier after InPost (#727). It slots into the shipping context like InPost, with two structural differences: (1) DPD Polska's `DPDPackageObjServices` API is **SOAP/WSDL**; (2) its label flow is **two calls** (create package → render label) where InPost is one REST POST.

**Classification**: **CORE + Integration.** The bulk is a new Integration package, but COD requires a small, additive CORE change (a typed optional field on `GenerateLabelCommand` + dispatch population). No DB migration.

---

## 2. Scope & Non-Goals

### In Scope
**CORE (additive, COD plumbing):**
- Extend `GenerateLabelCommand` (`libs/core/src/shipping/domain/types/generate-label.types.ts`) with a typed optional `cod?: ShipmentCod` field — the file header sanctions exactly this ("add a typed optional field here… never an untyped bag"). `ShipmentCod = { amount: string; currency: string }` in a new `*.types.ts`.
- Populate it in `ShipmentDispatchService` (`libs/core/src/shipping/application/services/shipment-dispatch.service.ts`) from the order's COD data (see prerequisite below).
- **Prerequisite verification:** confirm the order snapshot / `ShipmentDispatchInput` actually carries COD (is-COD + amount + currency). If it does not, sourcing it is an additional upstream step (orders context) that must be settled before the dispatch can populate the field — flagged as OQ-0.

**Integration (`libs/integrations/dpd-polska/`):**
- SOAP transport (`IDpdSoapClient`) — hand-rolled SOAP 1.1 envelopes via `fast-xml-parser` `XMLBuilder`, response parse via `XMLParser`.
- `DpdShippingAdapter implements ShippingProviderManagerPort, LabelDocumentReader`:
  - `generateLabel` → `generatePackagesNumbersV1` (create) → package id + waybill.
  - `fetchLabel` → `generateSpedLabelsV1` (render) → base64 PDF → `LabelDocument`.
  - `getSupportedMethods()` → `['kurier']`.
  - `getTracking` → **see §6 coarse-contract decision** (does *not* fabricate `in-transit`).
- **COD** mapped into `OpenUMLFeV1.services.cod` from the new command field.
- Config DTO + `ConnectionConfigShapeValidatorPort`; credentials (login + masterFID + password) enforced at factory construction.
- Manifest `dpd.polska.webservice.v1`, plugin descriptor, **API** host registration (`apps/api/src/plugins.ts` + jest-integration mapper).
- ADR-018 (SOAP transport pattern).
- Unit tests: soap client, mapper, adapter, config validator, **+ a core dispatch test for COD population**.

### Out of Scope (other #961 children)
- DPD Pickup points / `PickupPointFinder` (#963).
- Bulk labels + handover protocol (#964).
- Real tracking via DPDInfoServices + worker registration (#965).
- FE connection form + panel affordances (#966).
- Label cancel/re-issue — **confirmed: no cancel op in `DPDPackageObjServices`** (§4); re-issue = new shipment.

### Constraints
- CORE change is **additive only** (optional field) — no breaking change to existing adapters (InPost/Allegro ignore `cod`).
- `fast-xml-parser` is already a repo dependency (`libs/integrations/prestashop`) — no new dependency category.
- Production WSDL host unconfirmed until contract signing; sandbox is the dev target.

---

## 3. Architecture Mapping

**Target Layers**: CORE (`libs/core/src/shipping/` — command type + dispatch) + Integration (`libs/integrations/dpd-polska/`).

**Capabilities Involved**: `ShippingProviderManagerPort` (base) + `LabelDocumentReader` — from `@openlinker/core/shipping`.

**Existing Services Reused** (otherwise unchanged): `ShipmentDispatchService` (gets the COD-population edit), `ShipmentLabelService`, `CredentialsResolverPort`, `ConnectionConfigShapeValidatorRegistryService`, `createNestAdapterModule` + `dispatchCapability`.

**New Components**:
- **CORE**: `ShipmentCod` type; `GenerateLabelCommand.cod?`; dispatch population.
- **Integration**: `dpd-plugin.ts`, `dpd-integration.module.ts`, `dpd-adapter.factory.ts`, `dto/dpd-connection-config.dto.ts`, `types/{dpd-config,dpd-credentials,dpd-soap}.types.ts`, `exceptions/{dpd-config,dpd-unauthorized,dpd-network}.exception.ts`, `adapters/{dpd-shipping.adapter.ts, dpd-connection-config-shape-validator.adapter.ts}`, `soap/{dpd-soap-client.interface.ts, dpd-soap-client.ts}`, `mappers/dpd-openumlf.mapper.ts`.

**Core vs Integration Justification**: COD is a **carrier-neutral** shipment concept (every PL courier offers pobranie), so it belongs on the canonical command, not behind a per-adapter escape hatch — consistent with how `recipient`/`parcel` were added for InPost (#764, per the type file's own header). SOAP envelopes / `OpenUMLFeV1` / DPD's COD element stay entirely in the integration.

---

## 4. External / Domain Research

### DPD Polska `DPDPackageObjServices` (SOAP) — verified against the live demo WSDL + XSD
- **Namespace** `http://dpdservices.dpd.com.pl/`, **document/literal**, empty `soapAction`.
- **Auth**: `authDataV1 { login: string, masterFid: int, password: string }`.
- **Create**: `generatePackagesNumbersV1(openUMLFeV1, pkgNumsGenerationPolicyV1, authDataV1)` → `return.packages[].parcels[] { parcelId: long, reference, status: validationStatusPGREnumV1, waybill }`.
- **Label**: `generateSpedLabelsV1(dpdServicesParamsV1, outputDocFormatV1, outputDocPageFormatV1, authDataV1)` → `return.documentData` (`xs:base64Binary`). Page-format enum is **`A4 | LBL_PRINTER`** (not `BIC3`). `dpdServicesParamsV1.session.packages[].parcels[]` references by `parcelId` / `waybill`.
- **COD**: `openUMLFeV1 … services.cod = serviceCODOpenUMLFeV1 { amount: string, currency: serviceCurrencyEnum }`.
- **Parcel fields** (`parcelOpenUMLFeV1`): `reference, weight, sizeX, sizeY, sizeZ, content, customerData1..3` — **all `xs:string`; DPD expects kg / cm.**
- **Address** (`packageAddressOpenUMLFeV1`, receiver+sender): `address, city, company, countryCode, email, fid:int, name, phone, postalCode`. `payerType ∈ { RECEIVER, SENDER, THIRD_PARTY }`.

### WSDL operation set — fully enumerated (34 ops), so the negatives are verified, not assumed
`generatePackagesNumbersV1–V10`, `generateSpedLabelsV1–V4`, `generateShipmentV1/V2`, `generateProtocolV1/V2`, `generateProtocolsWithDestinationsV1/V2`, `generateReturnPackages`, `generateReturnLabelV1`, `generateDomesticReturnLabelV1`, `generateInternationalPackageNumbersV1`, `generateDropOffPinV1`, `packagesPickupCallV1–V4`, `appendParcelsToPackageV1/V2`, `getCourierOrderAvailabilityV1`, `findPostalCodeV1`, `importDeliveryBusinessEventV1`.
- **No cancel/withdraw/delete operation** → cancel is genuinely unavailable (validates the out-of-scope call).
- **No tracking/events/status operation** in *this* service → tracking lives in the separate **`DPDInfoServices`** WSDL (`getEventsForWaybill*`), which is #965.
- **`generateShipmentV1/V2`** is a possible **single-call** create+label alternative to the two-step flow — evaluate in the Phase 0 spike; if it returns the label PDF in one round-trip it may simplify `generateLabel` (with `fetchLabel` still re-rendering via `generateSpedLabels`). Default remains the proven two-step unless the spike shows the single-call is cleaner.

Sources: live WSDL + `?xsd=…schema1.xsd`; reference clients [dbojdo/dpd-client](https://github.com/dbojdo/dpd-client), [t3ko/dpd-pl-api-php](https://github.com/t3ko/dpd-pl-api-php), [msztorc/php-dpd-api](https://github.com/msztorc/php-dpd-api). Full evidence in spec §4.

### Internal patterns to mirror
- **Adapter scaffolder** `scripts/create-adapter.mjs` (14-file template set, drift-guarded by `check-create-adapter.mjs`) — the blessed starting point for a new adapter package. Start there, then layer SOAP-specific files on top.
- **InPost package** (`libs/integrations/inpost/`) — closest behavioural template (factory, client-behind-interface, adapter implementing port + capabilities, config DTO + validator, manifest + descriptor).
- **PrestaShop XML** (`libs/integrations/prestashop/src/infrastructure/http/`) — `XMLBuilder` (`prestashop-webservice.client.ts:115`), `XMLParser` (`prestashop-response.parser.ts:20`). The DPD SOAP client copies this usage shape.

---

## 5. Questions & Assumptions

### Open Questions (resolve in the spike / prerequisite — do not block planning)
- **OQ-0 (new, gating COD)**: does the order snapshot / `ShipmentDispatchInput` already carry COD (is-COD + amount + currency)? If not, sourcing it is an upstream orders-context step that precedes the dispatch population.
- **OQ-1**: exact `serviceCurrencyEnum` values (PLN at least) — confirm from the XSD enum.
- **OQ-2**: does `generateShipmentV1/V2` return the label in one call (single-call path)? Spike.
- **OQ-3**: SOAP 1.1 envelope namespaces / element ordering — confirm against live WSDL in the spike.
- **OQ-4**: production WSDL host (`dpdservices.dpd.com.pl` inferred) — confirm at contract signing.

### Assumptions
- `labelPdfRef` is a **locator string**, not stored bytes (InPost precedent — no blob store in core). For DPD: store the waybill/package id; `fetchLabel` re-renders via `generateSpedLabelsV1`.
- `getSupportedMethods()` returns `['kurier']` only (pickup = #963).

### Documentation Gaps
- None blocking. The live WSDL/XSD is the contract source of truth.

---

## 6. Proposed Implementation Plan

### Phase 0 — Sandbox spike (de-risk SOAP before hardening)
1. **Throwaway spike** against `dpdservicesdemo.dpd.com.pl` (public creds `test`/`1495`/`KqvsoFLT2M`): build `generatePackagesNumbersV1` (plain + COD), feed parcel ref into `generateSpedLabelsV1` → decode `documentData` → PDF. Also probe `generateShipmentV1` to evaluate the single-call path (OQ-2).
   - **Acceptance**: valid PDF for a plain *and* a COD shipment; the exact COD element path, `serviceCurrencyEnum`, and the per-parcel `status` shape on both success and a deliberately-invalid request are captured. Spike code is NOT merged.

### Phase 1 — CORE: COD on the command (additive)
2. **Verify the COD source (OQ-0)** on the order snapshot / dispatch input. If absent, add it (orders context) first.
3. **`ShipmentCod` type + `GenerateLabelCommand.cod?`** in `libs/core/src/shipping/domain/types/`. Populate in `ShipmentDispatchService`. Unit-test the dispatch populates `cod` for a COD order and leaves it `undefined` otherwise.
   - **Acceptance**: existing InPost/Allegro dispatch unaffected (field optional); core unit + (if touched) the shipping int-spec still green.

### Phase 2 — Integration: package scaffold + SOAP transport
4. **Scaffold** via `node scripts/create-adapter.mjs dpd-polska` (the blessed 14-file skeleton), then add the SOAP-specific files. Deviations from the scaffold noted in the PR.
5. **SOAP types** (`dpd-soap.types.ts`) typed from the XSD; **domain exceptions** (`dpd-{config,unauthorized,network}.exception.ts`) mirroring InPost.
6. **`IDpdSoapClient` + `DpdSoapClient`**: `XMLBuilder` envelope (auth + op body), native `fetch` POST with `SOAPAction`, `XMLParser` parse. Map: SOAP `Fault` **and** non-OK `Status` → `ShippingProviderRejectionException('dpd', code, msg, details)`; 401/403 → `DpdUnauthorizedException`; network/timeout → `DpdNetworkException`. Retry loop + 30 s timeout (InPost constants).
   - **Acceptance**: unit tests build a known envelope, parse a canned success, and map a canned SOAP fault → exception.

### Phase 3 — Mapper + adapter
7. **`dpd-openumlf.mapper.ts`**: `GenerateLabelCommand` → `openUMLFeV1` (recipient, parcel, sender from config, `payerType='SENDER'`, courier service, **`services.cod` from `cmd.cod`**). **Unit conversion is explicit and tested**: `weightGrams` → kg string (`1500 → "1.5"`), dimensions → cm strings. Response → `{ providerShipmentId, trackingNumber: waybill, labelPdfRef: waybill }`; `documentData` base64 → `Uint8Array`.
8. **`DpdShippingAdapter`** (`implements ShippingProviderManagerPort, LabelDocumentReader`):
   - `generateLabel` → mapper → `client.call('generatePackagesNumbersV1', …)`; **assert `return.packages[].parcels[].status` is OK** (DPD returns COD/validation failures in the response body, not as SOAP faults — Phase B's "COD fails where labels succeed"); map a non-OK status → `ShippingProviderRejectionException`.
   - `fetchLabel` → `generateSpedLabelsV1` (`outputDocFormatV1='PDF'`, `outputDocPageFormatV1='A4'`) → `LabelDocument`.
   - `getSupportedMethods()` → `['kurier']`.
   - **`getTracking`** → **coarse contract (see decision below)**.
   - **Acceptance**: adapter unit tests (mock `IDpdSoapClient`): plain happy path, COD path, non-OK-status → exception, SOAP-fault → exception, unknown-method guard.

#### `getTracking` coarse contract (decision)
The adapter receives only `{ providerShipmentId }` and has no real tracking source until #965 (DPDInfoServices). It must **not fabricate `in-transit`** — the status-sync (#838) would write that back and wrongly advance a freshly-`generated` shipment that then never reaches `delivered`. v1 behaviour: `getTracking` **throws a typed "tracking not yet available for DPD" rejection** (`providerCode: 'tracking.unavailable'`). **DPD is intentionally NOT registered in the worker until #965**, so the status-sync never calls it; the throw only guards a stray manual call. #965 replaces the body with the real DPDInfoServices read.

### Phase 4 — Validator, factory, plugin, host wiring
9. **Config DTO + validator** (mirror InPost; PL postcode `NN-NNN`, ISO-3166-1 country). Registered in `register(host)`.
10. **`dpd-adapter.factory.ts`**: extract config, resolve `DpdCredentials` (throw `DpdConfigException` if `login`/`masterFid`/`password` missing), pick WSDL endpoint by `environment`, construct client + adapter.
11. **`dpd-plugin.ts`** (`dpdAdapterManifest`: `adapterKey: 'dpd.polska.webservice.v1'`, `platformType: 'dpd'`, `supportedCapabilities: ['ShippingProviderManager']`, `isDefault: true`) + `createDpdPlugin()` (`register` config-validator; `createCapabilityAdapter` → `dispatchCapability`). **`dpd-integration.module.ts`** via `createNestAdapterModule`.
12. **Barrels** (`index.ts`, `testing.ts` → `FakeDpdShippingAdapter`). **Host wiring**: add `DpdIntegrationModule` to `apps/api/src/plugins.ts` + the two `@openlinker/integrations-dpd-polska` mapper lines to `apps/api/test/jest-integration.cjs` (#917 — `check-jest-integration-mappers.mjs` prints them).

### Configuration / Migrations / Events
- **Config**: none beyond connection config/credentials. No env vars.
- **Migrations**: **none** — reuses the core `shipments` table.
- **Events**: none new — `ShipmentDispatchService` owns persistence.

---

## 7. Alternatives Considered

- **A full SOAP library (`soap` / `strong-soap`)** — rejected (boot-time WSDL parse / heavy dep for ~3 ops). Hand-rolled + `fast-xml-parser` (already in tree). ADR-018.
- **COD via an untyped `platformParams` bag on the command** — rejected; the command type's header mandates a typed optional field. `cod?: ShipmentCod` is the sanctioned shape.
- **Eager PDF storage in `generateLabel`** — rejected; no blob store, `labelPdfRef` is a locator, `fetchLabel` re-renders (InPost precedent).
- **A new core `SoapShippingPort`** — rejected; SOAP is transport, not capability.

---

## 8. Validation & Risks

### Architecture Compliance
- ✅ CORE change is additive + carrier-neutral (matches the `recipient`/`parcel` precedent); no breaking change.
- ✅ Integration implements existing ports; barrel-only imports; errors map to the shared `ShippingProviderRejectionException`.

### Risks
- **COD source on the order (OQ-0)** — if the snapshot doesn't carry COD, scope grows into orders. **Mitigation**: verify first (Phase 1 step 2); if missing, treat as a prerequisite sub-task and flag to the maintainer before building the adapter.
- **SOAP envelope fidelity** — Phase 0 spike against the live WSDL before hardening.
- **DPD returns business failures in the response `status`, not SOAP faults** — the adapter must check `parcels[].status` (Phase 3 step 8); a missed check would surface as silent label failure. Covered by a dedicated test.
- **Unit mismatch (grams vs kg)** — explicit conversion + test (Phase 3 step 7).
- **No idempotency on create** — at-most-once relies on core `findActiveByOrderId` + DB partial-unique on `providerShipmentId`. **Double-create risk is higher for COD (double collection)**; set `parcel.reference` = OL shipment id for traceability/reconciliation. Accepted for v1.
- **`getTracking` latent landmine** — neutralised by the coarse-throw contract + keeping DPD out of the worker until #965.

### Backward Compatibility
- ✅ Additive. New optional command field; new plugin package + two host-wiring lines. Existing adapters unaffected.

---

## 9. Testing Strategy & Acceptance Criteria

### Unit Tests
- **Core**: `shipment-dispatch.service.spec.ts` — dispatch populates `cod` for a COD order, leaves it `undefined` otherwise.
- `dpd-soap-client.spec.ts` — envelope build, success parse, SOAP-fault → rejection, 401 → unauthorized, timeout → network, retry-on-transient.
- `dpd-openumlf.mapper.spec.ts` — plain + COD mapping; grams→kg + cm conversion; base64 → `Uint8Array`.
- `dpd-shipping.adapter.spec.ts` — `generateLabel` happy/COD, **non-OK parcel status → rejection**, `fetchLabel`, `getSupportedMethods`, `getTracking` throws typed unavailable (mock `IDpdSoapClient`).
- `dpd-connection-config-shape-validator.adapter.spec.ts` — valid/invalid config.

### Integration Tests
- None new (no DB, no new controller — existing `/shipments/*` cover DPD once registered). Live-sandbox round-trip is the manual Phase 0 spike.

### Acceptance Criteria (issue #962)
- [ ] Operator creates a "DPD Polska" connection; connection-test reaches the web service.
- [ ] Courier label generates → downloadable PDF; shipment `generated`.
- [ ] COD order threads the amount (core command → adapter → `services.cod`); DPD COD/validation errors surface verbatim.
- [ ] Invalid recipient data rejected pre-submission.
- [ ] `pnpm lint` / `type-check` / unit tests green; jest-integration mapper added; `check-create-adapter` invariant satisfied.
- [ ] **Manual (pre-merge):** live sandbox round-trip produces a real PDF for a plain + a COD shipment.

---

## 10. Alignment Checklist

- [x] Follows hexagonal architecture (integration implements core ports; additive core change)
- [x] CORE vs Integration boundary honoured + justified (COD is carrier-neutral)
- [x] Uses existing patterns (scaffolder, InPost layout, PrestaShop `fast-xml-parser`, plugin-sdk)
- [x] Idempotency considered (best-effort core pre-check; double-COD risk noted)
- [x] Rate limits & retries addressed (retry loop + timeout)
- [x] Error handling comprehensive (SOAP fault **and** response-status; shared rejection)
- [x] Testing strategy complete (5 unit suites incl. core dispatch; int deferred with rationale)
- [x] Naming + file structure per standards (mirrors InPost / scaffolder)
- [x] Plan execution-ready

---

## Related Documentation
- Spec: [`docs/specs/product-spec-961-dpd-polska-shipping.md`](../specs/product-spec-961-dpd-polska-shipping.md)
- ADR: [`docs/architecture/adrs/018-soap-transport-for-dpd-polska.md`](../architecture/adrs/018-soap-transport-for-dpd-polska.md)
- Reference: `libs/integrations/inpost/`, `scripts/create-adapter.mjs`
- [Architecture Overview](../architecture-overview.md) · [Engineering Standards](../engineering-standards.md) · [Testing Guide](../testing-guide.md) · [Migrations](../migrations.md)

# Implementation Plan: DPD Polska adapter package + SOAP transport (courier-to-door + COD)

**Date**: 2026-06-02
**Status**: Ready for Review
**Issue**: [#962](https://github.com/openlinker-project/openlinker/issues/962) (Part of [#961](https://github.com/openlinker-project/openlinker/issues/961))
**Spec**: [`docs/specs/product-spec-961-dpd-polska-shipping.md`](../specs/product-spec-961-dpd-polska-shipping.md)
**Plan branch**: `962-dpd-soap-plan` · **Implementation branch (later)**: `962-dpd-adapter-soap-transport`
**Estimated Effort**: L (~1.5–2 weeks), spike-first

---

## 1. Task Summary

**Objective**: Build the `@openlinker/integrations-dpd-polska` plugin package — the foundation of the DPD Polska integration — implementing **courier-to-door label generation + COD** on the seller's own DPD contract, behind the existing `ShippingProviderManagerPort` + `LabelDocumentReader` contracts.

**Context**: DPD is the customer-pulled second OL-managed carrier after InPost (#727). It slots into the shipping context exactly like InPost, with **one structural difference**: DPD Polska's `DPDPackageObjServices` API is **SOAP/WSDL**, and its label flow is **two calls** (create package → render label), where InPost is one REST POST.

**Classification**: Integration (new plugin package). No CORE changes. No DB migration.

---

## 2. Scope & Non-Goals

### In Scope
- New package `libs/integrations/dpd-polska/` mirroring `libs/integrations/inpost/`.
- A package-local SOAP transport (`IDpdSoapClient`) — hand-rolled SOAP 1.1 envelopes via `fast-xml-parser`'s `XMLBuilder`, response parsing via `XMLParser`.
- `DpdShippingAdapter implements ShippingProviderManagerPort, LabelDocumentReader`:
  - `generateLabel` — `generatePackagesNumbersV1` (create) → returns package id + waybill.
  - `fetchLabel` — `generateSpedLabelsV1` (render) → base64 PDF → `LabelDocument`.
  - `getSupportedMethods()` → `['kurier']`.
  - `getTracking` — **coarse fallback** (real tracking via DPDInfoServices = #965).
- **COD** carried through the `OpenUMLFV1` mapping.
- Connection config DTO + `ConnectionConfigShapeValidatorPort`; credentials resolution (login + masterFID + password), enforced at factory construction.
- Manifest `dpd.polska.webservice.v1`, plugin descriptor, **API** host registration (`apps/api/src/plugins.ts` + jest-integration mapper).
- ADR-018 (SOAP transport pattern).
- Unit tests for soap client, mapper, adapter, config validator.

### Out of Scope (other #961 children)
- DPD Pickup points / `PickupPointFinder` (#963).
- Bulk labels + handover protocol (#964).
- Real tracking via DPDInfoServices + worker registration (#965).
- FE connection form + panel affordances (#966).
- Label cancel/re-issue (no cancel op in `DPDPackageObjServices` — see spec §7).

### Constraints
- CORE remains unchanged — DPD extends only via the published `@openlinker/core/shipping` contract + `@openlinker/plugin-sdk`.
- `fast-xml-parser` is already a repo dependency (`libs/integrations/prestashop`) — no new dependency category.
- Production WSDL host unconfirmed until contract signing; sandbox is the dev target.

---

## 3. Architecture Mapping

**Target Layer**: Integration (`libs/integrations/dpd-polska/`).

**Capabilities Involved**:
- `ShippingProviderManagerPort` (base) + `LabelDocumentReader` sub-capability — both from `@openlinker/core/shipping`.

**Existing Services Reused** (no changes to them):
- `ShipmentDispatchService` (core) resolves the adapter via `IIntegrationsService.getCapabilityAdapter<ShippingProviderManagerPort>(connectionId, 'ShippingProviderManager')` and persists the `Shipment`.
- `ShipmentLabelService` (core) narrows `isLabelDocumentReader(adapter)` and calls `fetchLabel`.
- `CredentialsResolverPort` (host) for secret resolution.
- `ConnectionConfigShapeValidatorRegistryService` (host) for config validation.
- `createNestAdapterModule` + `dispatchCapability` (`@openlinker/plugin-sdk`).

**New Components**:
- Plugin: `dpd-plugin.ts` (manifest + descriptor), `dpd-integration.module.ts`.
- Application: `dpd-adapter.factory.ts`, `dto/dpd-connection-config.dto.ts`.
- Domain: `types/{dpd-config,dpd-credentials,dpd-soap}.types.ts`, `exceptions/{dpd-config,dpd-unauthorized,dpd-network}.exception.ts`.
- Infrastructure: `adapters/{dpd-shipping.adapter.ts, dpd-connection-config-shape-validator.adapter.ts}`, `soap/{dpd-soap-client.interface.ts, dpd-soap-client.ts}`, `mappers/dpd-openumlf.mapper.ts`.

**Core vs Integration Justification**: All DPD logic is platform-specific (SOAP envelopes, `OpenUMLFV1`, DPD COD service). It implements existing CORE ports; CORE gains nothing DPD-specific. This is squarely an Integration per ADR-002. No new core port is needed — the shipping contract already covers it (proven by InPost).

---

## 4. External / Domain Research

### DPD Polska `DPDPackageObjServices` (SOAP) — verified against 3 reference clients
- **Auth**: `AuthDataV1 { login, password, masterFid }` on every call.
- **Create package**: `generatePackagesNumbersV1(OpenUMLFV1, PkgNumsGenerationPolicyEnumV1, AuthDataV1)` → package id(s) + waybill number(s).
- **Render label**: `generateSpedLabelsV1(DPDServicesParamsV1, OutputDocFormatDSPEnumV1='PDF', OutputDocPageFormatDSPEnumV1='A4'|'BIC3', AuthDataV1)` → base64 PDF (`filedata`/`documentData`).
- **COD**: an additional service on the parcel/package within `OpenUMLFV1` (amount + currency). **Exact field path/name lives in the imported XSD — confirm in the spike (OQ-1).**
- **Sandbox WSDL**: `https://dpdservicesdemo.dpd.com.pl/DPDPackageObjServicesService/DPDPackageObjServices?WSDL`; public creds `test` / `1495` / `KqvsoFLT2M`.
- **No cancel op**; **no tracking op** (tracking = separate `DPDInfoServices`, #965).

Sources: [dbojdo/dpd-client WSDL](https://github.com/dbojdo/dpd-client/blob/master/tests/DPDServices/Client/dpd.wsdl), [t3ko/dpd-pl-api-php](https://github.com/t3ko/dpd-pl-api-php), [msztorc/php-dpd-api](https://github.com/msztorc/php-dpd-api). Full evidence in spec §4.

### Internal patterns to mirror
- **InPost package** (`libs/integrations/inpost/`) — 1:1 structural template (factory, HTTP-client-behind-interface, adapter implementing the port + capabilities, config DTO + validator, manifest + descriptor, `createNestAdapterModule`).
- **PrestaShop XML** (`libs/integrations/prestashop/src/infrastructure/http/`) — `XMLBuilder` (build) at `prestashop-webservice.client.ts:115`, `XMLParser` (parse) at `prestashop-response.parser.ts:20`. The DPD SOAP client copies this `fast-xml-parser` usage shape.

---

## 5. Questions & Assumptions

### Open Questions (resolved during the spike — do not block planning)
- **OQ-1**: Exact `OpenUMLFV1` field names for parcel/receiver/sender/services + the COD sub-shape. → spike pulls `...?xsd=1`.
- **OQ-2**: Does `generatePackagesNumbersV1` return a usable reference for `generateSpedLabelsV1` (package id vs waybill vs session)? → spike confirms; `DPDServicesParamsV1` supports all three per the WSDL.
- **OQ-3**: SOAP 1.1 vs 1.2 + exact `SOAPAction` header + target namespaces. → read from the WSDL in the spike.
- **OQ-4**: Production WSDL host (`dpdservices.dpd.com.pl` inferred) — confirm at contract signing.

### Assumptions
- `labelPdfRef` is a **locator string**, not stored bytes (same as InPost — no blob store in core). For DPD: store the package id / waybill; `fetchLabel` re-renders via `generateSpedLabelsV1`.
- `getSupportedMethods()` returns `['kurier']` only (pickup = #963).
- A single SOAP endpoint (`DPDPackageObjServices`) covers create + label; tracking's second service is out of scope.

### Documentation Gaps
- None blocking. DPD's public web-service spec is thin; the spike + XSD are the source of truth (mirrors how #727 treated ShipX rate limits).

---

## 6. Proposed Implementation Plan

### Phase 0 — Sandbox spike (de-risk SOAP before hardening)
**Goal**: prove the create→render→COD round-trip against the demo WSDL.

1. **Throwaway spike script** against `dpdservicesdemo.dpd.com.pl` with public creds.
   - **Action**: build a minimal `generatePackagesNumbersV1` envelope (one parcel, courier, then one with COD) → capture package id + waybill; feed into `generateSpedLabelsV1` → decode base64 → write a PDF.
   - **Acceptance**: a valid PDF on disk for both a plain and a COD shipment; the exact request/response XML shapes + COD field path are captured into the plan's OQ answers (and the mapper is written against them). Spike code is NOT merged.

### Phase 1 — Package scaffold + SOAP transport
**Goal**: a testable `IDpdSoapClient`.

2. **Package skeleton** — `libs/integrations/dpd-polska/package.json` (deps: `@openlinker/core`, `@openlinker/plugin-sdk`, `@openlinker/shared`, `class-validator`, `class-transformer`, `fast-xml-parser`), `tsconfig`, `src/index.ts`, `src/testing.ts`.
   - **Acceptance**: `pnpm -r build` compiles the empty package; workspace resolves it.
3. **SOAP types** — `src/domain/types/dpd-soap.types.ts`: `DpdAuthData`, `DpdOpenUmlf*`, `DpdGenerateLabelResponse`, etc. (typed against spike findings).
4. **Domain exceptions** — `src/domain/exceptions/{dpd-config,dpd-unauthorized,dpd-network}.exception.ts` (mirror InPost).
5. **`IDpdSoapClient`** — `src/infrastructure/soap/dpd-soap-client.interface.ts`: `call<T>(operation, body): Promise<T>` (typed per operation).
6. **`DpdSoapClient`** — `src/infrastructure/soap/dpd-soap-client.ts`:
   - **Action**: `XMLBuilder` builds the SOAP envelope (auth + operation body); native `fetch` POSTs with `SOAPAction`; `XMLParser` parses; SOAP `Fault` / non-OK `Status` → `ShippingProviderRejectionException('dpd', <code>, <msg>, <details>)`; 401/403-equivalent → `DpdUnauthorizedException`; network/timeout → `DpdNetworkException`. Retry loop (transient faults / 5xx) + 30 s timeout, mirroring `InpostHttpClient` constants.
   - **Acceptance**: unit tests build a known envelope, parse a canned success response, and map a canned fault → the right exception.

### Phase 2 — Mapper + adapter
**Goal**: the capability adapter, fully unit-tested against a mocked client.

7. **`dpd-openumlf.mapper.ts`** — `GenerateLabelCommand` → `OpenUMLFV1` (recipient, parcel, sender from config, `payerType=SENDER`, courier service, **COD service when `cmd` carries a COD amount**); response → `{ providerShipmentId, trackingNumber, labelPdfRef }`; base64 `filedata` → `Uint8Array` for `LabelDocument`.
   - **Acceptance**: mapper unit tests for plain + COD commands; base64 decode test.
8. **Config + credentials types** — `src/domain/types/dpd-config.types.ts` (`DpdEnvironment`, `DpdSenderContact`, `DpdConnectionConfig`), `dpd-credentials.types.ts` (`DpdCredentials { login, masterFid, password }`). Per spec §5.
9. **`DpdShippingAdapter`** — `src/infrastructure/adapters/dpd-shipping.adapter.ts` `implements ShippingProviderManagerPort, LabelDocumentReader`:
   - `generateLabel` → mapper → `client.call('generatePackagesNumbersV1', …)` → result.
   - `fetchLabel` → `client.call('generateSpedLabelsV1', …)` → `LabelDocument`.
   - `getTracking` → coarse `in-transit` snapshot (carrier `'dpd'`, known waybill) with a `// #965` TODO.
   - `getSupportedMethods()` → `['kurier']`.
   - **Acceptance**: adapter unit tests (mock `IDpdSoapClient`): happy path, COD path, fault → exception, unknown-method guard.

### Phase 3 — Validator, factory, plugin, host wiring
10. **Config DTO + validator** — `src/application/dto/dpd-connection-config.dto.ts` (class-validator; PL postcode `NN-NNN`, ISO-3166-1 country) + `src/infrastructure/adapters/dpd-connection-config-shape-validator.adapter.ts` (mirror InPost). Registered in `register(host)`.
11. **`dpd-adapter.factory.ts`** — `createDpdShippingAdapter(connection, credentialsResolver)`: extract config, resolve `DpdCredentials` (throw `DpdConfigException` if `login`/`masterFid`/`password` missing), pick WSDL endpoint by `environment`, construct `DpdSoapClient` + adapter.
12. **`dpd-plugin.ts`** — `dpdAdapterManifest` (`adapterKey: 'dpd.polska.webservice.v1'`, `platformType: 'dpd'`, `supportedCapabilities: ['ShippingProviderManager']`, `displayName: 'DPD Polska Web Service v1'`, `version: '1.0.0'`, `isDefault: true`) + `createDpdPlugin()` (`register` config-validator; `createCapabilityAdapter` → `dispatchCapability({ ShippingProviderManager: () => adapter })`).
13. **`dpd-integration.module.ts`** — `createNestAdapterModule({ plugin: createDpdPlugin() })`.
14. **Barrels** — `src/index.ts` (manifest, plugin, module, public config/credential types + exceptions), `src/testing.ts` (`FakeDpdShippingAdapter`).
15. **Host wiring** —
    - `apps/api/src/plugins.ts`: add `DpdIntegrationModule` to `apiPlugins`.
    - `apps/api/test/jest-integration.cjs`: add the two `^@openlinker/integrations-dpd-polska$` + `/(.*)$` mapper entries (#917 — `check-jest-integration-mappers.mjs` prints them).
    - **Acceptance**: `pnpm --filter @openlinker/api build` + integration boot resolve the plugin; capability resolution returns the adapter for a `dpd` connection.

### Configuration / Migrations / Events
- **Config**: none beyond connection config/credentials. No env vars.
- **Migrations**: **none** — reuses the core `shipments` table; the adapter never touches the DB.
- **Events**: none new — `ShipmentDispatchService` owns persistence + any events.

---

## 7. Alternatives Considered

### Alt 1 — A SOAP library (`soap` / `strong-soap`)
- **Rejected**: parses the WSDL at boot (a network dependency on DPD at process start) and is a heavy runtime dep for ~2 operations. Hand-rolled envelopes + the already-present `fast-xml-parser` are lighter and fully controlled. (ADR-018.)

### Alt 2 — Generate the label PDF eagerly in `generateLabel` and store bytes
- **Rejected**: there's no blob store in core; `labelPdfRef` is a locator and `fetchLabel` re-renders on demand (InPost precedent). Avoids inventing storage.

### Alt 3 — A net-new core `SoapShippingPort`
- **Rejected**: SOAP is a transport detail, not a capability. The existing `ShippingProviderManagerPort` already fits; a new port would leak transport into CORE.

---

## 8. Validation & Risks

### Architecture Compliance
- ✅ Integration-only; implements existing CORE ports; no CORE edits; no `orm-entities`/deep-core imports (barrel-only).
- ✅ Ports-not-concretes; adapter behind capability dispatch; errors map to the shared `ShippingProviderRejectionException`.

### Naming / Structure
- ✅ `Dpd{Capability}Adapter`, `DpdConnectionConfigDto`, `Dpd*Exception`, `*.types.ts`, mirrors InPost layout.

### Risks
- **SOAP envelope fidelity** (namespaces, element order) — mitigated by Phase 0 spike against the live demo WSDL before hardening.
- **COD field path unknown until XSD pull** — mapper written against spike findings, not guessed.
- **`getTracking` is coarse in this slice** — explicitly a fallback; #965 replaces it. Documented so it isn't mistaken for complete.
- **No idempotency on DPD create** — `DPDPackageObjServices` has no idempotency key; at-most-once relies on core `ShipmentDispatchService.findActiveByOrderId` pre-check + DB partial-unique on `providerShipmentId`. Set the OL `ref1` field to the OL shipment id for traceability. Flag: a retry after a network failure *post-create, pre-response* could double-create — acceptable for v1 (operator sees + cancels via DPD portal, since OL cancel is out of scope); revisit if it bites.

### Backward Compatibility
- ✅ Purely additive — a new plugin package + two host-wiring lines. No existing behavior changes.

---

## 9. Testing Strategy & Acceptance Criteria

### Unit Tests (`*.spec.ts`, colocated)
- `dpd-soap-client.spec.ts` — envelope build, success parse, fault → `ShippingProviderRejectionException`, 401 → `DpdUnauthorizedException`, timeout → `DpdNetworkException`, retry-on-transient.
- `dpd-openumlf.mapper.spec.ts` — plain + COD command mapping; base64 → `Uint8Array`.
- `dpd-shipping.adapter.spec.ts` — `generateLabel` happy/COD/fault, `fetchLabel`, `getSupportedMethods`, coarse `getTracking` (mock `IDpdSoapClient`).
- `dpd-connection-config-shape-validator.adapter.spec.ts` — valid/invalid config.

### Integration Tests
- None new in this slice (no DB, no HTTP controller added — the existing `/shipments/generate-label` + `/shipments/:id/label` controllers already cover DPD once registered). A live-sandbox int-spec is deferred (would need network + creds in CI); the spike covers the live round-trip manually.

### Mocking Strategy
- Mock `IDpdSoapClient` in adapter tests (never the real endpoint). Per testing-guide: mock the port/interface.

### Acceptance Criteria (issue #962)
- [ ] Operator creates a "DPD Polska" connection (login + masterFID + password + sender); connection-test reaches the web service.
- [ ] "Generate label" on a courier order returns a downloadable DPD waybill PDF; shipment → `generated`.
- [ ] A COD order submits the amount to DPD; the label is produced; COD errors surface verbatim.
- [ ] Invalid recipient data is rejected with a clear message pre-submission.
- [ ] Unit tests pass; `pnpm lint` + `pnpm type-check` clean; jest-integration mapper added.

---

## 10. Alignment Checklist

- [x] Follows hexagonal architecture (integration implements core ports)
- [x] Respects CORE vs Integration boundaries (no CORE edits)
- [x] Uses existing patterns (InPost layout, PrestaShop `fast-xml-parser`, plugin-sdk)
- [x] Idempotency considered (best-effort core pre-check; limitation documented)
- [x] Event-driven N/A (core owns persistence/events)
- [x] Rate limits & retries addressed (retry loop + timeout in soap client)
- [x] Error handling comprehensive (domain exceptions + shared rejection mapping)
- [x] Testing strategy complete (4 unit suites; int deferred with rationale)
- [x] Naming conventions followed
- [x] File structure matches standards (mirrors InPost)
- [x] Plan is execution-ready
- [x] Plan saved as markdown

---

## Related Documentation
- Spec: [`docs/specs/product-spec-961-dpd-polska-shipping.md`](../specs/product-spec-961-dpd-polska-shipping.md)
- ADR: [`docs/architecture/adrs/018-soap-transport-for-dpd-polska.md`](../architecture/adrs/018-soap-transport-for-dpd-polska.md)
- Reference package: `libs/integrations/inpost/`
- [Architecture Overview](../architecture-overview.md) · [Engineering Standards](../engineering-standards.md) · [Testing Guide](../testing-guide.md) · [Migrations](../migrations.md)

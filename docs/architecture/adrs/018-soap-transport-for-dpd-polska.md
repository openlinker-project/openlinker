# ADR-018: SOAP transport for the DPD Polska integration

- **Status**: Proposed
- **Date**: 2026-06-02
- **Authors**: @piotrswierzy

## Context

OpenLinker's integrations all speak REST/JSON over native `fetch` — InPost ShipX (`inpost-http-client.ts`), Allegro, PrestaShop's webservice. The DPD Polska integration (#961/#962) is the first that must speak **SOAP 1.1 / WSDL**: its `DPDPackageObjServices` API authenticates with `AuthDataV1 { login, password, masterFid }` and uses a two-call label flow (`generatePackagesNumbersV1` → `generateSpedLabelsV1`, the latter returning the label PDF as base64 inside the SOAP body). We need a transport approach that fits the existing plugin/adapter shape, is unit-testable, and doesn't regress boot or bundle characteristics.

## Decision

Build SOAP requests as **hand-rolled SOAP 1.1 envelopes** using `fast-xml-parser`'s `XMLBuilder`, and parse responses with its `XMLParser`, behind a package-local `IDpdSoapClient` interface (the same seam shape as `IInpostHttpClient`). The DPD adapter depends on `IDpdSoapClient`, never on a SOAP library or `fetch` directly.

## Alternatives considered

- **A full SOAP client library (`soap` / `strong-soap`)**: Rejected — it parses the WSDL at process boot (introducing a startup network dependency on DPD, or a vendored-WSDL maintenance burden) and adds a heavy runtime dependency for the ~2–3 operations we actually call. It also obscures the wire format we need to control precisely for the COD/`OpenUMLFV1` shape.
- **A new core `SoapShippingPort`**: Rejected — SOAP is a transport detail, not a business capability. The existing `ShippingProviderManagerPort` already fits (proven by InPost); a new port would leak transport concerns into CORE.
- **Raw string-concatenated XML (no builder)**: Rejected — escaping/encoding bugs are easy and `fast-xml-parser` is already a repo dependency (PrestaShop), so `XMLBuilder`/`XMLParser` are free and battle-tested in-tree.

## Consequences

**Pros:**
- Consistent with the established native-`fetch` + no-heavy-HTTP-lib precedent.
- No boot-time WSDL fetch/parse; no new dependency category (`fast-xml-parser` already present).
- Full control of the envelope — needed for the `OpenUMLFV1` COD shape — and a mockable `IDpdSoapClient` for unit tests.

**Cons / trade-offs:**
- We hand-maintain envelope/namespace fidelity rather than deriving it from the WSDL — mitigated by a sandbox spike against the live demo WSDL (#962 Phase 0) before hardening, and by keeping the operation surface tiny (~2–3 calls).
- If DPD later requires many more operations, the hand-rolled approach scales less gracefully than a generated client — revisit this ADR if the operation count grows materially (e.g. > ~8).

**Migration path (if applicable):**
- None — purely additive. If superseded by a generated client later, the `IDpdSoapClient` seam means only the implementation changes, not the adapter.

## References
- Related issues: #961 (product spec), #962 (this implementation), #965 (DPDInfoServices tracking — same transport)
- Implementation plan: [implementation-plan-962-dpd-adapter-soap-transport.md](../../plans/implementation-plan-962-dpd-adapter-soap-transport.md)
- Primary doc section: [docs/architecture-overview.md](../../architecture-overview.md) § Listings/Shipping capability ports
- Reference: `libs/integrations/inpost/` (adapter/transport seam), `libs/integrations/prestashop/src/infrastructure/http/` (`fast-xml-parser` usage)

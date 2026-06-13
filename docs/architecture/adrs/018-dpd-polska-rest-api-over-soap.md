# ADR-018: DPD Polska transport — native REST DPDServices API over legacy SOAP

- **Status**: Proposed
- **Date**: 2026-06-02
- **Authors**: @piotrswierzy

> Replaces the earlier SOAP-transport draft of this ADR (a pre-merge revision on
> the same PR). The SOAP framing was based on incomplete research — see Context.

## Context

DPD Polska exposes **two** integration APIs for own-contract shipping:

1. **Legacy SOAP** — `DPDPackageObjServices` (WSDL; the widely-blogged service every public PHP reference client wraps; a public demo sandbox exists).
2. **Native REST** — **`DPDServices`** (JSON; Swagger/redoc at `dpdservices.dpd.com.pl/swagger-ui` · `…/redoc-ui`; a documented test server). DPD Polska's own customer documentation (`DPD-Services.zip → REST version.txt`) states the REST API transfers parcel data, downloads **labels (PDF / ZPL / EPL / XML)**, downloads **handover protocols**, and optionally calls a courier — i.e. it covers everything #962 needs.

The first draft of this ADR assumed the integration had to be SOAP, because the SOAP service is the one with abundant public reference clients. That was wrong: DPD Polska has a first-class REST API, confirmed from the carrier's own docs. OpenLinker's every other integration (InPost ShipX, Allegro, PrestaShop webservice) is REST/JSON over native `fetch`.

## Decision

Build the DPD Polska adapter against the **native REST `DPDServices` API** — JSON over native `fetch`, mirroring the InPost ShipX adapter. The two-step flow is the same as SOAP (`shipment/v1/generatePackagesNumbers` → `shipment/v1/generateSpedLabels`, plus `shipment/v1/generateProtocol`), expressed in JSON. No SOAP, no XML envelopes, no XML parser.

## Alternatives considered

- **SOAP `DPDPackageObjServices` + hand-rolled envelopes + `fast-xml-parser`** (the prior draft): Rejected — legacy XML/WSDL; needs hand-built SOAP envelopes (no SOAP lib in-tree) and XML parsing; its only real edge over REST was a public demo sandbox, and the REST API has its own documented test server. REST is simpler, consistent with every existing OL integration, and is the carrier's modern direction.
- **A full SOAP client library (`soap` / `strong-soap`)**: Moot once SOAP is rejected; was only relevant under the SOAP framing.
- **A new core `SoapShippingPort` / transport abstraction**: Moot — transport is an adapter-internal detail behind `IDpdHttpClient`.

## Consequences

**Pros:**
- Native `fetch` + JSON like every other OL integration — reuses the InPost HTTP-client pattern verbatim; no new dependency, no `fast-xml-parser`, no envelope/namespace fidelity burden.
- Smaller, simpler adapter + tests; future-proof (DPD's strategic API).

**Cons / trade-offs:**
- REST **test-server credentials** live in the gated Swagger/redoc doc — needed for the Phase-0 spike (the public-internet OpenAPI JSON returns 403).
- Tracking is a **separate service** (`DPD InfoServices`) regardless of transport — unchanged (#965). **Resolved by [ADR-022](./022-dpd-tracking-soap-dpdinfoservices.md): tracking is SOAP `DPDInfoServices`; the DPD plugin is now dual-transport.**

**Migration path:** none — this is a pre-implementation reversal of the draft; no code shipped against SOAP.

## References
- Related issues: #961 (product spec), #962 (this implementation), #965 (tracking via DPD InfoServices)
- Implementation plan: [implementation-plan-962-dpd-adapter-rest.md](../../plans/implementation-plan-962-dpd-adapter-rest.md)
- Reference: `libs/integrations/inpost/` (REST adapter + HTTP-client seam to mirror)
- Primary doc section: [docs/architecture-overview.md](../../architecture-overview.md) § Shipping capability ports

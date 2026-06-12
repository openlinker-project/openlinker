# ADR-022: DPD Polska tracking transport — SOAP DPDInfoServices (dual-transport plugin)

- **Status**: Proposed
- **Date**: 2026-06-11
- **Authors**: @piotrswierzy

> Completes the tracking-transport thread that [ADR-018](./018-dpd-polska-rest-api-over-soap.md) explicitly deferred ("Tracking is a separate service (DPD InfoServices) *regardless of transport* — unchanged (#965)"). This does **not** supersede ADR-018 — it leaves the REST shipment/label decision intact and only settles how tracking is read.

## Context

ADR-018 chose the native **REST `DPDServices`** API for DPD shipment creation + labels, and deliberately left tracking out of scope: DPD Polska has **no tracking operation in the shipment API**. Tracking lives in a **separate web service, `DPDInfoServices`**, confirmed from DPD's own `INFO_Services_v2` spec (obtained 2026-06-11, #965):

- It is a **SOAP** service on its **own host** — `dpdinfoservices.dpd.com.pl` (PROD), distinct from the `dpdservices` shipment host and from the `gryf` documentation portal.
- It exposes two interfaces: **`DPDInfoServicesObjEvents`** (parameters passed/returned uncoded) and **`DPDInfoServicesXmlEvents`** (same data base64-encoded, optionally ZIP-compressed).
- The per-parcel operation is **`getEventsForWaybillV1(waybill, langCode, ALL|ONLY_LAST, authDataV1)`** — channel-less (§1.3) and idempotent on re-read.
- Auth is `authDataV1 { login, password, channel }` carried **in the SOAP body** (not the `X-DPD-FID` header the REST shipment API uses); `channel` is empty for the waybill method.

So the DPD plugin — REST-only after #962/#971 — must gain a second, SOAP transport to satisfy `ShippingProviderManagerPort.getTracking` (the #838 status-sync engine calls it per-shipment).

## Decision

1. **The DPD plugin becomes dual-transport**: REST `DPDServices` for shipment/labels/pickup (unchanged) + a minimal SOAP `DPDInfoServices` client for tracking. One adapter (`DpdShippingAdapter`), one connection, one credential set — two internal transports.
2. **Use the `DPDInfoServicesObjEvents` interface** (uncoded), not `XmlEvents`. We read one waybill at a time, so the base64/ZIP codec `XmlEvents` adds buys nothing and costs complexity.
3. **No SOAP library** — hand-build the `getEventsForWaybillV1` envelope as a template string and parse the response with **`fast-xml-parser`** (already a repo dependency; the PrestaShop plugin sets the precedent). It is a single operation; `node-soap`/`strong-soap` bring WSDL parsing we don't need plus a larger dependency/CVE surface.
4. **Auth reuses the connection's existing `login`/`password`** (the factory already resolves them); `masterFid` is irrelevant to InfoServices. `channel` is sent empty for the waybill method.
5. **Read-only / no `markEventsAsProcessed`.** That confirmation step exists only for the channel-based `getEventsForCustomer` *account-bulk pull*; a per-waybill query is an idempotent read (re-querying returns the same events — exactly what status polling wants).

## Alternatives considered

- **A SOAP library (`node-soap` / `strong-soap`).** Rejected: heavyweight WSDL machinery for one operation; larger dependency + security surface; we already ship `fast-xml-parser`.
- **The `XmlEvents` interface.** Rejected: base64 + optional ZIP coding adds a codec layer with no benefit for single-waybill reads.
- **A separate DPD-InfoServices connection / adapter.** Rejected: it's the same DPD account and the same `ShippingProviderManager.getTracking` capability — one adapter with two transports is the correct shape; a second connection would fork credentials + capability resolution for no gain.
- **The `getEventsForCustomerV4` + `markEventsAsProcessedV1` account-pull** (DPD's "recommended scenario"). Deferred: it's an account-level bulk feed that doesn't map to the per-shipment `getTracking({ providerShipmentId })` contract. It's the natural **future batch optimization** if per-waybill fan-out becomes a throughput problem, but would need a core change to drive.

## Consequences

- One extra transport (SOAP/XML) to maintain inside a single plugin; isolated behind a `IDpdInfoSoapClient` port so the REST path is untouched.
- **Per-waybill poll fan-out**: the #838 poll iterates a connection's DPD shipments and calls `getTracking` once each ⇒ N SOAP round-trips per batch. Mitigated by a conservative default cadence (~30 min) + a modest page limit; the batch op above is the escape hatch if needed.
- **XML-decoding robustness burden**: single-element array coercion (`fast-xml-parser` collapses one `<eventsList>` to an object), offset-less `eventTime` (Europe/Warsaw wall-clock), and SOAP-Fault-on-HTTP-200 must all be handled in the client/mapper.
- **Redirect/return stall**: on a `230402` redirect the parcel gets a *new* waybill; OL keeps polling the original `providerShipmentId`, so a redirected shipment's status stalls at `in-transit` (logged). Auto-following the new waybill is a documented follow-up, out of scope for #965.
- The **demo InfoServices host** (`dpdinfoservicesdemo.dpd.com.pl`) is inferred from the demo-host naming pattern and carries a `// TODO confirm` until validated against the demo WSDL; PROD is confirmed.

## Related

- [ADR-018](./018-dpd-polska-rest-api-over-soap.md) — DPD shipment transport (REST). This ADR resolves the tracking-transport thread ADR-018 deferred; ADR-018's status is unchanged.

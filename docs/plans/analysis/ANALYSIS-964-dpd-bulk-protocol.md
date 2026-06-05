# Pre-implement gate: #964 DPD bulk label generation + handover protocol

**Plan**: [`../implementation-plan-964-dpd-bulk-protocol.md`](../implementation-plan-964-dpd-bulk-protocol.md)
**Date**: 2026-06-03
**Verdict**: ✅ **READY**

Purely additive plan. Every artifact the plan calls "new" is confirmed absent; every reuse target exists with the exact shape the plan assumes. No contract-surface breaks. One naming/wiring clarification (W-1) to honour during implementation, and the dispatch-input item type can be made precise (W-2) — neither blocks.

---

## Reuse findings

| Plan artifact | Verdict | Evidence |
|---|---|---|
| `DispatchProtocolReader` capability (`shipping/domain/ports/capabilities/dispatch-protocol-reader.capability.ts`) | **NEW (absent)** — name pre-reserved | `label-document-reader.capability.ts:15-17` reserves it verbatim: *"a sibling sub-capability (`DispatchProtocolReader`) when it ships"* |
| `isDispatchProtocolReader` guard | **NEW** | Matches existing guard convention (`isLabelDocumentReader`, `isShipmentCanceller`, `isPickupPointFinder`) |
| `LabelDocument` reuse (`{contentType:string; body:Uint8Array}`) | **EXISTS → reuse** | `shipping/domain/types/label-document.types.ts:22-28`; exported from `@openlinker/core/shipping` |
| `BulkShipmentDispatchService` + `I*Service` interface | **NEW (absent)** | No `bulk-shipment-dispatch*` under `shipping/application/services/` |
| `bulk-shipment-dispatch.types.ts` | **NEW (absent)** | confirmed absent under `application/types/` |
| `BULK_SHIPMENT_DISPATCH_SERVICE_TOKEN` | **NEW** | `shipping.tokens.ts` pattern `Symbol('I…Service')`; `SHIPMENT_DISPATCH_SERVICE_TOKEN` already exists for the per-order service the bulk loop injects |
| Per-order `ShipmentDispatchService.dispatch()` loop target | **EXISTS → reuse** | `shipment-dispatch.service.ts:73` `dispatch(input: ShipmentDispatchInput): Promise<ShipmentDispatchResult>`; injects routing(#832)+payment-gate(#938)+`findActiveByOrderId` idempotency |
| DPD `generateProtocol` on `DpdShippingAdapter` | **NEW (absent)** | adapter implements `ShippingProviderManagerPort, LabelDocumentReader, PickupPointFinder`; no protocol code anywhere in package |
| `decodeProtocolDocument` (base64→bytes) | **PARTIAL → reuse `decodeLabelDocument`** | `dpd-shipment.mapper.ts:189-207` decodes base64 `documentData`→`Uint8Array`; same shape for protocol |
| `FakeDpdShippingAdapter` gains `generateProtocol` | **EXISTS → extend** | `testing/fake-dpd-shipping.adapter.ts:32` |
| `POST /shipments/bulk/generate-labels` + protocol download | **NEW (absent)** | no `/shipments/bulk*` route in `shipment.controller.ts`; binary-stream pattern to mirror at `:id/label` (`res.setHeader` + `res.send(Buffer.from(body))`) |
| Bulk request DTO (`@ArrayMaxSize(25)`) | **NEW** | pattern established in `listings/http/dto/bulk-offer-create.dto.ts` (`@IsArray/@ArrayMinSize/@ArrayMaxSize`); bulk-offer cap **= 100** confirmed (plan's claim correct) |

## Backward-compat findings

No Critical items. Everything is additive — no exported symbol removed/renamed, no port signature changed, no DTO retyped, no ORM/migration touched (`check:invariants` unaffected; no cross-context or deep-barrel imports introduced).

**Warnings / clarifications to honour during implementation:**

- **W-1 (sub-capability is NOT a manifest capability).** One audit suggested adding `'DispatchProtocolReader'` to the DPD manifest `supportedCapabilities` + the `dispatchCapability` map. **Do not.** The existing sub-capabilities `LabelDocumentReader` and `PickupPointFinder` are **not** in `supportedCapabilities` (`dpd-plugin.ts:31` lists only `'ShippingProviderManager'`) and **not** in the `dispatchCapability` map — they're discovered by resolving the `ShippingProviderManager` adapter and narrowing with the `is*` guard (exactly what `ShipmentLabelService` does for `LabelDocumentReader`). The bulk service must resolve `getCapabilityAdapter<ShippingProviderManagerPort>(processorConnectionId, 'ShippingProviderManager')` then `isDispatchProtocolReader(adapter)`. No manifest change. The plan already models it as a sub-capability; this note just blocks the wrong wiring.

- **W-2 (make the per-order item type precise).** The plan describes the bulk item as "the per-order payload minus the shared routing keys." Concretely that is `Omit<ShipmentDispatchInput, 'sourceConnectionId' | 'sourceDeliveryMethodId'>`, and `BulkShipmentDispatchInput = { sourceConnectionId; sourceDeliveryMethodId: string | null } & { items: <thatOmit>[] }`. Derive from the existing `ShipmentDispatchInput` (`application/types/shipment-dispatch.types.ts:23`) rather than re-declaring fields, so the two can't drift.

- **W-3 (result-union mapping).** `ShipmentDispatchResult` has **no** `failed` variant — a label failure is **thrown** (shipment persisted `failed` first). So the bulk per-order `failed{orderId,error}` entry is produced by the bulk loop's `try/catch`, and the protocol is generated only over waybills from `kind:'dispatched'` results (`omp_fulfilled` carries no shipment). Plan §3/§8 already say this; flagging so the implementation maps the union correctly.

## Open questions (unchanged from plan, none blocking)

- **OQ-1** DPD `generateProtocol` exact path/request/response (waybills vs sessionId) — gated on #962 creds; isolated in DPD types+mapper; live round-trip = pre-merge AC. Build against documented shape.
- **OQ-2** Protocol delivery to FE (inline bytes vs retrievable ref) — decided with #966; v1 returns a streamable `LabelDocument`.

## Idempotency note

`findActiveByOrderId` is best-effort (find→create not atomic). The bulk loop is **sequential synchronous**, so no intra-batch concurrent double-create — consistent with the existing per-order serialization expectation. The N≤25 cap (ADR-019) bounds the sequential-call wall-clock.

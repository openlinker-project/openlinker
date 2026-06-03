# Implementation Plan: DPD bulk label generation + handover protocol

**Date**: 2026-06-03
**Status**: Draft — pending Gate (Phase 3 review); one architecture fork to settle
**Issue**: #964 (Part of #961)
**Spec**: [`docs/specs/product-spec-961-dpd-polska-shipping.md`](../specs/product-spec-961-dpd-polska-shipping.md) §4.4 (US-6 / AC-6)
**Builds on**: #962 (DPD adapter, merged #971), #963 (DPD Pickup, merged #973)
**Implementation branch**: `964-dpd-bulk-protocol`
**Estimated Effort**: M–L (~1 week for the recommended shape; L–XL for the async-aggregate alternative)

> **The architecture fork the issue flagged is settled in §3 below**: a *synchronous* core
> bulk-dispatch orchestrator (NOT the async `BulkOfferCreationBatch`-style aggregate).
> §3 keeps three deferred decisions explicitly separate — (a) the **async executor**
> (worker + advancement gate + progress polling), rejected because DPD bulk is not a
> slow/rate-limited/restart-surviving workload; (b) the **durable batch record**, deferred
> because #964's partial-failure AC is already met by per-order `Shipment` rows; and (c) the
> **per-order-prepare / batched-execute split**, named as the intended long-term shape that a
> batch-native or slow carrier (#831) evolves into. Synchronous-now forecloses none of them —
> `BulkShipmentDispatchService` is the exact seam an async wrapper later calls. See §3 + ADR-019.

---

## 1. Task Summary

**Objective**: Let an operator dispatch **N orders' DPD labels in one action** and get a **single DPD handover protocol** (the courier hand-off manifest), with **per-order success/failure** and partial-failure survival.

**Classification**: **CORE (new bulk-dispatch orchestrator + new `DispatchProtocolReader` sub-capability) + Integration (DPD `generateProtocol` impl) + API.** FE bulk-selection UX is deferred (see Non-Goals). No DB migration (recommended shape).

**Context**: Today shipping dispatch is strictly per-order (`ShipmentDispatchService.dispatch(input)` → one `Shipment`). #964 adds the bulk surface. The handover-manifest capability name is **pre-reserved** by the codebase: `label-document-reader.capability.ts` says the dispatch protocol "is a DIFFERENT document (per-batch, not per-parcel)… it will be a sibling sub-capability (`DispatchProtocolReader`) when it ships." This is also the seam Allegro Delivery #831 will reuse.

---

## 2. Scope & Non-Goals

### In Scope
**CORE (`libs/core/src/shipping/`):**
- `DispatchProtocolReader` sub-capability (`domain/ports/capabilities/dispatch-protocol-reader.capability.ts`) — `generateProtocol(input: { providerShipmentIds: string[] }): Promise<LabelDocument>` + `isDispatchProtocolReader` guard. Carrier-neutral (the name + intent are pre-reserved; #831 reuses it).
- `BulkShipmentDispatchService` (`application/services/bulk-shipment-dispatch.service.ts` + interface) — **synchronous** orchestrator: for each item, delegate to the existing `ShipmentDispatchService.dispatch()` (so routing + payment-gate + idempotency + `Shipment` rows are reused per order), isolate per-order failures, then call the connection's `DispatchProtocolReader.generateProtocol()` over the dispatched waybills. Returns per-order results + the protocol document.
- Types: `BulkShipmentDispatchInput` / `BulkShipmentDispatchResult` (per-order outcome union + optional protocol).

**Integration (`libs/integrations/dpd-polska/`):**
- `DpdShippingAdapter implements … , DispatchProtocolReader` — `generateProtocol` via DPD `generateProtocolV1` (handover document, base64 → bytes; reuses `DpdHttpClient`).
- Mapper + types for the protocol request/response.

**API (`apps/api/src/shipping/http/`):**
- `POST /shipments/bulk/generate-labels` → `BulkShipmentDispatchService`; returns `{ results: [{ orderId, status, shipmentId?, error? }], protocol?: { contentType, ... } }`.
- Protocol document download (`GET /shipments/bulk/protocol?...` or a follow-the-link ref) — exact shape decided with the FE issue; v1 may return the protocol bytes inline / via a one-shot ref.

### Out of Scope (Non-Goals)
- **FE bulk-selection UX** (multi-select on `/orders` → bulk-dispatch action + per-order result panel). Deferred to the DPD FE issue (#966) / a FE follow-up — mirrors #962/#963 which shipped backend-first. The `BulkActionBar` primitive already exists (used by bulk-offer-creation) for that work.
- **Async executor** (worker fan-out + `bulk_*_advancements` gate + progress-polling) — rejected for this workload (§3 (a)). #831's slow dispatch half is the consumer that adds it; the synchronous service is the seam it wraps.
- **Durable batch record** (`bulk_shipment_dispatch_batch` row + `Shipment.bulkBatchId` FK) — deferred (§3 (b)): #964's partial-failure AC is met by per-order `Shipment` rows. Adds batch retry / navigate-away later; no migration in v1.
- **Per-order-prepare / batched-execute split** + **DPD batch-native single create call** (`generatePackagesNumbers` with N packages in one HTTP call) — named as the intended long-term shape (§3 (c)) but not built. v1 reuses per-order `dispatch()` (N sequential create calls) to inherit routing/payment-gate/idempotency/`Shipment`-row guarantees; the N≤25 cap bounds the timeout cost. The **protocol** is the genuinely-batch call even in v1.
- **Multi-parcel single order** (1 order → N parcels) — spec §7, separate.
- Courier / COD / pickup base flows (#962 + #963).

### Constraints
- No CORE change beyond the additive capability + new service. No migration (no persistent batch in the recommended shape). Reuse #962 `DpdHttpClient` + #963 patterns.

---

## 3. Architecture decision — synchronous orchestrator vs async batch aggregate (THE FORK)

The issue says: *"possible new core bulk-dispatch seam (shipping is per-order today) — run /plan to settle core-vs-adapter-local."* Settled:

**Chosen: a synchronous core `BulkShipmentDispatchService` that loops the existing per-order `ShipmentDispatchService.dispatch()`, then issues one `generateProtocol`.**

The fork is not one binary choice — it's **three independent deferral decisions** that the bulk-offer aggregate happens to bundle together. Keeping them separate is what makes "synchronous now" honest rather than a guess:

**(a) Async executor — REJECTED.** The `BulkOfferCreationBatch` machinery (parent batch row + `bulk_*_advancements` at-most-once gate + submit/progress/retry services + `marketplace.*.create` worker job + FE progress-polling page; listings #726/#734) exists because **offer creation is N slow, independent, rate-limited Allegro calls with per-offer classification read-back** — minutes-long, must survive worker restarts, needs durable progress + retry. DPD bulk is not that workload, so this whole scaffold would be large and mostly idle for zero latency benefit. Rejected.

**(b) Durable batch record — DEFERRED (on its own terms, not as a side-effect of (a)).** A `bulk_shipment_dispatch_batch` row + `Shipment.bulkBatchId` FK would buy durability (navigate-away/come-back), batch-level retry of the *failed subset*, and a home for protocol-regeneration state — **without** any of the (a) async machinery. #964's AC ("partial failure doesn't lose successful labels") does **not** require it: the per-order `Shipment` rows already persist each outcome, and the synchronous response carries the per-order result list. So we defer it — but we reject it *because the AC is already met*, not because "no persistence is ever needed." It is the natural first thing #831 adds.

**(c) Per-order-prepare / batched-execute split — NAMED as the intended evolution, not built now.** This v1 reuses `ShipmentDispatchService.dispatch()` wholesale, which means a bulk of N is **N sequential `dispatch()` calls** (each: routing resolution #832 + payment-status read #938 + `Shipment` insert + one outbound DPD create) **plus** one protocol call — all in one request. That reuses every per-order guarantee for free (zero duplication, per-order failure isolation is a `try/catch` per item → a failed order becomes a `failed` `Shipment` row + a failure entry; successful siblings untouched). The cost is real: it is **not** "~3 fast calls" — it is ~N sequential outbound round-trips, with a hard request-timeout ceiling. The clean long-term shape splits **"prepare per order"** (routing + payment-gate + `Shipment` row, looped — cheap, DB-local) from **"execute"** (one *batched* adapter call, e.g. DPD `generatePackagesNumbers` with N packages). That split is what lets a batch-native carrier stay efficient *without* bypassing the per-order guarantees, and what a slow source-brokered carrier (#831's Allegro Delivery dispatch-command half) wraps in the (a) executor. We don't build the split now (the loop is simpler and correct at a bounded cap), but the cap below exists precisely because we haven't.

**Synchronous-cap bound (mitigation for (c)).** Because v1 issues N sequential outbound calls in one request, the API DTO caps N at **25** (not the bulk-offer 100) — worst case ~25 DPD creates + 1 protocol stays comfortably under a 30 s gateway timeout. The cap is documented as a deliberate consequence of the per-order loop, removable once the prepare/execute split (c) or the durable record (b) lands. (Bulk-offer's 100 cap is fine there because it fans out to async workers, not a synchronous loop.)

**Known second consumer.** #831 (Allegro Delivery — dispatch manifest + courier pickup) reuses `DispatchProtocolReader` (capability is pre-reserved for it) **and** is the slow, source-brokered dispatch workload that triggers (a)+(b)+(c). So we are not pre-paying hypothetical complexity: #831 is a filed issue, and `BulkShipmentDispatchService` is the exact synchronous seam it wraps. That's the whole reason sync-now is safe.

**Net:** recommended shape = **1 new capability + 1 new core service + DPD protocol impl + API endpoints + tests**, M–L, N≤25. The async alternative would push this to L–XL. Decision recorded in **ADR-019**.

---

## 4. External Research — DPD `generateProtocol` (verified shape pending spike)

- DPD `DPDServices` REST exposes **`generateProtocolV1`** (handover protocol / "protokół odbioru") over a set of waybills — returns a document (PDF) analogous to `generateSpedLabels`' `documentData` (base64). Same Basic-auth + `DpdHttpClient`. (#962 grounding note + the customer doc list `generateProtocol` alongside the shipment ops.)
- **OQ-1 (spike, gated on #962 creds):** exact path (`/public/shipment/v1/generateProtocol`?), request shape (session/waybills array, like `generateSpedLabels`), response (`documentData` base64 + status), and whether a protocol is keyed by waybills or by the create `sessionId`. Isolated in DPD types + mapper; the live round-trip is a pre-merge AC (the #962 pattern).

### Internal patterns to mirror
- **`LabelDocumentReader`** (`fetchLabel` → `LabelDocument`) — `DispatchProtocolReader.generateProtocol` is its per-batch sibling, same `LabelDocument` return (contentType + bytes).
- **`ShipmentLabelService` + `GET /shipments/:id/label`** — the binary-download controller pattern (content-type, `Content-Disposition`, extension-from-MIME) to mirror for the protocol download.
- **`ShipmentDispatchService.dispatch()`** — looped per item by the new bulk service.

---

## 5. Questions & Assumptions

### Open Questions
- **OQ-1 (DPD protocol endpoint/shape)** — confirmed in the Phase-0 spike against the live Swagger (gated on #962 creds); isolated in types + mapper. Live bulk + protocol round-trip = pre-merge AC.
- **OQ-2 (protocol document delivery to FE)** — return protocol bytes inline in the bulk response vs a retrievable ref (`labelPdfRef`-style). Decided with the FE issue; v1 backend returns a `LabelDocument` the API can stream. Recommend a `GET /shipments/bulk/protocol` taking the waybill set (stateless) to match the stateless DPD call.

### Assumptions
- Bulk is operator-triggered, synchronous, bounded at **N≤25** (NOT the bulk-offer 100 — see §3 cap rationale: v1 issues N sequential outbound calls in one request, so the cap bounds the timeout cost; bulk-offer's 100 is fine there because it fans out to async workers). Documented in the API DTO with a comment pointing at §3.
- All orders in one bulk call target the **same** source connection / carrier (the protocol is per-DPD-account); the service asserts a single resolved processor connection across items and errors clearly otherwise.

---

## 6. Proposed Implementation Plan

### Phase 0 — Spike (confirm OQ-1; gated on #962 creds)
1. Against the live DPDServices Swagger (#962 chrome-devtools path): confirm `generateProtocol` path/method/request/response + whether it keys on waybills or sessionId. Capture canned fixtures. Not merged; if creds unavailable, build Phases 1–4 against the documented shape + leave the live round-trip as the pre-merge AC.

### Phase 1 — CORE: `DispatchProtocolReader` capability
2. `domain/ports/capabilities/dispatch-protocol-reader.capability.ts` — interface (`generateProtocol(input: { providerShipmentIds: string[] }): Promise<LabelDocument>`) + `isDispatchProtocolReader` guard. Export both from the shipping barrel. (Reuses `LabelDocument`.)
   - **Acceptance**: type-check green; guard unit-tested; no other adapter forced to implement it (optional sub-capability).

### Phase 2 — CORE: `BulkShipmentDispatchService`
3. Types `application/types/bulk-shipment-dispatch.types.ts`: `BulkShipmentDispatchInput { sourceConnectionId; sourceDeliveryMethodId; items: ShipmentDispatchItem[] }` (item = the per-order payload minus the shared routing keys) + `BulkShipmentDispatchResult { results: PerOrderDispatchResult[]; protocol?: LabelDocument }` where `PerOrderDispatchResult` is a per-order discriminated union (`dispatched{shipment}` | `omp_fulfilled` | `failed{orderId, error}`).
4. `application/services/bulk-shipment-dispatch.service.ts` (+ `I*Service` interface): inject `IShipmentDispatchService` + `IIntegrationsService`. For each item: `try { dispatch() } catch → failed entry` (failure isolation). Then resolve the processor connection's adapter, `isDispatchProtocolReader` → `generateProtocol(dispatchedWaybills)`; if unsupported, return results without a protocol (don't fail the batch). Assert single resolved connection across items.
   - **Acceptance**: unit tests — all-success + protocol; partial-failure (one order throws, others survive, protocol covers only succeeded); adapter without `DispatchProtocolReader` → results, no protocol; mixed connections → throws.

### Phase 3 — Integration: DPD `generateProtocol`
5. `dpd-rest.types.ts`: protocol request/response shapes (isolated, OQ-1). `dpd-shipment.mapper.ts`: `buildGenerateProtocolRequest(waybills)` + `decodeProtocolDocument(res)` (base64 → bytes, status assert — reuse the #962 helpers).
6. `dpd-shipping.adapter.ts`: `implements … , DispatchProtocolReader`; `generateProtocol` → `POST` the protocol endpoint (`idempotent: true` read-style) → `decodeProtocolDocument`. `FakeDpdShippingAdapter` gains it.
   - **Acceptance**: mapper + adapter unit tests (protocol build + decode + capability presence).

### Phase 4 — API
7. `POST /shipments/bulk/generate-labels` (DTO with `items[]`, `@ArrayMaxSize(25)` + a comment pointing at §3's cap rationale) → `BulkShipmentDispatchService`; map per-order failures into the response (200 with per-order statuses; never 500 for a partial failure). Protocol retrieval endpoint (binary stream, mirroring `GET /shipments/:id/label`).
   - **Acceptance**: controller unit test; integration test (bulk happy-path + partial-failure) reusing the shipping int-spec harness.

### Config / Migrations / Events
- No migration, no env vars, no events (synchronous; per-order persistence already exists).

---

## 7. Alternatives Considered
- **Async executor (BulkOfferCreationBatch clone — worker + advancement gate + progress/retry services + FE polling)** — rejected (§3 (a)): justified only by slow/rate-limited/restart-surviving per-item calls; DPD bulk isn't that. #831's slow dispatch half is the consumer that adds it, wrapping this synchronous seam.
- **Durable batch record (`bulk_shipment_dispatch_batch` + `Shipment.bulkBatchId`, no async machinery)** — deferred (§3 (b)) on its own terms: #964's partial-failure AC is met by per-order `Shipment` rows. The first thing #831 adds for batch retry / navigate-away; no migration in v1.
- **Per-order-prepare / batched-execute split + DPD batch-native single `generatePackagesNumbers` (N packages, 1 call)** — named as the long-term shape (§3 (c)) but deferred: v1 loops per-order `dispatch()` to preserve all guarantees with zero duplication; the N≤25 cap bounds the sequential-call timeout cost. This is the lever that lifts the cap, not just a latency nicety.
- **Adapter-local batch (no core seam)** — rejected: would duplicate routing/payment-gate/idempotency/`Shipment`-row logic inside the adapter, and the protocol capability has to be core anyway (carrier-neutral, #831 reuses it).

---

## 8. Validation & Risks
- **Per-order failure isolation** is the core AC — covered by the try/catch-per-item loop + a dedicated partial-failure test. A failed order persists as a `failed` `Shipment`; successes are untouched.
- **Protocol-over-succeeded-only**: the protocol is generated over the waybills that actually dispatched, so a partial failure still yields a valid protocol for the successes.
- **Single-connection assumption**: bulk asserts one resolved processor connection (the protocol is per-DPD-account); mixed-connection input errors clearly rather than producing a wrong manifest.
- **`DispatchProtocolReader` optional**: adapters that don't support it (InPost today) just yield no protocol — the capability guard prevents a hard dependency.
- **Live round-trip** (bulk + protocol) gated on #962 creds → pre-merge AC.
- **FE-dormant until #966**: backend bulk is API-reachable but the operator multi-select UX is the FE issue. Consistent with #962/#963.

---

## 9. Testing Strategy & Acceptance Criteria

### Unit Tests
- `dispatch-protocol-reader.capability.spec.ts` — guard true/false.
- `bulk-shipment-dispatch.service.spec.ts` — all-success+protocol, partial-failure survival, no-protocol-capability, mixed-connection throw, payment-gate-per-order (one blocked, others proceed).
- DPD `dpd-shipment.mapper.spec.ts` + `dpd-shipping.adapter.spec.ts` — protocol build/decode + `isDispatchProtocolReader` true.

### Integration Tests
- `shipments-bulk-dispatch.int-spec.ts` — bulk happy-path + partial-failure via the existing harness (stubbed shipping adapter). Live DPD bulk+protocol = manual pre-merge AC (needs #962 creds).

### Acceptance Criteria (#964)
- [ ] Operator (API) submits N orders → N labels generated + one DPD handover protocol (unit + int-proven; live in the AC below).
- [ ] Per-order success/failure surfaced; a partial failure keeps successful labels + still yields a protocol for the successes.
- [ ] `pnpm lint` / `type-check` / unit tests green; invariants satisfied.
- [ ] **Manual (pre-merge):** live DPD bulk + protocol round-trip (needs #962 creds + OQ-1).

---

## 10. Alignment Checklist
- [x] Hexagonal — additive core capability + service; integration implements it; API delegates
- [x] CORE vs Integration settled (§3) — synchronous core orchestrator, carrier-neutral protocol capability
- [x] Reuses existing patterns (`ShipmentDispatchService` loop, `LabelDocumentReader` sibling, #962 DPD stack, `BulkActionBar` for the deferred FE)
- [x] Idempotency — per-order `findActiveByOrderId` reused; protocol is an idempotent read
- [x] Error handling — per-order failure isolation; `ShippingProviderRejectionException`
- [x] Testing strategy complete (unit + int, partial-failure focus)
- [x] No migration; no async machinery (justified §3)
- [x] Execution-ready pending the architecture-fork sign-off + OQ-1 spike

---

## Related Documentation
- Spec: [`product-spec-961-dpd-polska-shipping.md`](../specs/product-spec-961-dpd-polska-shipping.md) · #962/#963 plans · [ADR-019](../architecture/adrs/019-synchronous-bulk-shipment-dispatch.md) (this decision) · [ADR-018](../architecture/adrs/018-dpd-polska-rest-api-over-soap.md) (DPD REST)
- Reference: `libs/integrations/dpd-polska/` (#962/#963), `libs/core/src/listings/**` bulk-offer (#726/#734), `libs/core/src/shipping/application/services/shipment-dispatch.service.ts`

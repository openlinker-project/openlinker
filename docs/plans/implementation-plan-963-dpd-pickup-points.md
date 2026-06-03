# Implementation Plan: DPD Pickup points — PickupPointFinder + ship-to-point

**Date**: 2026-06-03
**Status**: Draft — pending Gate (Phase 3 review)
**Issue**: #963 (Part of #961)
**Spec**: [`docs/specs/product-spec-961-dpd-polska-shipping.md`](../specs/product-spec-961-dpd-polska-shipping.md) §4.3 (US-4 / AC-4)
**Builds on**: #962 (DPD adapter package + REST transport, merged via #971)
**Implementation branch**: `963-dpd-pickup-points`
**Estimated Effort**: S–M (~2–4 days)

> **Scope correction from research (2026-06-03).** Two facts reshape this issue
> from the issue-body framing:
> 1. **The dispatch path is already carrier-agnostic.** `GenerateLabelCommand.paczkomatId`
>    carries *any* pickup-point id; the Allegro adapter reads `delivery.pickupPoint.id`
>    carrier-blind into `IncomingOrder.pickupPoint` → order snapshot, and the operator
>    generate-label flow supplies it. A DPD point id (`PL11033`) **already flows through
>    with zero core / Allegro changes** — the "Allegro auto-fill" AC is satisfied by
>    existing plumbing once the DPD adapter consumes `paczkomatId`.
> 2. **The FE pickup picker modal does not exist yet** (deferred; the form is manual
>    text entry today) and the DPD FE connection plugin is **#966's** scope. So #963's
>    "thin FE wiring to reuse the picker" is effectively nil.
>
> **#963 is therefore a backend-only Integration slice.** Net-new = the DPD adapter's
> `PickupPointFinder` + the ship-to-point (`pudoReceiver` / `DPD_PICKUP`) mapping.

---

## 1. Task Summary

**Objective**: Add DPD Pickup (parcel-shop / PUDO) delivery to `@openlinker/integrations-dpd-polska`: the adapter implements `PickupPointFinder` (searches the DPD point directory) and the mapper ships a parcel to a chosen point (`pudoReceiver` + `DPD_PICKUP` service) when `shippingMethod === 'paczkomat'`.

**Classification**: **CORE (one additive line) + Integration.** A dedicated `'pickup'` `ShippingMethod` value is added to the closed core union (`shipping_method` is a `text` column → **no migration**); the rest is the DPD integration. No FE change in this issue (FE mirror + form affordances = #966).

**Context**: Mirrors the InPost pickup vertical slice (#764/#766) — DPD plugs into the already-carrier-agnostic `PickupPointLookupService` → `GET /pickup-points` → `isPickupPointFinder` → `findPickupPoints` machinery and the operator generate-label flow.

---

## 2. Scope & Non-Goals

### In Scope
**CORE (`libs/core/src/shipping/`) — one additive edit:**
- Add `'pickup'` to `ShippingMethodValues` + `SHIPPING_METHOD` in `domain/types/shipping-method.types.ts` (the dedicated carrier-neutral "ship to a parcel-shop / PUDO point" method, distinct from `paczkomat` = locker). `shipping_method` is a `text` column → no migration; `@IsEnum(ShippingMethodValues)` DTOs auto-accept it; no exhaustive `never`-switch to update.

**Integration (`libs/integrations/dpd-polska/`):**
- `DpdShippingAdapter implements …, PickupPointFinder` — `findPickupPoints(query)` against the DPD point directory; `getSupportedMethods()` gains `'pickup'` (→ `['kurier','pickup']`).
- Mapper **pickup branch**: `shippingMethod === 'pickup'` → one `SinglePackage` with `pudoReceiver` (the point id from `cmd.paczkomatId`) + the `DPD_PICKUP` `TransportService`, instead of the courier `receiver`.
- Point-directory mapping: DPD point → neutral `PickupPoint`; neutral `FindPickupPointsQuery` → DPD point-search request.
- Types: `pudoReceiver` on `DpdSinglePackage`, `DPD_PICKUP` service code, point-search request/response shapes.
- `FakeDpdShippingAdapter` gains `findPickupPoints` (seeded points) + pickup-branch validation.
- Unit tests for all of the above.

### Out of Scope
- **Allegro / order-ingestion changes** — the pickup-point id already flows (research §2 below). Zero changes.
- **FE** — the FE `ShippingMethodValues` mirror (`apps/web/src/features/shipments/api/shipments.types.ts`) gaining `'pickup'`, the generate-label form offering it, picker modal (doesn't exist; deferred), DPD connection form + COD/pickup panel = **#966**. Until #966, DPD pickup is backend-capable but not operator-reachable via the FE (mirrors #962: COD backend shipped, operator entry = #966).
- **Renaming `GenerateLabelCommand.paczkomatId`** — the point id keeps riding the existing (carrier-neutral despite the name) `paczkomatId` command field; renaming it is a separate, larger core change, out of scope.
- **PrestaShop pickup-point read** — PS order source doesn't expose a point today; manual fallback. Out of scope (re-evaluate if a PS DPD module surfaces it).
- Courier-to-door + COD (#962, shipped); bulk + protocol (#964); tracking (#965).

### Constraints
- No new runtime dep. No migration (`text` column). The dedicated `'pickup'` value is additive to the closed core union (forward-compatible per `shipping-method.types.ts`'s own doc).

---

## 3. Architecture Mapping

**Layer**: Integration only. Implements the existing `PickupPointFinder` sub-capability (`@openlinker/core/shipping`) — no new core surface.

**Reused unchanged**:
- `PickupPointLookupService.search(connectionId, query)` → `getCapabilityAdapter<ShippingProviderManagerPort>` → `isPickupPointFinder(adapter)` → `findPickupPoints` → write-through `PickupPointCachePort`. Carrier-agnostic.
- `GET /pickup-points?connectionId&searchText&city&postalCode&limit` (`apps/api/src/shipping/http/pickup-point.controller.ts`) — works for any connection whose adapter implements the capability.
- `FindPickupPointsQuery` / `PickupPoint` / `PickupPointAddress` types.
- The whole #962 DPD stack: `DpdHttpClient`, factory, plugin, config validator.

**InPost reference slice to mirror**: `inpost-shipping.adapter.ts` (`findPickupPoints`), `inpost-shipx.mapper.ts` (`buildPointsQuery` / `toPickupPoint`), `pickup-point-finder.capability.ts` (guard — reuse as-is).

---

## 4. External Research — DPD point directory (OQ-1, the one spike item)

DPD Polska exposes a **ParcelShopFinder / DPD Pickup point directory** (parcel shops + lockers) — confirmed it exists; the exact placement + shape is the spike item, same gated-Swagger situation as #962's live round-trip:

- **OQ-1 (primary):** the exact point-search endpoint — is it in the REST `DPDServices` API (e.g. an `appservices` / `findPoints` / postal-code group at `dpdservices.dpd.com.pl`, reusing the same Basic auth + `DpdHttpClient`), or a **separate** DPD Pickup finder service (different base URL / auth → would need a second small client)? Confirm method (GET-with-query vs POST-body), request fields (city / postcode / street / limit), and response fields (point id, name, address, lat/lon, type=shop|locker, opening hours). **Resolve via the live Swagger (chrome-devtools-mcp, as in #962).**
- **OQ-2:** the ship-to-point wire shape — does the point id ride on `SinglePackage.pudoReceiver` (e.g. `{ pudoId, name?, phone?, email? }`), as a `DPD_PICKUP` `TransportService` attribute, or both? Confirm against `generatePackagesNumbers` in the Swagger.
- **OQ-3:** does a pickup shipment still require `receiver` contact (for SMS/notification) alongside `pudoReceiver`? InPost sends a receiver peer without an address for lockers — DPD likely similar.

**Design guard:** the entire DPD-point wire shape lives in `dpd-rest.types.ts` + a new `dpd-pickup.mapper.ts` (or an extension of `dpd-shipment.mapper.ts`). Confirming OQ-1/OQ-2 later touches only those files + (if OQ-1 = separate service) the factory's client wiring. Unit tests run against canned fixtures of the expected shape; the **live point-search + ship-to-point round-trip is a pre-merge manual AC** (needs the #962 test-server creds).

---

## 5. Questions & Assumptions

### Assumptions (confirm in Phase 0 spike)
- The point directory is reachable via the same `DPDServices` host + Basic auth → reuse `DpdHttpClient` (add a `query?` option for a GET search, mirroring InPost). If OQ-1 shows a separate service, add a small `DpdPointDirectoryClient` behind the same factory.
- `cmd.paczkomatId` = the DPD point id (e.g. `PL11033`); `cmd.parcel.weightGrams` required (DPD parcels always carry weight; no locker-size `template` like InPost).
- A pickup shipment sends `pudoReceiver` (point id + buyer contact) and **omits** the courier street `receiver.address`.

---

## 6. Proposed Implementation Plan

### Phase 0 — Spike (confirm OQ-1/OQ-2 against the live Swagger; needs #962 creds for the live call)
1. Via chrome-devtools-mcp on `dpdservices.dpd.com.pl` Swagger (the #962 path): confirm (a) the point-search endpoint path/method/auth/fields, (b) the `pudoReceiver` / `DPD_PICKUP` shape on `generatePackagesNumbers`. Capture canned request/response fixtures. Spike code NOT merged. (If creds are still gated, build Phases 1–3 against the documented/expected shape and leave the live finder + ship-to-point round-trip as the pre-merge AC.)

### Phase 1 — CORE: dedicated `'pickup'` method (additive)
2. `libs/core/src/shipping/domain/types/shipping-method.types.ts`: add `'pickup'` to `ShippingMethodValues` and `SHIPPING_METHOD` (+ JSDoc: parcel-shop/PUDO point delivery, distinct from `paczkomat` locker). Update the file's "two flavours" note to list `pickup` alongside `paczkomat`/`kurier`.
   - **Acceptance**: type-check green repo-wide (no exhaustive switch breaks); `@IsEnum` DTOs accept `'pickup'`; InPost/Allegro adapters unaffected (they don't advertise it).

### Phase 2 — DPD types
3. `domain/types/dpd-rest.types.ts`: add `DpdPudoReceiver` (point id + optional contact), `pudoReceiver?` on `DpdSinglePackage`, `DPD_SERVICE_CODE_DPD_PICKUP = 'DPD_PICKUP'`, and point-search request/response interfaces (`DpdPointSearchRequest`/`Query`, `DpdPoint`, `DpdPointSearchResponse`).
   - **Acceptance**: type-check green; existing #962 types unchanged.

### Phase 3 — Mapper (pickup branch + point mapping)
4. `infrastructure/mappers/dpd-shipment.mapper.ts`: split `buildCreatePackagesRequest` into method branches — keep the courier branch (#962), add a **pickup branch** for `shippingMethod === 'pickup'`: require `cmd.paczkomatId` (the point id; else `preflight.missing-paczkomat-id`) + `weightGrams`; build `pudoReceiver` from the point id + `cmd.recipient` contact; add the `DPD_PICKUP` service; COD still allowed (attach as #962). Throw `preflight.unsupported-method` for anything other than `kurier`/`pickup`.
5. Point mapping helpers: `buildPointSearchRequest(query: FindPickupPointsQuery)` and `toPickupPoint(dpdPoint): PickupPoint` (map id/name/address/lat/lon/status).
   - **Acceptance**: mapper unit tests — pickup-branch body (pudoReceiver + DPD_PICKUP), missing-point-id throw, COD-on-pickup, point query/response mapping.

### Phase 4 — Adapter + fake
6. `infrastructure/adapters/dpd-shipping.adapter.ts`: `implements … , PickupPointFinder`; add `findPickupPoints(query)` → `client.request` (GET-with-query or POST per OQ-1, `idempotent: true`) → `toPickupPoint[]`; `getSupportedMethods()` → `['kurier', 'pickup']`. `generateLabel` already routes through the mapper (now method-aware).
7. `testing/fake-dpd-shipping.adapter.ts`: `implements PickupPointFinder`; `findPickupPoints` returns seeded points; `generateLabel` validates the pickup branch (missing point id → rejection); add `seedPickupPoints`.
   - **Acceptance**: adapter unit tests — `findPickupPoints` happy path + capability presence (`isPickupPointFinder(adapter) === true`), `'pickup'`-method `generateLabel`, `getSupportedMethods` = `['kurier','pickup']`; fake spec updated.

### Phase 5 — HTTP client (only if OQ-1 needs it)
8. If the point search is a GET with query params, add a `query?: Record<string, string|number|undefined>` option to `DpdRequestOptions` + build it in `dpd-http-client.ts` (mirror InPost's `buildUrl`). If it's a separate service (OQ-1), add `DpdPointDirectoryClient` + wire it in `dpd-adapter.factory.ts`.
   - **Acceptance**: http-client unit test for query serialization (if added).

### Config / Migrations / Events
- None. No env vars, no migration, no events.

---

## 7. Alternatives Considered
- **Reuse `paczkomat` as the generic pickup method** — rejected (maintainer decision). `paczkomat` is InPost-locker terminology; conflating DPD parcel-shops onto it muddies the vocabulary. A dedicated `'pickup'` value is clean because the `text` column needs no migration, `@IsEnum` DTOs auto-accept it, and no exhaustive `never`-switch exists — so the only cost is one additive core line + the FE mirror update (deferred to #966).
- **Carrier-prefixed value (`'dpd_pickup'`)** — rejected; `ShippingMethod` values are carrier-neutral (`paczkomat`/`kurier`/`omp`). `'pickup'` lets future carriers' parcel-shop delivery reuse it.
- **Auto-deriving `paczkomatId` from the order snapshot in core dispatch** — rejected; the operator-supplied seam (caller-owns-payload, #962/#769) is intentional and already carries the point id. No core change.
- **Building Allegro/PS pickup-point read in this issue** — unnecessary; Allegro already reads it carrier-blind (#458). PS doesn't expose it (separate future issue).

---

## 8. Validation & Risks
- **OQ-1 (point-directory endpoint)** is the highest-uncertainty item — mitigated by isolating the wire shape (types + mapper) and the spike. Worst case (separate service) adds one small client behind the factory, not a redesign.
- **R1 — `'pickup'` not operator-reachable until #966 (confirmed safe)**: the FE keeps a *standalone* `SHIPPING_METHOD_VALUES` + `SHIPPING_METHOD_LABEL: Record<ShippingMethod,string>` mirror (`apps/web/src/features/shipments/api/shipments.types.ts`), NOT imported from core — so adding `'pickup'` to the core union does **not** break `apps/web` type-check, and no BE↔FE parity test exists. **#966 owns** widening the FE mirror + label + offering `'pickup'` in the generate-label form. Until then DPD pickup is backend-capable but FE-dormant; no `'pickup'` shipment can reach the `/shipments` label map, so the missing FE label is harmless (hand-off note for #966).
- **R2 — point id rides `paczkomatId`**: the dedicated method is `'pickup'` but the point id reuses the generic `cmd.paczkomatId` field (renaming it is out of scope). Slight name/field mismatch, documented.
- **R3 — pickup still needs weight/dims**: DPD parcels carry weight regardless of pickup vs courier; the pickup branch requires `weightGrams` (unlike InPost lockers which use a size `template`).
- **Live round-trip** (finder + ship-to-point) gated on #962 test-server creds → pre-merge manual AC, not a build/unit blocker.
- Backward compatible — additive to the #962 adapter; courier + COD paths unchanged.

---

## 9. Testing Strategy & Acceptance Criteria

### Unit Tests (extend the #962 suites)
- `dpd-shipment.mapper.spec.ts` — pickup branch (pudoReceiver + DPD_PICKUP), missing-point-id throw, COD-on-pickup, point query + response mapping.
- `dpd-shipping.adapter.spec.ts` — `findPickupPoints` happy path, `isPickupPointFinder` true, `'pickup'` `generateLabel`, `getSupportedMethods` = `['kurier','pickup']`.
- `fake-dpd-shipping.adapter.spec.ts` — `findPickupPoints` seeded, pickup validation.

### Acceptance Criteria (#963)
- [ ] `'pickup'` added to core `ShippingMethodValues`; repo type-check green.
- [ ] `DpdShippingAdapter` implements `PickupPointFinder`; `GET /pickup-points?connectionId=<dpd>` returns DPD points (unit-proven; live in the AC below).
- [ ] A label with `shippingMethod='pickup'` + `paczkomatId=<point>` builds a `pudoReceiver` + `DPD_PICKUP` request (unit-proven).
- [ ] A DPD point id (`PL11033`) passes through `paczkomatId` → pickup mapping unchanged (carrier-agnostic plumbing; mapper/adapter test). Operator selection of `'pickup'` in the FE = #966.
- [ ] `pnpm lint` / `type-check` / unit tests green; `check-create-adapter` + jest-integration invariants satisfied.
- [ ] **Manual (pre-merge):** live DPD point search + a real label shipped to a DPD Pickup point (needs #962 test-server creds + OQ-1/OQ-2 confirmation).

---

## 10. Alignment Checklist
- [x] Hexagonal — integration implements an existing core sub-capability; one additive core enum value
- [x] CORE vs Integration boundary respected (dispatch plumbing already carrier-agnostic; the `'pickup'` value is a neutral core vocabulary addition)
- [x] Reuses existing patterns (InPost pickup slice, #962 DPD stack, `PickupPointFinder` guard)
- [x] Idempotency — `findPickupPoints` is an idempotent read; ship-to-point inherits #962's create guard
- [x] Error handling — `ShippingProviderRejectionException` (`preflight.*`) + #962 HTTP mapping
- [x] Testing strategy complete (3 unit suites extended)
- [x] Naming + file structure per standards (mirrors #962 / InPost)
- [x] Execution-ready (OQ-1/OQ-2 + live round-trip scoped to the spike / pre-merge AC)

---

## Related Documentation
- Spec: [`product-spec-961-dpd-polska-shipping.md`](../specs/product-spec-961-dpd-polska-shipping.md)
- #962 plan: [`implementation-plan-962-dpd-adapter-rest.md`](./implementation-plan-962-dpd-adapter-rest.md) · ADR-018
- Reference: `libs/integrations/inpost/` (pickup slice), `libs/integrations/dpd-polska/` (#962)

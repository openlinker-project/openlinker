# Implementation Plan: DPD Polska frontend plugin (#966)

**Date**: 2026-06-05
**Status**: Draft — pending Gate (Phase 3 review); one scope fork (COD amount) to settle
**Issue**: #966 (Part of #961)
**Spec**: [`docs/specs/product-spec-961-dpd-polska-shipping.md`](../specs/product-spec-961-dpd-polska-shipping.md) §US-1/2/5/9
**Builds on**: #962 (DPD adapter, merged), #963 (DPD Pickup, merged), #964 (bulk + protocol, merged)
**Branch**: `966-dpd-fe-plugin`
**Estimated Effort**: M (~3–6 days)

> **Mockups first.** Per the work request, after this plan is signed off the next step is
> `/frontend-design:frontend-design` to produce visual mockups of the five surfaces in §6
> **before** implementation (Phase 4).

---

## 1. Task Summary

**Objective**: Ship the operator-facing frontend for DPD Polska — the **first carrier (shipping-only) FE plugin** — so an operator can (a) configure a DPD connection from the UI, (b) see COD + DPD-Pickup affordances on the order/shipment surfaces, and (c) never see DPD terminology in a deployment with no DPD connection.

**Classification**: **Frontend** (`apps/web`) + one **thin Interface-layer touch** (`apps/api` shipping DTO — see §3 fork) + a small shared **shipping-method enum** addition. No core changes, no migration.

**Context**: The DPD backend trilogy is merged — manifest `platformType:'dpd'`, `adapterKey:'dpd.polska.rest.v1'`, `supportedCapabilities:['ShippingProviderManager']`; config = `{ environment, payerFid, masterFid?, senderAddress }`; credentials = `{ login, password }`; COD currencies `PLN|EUR|RON|CZK`. The FE plugin contract is platform-agnostic (PrestaShop is the non-OAuth precedent), so **no contract change is required** — DPD slots into the existing `OpenLinkerPlugin` model.

---

## 2. Scope & Non-Goals

### In Scope (Frontend)
1. **DPD plugin** `apps/web/src/plugins/dpd/` — `definePlugin({ id:'dpd', platformType:'dpd', build:{routes:[dpdSetupRoute]}, platform:{ displayName, setupCard, StructuredConfigSection, CredentialsPanel } })`; registered in `apps/web/src/plugins/index.ts` (`plugins` array — the single edit point).
2. **DPD setup route + create form** `/connections/new/dpd` (mirrors `apps/web/src/plugins/prestashop/prestashop-setup.route.tsx`).
3. **Create wizard (full structured config)** — `DpdSetupForm` (own zod schema, mirrors `PrestashopSetupForm`): `environment` (sandbox|production select), `payerFid` (numeric), `masterFid?` (numeric), `senderAddress` (company?, name?, address, city, postalCode `NN-NNN`, countryCode `AA`, phone?, email?). Client-side validation mirrors the BE validator (`dpd-connection-config.dto.ts`); server stays authoritative. **No order-trigger model** — DPD is outbound-only (no `OrderSource`), so its backend config carries none.
   - **Scope note (decided):** structured *editing* of DPD config is **deferred** — wiring DPD's nested top-level config into the shared `editConnectionSchema` / `mergeStructuredIntoConfig` is an invasive change to shared connection-edit infra disproportionate to #966. The plugin contributes **no `StructuredConfigSection`**, so editing a DPD connection's config uses the existing generic **raw-JSON** block. Create is fully structured; credentials rotate is structured (below).
4. **`CredentialsPanel`** — DPD `{ login, password }` capture + rotate (mirror `prestashop-credentials-panel.tsx`, extended to two fields).
5. **Shipping-method enum**: add `'pickup'` to the FE `SHIPPING_METHOD_VALUES` + `SHIPPING_METHOD_LABEL` (`apps/web/src/features/shipments/api/shipments.types.ts`) — **currently missing** (`['paczkomat','kurier','omp']`), so DPD pickup shipments render a raw enum today. Update the `/shipments` Method column + `GenerateLabelForm` pickup-row condition in lockstep.
6. **`GenerateLabelForm` DPD pickup + COD**: render the pickup-point input for `shippingMethod==='pickup'` (operator-typed id, mirrors the existing InPost paczkomat input — the picker **modal is deferred to #883**, not built here); add an **optional COD amount + currency** input (currency limited to `PLN|EUR|RON|CZK`) that flows to dispatch.
7. **Shipment panel COD indicator**: surface that an order is COD via the existing `paymentStatus==='cod'` signal (already rendered as a "Cash on delivery" badge in `OrderDetailHeader`); add a COD row/indicator on `OrderShipmentPanel`.
8. **Capability-gated terminology**: all DPD terms resolve through `usePlatform('dpd').displayName` and capability checks — **no literal `platformType==='dpd'`** outside `plugins/dpd/` (ESLint-enforced). `pickupPointResolvesAsync` is **omitted** for DPD (pickup is operator-selected → caption reads "operator-selected" with zero special logic).
9. **Tests**: DPD plugin smoke test (identity/build/platform slots), StructuredConfigSection + CredentialsPanel component tests, GenerateLabelForm COD/pickup interaction test, shipment-panel COD/terminology gate test. Mirror `apps/web/src/plugins/allegro/allegro.test.ts` + `order-shipment-panel.test.tsx`.

### Thin backend touch (Interface layer only — see §3 fork)
- Add optional `cod: { amount: string; currency: string }` to `GenerateLabelDto` (`apps/api/src/shipping/http/dto/generate-label.dto.ts`) + map it in `ShipmentController.generateLabel` into `ShipmentDispatchInput.cod`. The core `ShipmentDispatchInput`/`GenerateLabelCommand` **already carry `cod`** and the DPD adapter already maps it — only the HTTP DTO + controller mapping are missing. No core/integration change.

### Out of Scope (Non-Goals)
- **Bulk dispatch UX** (multi-select on `/orders` → #964 bulk endpoints) — folded into a separate FE bulk issue; not here.
- **Pickup-point picker modal** (#883, deferred) — DPD pickup id stays a typed input, exactly like InPost today.
- **Backend adapter/transport** (#962) — done.
- **Persisting a COD amount on the order snapshot or shipment row** — see §3; the panel shows the COD *status*, not a persisted figure, unless the fork picks the backend path.
- **DPD tracking UI** — depends on #965 (tracking backend, not yet built).

### Constraints
- No core change, no migration. FE plugin contract unchanged (DPD reuses existing slots). One additive enum value (`'pickup'`) + one additive DTO field (`cod`).

---

## 3. Scope fork — COD "collection amount" (AC-2)

**AC-2 reads: "COD orders show the collection amount in the Shipment panel."** Research surfaced a contract gap:

- COD is **NOT on the order snapshot or the `Shipment` row**. It is **operator-supplied at dispatch time** (`GenerateLabelCommand.cod`, caller-owns-payload, #962) and **not persisted** anywhere queryable after dispatch (the `Shipment` entity has no `cod` field).
- The order snapshot carries `paymentStatus` which can be `'cod'` → already shown as a "Cash on delivery" badge. There is **no COD amount** anywhere in the FE view models.

So "show the collection amount" for an already-dispatched shipment **cannot be satisfied FE-only** — there's no amount to read. Two resolutions:

- **(A) FE-only, pragmatic [RECOMMENDED].** Surface COD *status* (the order is cash-on-delivery) on the Shipment panel via the existing `paymentStatus==='cod'` signal, and let the operator **enter the COD amount + currency at dispatch** in `GenerateLabelForm` (flows to the new `GenerateLabelDto.cod`). The panel shows "COD — collect on delivery" (no historical figure). Keeps #966 a frontend slice + one thin DTO field. The persisted-amount display becomes a documented deferred follow-up.
- **(B) Backend-persisted amount.** Add a COD amount to the order snapshot and/or the `Shipment` row (migration + core/adapter change) so the panel can render the exact figure. This is a backend issue in its own right — out of the "FE" scope #966 declares, and it reopens core/migration work the trilogy deliberately kept out.

**Recommendation: (A)** — ship the FE slice now; file a small backend follow-up for persisted-COD-amount display if operators ask for the figure post-dispatch. The §6 mockups will show the (A) treatment (status indicator + dispatch-time amount input).

> **DECIDED (2026-06-05): (A).** COD is surfaced as *status* on the panel (from `paymentStatus==='cod'`) + an operator-entered amount/currency at dispatch (`GenerateLabelDto.cod`). Persisted-figure display is a deferred backend follow-up. OQ-2 also resolved: the thin `GenerateLabelDto.cod` addition is **in scope** for #966.

---

## 4. Internal patterns to mirror (exact references)

- **Plugin shape**: `apps/web/src/plugins/prestashop/index.ts` (`definePlugin` for a non-OAuth, config-heavy platform) + `apps/web/src/plugins/index.ts` (registry).
- **Setup route**: `apps/web/src/plugins/prestashop/prestashop-setup.route.tsx`.
- **StructuredConfigSection**: `apps/web/src/plugins/prestashop/components/prestashop-structured-section.tsx` (props `{ connection, form, configIsParseable, syncStructuredToJson }`; `syncStructuredToJson(field,value)` keeps raw JSON in sync).
- **CredentialsPanel**: `apps/web/src/plugins/prestashop/components/prestashop-credentials-panel.tsx` (rotate pattern + `useUpdateConnectionCredentialsMutation`; `connection.credentialsBacked` fallback).
- **Form host**: `apps/web/src/features/connections/components/EditConnectionForm.tsx` (slots StructuredConfigSection/CredentialsPanel via `usePlatform`); `create-connection-form.tsx`; schema `edit-connection.schema.ts` (`EditConnectionFormValues`).
- **Capability-gated terminology**: `order-shipment-panel.tsx` (capability gate on `'ShippingProviderManager'`; paczkomat caption via `pickupPointResolvesAsync`); `order-delivery-panel.tsx`; `usePlatform` (`shared/plugins/use-platform.ts`).
- **Shipping-method labels**: `apps/web/src/features/shipments/api/shipments.types.ts` (`SHIPPING_METHOD_VALUES` / `SHIPPING_METHOD_LABEL` `Record<…>` — compiler enforces a label per value).
- **GenerateLabelForm**: `apps/web/src/features/orders/components/generate-label-form.tsx` (paczkomat input lines ~407–425; snapshot pre-fill `snapshot.pickupPoint?.id`).
- **Tests**: `apps/web/src/plugins/allegro/allegro.test.ts` (plugin smoke); `order-shipment-panel.test.tsx` + `apps/web/src/test/test-utils.tsx` `renderWithProviders({ plugins, apiClient })` (override the plugin registry + mock API).

---

## 5. Backend contract the FE binds to (from #962/#963)

| Thing | Value |
|---|---|
| platformType (gate key) | `'dpd'` |
| adapterKey | `'dpd.polska.rest.v1'` |
| supportedCapabilities | `['ShippingProviderManager']` |
| config (non-secret, in `connection.config`) | `environment: 'sandbox'\|'production'`, `payerFid: /^\d+$/`, `masterFid?: /^\d+$/`, `senderAddress: { company?, name?, address, city, postalCode /^\d{2}-\d{3}$/, countryCode /^[A-Z]{2}$/, phone?, email? }` |
| credentials | `{ login: string, password: string }` (both required) |
| COD currencies | `PLN \| EUR \| RON \| CZK` |
| DPD shipping methods | `'kurier'` (courier), `'pickup'` (parcel-shop) |
| Connection response DTO | returns `platformType`, `supportedCapabilities`, `enabledCapabilities`, `config`, `credentialsBacked`, `adapterKey` |
| Create connection | `POST /connections` `{ name, platformType:'dpd', config, credentials:{login,password} }` |
| Test connection | `POST /connections/:id/test` → `{ success, status?, message, latencyMs }` |
| Dispatch | `POST /shipments/generate-label` (gains optional `cod` — §3) |

---

## 6. Surfaces to mock (`/frontend-design` — do these BEFORE Phase 4)

1. **DPD setup card** on `/connections/new` (alongside PrestaShop/Allegro) — `setupCard` with badge "DPDServices REST".
2. **DPD create-connection form** (`/connections/new/dpd`) — credentials (login, password) + config (environment select, payerFid, masterFid, sender-address block) + "Test connection" affordance.
3. **DPD connection edit** — `StructuredConfigSection` (config) + `CredentialsPanel` (rotate login/password).
4. **`GenerateLabelForm` for a DPD order** — `kurier` vs `pickup` method, DPD Pickup point id input (operator-typed), optional COD amount + currency.
5. **`OrderShipmentPanel` for a DPD COD + pickup shipment** — COD indicator (status, per §3-A), DPD Pickup row ("operator-selected"), DPD `displayName` terminology.

Mockups follow `docs/frontend-ui-style-guide.md` (cockpit density, tokens, IBM Plex, `StatusBadge`/`KeyValueList`/`FormField` primitives) — no new styled libraries.

---

## 7. Step-by-step plan

### Phase A — Shared enum + DTO seam
1. `features/shipments/api/shipments.types.ts`: add `'pickup'` to `SHIPPING_METHOD_VALUES`; add `pickup: 'Pickup point'` to `SHIPPING_METHOD_LABEL`. **AC**: type-check forces the label; `/shipments` Method column + filter render "Pickup point" not a raw enum.
2. `apps/api/src/shipping/http/dto/generate-label.dto.ts`: add optional nested `ShipmentCodDto { amount:string; currency:string }` (`@IsString @IsNotEmpty`); map it in `ShipmentController.generateLabel` → `input.cod`. **AC**: controller unit test — COD passes through; absent COD unchanged. (Mirrors how `recipient`/`parcel` are mapped.)

### Phase B — DPD plugin skeleton
3. `apps/web/src/plugins/dpd/index.ts`: `definePlugin({ id:'dpd', platformType:'dpd', build:{routes:[dpdSetupRoute]}, platform:{ displayName:'DPD Polska', setupCard, StructuredConfigSection, CredentialsPanel } })`.
4. `apps/web/src/plugins/index.ts`: append `dpdPlugin` to `plugins` (the single edit point). **AC**: boot invariants pass (unique id + platformType); `usePlatform('dpd')` resolves.
5. `apps/web/src/plugins/dpd/dpd-setup.route.tsx` + setup page (mirror PrestaShop). **AC**: `/connections/new/dpd` renders; `route-lazy`/`route-handle` contract tests updated if needed.

### Phase C — Config + credentials UI
6. `plugins/dpd/components/dpd-structured-section.tsx`: environment select + payerFid + masterFid + sender-address fields; client-side mirrors of the BE regex (`NN-NNN`, `AA`, numeric fids); `syncStructuredToJson` per field. **AC**: invalid postcode/country/fid show inline errors; valid config serialises into `config` JSON matching `DpdConnectionConfig`.
7. `plugins/dpd/components/dpd-credentials-panel.tsx`: login + password capture/rotate via `useUpdateConnectionCredentialsMutation` (`credentials:{login,password}`); `credentialsBacked` fallback. **AC**: rotate submits both keys; read-only when not db-backed.
8. Extend `edit-connection.schema.ts` / create-form wiring only as needed for the DPD config fields (reuse existing `configText` + structured-sync; add DPD fields to `EditConnectionFormValues` if the structured section needs typed fields). **AC**: edit round-trips DPD config without touching PrestaShop/Allegro paths.

### Phase D — Dispatch + panel affordances
9. `generate-label-form.tsx`: render pickup-point input when `shippingMethod==='pickup'` (operator-typed, pre-fill `snapshot.pickupPoint?.id`); add optional COD amount + currency (`PLN|EUR|RON|CZK` select) → request `cod`. **AC**: COD fields appear, submit into `generate-label` payload; pickup id required for `pickup`.
10. `order-shipment-panel.tsx`: add a COD indicator derived from the order's `paymentStatus==='cod'` (§3-A); DPD Pickup row reuses the paczkomat-row pattern (caption "operator-selected" via omitted `pickupPointResolvesAsync`). **AC**: COD order shows the indicator; non-COD shows nothing; DPD terms use `displayName`.

### Phase E — Tests
11. `plugins/dpd/dpd.test.ts` (identity/build/platform slots); `dpd-structured-section.test.tsx`; `dpd-credentials-panel.test.tsx`; `generate-label-form.test.tsx` COD+pickup cases; `order-shipment-panel.test.tsx` COD/terminology-gate cases. **AC**: `pnpm --filter @openlinker/web test` green; trait-driven assertions (no `platformType===` in tests).

### Config / Migrations / Events
- None. One additive FE enum value + one additive API DTO field; no schema change.

---

## 8. Questions & Assumptions

### Open Questions
- **OQ-1 (THE fork, §3)**: COD amount display — FE-only status + dispatch-time input (A, recommended) vs. backend-persisted figure (B, out of scope). **Decide at the Phase-3 gate.**
- **OQ-2**: Is the thin `GenerateLabelDto.cod` addition acceptable inside this "FE" issue, or split to a 1-file backend issue? (Recommend: include — it's the exact contract the COD input needs; core already supports it.)
- **OQ-3**: Should COD amount entry appear for **every** carrier's dispatch form, or only when the order is `paymentStatus==='cod'`? (Recommend: show when COD, allow override; COD-incapable adapters ignore it server-side.)

### Assumptions
- DPD pickup id is operator-typed (no picker modal — #883 deferred); reuse the InPost paczkomat input pattern.
- `senderAddress` is operator-entered config (not per-shipment) — matches the BE `DpdConnectionConfig`.
- "Zero DPD terminology without a DPD connection" (AC-4) is satisfied by the plugin model: DPD config UI only renders inside a DPD connection form; DPD shipment terms only render for DPD-routed shipments; the setup card on `/connections/new` is generic discovery, not terminology.

---

## 9. Validation & Risks
- **Plugin contract fit**: DPD is the first carrier plugin — confirm a shipping-only platform needs none of the marketplace slots (it doesn't; all slots are optional). Risk: low.
- **ESLint platform-dispatch ban**: all gating via `usePlatform`/capabilities; no `platformType==='dpd'` outside `plugins/dpd/`. Covered by `no-restricted-syntax`.
- **`.nullish()` discipline**: any new snapshot/view fields read in the panel use `.nullish()` (OL serialises absent optionals as JSON null) — reference `order-snapshot.schema.ts`.
- **COD scope (§3)**: the one place AC vs. backend reality diverges — resolved at the gate; mockups reflect the chosen path.
- **Flaky FE suite**: `apps/web` Vitest flakes under full-suite parallelism — run new specs in isolation to confirm, never `--no-verify` (see `docs/lessons.md` / memory).

## 10. Alignment Checklist
- [x] FE dependency direction (`app`→`pages`→`features`→`shared`); plugin in `plugins/`, gating via `shared/plugins` hooks
- [x] Reuses existing plugin contract (no new slots) + PrestaShop precedent
- [x] Capability/trait-gated terminology (no literal platformType dispatch)
- [x] One additive enum value + one additive DTO field; no core change, no migration
- [x] Tests mirror existing plugin + consumer-component patterns
- [x] Mockups (`/frontend-design`) precede implementation
- [x] COD scope fork (§3) signed off — **(A)** chosen
- [x] Execution-ready after mockups — **implemented**

## 11. Known follow-ups (documented, out of #966)

- **Operator-driven DPD *pickup dispatch* — tracked as [#979](https://github.com/openlinker-project/openlinker/issues/979).**
  `GenerateLabelForm` auto-derives the shipping method (`'paczkomat'|'kurier'`)
  from the order's source delivery method via an InPost-centric heuristic
  (flagged in-code at #952/#954) — it does **not** emit DPD `'pickup'`, because
  the resolved carrier is only known server-side at dispatch. #966 lands the
  `'pickup'` enum, the panel pickup-row labeling, and COD; DPD **courier**
  dispatch works, but DPD **pickup** dispatch 502s at the adapter
  (`preflight.unsupported-method`) until #979 adds carrier-aware method selection.
- **Structured config *editing*** of a DPD connection (raw-JSON fallback ships now) — §2.
- **Persisted COD amount** display on the shipment panel (status-only ships now) — §3.
- **Pickup-point picker modal** — #883 (typed input ships now).

## Related
- Spec: [`product-spec-961-dpd-polska-shipping.md`](../specs/product-spec-961-dpd-polska-shipping.md) · #962/#963/#964 plans · ADR-018/ADR-019
- Reference: `apps/web/src/plugins/{prestashop,allegro}/`, `apps/web/src/features/{connections,orders,shipments}/`, `libs/integrations/dpd-polska/`

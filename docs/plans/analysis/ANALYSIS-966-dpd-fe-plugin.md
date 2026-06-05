# Pre-implement gate: #966 DPD Polska frontend plugin

**Plan**: [`../implementation-plan-966-dpd-fe-plugin.md`](../implementation-plan-966-dpd-fe-plugin.md)
**Date**: 2026-06-05
**Verdict**: ✅ **READY**

Purely additive FE work — a new plugin reusing the existing `OpenLinkerPlugin` contract (no slot changes), plus one additive API DTO field and one additive shipping-method enum value. No Critical contract-surface breaks. Two **mechanical Warnings** the implementation must handle in lockstep (route-count contract bump; enum-mirror label), and two design notes.

---

## Reuse findings

| Plan artifact | Verdict | Evidence |
|---|---|---|
| `apps/web/src/plugins/dpd/` plugin (`definePlugin id/platformType 'dpd'`) | **NEW (absent)** | `apps/web/src/plugins/` holds only `allegro/` + `prestashop/` |
| Register in `plugins` array | **EXISTS → append** | `apps/web/src/plugins/index.ts:47` `[prestashopPlugin, allegroPlugin]` — single edit point |
| Plugin slots (`setupCard`, `StructuredConfigSection`, `CredentialsPanel`, `getCallbackUrlDefault`) | **EXISTS → reuse** | `shared/plugins/plugin.types.ts` `PlatformContribution`; all optional — a shipping-only platform needs no marketplace slots |
| `usePlatform` / `usePlatforms` gating | **EXISTS → reuse** | `shared/plugins/use-platform.ts`, `use-platforms.ts` |
| DPD setup route `/connections/new/dpd` | **NEW** — mirror `prestashopSetupRoute` | `apps/web/src/plugins/prestashop/prestashop-setup.route.tsx` (`path:'connections/new/prestashop'` + `handle.crumb` + lazy page import) |
| `StructuredConfigSection` / `CredentialsPanel` components | **NEW** — mirror PS | `plugins/prestashop/components/{prestashop-structured-section,prestashop-credentials-panel}.tsx` |
| `EditConnectionFormValues` schema fields for DPD config | **PARTIAL → extend (additive optional)** | `features/connections/.../edit-connection.schema.ts`; PS already adds optional `baseUrl/shopId/...` — DPD adds optional `environment/payerFid/masterFid/sender*` the same way |
| FE `'pickup'` shipping method | **PARTIAL → extend** | `features/shipments/api/shipments.types.ts:49` `['paczkomat','kurier','omp']` — `'pickup'` absent (see W-2) |
| `GenerateLabelDto.cod` | **NEW (absent)** | `apps/api/src/shipping/http/dto/generate-label.dto.ts` has `recipient/parcel/paczkomatId`, **no `cod`** |
| Core `GenerateLabelCommand.cod` (the DTO maps into) | **EXISTS → reuse** | `libs/core/src/shipping/domain/types/generate-label.types.ts:61` `cod?: ShipmentCod`; `ShipmentDispatchInput` keeps it via `Omit<…>` |
| COD currency list `PLN/EUR/RON/CZK` (FE select) | **EXISTS (BE)** — mirror as plugin-local const | `libs/integrations/dpd-polska/.../dpd-rest.types.ts` `DpdCodCurrencyValues` |
| Shipment-panel COD-status indicator (decision A) | **NEW** — derive from `paymentStatus==='cod'` | `order-snapshot.schema.ts` parses `paymentStatus`; `OrderDetailHeader` already renders the "Cash on delivery" badge |
| `GenerateLabelForm` pickup input | **EXISTS → extend** (no picker — #883 deferred) | `features/orders/components/generate-label-form.tsx` paczkomat input pattern |

## Backward-compat findings

No **Critical** items — nothing exported is removed/renamed; no port signature, response-DTO field, Symbol token, or ORM schema changes; no migration.

**Warnings (mechanical — must be done in the same PR):**

- **W-1 (route contract tests).** Adding the lazy `/connections/new/dpd` route trips two guards:
  - `apps/web/src/app/routes/route-lazy.test.ts:64` `EXPECTED_LAZY_ROUTE_COUNT = 38` → bump to **39**.
  - `apps/web/src/app/routes/route-handle.test.ts` asserts every authenticated leaf route declares `handle.crumb`. The DPD setup route **must** carry `handle: { crumb: { group:'Platform', title:'Connect DPD Polska' } }` (the PS mirror does). Both are mechanical; the PS route is the exact template.

- **W-2 (FE enum is a documented mirror that has drifted).** `shipments.types.ts:34` comments the FE `SHIPPING_METHOD_VALUES` as "FE mirror of the BE `ShippingMethodValues`" — but the BE added `'pickup'` in #963 and the FE mirror was **not** updated. Adding `'pickup'` is required and is compiler-safe: `SHIPPING_METHOD_LABEL` is `Record<ShippingMethod,string>` (not `Partial`), so omitting the `pickup` label fails type-check. Verified there is exactly **one** exhaustive consumer (`SHIPPING_METHOD_LABEL`); `shipments-page.tsx` column + filter iterate the values array and auto-pick up the new entry. → add `'pickup'` to the array **and** `pickup: '…'` to the label record in lockstep.

## Open questions (non-blocking — resolve during implementation)

- **OQ-A (nested sender address).** PS's `StructuredConfigSection` flattens its config fields onto the form; DPD's `senderAddress` is a **nested** object. Decide whether the DPD structured section flattens (`senderAddress.address` → flat form fields synced into `config.senderAddress`) or syncs the whole nested object into the config JSON. Design detail, not a contract break — the `syncStructuredToJson` helper handles arbitrary paths.
- **OQ-B (is the shipment-list response runtime-validated against the enum?).** If `/shipments` zod-parses `shippingMethod` against `SHIPPING_METHOD_VALUES`, a DPD `pickup` shipment currently **hard-fails** the parse (latent bug); if it's a plain TS cast, it renders a blank Method cell (`SHIPPING_METHOD_LABEL['pickup']` undefined). Either way W-2's enum addition fixes it — worth confirming so the PR description states whether it's a latent-bug fix or cosmetic.

## Net

Additive across the board: **1 new FE plugin (+route, +2 components, +setup page) + 1 enum value + 1 API DTO field + 1 controller mapping line + panel/form affordances + tests.** No core change, no migration, no contract removal. Handle W-1 + W-2 in the same PR (both compiler/contract-test-enforced, so CI catches a miss). Proceed to implementation.

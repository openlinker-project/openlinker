# Implementation Plan — #839 Allegro Delivery shipment surface

**Issue:** #839 · **Layer:** Frontend (`apps/web`) · **Branch:** `839-allegro-delivery-shipment-surface`
**Effort:** S–M (1–2 days) · **Migration:** none

> Closes #732's FE surface for Allegro Delivery (branch-3 of the fulfillment-routing model). Extends — does **not** fork — the FE shipment trio that #769/#770/#881 shipped (Shipment panel, `/shipments` list, capability gate). Frontend-only PR.

## 1. Direction

The existing FE surface (#769 / #770 / #881) already covers most of the heavy lifting:

| AC | What's already done | What's missing |
|---|---|---|
| **AC-2** — async pending state | `GenerateLabelForm` `<fieldset disabled>` during mutation + `aria-live` "still processing" note at 5s | nothing |
| **AC-3** — pickup-point pre-fill + retry hint | `paczkomatId` pre-filled from `snapshot.pickupPoint?.id` | "pickup not yet available — retrying" hint when missing |
| **AC-6** — cancel + re-issue while `generated` | `ShipmentActionButtons` already gates cancel on `status='generated'` | branch-1 awareness — hide action row for `shippingMethod='omp'` |
| **AC-7** — cross-branch `/shipments` w/ processor column + filters + PS read-back | filter URL-state + capability gate already there | (a) widen `SHIPPING_METHOD_VALUES` with `'omp'` (drift from #882); (b) processor column; (c) processor filter |
| **AC-8** — no Allegro Delivery terminology w/o capability | global ShippingProviderManager gate already on the order panel | (a) capability-gate the Allegro Delivery subsection on connection settings |

## 2. The BLOCKING drift

**#882 added `'omp'` to `ShippingMethodValues` server-side** but the FE mirror in `apps/web/src/features/shipments/api/shipments.types.ts:35` still lists only `['paczkomat', 'kurier']`. The moment `OL_PRESTASHOP_FULFILLMENT_STATUS_SYNC_SCHEDULER_ENABLED=true` for any PS connection, the BE `/shipments` response starts returning `shippingMethod: 'omp'` and:

- The `/shipments` filter dropdown has no "omp" option (AC-7 fails);
- `(searchParams.get('shippingMethod') as ShippingMethod | null)` silently accepts `'omp'` from URL params while TS thinks it's `'paczkomat' | 'kurier'` — non-exhaustive `switch` problems waiting to happen;
- The Method-column cell renders `'omp'` as raw mono text — inconsistent with the operator-readable feel.

This is exactly the FE↔BE arity drift class that bit us in #886. Fix lands as commit 1/7.

## 3. Implementation order (one PR, seven focused commits)

1. **Widen `SHIPPING_METHOD_VALUES` with `'omp'` + add friendly labels** — `shipments.types.ts:35`. Add `SHIPPING_METHOD_LABEL: Record<ShippingMethod, string>` for column rendering (`'paczkomat' → 'Paczkomat'`, `'kurier' → 'Kurier'`, `'omp' → 'OMP-fulfilled'`).
2. **Processor derivation helper + column** — new `features/shipments/lib/derive-processor.ts` returning `'omp' | 'carrier' | 'pending'` from `(shippingMethod, providerShipmentId)`. New `features/shipments/components/processor-badge.tsx`. Wire as a column on `shipments-page.tsx`.
3. **Processor URL filter** — `?processor=omp|carrier` mapping to `shippingMethod=omp` / `hasProviderShipmentId=true` BE filters. Update `filters` object, `setFilter`, `clearFilters`, `filtersActive`. Add the chip to the toolbar.
4. **Branch-1 awareness in `ShipmentActionButtons`** — early-return `null` (or render "Fulfilled by destination" affordance) for `shippingMethod === 'omp'`. The existing matrix is shipping-method-blind today; this is the smallest correctness fix.
5. **AC-3 retry hint in `GenerateLabelForm`** — detect Allegro-source + no pickup-point + recent order (< 24h since `order.createdAt`); render `Alert` (tone `info`) above the disabled submit with a refetch button hitting `useOrderShipmentsQuery.refetch()` (and a fresh `useOrderQuery` refetch since the snapshot is on the order, not the shipment).
6. **Allegro Delivery subsection in `AllegroExtraSection`** — capability-gated on `connection.supportedCapabilities.includes('ShippingProviderManager')`. Informational only (poll cadence, async waybill resolution, no-config) — matches #771's "webhook/poll note" shape.
7. **Tests + quality gate** — extend the existing spec files (`shipments-page.test.tsx`, `order-shipment-panel.test.tsx`, `generate-label-form.test.tsx`, `allegro-extra-section.test.tsx`) for the new behaviour. Run `pnpm lint && pnpm type-check && pnpm test`.

## 4. Out of scope (deferred, per the issue body)

- **Manifest / courier-pickup UI** → PD #831 (Allegro Delivery v2 product-design).
- **The routing-config screen itself** (#836 — already merged).
- **Backend changes** — none. All BE filters needed (`hasProviderShipmentId`, `shippingMethod=omp`) already shipped via #882.

## 5. Risks

| Risk | Mitigation |
|---|---|
| **AC-3 retry detection** depends on `connectionsQuery.data` being populated to determine source platformType. | Wait for the query to settle before deciding "retrying" vs "missing"; degrade to a generic "pickup point missing" message during loading. |
| **Method-column friendly label** breaks if a new shipping method ships BE-side without the FE label map being widened. | `Record<ShippingMethod, string>` (not `Partial<>`) → TS compile error on the next add. |
| **Branch-2/3 disambiguation at row level** in the processor column. | v1 uses two-bucket ("OMP-fulfilled" vs. "Carrier"); three-bucket (branch-2 vs. branch-3) needs the order's source platformType, deferred. |

## 6. Quality gate

```
pnpm lint
pnpm type-check
pnpm test
```

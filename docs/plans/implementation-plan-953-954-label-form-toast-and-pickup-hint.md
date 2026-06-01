# Implementation Plan — Generate-Label toast + pickup-hint fixes (#953, #954)

## TL;DR

Two FE-only bug fixes in one file, `apps/web/src/features/orders/components/generate-label-form.tsx`:

- **#953** — the "Label generated" success toast fires unconditionally, even on the `omp_fulfilled` dispatch branch (no shipment, no label) — which is the *default* path for Allegro orders today. Branch the post-submit feedback on `result.kind`.
- **#954** — the "Pickup point not yet available" retry hint fires on courier orders that will never have a locker, because locker-vs-courier is inferred from `pickupPoint` presence (circular) rather than the delivery method. Gate the hint (and the `shippingMethod` inference) on the order's actual delivery method, with an interim heuristic where the method is absent.

**Classification:** Frontend / Interface (one feature component + its test). No backend, no migration, no API change.

## Scope decision — #954 without #952

#954 is "best done with #952" (which persists `shipping.methodId` into the snapshot). The user selected #953 + #954 **without** #952. Resolution, matching #954's own interim guidance:

- `orderShippingSchema` (`methodId`, `methodName`) **already exists** in `order-snapshot.schema.ts` and the parsed `snapshot.shipping` is already consumed in this file — it's simply `undefined` at runtime until #952 lands.
- So the fix keys on `snapshot.shipping` **when present** (authoritative), and falls back to a **full-street-address heuristic** when absent: a clear street address + no pickup point ⇒ courier ⇒ suppress the hint. This fixes the reported case (Allegro courier order, street-address ship-to, no pickup point) while **preserving** the #839 hint for likely-locker orders (no street address yet) — so we don't regress the feature #839/#893 added.
- When #952 lands, the method becomes authoritative and the heuristic is dead code that can be dropped. Noted as a follow-up.

## Research notes

- `DispatchResult.kind: 'dispatched' | 'omp_fulfilled'` — `apps/web/src/features/shipments/api/shipments.types.ts:151`. The mutation already returns it; the `dispatched` branch already guards the auto-download (line 196). Only the toast is unconditional.
- `showToast` tone is `AlertTone`; `'info'` is valid (and the default) — `shared/ui/toast-provider.tsx`.
- `snapshot.shipping` (`ParsedOrderShipping`: `methodId`, `methodName?`) and `snapshot.pickupPoint` are already parsed by `order-snapshot.schema.ts`. The test fixture in `generate-label-form.test.tsx` already supplies `shipping.methodId`.
- Existing hint gate: `!hasPickupPoint && sourcePlatform?.pickupPointResolvesAsync === true && isWithinPickupPointRetryWindow(order.createdAt)` (lines 119-122).

## Design & steps

### Step 1 — #953: branch post-submit feedback on `result.kind`
`generate-label-form.tsx` `onSubmit` (~L181-204):
- `result.kind === 'dispatched'` → keep the current success toast ("Label generated / tracking in ~5 min") + the existing auto-download guard. Unchanged.
- `result.kind === 'omp_fulfilled'` → show a neutral `tone: 'info'` toast: title e.g. "Fulfilled by destination store", description "This order is fulfilled by the destination store — no OpenLinker label is issued." No download.
- `form.reset()` + `onSuccess()` still run in both branches (the inline form collapses either way).
- **AC**: omp_fulfilled shows no "Label generated" toast; dispatched unchanged.

### Step 2 — #954: locker-method classifier + hint/`shippingMethod` gating
- Add a pure helper `classifyDeliveryMethod(shipping: ParsedOrderShipping | undefined): 'locker' | 'courier' | 'unknown'` — keyword match on `methodName`/`methodId` (`paczkomat | locker | automat | punkt | pickup | one box | one punkt`) ⇒ `locker`; any other present method ⇒ `courier`; absent ⇒ `unknown`. Heuristic, documented, with a TODO to replace with a platform-provided classification post-#952.
- Compute `hasFullStreetAddress = Boolean(a?.address1 && a?.city && a?.postalCode)`.
- `isLikelyCourier = methodClass === 'courier' || (methodClass === 'unknown' && hasFullStreetAddress)`.
- `shippingMethod`: `hasPickupPoint || methodClass === 'locker'` ⇒ `'paczkomat'`, else `'kurier'` (was: `hasPickupPoint ? paczkomat : kurier`). Drives `detectMissingFields` (locker skips the address requirement) and the paczkomat input.
- `showPickupRetryHint`: add `&& !isLikelyCourier` to the existing gate.
- **AC**: courier ⇒ no hint; locker-unresolved-within-window ⇒ hint shown; locker-resolved ⇒ no hint; `shippingMethod` consults the method.

### Step 3 — tests (`generate-label-form.test.tsx`)
Add cases (mirroring the existing `renderWithProviders` + `createMockApiClient` patterns):
- **#953**: mock the generate-label mutation to resolve `{ kind: 'omp_fulfilled' }` → assert no "Label generated" toast, an info message present, no label download; and `{ kind: 'dispatched', shipment: { id, labelPdfRef } }` → success toast + download invoked.
- **#954**: courier order (`shipping.methodId` courier, async platform, young, no pickup) → hint NOT shown; locker order (locker method, no pickup, async, young) → hint shown; locker order with pickup resolved → no hint; unknown-method + full street address → no hint (interim heuristic).

## Risks & validation

- **Heuristic misclassification** (#954): a locker method whose name lacks a known token would be treated as courier and suppress a genuine hint. Bounded: method-present courier classification only triggers on a real method string; the keyword list covers the Allegro/InPost locker vocabulary; #952 makes it authoritative later. Documented as heuristic.
- **`shippingMethod` change downstream**: now an order can be `paczkomat` via method without a `pickupPoint` id — the paczkomat input renders empty (operator types it), matching the existing InPost-direct flow; `detectMissingFields` correctly drops the address requirement. Covered by tests.
- **No backend/Schema/contract change** ⇒ no `check:invariants`, migration, or barrel impact.
- Gate: `pnpm lint` / `type-check` / `test` (web suite via `jest`/vitest) green; the new pre-commit `smart-test` will scope to `@openlinker/web`.

## Final checklist

- [ ] #953 toast branches on `result.kind`; `omp_fulfilled` issues no label claim
- [ ] #954 hint suppressed for courier (method or street-address heuristic); preserved for unresolved locker
- [ ] `shippingMethod` consults the delivery method, not only `pickupPoint`
- [ ] Component tests cover both bugs' branches
- [ ] `pnpm lint && type-check && test` green

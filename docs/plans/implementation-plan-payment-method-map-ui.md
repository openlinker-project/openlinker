# Implementation Plan: Payment-method mapping section (#3775)

**Issue**: #3775 (backend: #3774)
**Branch**: `3775-payment-method-map-ui`, based on the local `3774-payment-method-map` branch,
whose plan (`implementation-plan-payment-method-map.md`) fixes the config key and the endpoint
contract this UI consumes. #3774 is not implemented yet; this UI is built against that contract
and verified against it once #3774 lands.

## 1. Understand

**Goal.** On the connection edit page, let an operator map the payment gateway ids their
PrestaShop / WooCommerce orders carry onto `Online` / `Bank transfer` / `Cash on delivery`,
without hand-editing `config.paymentMethodMap` in the raw JSON.

**Layer.** Frontend, `features/connections` (+ the payment-method mirror moved to `shared/types`).

**Non-goals.** Any backend change (#3774); re-classifying existing orders; Allegro / Erli / Shoper.

## 2. Research findings

- The edit page is one React Hook Form form (`components/EditConnectionForm.tsx`) with a raw
  `configText` JSON editor. Structured sections (`RateLimitSection`, `StockAndPricingSection`,
  `FulfilmentOwnershipSection`) follow one contract: the section calls `form.setValue`, then a
  host "whole-object serializer" (`sync…ToJson`) that runs `mergeStructuredIntoConfig`
  (`components/edit-connection.schema.ts`) into `configText`. Inputs are disabled while the
  raw JSON does not parse (`configIsParseable`). Save is the form's single submit.
- A cleared knob writes an EXPLICIT `null`, never a deleted key, because the pre-submit merge
  `{ ...fresh.config, ...input.config }` cannot remove a key (#2016, `rateLimit` clause).
- Capability gating reads `connection.enabledCapabilities`
  (`FulfilmentOwnershipSection` is shown only for `OrderProcessorManager`).
- Server state: `use-catalog-trust-query.ts` is the shape to copy (query key in
  `api/connections.query-keys.ts`, method on `api/connections.api.ts`, `enabled` gated on a
  capability).
- A save 400 already surfaces through the form's generic `updateConnection.error` alert.
- `PaymentMethodValues` is mirrored in `features/orders/api/order-snapshot.schema.ts` and guarded
  by `scripts/check-payment-method-mirror.mjs`. It can NOT be consumed through the `features/orders`
  barrel: `orders` already imports the `connections` barrel (`generate-label-form.tsx`
  `useConnectionsQuery`, `order-detail-header.tsx` `ConnectionEntityLabel`), so `connections ->
  orders` would close a runtime barrel-to-barrel cycle, and `PaymentMethodValues` is a runtime
  array that does not erase. `shared/` is the documented home for cross-feature types
  (`frontend-architecture.md`).
- The edit route (`app/routes/edit-connection.route.tsx`) has no permission guard; the detail page
  only hides the Edit entry (`write.visible`), and the form's submit gate is the demo lock
  (`write.demoReadOnly`). A role without `connections:write` can reach the form by URL, so a
  control must gate itself on `write.canWrite` (the backend 403 stays the real enforcement).
- The edit form already invalidates connection queries on a successful update; the observed
  payment-methods query is a new key and is NOT covered by that until it is added.
- `check-ui-vocabulary.mjs` scans copy in three Wave-2 folders only; `features/connections` is
  not one of them, but the copy still avoids model-internal words (no "resolver", "classifier",
  "normalised").

## 3. Design

### 3.1 Contract amendment needed in #3774

The #3774 plan returns `classifierAvailable: boolean`, which conflates two facts the UI must tell
apart: "this integration does not honour a map" (Allegro: hide the controls) and "this
integration does, but could not be reached right now" (a disabled PrestaShop: still editable).
Proposed replacement in the response:

```ts
mapSupport: 'supported' | 'unsupported' | 'unknown';
```

`unknown` = the adapter could not be built (disabled, `needs_reauth`, credential failure). Without
this the section either hides the controls on a temporarily disabled shop or offers them on a
connection that ignores them. **Folded into the #3774 plan (§3.5, commit on
`3774-payment-method-map`)**, which also makes `platformMethod` / `resolvedMethod` /
`resolvedBy` `null` unless `mapSupport` is `supported`, so the types below are nullable.

### 3.2 Data

- `api/connections.types.ts`: `ObservedPaymentMethods`, `ObservedPaymentMethod` mirroring the
  #3774 response (`sourcePaymentMethod`, `orderCount`, `lastSeenAt`, `platformMethod`,
  `operatorMethod`, `resolvedMethod`, `resolvedBy`, plus `mapSupport`, `windowDays`).
- `api/connections.api.ts`: `getObservedPaymentMethods(connectionId)`.
- `api/connections.query-keys.ts`: `observedPaymentMethods(connectionId)`.
- `hooks/use-observed-payment-methods-query.ts`: `enabled` gated on `OrderSource`.
- After a successful connection update, invalidate
  `connectionsQueryKeys.observedPaymentMethods(connectionId)`, so `operatorMethod` /
  `resolvedMethod` / `resolvedBy` never show pre-save values.
- `windowDays` is present in every `mapSupport` state (#3774 contract), so the copy never falls
  back to a hardcoded number.

### 3.2a Shared vocabulary

Move the frontend mirror to `apps/web/src/shared/types/payment-method.types.ts`
(`PaymentMethodValues`, `PaymentMethod`). `features/orders/api/order-snapshot.schema.ts` imports
it from there (re-exporting nothing new), `features/connections` imports it from there, and
`FRONTEND_FILE` in `scripts/check-payment-method-mirror.mjs` points at the new file so the guard
keeps checking the copy that is actually used.

### 3.3 Form state

- `edit-connection.schema.ts`: form field `paymentMethodMap: Record<string, PaymentMethodChoice>`
  where a choice is a `PaymentMethodValues` member or `''` (not set); structured-patch key
  `paymentMethodMap?: Record<string, PaymentMethod> | null`; a `mergeStructuredIntoConfig` clause
  that drops `''` / `unknown` entries and writes an explicit `null` when nothing is left.
- `EditConnectionForm.tsx`: `readPaymentMethodMapForm(config)` hydrates from config (keys
  lowercased + trimmed, matching the backend normaliser, so a hand-typed `PayU` lines up with the
  observed `payu`); `syncPaymentMethodMapToJson()` serializer; section mounted beside
  `FulfilmentOwnershipSection`, gated on `enabledCapabilities.includes('OrderSource')`.

### 3.4 Section (`components/payment-methods-section.tsx` + `lib/payment-methods.copy.ts`)

- Rows = observed ids ∪ ids already in the stored map. A stored mapping for a gateway not seen in
  the window is listed ("not seen in the last 90 days") rather than silently dropped by the next
  save.
- Per row: gateway id, order count, last seen, and either a read-only "Defined by the platform:
  {method}" (when `platformMethod` is set) or a select: `Not set`, `Online`, `Bank transfer`,
  `Cash on delivery`. Options are built from the mirrored `PaymentMethodValues` minus `unknown`.
- States, each distinct: loading; read failed (alert, controls hidden, stored map untouched -
  never rendered as "no gateways"); `mapSupport: 'unsupported'` (one line saying this
  integration does not use the mapping, no controls); `unknown` (controls shown with a note that
  the connection could not be reached, so platform-defined gateways cannot be marked); empty
  (no orders in the window).
- Standing copy: changes apply to orders received after saving; `Cash on delivery` pre-fills the
  order total as the amount the courier collects.
- Inputs disabled when `!configIsParseable` (divergence gate, same as every section) or when
  `!write.canWrite` (the host passes `canWrite`; the section shows the mapping read-only).
- Layout: reuse the `rate-limit-section` classes the sibling sections use. Each gateway is a
  stacked row (id + count + last seen on one line, the select or platform note below) so it fits
  390 px without horizontal scroll (`frontend-ui-style-guide.md`). `lastSeenAt` goes through the
  shared date formatter.

## 4. Steps

1. Move the mirror to `shared/types/payment-method.types.ts`; repoint `order-snapshot.schema.ts`
   and `check-payment-method-mirror.mjs` (`--self-check` and the real run stay green).
2. Types, API method, query key, hook (+ hook test with a mocked api client), and invalidation of
   the observed query on update success (+ test).
3. Schema field, structured patch, `mergeStructuredIntoConfig` clause (+ tests: drop `''` /
   `unknown`, explicit `null` when empty, sibling keys preserved).
4. `readPaymentMethodMapForm` + serializer + mount in `EditConnectionForm` (+ test: hydration
   lowercases keys; section absent without `OrderSource`).
5. Section + copy (+ `payment-methods-section.test.tsx`: each state, platform-defined row
   read-only, select change updates `configText`, stored-but-unseen row listed, controls disabled
   when JSON does not parse and when `canWrite` is false; `mapSupport: 'unknown'` shows the
   "could not be reached" note and a select for EVERY row; `unsupported` shows no select at all).

## 5. Validate

- Dependency direction: `connections` and `orders` both import the vocabulary from `shared/`;
  no new feature-to-feature edge, so no barrel cycle.
- State ownership: server state via TanStack Query; the map lives in React Hook Form; no local
  copy of the map outside the form.
- No backend knowledge of module names in the browser: "platform-defined" comes from
  `platformMethod` in the response.
- Tests: Vitest + Testing Library, run on CI.

## Risks / open questions

1. **Contract amendment (§3.1)**: folded into the #3774 plan. On `mapSupport: 'unknown'` the
   section cannot mark platform-defined gateways, so a select is shown for every row; picking a
   value for a platform-defined id is a harmless no-op (§3.6 of the #3774 plan).
2. **Built ahead of its backend**: verified only against mocks until #3774 exists.
3. **Window wording** hardcodes nothing: the "last N days" copy reads `windowDays` from the response.

## Review log

Plan tech-review (2026-10-16), folded in: the payment-method mirror moves to `shared/types`
instead of the `orders` barrel, which would have closed a runtime `orders <-> connections` barrel
cycle (§2, §3.2a, step 1); the observed query is invalidated after a save (§3.2, step 2); controls
gate themselves on `canWrite` because the edit route has no permission guard (§2, §3.4);
tests pin the `unknown` / `unsupported` distinction (step 5); layout and date formatting stated
(§3.4); `windowDays` always present (§3.2, mirrored in the #3774 plan).
